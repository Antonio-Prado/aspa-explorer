// The incident detectors of tools/data_scripts/incident.py and extra_detectors.py, in Rust. So far the detections, one
// line for each, the same lines as ref/detections_ref.py writes with the functions of the Python scripts; the incidents
// that group them are in life.rs.
//   incident-rs run [--flush-open]            in the working directory of incident.py, in its place (life.rs)
//   incident-rs incidents ... IN OUT          one file (life.rs)
//   incident-rs detections [--detectors LIST] [--caida FILE.bz2] [--roas FILE.json.xz] [--delegations DIR] [--links FILE] IN.jsonl.gz OUT.tsv
// The detectors: flap (VOL-FO, with the peers that see the prefix flap), rlk, prh, deg (another origin under an aggregate),
// ab (space that is not allocated), asm (the AS numbers and the links of the path), degs (deaggregation by scale),
// dc (delayed convergence), ac (amplified churn), atr (the session: mass withdrawals, NOTIFICATIONs).
mod asm;
mod atr;
mod deg;
mod flaps;
mod life;
mod record;
mod reg;
mod rel;
mod roas;
mod scale;
mod vol;

use flate2::read::MultiGzDecoder;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};

const GC_INTERVAL_SECONDS: i64 = 600;
const ALL: &str = "flap,rlk,prh,deg,ab,asm,degs,dc,ac,atr";
const MASS_WITHDRAWAL: u32 = 500;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("incidents") { return life::run(&args[1..]); }
    if args.first().map(String::as_str) == Some("run") { return life::run_dir(&args[1..]); }
    if args.first().map(String::as_str) != Some("detections") {
        eprintln!("usage: incident-rs detections [--detectors {}] [--caida FILE.bz2] [--roas FILE.json.xz] [--delegations DIR] [--links FILE] IN.jsonl.gz OUT.tsv", ALL);
        std::process::exit(2);
    }
    let (mut detectors, mut caida, mut roa_file, mut delegations, mut link_file, mut files) = (String::from(ALL), None, None, None, None, Vec::new());
    let mut it = args[1..].iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--detectors" => detectors = it.next().expect("--detectors LIST").clone(),
            "--caida" => caida = it.next().cloned(),
            "--roas" => roa_file = it.next().cloned(),
            "--delegations" => delegations = it.next().cloned(),
            "--links" => link_file = it.next().cloned(),
            _ => files.push(a.clone()),
        }
    }
    let on = |name: &str| detectors.split(',').any(|d| d == name);
    let rel = match (&caida, on("rlk") || on("deg") || on("asm")) { (Some(f), true) => rel::Relationships::load(f), _ => rel::Relationships::default() };
    let roas = match (&roa_file, on("prh") || on("deg")) { (Some(f), true) => roas::Roas::load(f), _ => roas::Roas::default() };
    let registry = match (&delegations, on("ab") || on("asm")) { (Some(d), true) => reg::Registry::load(d), _ => reg::Registry::default() };
    let links = match (&link_file, on("asm")) { (Some(f), true) => asm::Links::load(f), _ => asm::Links::default() };
    let (do_flap, do_rlk, do_prh, do_deg) = (on("flap"), on("rlk") && !rel.is_empty(), on("prh") && !roas.is_empty(), on("deg"));
    let (do_ab, do_asm, do_degs, do_dc, do_ac, do_atr) = (on("ab"), on("asm"), on("degs"), on("dc"), on("ac"), on("atr"));

    let input = BufReader::with_capacity(1 << 20, MultiGzDecoder::new(File::open(&files[0]).expect("input")));
    let mut out = BufWriter::with_capacity(1 << 20, File::create(&files[1]).expect("output"));
    let mut flaps = flaps::Flaps::default();
    let mut deg = deg::Deg::default();
    let mut scale = scale::Scale::default();
    let mut vol = vol::Vol::default();
    let mut atr = atr::Atr::default();
    let mut clock = record::Clock::default();
    let mut scale_hits = Vec::new();
    let (mut last_gc, mut n, mut hits) = (None::<i64>, 0u64, 0u64);
    for line in input.split(b'\n') {
        let line = line.expect("read");
        let rec = match record::parse(&line) { Some(r) => r, None => continue };
        if rec.kind == "N" || rec.kind == "S" {
            // the records of the session have no prefix
            if let (true, Some(ts), Some(peer)) = (do_atr, rec.timestamp, rec.peer) {
                if ts.is_empty() || peer == 0 { continue; }
                let collector = rec.collector.unwrap_or("None");
                if rec.kind == "S" {
                    let s = atr.session(collector, peer);
                    atr.state(s, clock.epoch(ts), rec.state.unwrap_or("None"));
                } else if let Some(kind) = atr::kind(rec.code, rec.subcode) {
                    hits += 1;
                    writeln!(out, "ATRN\t{}\t{}\t{}\t{}\t{}\t{}", ts, collector, peer, kind, rec.code.unwrap_or(0), rec.subcode.map(|s| s.to_string()).unwrap_or_else(|| "None".into())).unwrap();
                }
            }
            continue;
        }
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
                scale.collect_garbage(epoch);
                vol.collect_garbage(epoch);
                atr.collect_garbage(epoch);
                last_gc = Some(epoch);
            }
        }
        n += 1;
        let collector = rec.collector.unwrap_or("None");
        let net = record::Net::parse(prefix);
        let key = record::Key::of(prefix, net.as_ref());
        if do_dc {
            if let Some((seconds, updates)) = vol.update(&key, epoch) {
                hits += 1;
                writeln!(out, "DC\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, seconds, updates).unwrap();
            }
        }
        if do_atr && !announce && epoch > 0 {
            let s = atr.session(collector, peer);
            let count = atr.withdrawal(s, epoch);
            if count > MASS_WITHDRAWAL {
                hits += 1;
                writeln!(out, "ATRW\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, count, atr.note(s, epoch).unwrap_or("-")).unwrap();
            }
        }
        if do_flap && epoch != 0 {
            if let Some(net) = &net {
                let count = flaps.event(net, collector, peer, epoch, announce);
                if count > 0 {
                    hits += 1;
                    writeln!(out, "FLAP\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, count, flaps.flapping(&key, peer, epoch)).unwrap();
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
                if let Some((kind, covering)) = roas.hijack(net, prefix, origin) {
                    hits += 1;
                    let expected = covering.iter().map(|(a, l)| format!("{}/{}", a, l)).collect::<Vec<_>>().join(",");
                    writeln!(out, "PRH\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, origin, kind, expected).unwrap();
                }
            }
        }
        if do_ab {
            if let Some(kind) = net.as_ref().and_then(|net| registry.unallocated(net)) {
                hits += 1;
                writeln!(out, "AB\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, rec.origin.map(|o| o.to_string()).unwrap_or_else(|| "None".into()), kind).unwrap();
            }
        }
        if do_asm {
            match rec.path.as_ref().and_then(|path| asm::check(path, &registry, &rel, &links)) {
                Some(asm::Hit::Number(kind, asn, why)) => { hits += 1; writeln!(out, "ASM\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, kind, asn, why).unwrap(); }
                Some(asm::Hit::Link(kind, a, b)) => { hits += 1; writeln!(out, "ASML\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, kind, a, b).unwrap(); }
                None => {}
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
        if do_degs {
            if let (Some(net), Some(origin)) = (&net, rec.origin) {
                scale_hits.clear();
                scale.announce(net, &key, origin, peer, epoch, &mut scale_hits);
                for h in &scale_hits {
                    hits += 1;
                    writeln!(out, "DEGS\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, h.kind, h.aggregate.text(), h.more_specifics, h.origin_more_specifics,
                        h.twice_median.map(|m| m.to_string()).unwrap_or_else(|| "-".into())).unwrap();
                }
            }
        }
        if do_ac {
            if let Some(origin) = rec.origin {
                if let Some((updates, peers)) = vol.announce(&key, origin, peer, epoch) {
                    hits += 1;
                    writeln!(out, "AC\t{}\t{}\t{}\t{}\t{}\t{}\t{}", ts, prefix, collector, peer, origin, updates, peers).unwrap();
                }
            }
        }
    }
    println!("{} records, {} detections", n, hits);
}
