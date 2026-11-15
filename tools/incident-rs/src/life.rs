// The incidents: process_record of incident.py. Each detection opens the incident of its actor or adds to the one that
// is open; an incident ends when nothing has been added to it for a quarter of an hour (ten minutes for the volatility),
// which is looked at every ten minutes of the time of the data, and is then written, one JSON object a line, as
// flush_incident writes it.
//   incident-rs incidents [--caida FILE.bz2] [--roas FILE.json.xz] [--delegations DIR] [--links FILE] [--open OPEN.jsonl] IN.jsonl.gz OUT.jsonl
// --open: at the end the incidents that are still open are written there (end_reason dataset_end), as --flush-open does.
use crate::atr::Session;
use crate::record::{Clock, Key, Net};
use crate::{asm, atr, deg, flaps, record, reg, rel, roas, scale, vol};
use flate2::read::MultiGzDecoder;
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};

const GC_INTERVAL_SECONDS: i64 = 600;
const TIMEOUT_SECONDS: i64 = 900;
const VOL_TIMEOUT_SECONDS: i64 = 600;
const MASS_WITHDRAWAL: u32 = 500;

#[derive(Clone, PartialEq, Eq, Hash)]
enum Actor { Dc(Key), Vol(Key), Atr(Session), Other(String) }

struct Incident {
    kind: &'static str,
    actor: Actor,
    seq: u64,
    prefixes: FxHashSet<Key>,
    peers: FxHashSet<Session>,
    start_time: String,
    start_epoch: i64,
    last_time: String,
    last_epoch: i64,
    total_updates: u64,
    details: Value,
    messages: Vec<Box<str>>,
}

impl Incident {
    // add_message: the incident starts at its earliest update and ends at its latest; the first two messages and the
    // last two are kept, the second moving on at the powers of two
    fn add(&mut self, line: &str, ts: &str, epoch: i64) {
        self.total_updates += 1;
        if epoch >= self.last_epoch { self.last_time.clear(); self.last_time.push_str(ts); self.last_epoch = epoch; }
        if 0 < epoch && epoch < self.start_epoch { self.start_time.clear(); self.start_time.push_str(ts); self.start_epoch = epoch; }
        if self.messages.len() < 4 { self.messages.push(line.into()); } else {
            if self.total_updates & (self.total_updates - 1) == 0 { self.messages.swap(1, 2); }
            self.messages.swap(2, 3);
            self.messages[3] = line.into();
        }
    }
}

#[derive(Default)]
struct Open {
    slots: Vec<Option<Incident>>,
    free: Vec<u32>,
    by_actor: FxHashMap<Actor, u32>,
    // prefix -> the incidents that have it and that a withdrawal can belong to (not the volatility, not the session)
    by_prefix: FxHashMap<Key, Vec<u32>>,
    seq: u64,
}

