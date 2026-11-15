// The incident detectors of tools/data_scripts/incident.py, in Rust. So far: the detections of the flaps (VOL-FO), of the
// valleys in the path (RLK), of the origins that no ROA authorises (PRH) and of the more specifics of another origin (DEG), one line for each, the same lines as
// ref/detections_ref.py writes with the functions of incident.py; the incidents that group them are still to come.
//   incident-rs detections [--detectors flap,rlk,prh,deg] [--caida FILE.bz2] [--roas FILE.json.xz] IN.jsonl.gz OUT.tsv
mod deg;
mod flaps;
mod record;
mod rel;
mod roas;

use flate2::read::MultiGzDecoder;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};

const GC_INTERVAL_SECONDS: i64 = 600;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("detections") {
        eprintln!("usage: incident-rs detections [--detectors flap,rlk,prh,deg] [--caida FILE.bz2] [--roas FILE.json.xz] IN.jsonl.gz OUT.tsv");
        std::process::exit(2);
    }
    let (mut detectors, mut caida, mut roa_file, mut files) = (String::from("flap,rlk,prh,deg"), None, None, Vec::new());
    let mut it = args[1..].iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--detectors" => detectors = it.next().expect("--detectors LIST").clone(),
            "--caida" => caida = it.next().cloned(),
            "--roas" => roa_file = it.next().cloned(),
            _ => files.push(a.clone()),
        }
    }
    let on = |name: &str| detectors.split(',').any(|d| d == name);
    let rel = match (&caida, on("rlk") || on("deg")) { (Some(f), true) => rel::Relationships::load(f), _ => rel::Relationships::default() };
    let roas = match (&roa_file, on("prh") || on("deg")) { (Some(f), true) => roas::Roas::load(f), _ => roas::Roas::default() };
    let (do_flap, do_rlk, do_prh, do_deg) = (on("flap"), on("rlk") && !rel.is_empty(), on("prh") && !roas.is_empty(), on("deg"));

    let input = BufReader::with_capacity(1 << 20, MultiGzDecoder::new(File::open(&files[0]).expect("input")));
    let mut out = BufWriter::with_capacity(1 << 20, File::create(&files[1]).expect("output"));
    let mut flaps = flaps::Flaps::default();
    let mut deg = deg::Deg::default();
    let mut clock = record::Clock::default();
    let (mut last_gc, mut n, mut hits) = (None::<i64>, 0u64, 0u64);
    for line in input.split(b'\n') {
        let line = line.expect("read");
        let rec = match record::parse(&line) { Some(r) => r, None => continue };
        let announce = match rec.kind { "A" => true, "W" => false, _ => continue };
        let (prefix, ts, peer) = match (rec.prefix, rec.timestamp, rec.peer) {
            (Some(p), Some(t), Some(peer)) if !p.is_empty() && !t.is_empty() && peer != 0 => (p, t, peer),
            _ => continue,
        };
        let epoch = clock.epoch(ts);
        if epoch > 0 {
            let since = *last_gc.get_or_insert(epoch);
            if epoch - since > GC_INTERVAL_SECONDS {
                flaps.collect_garbage(epoch);
                deg.collect_garbage(epoch);
                last_gc = Some(epoch);
            }
        }
        n += 1;
        let collector = rec.collector.unwrap_or("None");
        let net = record::Net::parse(prefix);
        if do_flap && epoch != 0 {
            if let Some(net) = &net {
                let count = flaps.event(net, collector, peer, epoch, announce);
                if count > 0 {
                    hits += 1;
                    writeln!(out, "FLAP\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, count).unwrap();
                }
            }
        }
        if !announce { continue; }
        if do_rlk {
            if let Some(path) = &rec.path {
                if let Some(l) = rel.leak(path) {
                    hits += 1;
                    writeln!(out, "RLK\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, l.from, l.by, l.to, l.kind, l.learned_from).unwrap();
                }
            }
        }
        if do_prh {
            if let (Some(net), Some(origin)) = (&net, rec.origin) {
                if let Some((kind, expected)) = roas.hijack(net, prefix, origin) {
                    hits += 1;
                    writeln!(out, "PRH\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, origin, kind, expected).unwrap();
                }
            }
        }
        if do_deg {
            if let (Some(net), Some(origin)) = (&net, rec.origin) {
                match deg.announce(net, prefix, origin, epoch, &rel, &roas) {
                    Some(deg::Hit::Specific(parent, parent_origin)) => {
                        hits += 1;
                        writeln!(out, "DEG\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, parent.text(), parent_origin, origin).unwrap();
                    }
                    Some(deg::Hit::Retroactive(parent, specifics)) => {
                        hits += 1;
                        let list = specifics.iter().map(|(p, o, t)| format!("{}|{}|{}", p, o, t)).collect::<Vec<_>>().join(",");
                        writeln!(out, "DEGR\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, parent.text(), origin, list).unwrap();
                    }
                    None => {}
                }
            }
        }
    }
    println!("{} records, {} detections", n, hits);
}
