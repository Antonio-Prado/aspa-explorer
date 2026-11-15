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

#[derive(Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
enum Actor { Dc(Key), Vol(Key), Atr(Session), Other(String) }

// the details in the state file, as their JSON text
mod json_text {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &serde_json::Value, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&v.to_string()) }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<serde_json::Value, D::Error> {
        serde_json::from_str(&String::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Incident {
    kind: String,
    actor: Actor,
    seq: u64,
    prefixes: FxHashSet<Key>,
    peers: FxHashSet<Session>,
    start_time: String,
    start_epoch: i64,
    last_time: String,
    last_epoch: i64,
    total_updates: u64,
    #[serde(with = "json_text")]
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

#[derive(Default, serde::Serialize, serde::Deserialize)]
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
        let inc = Incident { kind: kind.to_string(), actor: actor.clone(), seq: self.seq, prefixes: prefix.into_iter().cloned().collect(), peers: std::iter::once(peer).collect(),
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
    fn count(&self) -> usize { self.by_actor.len() }
    // every open incident, in the order they were opened; none is left
    fn all(&mut self) -> Vec<Incident> {
        let mut out: Vec<Incident> = self.slots.drain(..).flatten().collect();
        out.sort_by_key(|i| i.seq);
        self.free.clear(); self.by_actor.clear(); self.by_prefix.clear();
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

// what does not change while the records are read
pub struct Tables { pub rel: rel::Relationships, pub roas: roas::Roas, pub registry: reg::Registry, pub links: asm::Links }

// the open incidents and the state of the detectors: what a run leaves to the next one
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Engine {
    flaps: flaps::Flaps, deg: deg::Deg, scale: scale::Scale, vol: vol::Vol, atr: atr::Atr,
    open: Open,
    last_gc: Option<i64>,
    pub processed: Vec<String>,
    #[serde(skip)] clock: Clock,
    #[serde(skip)] scale_hits: Vec<scale::Hit>,
    #[serde(skip)] anomalies: Vec<(&'static str, Actor, Value)>,
    #[serde(skip)] pub written: u64,
}

const STATE_MAGIC: u64 = 0x4153_5041_5253_0001;       // the format of the state file: it changes with the structures above

impl Engine {
    pub fn load(file: &str) -> Option<Engine> {
        let mut f = BufReader::with_capacity(1 << 20, File::open(file).ok()?);
        let magic: u64 = bincode::deserialize_from(&mut f).ok()?;
        if magic != STATE_MAGIC { eprintln!("{}: not a state of this version", file); return None; }
        match bincode::deserialize_from(&mut f) { Ok(e) => Some(e), Err(e) => { eprintln!("could not load state: {}", e); None } }
    }
    // written whole and then renamed
    pub fn save(&self, file: &str) {
        let tmp = format!("{}.tmp", file);
        let mut f = BufWriter::with_capacity(1 << 20, File::create(&tmp).expect("the state file"));
        bincode::serialize_into(&mut f, &STATE_MAGIC).expect("write");
        bincode::serialize_into(&mut f, self).expect("write");
        f.flush().expect("write");
        drop(f);
        std::fs::rename(&tmp, file).expect("rename");
    }
    pub fn open_incidents(&self) -> usize { self.open.count() }
    // --flush-open: the incidents that are still open, written with end_reason dataset_end, and none left open
    pub fn flush_open(&mut self, out: &mut impl Write) -> usize {
        let left = self.open.all();
        for inc in &left { flush(out, inc, "dataset_end", &self.atr); }
        left.len()
    }
    // process_record
    pub fn process(&mut self, line: &str, t: &Tables, out: &mut impl Write) -> bool {
        if record::parse(line.as_bytes()).is_none() { return false; }
        self.record(line, t, out);
        true
    }
    fn record(&mut self, line: &str, t: &Tables, out: &mut impl Write) {
        let Engine { flaps, deg, scale, vol, atr, open, last_gc, clock, scale_hits, anomalies, written, .. } = self;
        let Tables { rel, roas, registry, links } = t;
    let rec = match record::parse(line.as_bytes()) { Some(r) => r, None => return };
    let collector = rec.collector.unwrap_or("None");
    let (ts, peer) = (rec.timestamp.unwrap_or(""), rec.peer.unwrap_or(0));
    if rec.kind == "N" || rec.kind == "S" {
        // the messages of the session: they have no prefix
        if peer == 0 || ts.is_empty() { return; }
        let session = atr.session(collector, peer);
        let epoch = clock.epoch(ts);
        if rec.kind == "S" { atr.state(session, epoch, rec.state.unwrap_or("None")); return; }
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
        return;
    }
    let prefix = rec.prefix.unwrap_or("");
    if prefix.is_empty() || peer == 0 || ts.is_empty() { return; }
    let epoch = clock.epoch(ts);
    if epoch > 0 {
        let since = *last_gc.get_or_insert(epoch);
        if epoch - since > GC_INTERVAL_SECONDS {
            for inc in open.expired(epoch) { flush(out, &inc, "timeout", atr); *written += 1; }
            flaps.collect_garbage(epoch);
            deg.collect_garbage(epoch);
            scale.collect_garbage(epoch);
            vol.collect_garbage(epoch);
            atr.collect_garbage(epoch);
            *last_gc = Some(epoch);
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
        return;
    }
    if rec.kind != "A" { return; }

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
        match asm::check(path, registry, rel, links) {
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
        match deg.announce(net, prefix, origin, epoch, rel, roas) {
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
        scale.announce(net, &key, origin, peer, epoch, scale_hits);
        for h in scale_hits.iter() {
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
}

// one file of records (gzip or not) through the engine
pub fn read_file(engine: &mut Engine, t: &Tables, file: &str, out: &mut impl Write) -> std::io::Result<u64> {
    let f = File::open(file)?;
    let input: Box<dyn BufRead> = if file.ends_with(".gz") { Box::new(BufReader::with_capacity(1 << 20, MultiGzDecoder::new(f))) } else { Box::new(BufReader::with_capacity(1 << 20, f)) };
    let mut n = 0;
    for raw in input.split(b'\n') {
        let raw = raw?;
        let line = match std::str::from_utf8(&raw) { Ok(l) => l.trim(), Err(_) => continue };
        if line.is_empty() { continue; }
        if engine.process(line, t, out) { n += 1; }
    }
    Ok(n)
}

pub fn run(args: &[String]) {
    let (mut caida, mut roa_file, mut delegations, mut link_file, mut open_file, mut state_file, mut files) = (None, None, None, None, None, None, Vec::new());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--caida" => caida = it.next().cloned(),
            "--roas" => roa_file = it.next().cloned(),
            "--delegations" => delegations = it.next().cloned(),
            "--links" => link_file = it.next().cloned(),
            "--open" => open_file = it.next().cloned(),
            "--state" => state_file = it.next().cloned(),
            _ => files.push(a.clone()),
        }
    }
    if files.len() != 2 {
        eprintln!("usage: incident-rs incidents [--caida FILE.bz2] [--roas FILE.json.xz] [--delegations DIR] [--links FILE] [--state FILE] [--open OPEN.jsonl] IN.jsonl[.gz] OUT.jsonl");
        std::process::exit(2);
    }
    let t = Tables { rel: caida.as_deref().map(rel::Relationships::load).unwrap_or_default(), roas: roa_file.as_deref().map(roas::Roas::load).unwrap_or_default(),
        registry: delegations.as_deref().map(reg::Registry::load).unwrap_or_default(), links: link_file.as_deref().map(asm::Links::load).unwrap_or_default() };
    let mut engine = state_file.as_deref().and_then(Engine::load).unwrap_or_default();
    let mut out = BufWriter::with_capacity(1 << 20, File::create(&files[1]).expect("output"));
    let n = read_file(&mut engine, &t, &files[0], &mut out).expect("read");
    out.flush().unwrap();
    let written = engine.written;
    let left = match open_file {
        Some(f) => { let mut o = BufWriter::new(File::create(f).expect("the file of the open incidents")); engine.flush_open(&mut o) }
        None => engine.open_incidents(),
    };
    if let Some(f) = &state_file { engine.save(f); }
    println!("{} records, {} incidents written, {} still open", n, written, left);
}

fn vol_again(inc: &mut Incident, session: Session, peers: usize, line: &str, ts: &str, epoch: i64) {
    inc.peers.insert(session);
    let before = inc.details.get("peers").and_then(Value::as_u64).unwrap_or(0);
    inc.details["peers"] = json!(before.max(peers as u64));
    inc.add(line, ts, epoch);
}

// The files that a pattern with one `*` in its last part names, sorted (what glob gives incident.py for its patterns).
fn glob(pattern: &str) -> Vec<String> {
    let (dir, name) = match pattern.rfind('/') { Some(i) => (&pattern[..i], &pattern[i + 1..]), None => (".", pattern) };
    let (before, after) = match name.split_once('*') { Some(p) => p, None => return if std::path::Path::new(pattern).exists() { vec![pattern.to_string()] } else { Vec::new() } };
    let mut out: Vec<String> = match std::fs::read_dir(dir) {
        Ok(d) => d.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.len() >= before.len() + after.len() && n.starts_with(before) && n.ends_with(after) && !n.starts_with('.'))
            .map(|n| if pattern.contains('/') { format!("{}/{}", dir, n) } else { n }).collect(),
        Err(_) => Vec::new(),
    };
    out.sort();
    out
}

const STATE_FILE: &str = "active_state.rs.bin";

// generate_incident_summary: the incidents of a file counted by type, the most frequent first
fn summary(output: &str, base: &str) {
    let mut counts: Vec<(String, u64)> = Vec::new();
    if let Ok(f) = File::open(output) {
        for line in BufReader::new(f).lines().map_while(Result::ok) {
            #[derive(serde::Deserialize)]
            struct Kind { #[serde(default)] incident_type: Option<String> }
            let kind = match serde_json::from_str::<Kind>(&line) { Ok(k) => k.incident_type.filter(|s| !s.is_empty()).unwrap_or_else(|| "unknown".into()), Err(_) => continue };
            match counts.iter_mut().find(|(k, _)| *k == kind) { Some((_, n)) => *n += 1, None => counts.push((kind, 1)) }
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));               // a stable sort: the types with the same count stay in the order they came
    let bar = "=".repeat(40);
    let mut text = format!("{bar}\n INCIDENT TYPE SUMMARY: {base}\n{bar}\n{:<35} | Count\n{}\n", "Incident Type", "-".repeat(40));
    for (kind, n) in &counts { text.push_str(&format!("{:<35} | {}\n", kind, n)); }
    text.push_str(&format!("{bar}\n"));
    let name = format!("summary_{}.txt", base);
    match std::fs::write(&name, text) { Ok(_) => println!("summary written to '{}'.", name), Err(e) => println!("could not generate summary: {}", e) }
}

// In the place of incident.py, in its working directory: the same input (data/*.jsonl, data/*.jsonl.gz, the relationships
// of CAIDA, roas/*.xz, the delegation files, the links of the table), the same incident and summary files, and a state of
// its own (active_state.rs.bin) with the files already read. A file that cannot be read whole ends the run with an error:
// nothing of it is saved, and the next run reads it again from the state of before.
pub fn run_dir(args: &[String]) {
    let flush_open = args.iter().any(|a| a == "--flush-open");
    if args.iter().any(|a| a != "--flush-open") { eprintln!("usage: incident-rs run [--flush-open]"); std::process::exit(2); }
    let env = |name: &str, default: &str| std::env::var(name).unwrap_or_else(|_| default.to_string());
    let caida = "20260901.as-rel.txt.bz2";
    let t = Tables {
        rel: if std::path::Path::new(caida).exists() { rel::Relationships::load(caida) } else { Default::default() },
        roas: roas::Roas::load_all(&glob("roas/*.xz")),
        registry: reg::Registry::load_all(&glob(&env("INCIDENTS_DELEGATIONS", "delegations/delegated-*"))),
        links: asm::Links::load_all(&glob(&env("INCIDENTS_LINKS", "links/*.txt"))),
    };
    println!("loaded {} directional relationship links, roas for {} prefixes, {} ranges that the registries list as available or reserved, {} links of the table of the collector.",
        t.rel.len(), t.roas.len(), t.registry.len(), t.links.len());
    let mut files = glob("data/*.jsonl");
    files.extend(glob("data/*.jsonl.gz"));
    files.sort();
    files.dedup();
    if files.is_empty() { println!("no files found matching data/*.jsonl, data/*.jsonl.gz."); return; }
    let mut engine = if std::path::Path::new(STATE_FILE).exists() {
        println!("loading state from previous run ('{}')...", STATE_FILE);
        Engine::load(STATE_FILE).unwrap_or_else(|| { eprintln!("the state cannot be read: move it away to start from an empty one"); std::process::exit(1) })
    } else { Engine::default() };
    let mut total = 0u64;
    for file in &files {
        if engine.processed.contains(file) { println!("skipping '{}' (already processed)...", file); continue; }
        let base = file.rsplit('/').next().unwrap().split('.').next().unwrap().to_string();
        let (output, tmp) = (format!("incidents_{}.jsonl", base), format!("incidents_{}.jsonl.tmp", base));
        println!("\nprocessing '{}' -> '{}'...", file, output);
        let mut out = BufWriter::with_capacity(1 << 20, File::create(&tmp).expect("output"));
        match read_file(&mut engine, &t, file, &mut out).and_then(|n| out.flush().map(|_| n)) {
            Ok(n) => total += n,
            Err(e) => { let _ = std::fs::remove_file(&tmp); eprintln!("\nerror reading {}: {}", file, e); std::process::exit(1); }
        }
        drop(out);
        std::fs::rename(&tmp, &output).expect("rename");
        engine.processed.push(file.clone());
        println!("\nfinished '{}'. saving {} active incidents...", file, engine.open_incidents());
        engine.save(STATE_FILE);
        summary(&output, &format!("incidents_{}", base));
    }
    if flush_open && engine.open_incidents() > 0 {
        println!("\nflushing {} open incidents at dataset end...", engine.open_incidents());
        let mut o = BufWriter::new(File::create("incidents_open.jsonl").expect("the file of the open incidents"));
        engine.flush_open(&mut o);
        o.flush().expect("write");
        engine.save(STATE_FILE);
    }
    println!("\nall files processed successfully! total raw updates evaluated: {}.", total);
}

// The state of incident.py, as ref/export_state.py writes it (one JSON array a line: what it is, then its values),
// becomes the state that `run` starts from.
pub fn import_state(args: &[String]) {
    if args.is_empty() || args.len() > 2 { eprintln!("usage: incident-rs import-state DUMP.jsonl [STATE]"); std::process::exit(2); }
    let target = args.get(1).map(String::as_str).unwrap_or(STATE_FILE);
    let mut e = Engine::default();
    let int = |v: &Value| v.as_i64().expect("a number");
    let nat = |v: &Value| v.as_u64().expect("a number");
    let text = |v: &Value| v.as_str().expect("a text").to_string();
    let collector = |v: &Value| v.as_str().unwrap_or("None").to_string();
    let key = |v: &Value| { let t = v.as_str().expect("a prefix"); Key::of(t, Net::parse(t).as_ref()) };
    let day = |v: &Value| record::epoch_of(&format!("{} 00:00:00", v.as_str().expect("a day"))).div_euclid(86400);
    let (mut lines, mut left_out) = (0u64, 0u64);
    for line in BufReader::with_capacity(1 << 20, File::open(&args[0]).expect("the dump")).lines() {
        let line = line.expect("read");
        let row: Vec<Value> = serde_json::from_str(&line).expect("a line of the dump");
        lines += 1;
        match row[0].as_str().expect("the name of the part") {
            "processed" => e.processed = row[1].as_array().unwrap().iter().map(text).collect(),
            "last_gc" => e.last_gc = row[1].as_i64(),
            "incident" => {
                let a = row[1].as_array().unwrap();
                let actor = match a[0].as_str().unwrap() {
                    "dc" => Actor::Dc(key(&a[1])),
                    "vol" => Actor::Vol(key(&a[1])),
                    "atr" => Actor::Atr(e.atr.session(&collector(&a[1]), nat(&a[2]))),
                    _ => Actor::Other(text(&a[1])),
                };
                let kind = text(&row[2]);
                e.open.seq += 1;
                let inc = Incident { kind: kind.clone(), actor: actor.clone(), seq: e.open.seq,
                    prefixes: row[3].as_array().unwrap().iter().map(key).collect(),
                    peers: row[4].as_array().unwrap().iter().map(|p| e.atr.session(&collector(&p[0]), nat(&p[1]))).collect(),
                    start_time: text(&row[5]), start_epoch: int(&row[6]), last_time: text(&row[7]), last_epoch: int(&row[8]), total_updates: nat(&row[9]),
                    details: serde_json::from_str(row[10].as_str().unwrap()).expect("the details"),
                    messages: row[11].as_array().unwrap().iter().map(|m| m.as_str().unwrap().into()).collect() };
                let prefixes: Vec<Key> = inc.prefixes.iter().cloned().collect();
                e.open.slots.push(Some(inc));
                let id = (e.open.slots.len() - 1) as u32;
                e.open.by_actor.insert(actor, id);
                if kind != "VOL" && kind != "ATR" { for p in &prefixes { e.open.index(id, p); } }
            }
            "flap" => match Net::parse(row[1].as_str().unwrap()) {
                Some(net) => e.flaps.import(&net, &collector(&row[2]), nat(&row[3]), row[4].as_array().unwrap().iter().map(int).collect()),
                None => left_out += 1,
            },
            "flap_peers" => e.flaps.import_peers(key(&row[1]), row[2].as_array().unwrap().iter().map(|p| (nat(&p[0]), int(&p[1]))).collect()),
            "withdrawals" => { let s = e.atr.session(&collector(&row[1]), nat(&row[2])); e.atr.import_window(s, row[3].as_array().unwrap().iter().map(|p| (int(&p[0]), nat(&p[1]) as u32)).collect(), nat(&row[4]) as u32, int(&row[5])); }
            "session" => { let s = e.atr.session(&collector(&row[1]), nat(&row[2])); e.atr.state(s, int(&row[3]), row[4].as_str().unwrap_or("None")); }
            "aggregate" => match (Net::parse(row[1].as_str().unwrap()), row[2].as_u64()) { (Some(net), Some(origin)) => e.deg.import_aggregate(net, origin, int(&row[3])), _ => left_out += 1 },
            "pending" => match Net::parse(row[1].as_str().unwrap()) {
                Some(cover) => for w in row[2].as_array().unwrap() { match w[1].as_u64() { Some(origin) => e.deg.import_pending(cover, w[0].as_str().unwrap(), origin, int(&w[2])), None => left_out += 1 } },
                None => left_out += 1,
            },
            "scale" => {
                let v6 = int(&row[2]) == 6;
                let number: u128 = row[3].as_str().unwrap().parse().expect("the aggregate");
                let aggregate = if v6 { Net { addr: number << 96, len: 32, v6 } } else { Net { addr: number << 16, len: 16, v6 } };
                e.scale.import_bucket(nat(&row[1]), aggregate, day(&row[4]), nat(&row[5]) as u32, nat(&row[6]) as u8, row[7].as_array().unwrap().iter().map(|p| (key(&p[0]), p[1].as_u64().unwrap_or(0))).collect());
            }
            "scale_origin" => e.scale.import_origin(nat(&row[1]), day(&row[2]), nat(&row[3]) as u32, nat(&row[4]) as u32, nat(&row[5]) as u8),
            "scale_history" => e.scale.import_history(nat(&row[1]), row[2].as_array().unwrap().iter().map(|n| nat(n) as u32).collect()),
            "burst" => e.vol.import_burst(key(&row[1]), int(&row[2]), int(&row[3]), nat(&row[4]) as u32, int(&row[5]) != 0),
            "churn" => e.vol.import_churn(nat(&row[1]), int(&row[2]), nat(&row[3]) as u32, row[4].as_array().unwrap().iter().map(key).collect(), row[5].as_array().unwrap().iter().map(nat).collect(), int(&row[6]) != 0),
            other => { eprintln!("a part of the state that is not known: {}", other); std::process::exit(1); }
        }
    }
    e.save(target);
    println!("{} lines read, {} open incidents, {} entries left out (a prefix or an origin that is not one) -> {}", lines, e.open_incidents(), left_out, target);
}