impl Open {
    fn get(&mut self, actor: &Actor) -> Option<&mut Incident> {
        let id = *self.by_actor.get(actor)?;
        self.slots[id as usize].as_mut()
    }
    #[allow(clippy::too_many_arguments)]
    fn open(&mut self, kind: &'static str, actor: Actor, prefix: Option<&Key>, peer: Session, ts: &str, epoch: i64, details: Value, line: &str, total_updates: u64) -> u32 {
        self.seq += 1;
        let inc = Incident { kind, actor: actor.clone(), seq: self.seq, prefixes: prefix.into_iter().cloned().collect(), peers: std::iter::once(peer).collect(),
            start_time: ts.to_string(), start_epoch: epoch, last_time: ts.to_string(), last_epoch: epoch, total_updates, details, messages: vec![line.into()] };
        let id = match self.free.pop() { Some(i) => { self.slots[i as usize] = Some(inc); i } None => { self.slots.push(Some(inc)); (self.slots.len() - 1) as u32 } };
        self.by_actor.insert(actor, id);
        id
    }
    fn index(&mut self, id: u32, prefix: &Key) {
        let ids = self.by_prefix.entry(prefix.clone()).or_default();
        if !ids.contains(&id) { ids.push(id); }
    }
    // check_timeouts: the incidents that end, in the order they were opened
    fn expired(&mut self, epoch: i64) -> Vec<Incident> {
        let mut out = Vec::new();
        for id in 0..self.slots.len() {
            let ended = match &self.slots[id] { Some(inc) => epoch - inc.last_epoch > if inc.kind == "VOL" { VOL_TIMEOUT_SECONDS } else { TIMEOUT_SECONDS }, None => false };
            if !ended { continue; }
            let inc = self.slots[id].take().unwrap();
            self.free.push(id as u32);
            self.by_actor.remove(&inc.actor);
            for p in &inc.prefixes {
                if let Some(ids) = self.by_prefix.get_mut(p) {
                    ids.retain(|i| *i != id as u32);
                    if ids.is_empty() { self.by_prefix.remove(p); }
                }
            }
            out.push(inc);
        }
        out.sort_by_key(|i| i.seq);
        out
    }
    fn all(&mut self) -> Vec<Incident> {
        let mut out: Vec<Incident> = self.slots.drain(..).flatten().collect();
        out.sort_by_key(|i| i.seq);
        out
    }
}

fn actor_text(a: &Actor, atr: &atr::Atr) -> String {
    match a { Actor::Dc(k) => format!("VOLDC_{}", k.text()), Actor::Vol(k) => format!("VOL_{}", k.text()), Actor::Atr(s) => format!("ATR_{}", atr.tag(*s)), Actor::Other(s) => s.clone() }
}

// flush_incident
fn flush(out: &mut impl Write, inc: &Incident, reason: &str, atr: &atr::Atr) {
    let mut prefixes: Vec<String> = inc.prefixes.iter().map(Key::text).collect();
    prefixes.sort();
    write!(out, "{{\"incident_type\": {}, \"actor_key\": {}, \"prefixes\": {}, \"start\": {}, \"end\": {}, \"end_reason\": {}, \"total_updates\": {}, \"details\": {}, \"messages\": [",
        json!(inc.kind), json!(actor_text(&inc.actor, atr)), json!(prefixes), json!(inc.start_time), json!(inc.last_time), json!(reason), inc.total_updates, inc.details).unwrap();
    for (i, m) in inc.messages.iter().enumerate() { if i > 0 { out.write_all(b", ").unwrap(); } out.write_all(m.as_bytes()).unwrap(); }
    out.write_all(b"]}\n").unwrap();
}

fn opt(v: Option<u64>) -> Value { v.map(Value::from).unwrap_or(Value::Null) }

pub fn run(args: &[String]) {
    let (mut caida, mut roa_file, mut delegations, mut link_file, mut open_file, mut files) = (None, None, None, None, None, Vec::new());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--caida" => caida = it.next().cloned(),
            "--roas" => roa_file = it.next().cloned(),
            "--delegations" => delegations = it.next().cloned(),
            "--links" => link_file = it.next().cloned(),
            "--open" => open_file = it.next().cloned(),
            _ => files.push(a.clone()),
        }
    }
    if files.len() != 2 {
        eprintln!("usage: incident-rs incidents [--caida FILE.bz2] [--roas FILE.json.xz] [--delegations DIR] [--links FILE] [--open OPEN.jsonl] IN.jsonl.gz OUT.jsonl");
        std::process::exit(2);
    }
    let rel = caida.as_deref().map(rel::Relationships::load).unwrap_or_default();
    let roas = roa_file.as_deref().map(roas::Roas::load).unwrap_or_default();
    let registry = delegations.as_deref().map(reg::Registry::load).unwrap_or_default();
    let links = link_file.as_deref().map(asm::Links::load).unwrap_or_default();

    let input = BufReader::with_capacity(1 << 20, MultiGzDecoder::new(File::open(&files[0]).expect("input")));
    let mut out = BufWriter::with_capacity(1 << 20, File::create(&files[1]).expect("output"));
    let (mut flaps, mut deg, mut scale, mut vol, mut atr) = (flaps::Flaps::default(), deg::Deg::default(), scale::Scale::default(), vol::Vol::default(), atr::Atr::default());
    let mut open = Open::default();
    let mut clock = Clock::default();
    let mut scale_hits = Vec::new();
    let mut anomalies: Vec<(&'static str, Actor, Value)> = Vec::new();
    let (mut last_gc, mut n, mut written) = (None::<i64>, 0u64, 0u64);
    for raw in input.split(b'\n') {
        let raw = raw.expect("read");
        let line = match std::str::from_utf8(&raw) { Ok(l) => l.trim(), Err(_) => continue };
        if line.is_empty() { continue; }
        let rec = match record::parse(line.as_bytes()) { Some(r) => r, None => continue };
        n += 1;
        let collector = rec.collector.unwrap_or("None");
        let (ts, peer) = (rec.timestamp.unwrap_or(""), rec.peer.unwrap_or(0));
        if rec.kind == "N" || rec.kind == "S" {
            // the messages of the session: they have no prefix
            if peer == 0 || ts.is_empty() { continue; }
            let session = atr.session(collector, peer);
            let epoch = clock.epoch(ts);
            if rec.kind == "S" { atr.state(session, epoch, rec.state.unwrap_or("None")); continue; }
            if let Some(kind) = atr::kind(rec.code, rec.subcode) {
                let actor = Actor::Other(format!("ATR_{}_{}", kind, atr.tag(session)));
                match open.get(&actor) {
                    Some(inc) => inc.add(line, ts, epoch),
                    None => {
                        let details = json!({"anomaly": "Session ended by an UPDATE message error", "atr_type": kind, "peer": peer, "collector": rec.collector, "code": rec.code, "subcode": rec.subcode});
                        open.open("ATR", actor, None, session, ts, epoch, details, line, 1);
                    }
                }
            }
            continue;
        }
        let prefix = rec.prefix.unwrap_or("");
        if prefix.is_empty() || peer == 0 || ts.is_empty() { continue; }
        let epoch = clock.epoch(ts);
        if epoch > 0 {
            let since = *last_gc.get_or_insert(epoch);
            if epoch - since > GC_INTERVAL_SECONDS {
                for inc in open.expired(epoch) { flush(&mut out, &inc, "timeout", &atr); written += 1; }
                flaps.collect_garbage(epoch);
                deg.collect_garbage(epoch);
                scale.collect_garbage(epoch);
                vol.collect_garbage(epoch);
                atr.collect_garbage(epoch);
                last_gc = Some(epoch);
            }
        }
        let session = atr.session(collector, peer);
        let net = Net::parse(prefix);
        let key = Key::of(prefix, net.as_ref());

        // an update of a prefix whose delayed convergence is already an incident belongs to it
        let dc = Actor::Dc(key.clone());
        match open.get(&dc) {
            Some(inc) => inc.add(line, ts, epoch),
            None => if let Some((seconds, updates)) = vol.update(&key, epoch) {
                let details = json!({"anomaly": "Delayed convergence candidate", "vol_type": "DC", "burst_seconds": seconds, "updates": updates, "gap_seconds": 60});
                open.open("VOL", dc, Some(&key), session, ts, epoch, details, line, updates as u64);
            }
        }

        let flap = match (&net, epoch != 0 && (rec.kind == "A" || rec.kind == "W")) { (Some(net), true) => flaps.event(net, collector, peer, epoch, rec.kind == "A"), _ => 0 };
        let flapping = if flap > 0 { flaps.flapping(&key, peer, epoch) } else { 0 };

        if rec.kind == "W" {
            if epoch > 0 {
                let count = atr.withdrawal(session, epoch);
                if count > MASS_WITHDRAWAL {
                    let actor = Actor::Atr(session);
                    match open.get(&actor) {
                        Some(inc) => { inc.prefixes.insert(key.clone()); inc.add(line, ts, epoch); }
                        None => {
                            let mut details = json!({"dropping_peer": peer, "collector": rec.collector, "withdrawal_count": count});
                            if let Some(note) = atr.note(session, epoch).filter(|s| !s.is_empty()) { details["session_event"] = json!(note); }
                            open.open("ATR", actor, Some(&key), session, ts, epoch, details, line, 1);
                        }
                    }
                }
            }
            if flapping > 0 {
                let actor = Actor::Vol(key.clone());
                match open.get(&actor) {
                    Some(inc) => vol_again(inc, session, flapping, line, ts, epoch),
                    None => {
                        // the flaps that triggered the detection are already part of the incident
                        let details = json!({"flap_count": flap, "window_seconds": 300, "vol_type": "FO", "peers": flapping});
                        open.open("VOL", actor, Some(&key), session, ts, epoch, details, line, flap as u64);
                    }
                }
            }
            // a withdrawal belongs to an incident only if the peer that sends it announced the anomaly
            if let Some(ids) = open.by_prefix.get(&key) {
                for id in ids.clone() {
                    if let Some(inc) = open.slots[id as usize].as_mut() {
                        if inc.kind != "VOL" && inc.kind != "ATR" && inc.peers.contains(&session) { inc.add(line, ts, epoch); }
                    }
                }
            }
            continue;
        }
        if rec.kind != "A" { continue; }

        if flapping > 0 {
            if let Some(inc) = open.get(&Actor::Vol(key.clone())) { vol_again(inc, session, flapping, line, ts, epoch); }
        }
        anomalies.clear();
        let origin_text = rec.origin.map(|o| o.to_string()).unwrap_or_else(|| "None".into());
        if let Some(path) = &rec.path {
            if let Some(l) = rel.leak(path) {
                anomalies.push(("RLK", Actor::Other(format!("RLK_{}_{}_{}", l.from, l.by, l.to)),
                    json!({"anomaly": "Valley-Free Violation (Route Leak)", "from": l.from, "by": l.by, "to": l.to, "path": path, "rlk_type": l.kind, "learned_from": l.learned_from})));
            }
        }
        if let (Some(net), Some(origin)) = (&net, rec.origin) {
            if let Some((kind, covering)) = roas.hijack(net, prefix, origin) {
                let anomaly = if kind == "Invalid_Length" { "Invalid_Length (Sub-Prefix Hijack)" } else { "Invalid_Origin (Prefix Hijack)" };
                let expected: Vec<Value> = covering.iter().map(|(a, l)| json!([a, l])).collect();
                anomalies.push(("PRH", Actor::Other(format!("PRH_{}", origin)), json!({"anomaly": anomaly, "expected_roas": expected, "actual_origin": origin, "prefix": prefix})));
            }
        }
        if let Some(kind) = net.as_ref().and_then(|net| registry.unallocated(net)) {
            anomalies.push(("PRH", Actor::Other(format!("PRH_AB_{}", origin_text)),
                json!({"anomaly": "Prefix in space that is not allocated (abusive hijack candidate)", "prh_type": "AB", "kind": kind, "prefix": prefix, "actual_origin": opt(rec.origin)})));
        }
        // the AS numbers of the path first: a link to a number that is not allocated would be flagged again as a forged link
        if let Some(path) = &rec.path {
            match asm::check(path, &registry, &rel, &links) {
                Some(asm::Hit::Number(kind, asn, why)) => {
                    let anomaly = match why { "loop" => "Poisoning candidate (an AS comes back in the path)", "private" => "Extension candidate (private AS number in the path)", _ => "Poisoning candidate (AS number that is not allocated)" };
                    anomalies.push(("ASM", Actor::Other(format!("ASM_{}_{}", kind, asn)), json!({"anomaly": anomaly, "asm_type": kind, "asn": asn, "asn_kind": why, "path": path})));
                }
                Some(asm::Hit::Link(kind, a, b)) => {
                    let anomaly = if kind == "FI" { "Forged origin candidate (link not in CAIDA)" } else { "Path shortening candidate (link not in CAIDA)" };
                    anomalies.push(("ASM", Actor::Other(format!("ASM_{}_{}_{}", kind, a, b)), json!({"anomaly": anomaly, "asm_type": kind, "link": [a, b], "path": path})));
                }
                None => {}
            }
        }
        if let (Some(net), Some(origin)) = (&net, rec.origin) {
            match deg.announce(net, prefix, origin, epoch, &rel, &roas) {
                Some(deg::Hit::Specific(parent, parent_origin)) => anomalies.push(("DEG", Actor::Other(format!("DEG_{}", origin)),
                    json!({"anomaly": "Cross-Origin Deaggregation", "parent_aggregate": parent.text(), "parent_origin": parent_origin, "sub_prefix": prefix, "sub_origin": origin}))),
                Some(deg::Hit::Retroactive(parent, specifics)) => {
                    let covered: Vec<Value> = specifics.iter().map(|(p, o, t)| json!([p, o, t])).collect();
                    anomalies.push(("DEG", Actor::Other(format!("DEG_{}", origin)),
                        json!({"anomaly": "Cross-Origin Deaggregation (Retroactive)", "parent_aggregate": parent.text(), "parent_origin": origin, "covered_specifics": covered})));
                }
                None => {}
            }
            scale_hits.clear();
            scale.announce(net, &key, origin, peer, epoch, &mut scale_hits);
            for h in &scale_hits {
                let anomaly = match h.kind { "flood" => "Fragmentation flood candidate", "excessive" => "Excessive deaggregation candidate", _ => "Jump in the more specifics of an origin" };
                let mut details = json!({"anomaly": anomaly, "deg_type": h.kind});
                if let Some(m2) = h.twice_median { details["median_before"] = if h.median_of_two { json!(m2 as f64 / 2.0) } else { json!(m2 / 2) }; }
                details["origin"] = json!(origin);
                details["aggregate"] = json!(h.aggregate.text());
                details["more_specifics"] = json!(h.more_specifics);
                details["origin_more_specifics"] = json!(h.origin_more_specifics);
                anomalies.push(("DEG", Actor::Other(format!("DEG_{}_{}", h.kind, origin)), details));
            }
        }
        if let Some(origin) = rec.origin {
            if let Some((updates, peers)) = vol.announce(&key, origin, peer, epoch) {
                anomalies.push(("VOL", Actor::Other(format!("VOLAC_{}", origin)),
                    json!({"anomaly": "Amplified churn candidate", "vol_type": "AC", "origin": origin, "updates": updates, "window_seconds": 300, "peers": peers})));
            }
        }
        for (kind, actor, details) in anomalies.drain(..) {
            let id = match open.by_actor.get(&actor).copied() {
                Some(id) => {
                    let inc = open.slots[id as usize].as_mut().unwrap();
                    inc.prefixes.insert(key.clone());
                    inc.peers.insert(session);
                    inc.add(line, ts, epoch);
                    id
                }
                None => open.open(kind, actor, Some(&key), session, ts, epoch, details, line, 1),
            };
            if kind != "VOL" { open.index(id, &key); }
        }
    }
    out.flush().unwrap();
    let left = open.all();
    if let Some(f) = open_file {
        let mut o = BufWriter::new(File::create(f).expect("the file of the open incidents"));
        for inc in &left { flush(&mut o, inc, "dataset_end", &atr); }
    }
    println!("{} records, {} incidents written, {} still open", n, written, left.len());
}

fn vol_again(inc: &mut Incident, session: Session, peers: usize, line: &str, ts: &str, epoch: i64) {
    inc.peers.insert(session);
    let before = inc.details.get("peers").and_then(Value::as_u64).unwrap_or(0);
    inc.details["peers"] = json!(before.max(peers as u64));
    inc.add(line, ts, epoch);
}
