// DEG by scale, check_deaggregation_scale of extra_detectors.py: the more specifics of one origin under one aggregate
// (a /16, a /32), counted for a UTC day when two peers have them: excessive deaggregation, flood, and a jump of the count
// of an origin against its median of the last days.
use crate::record::{Key, Net};
use rustc_hash::FxHashMap;

const DEG_EXCESS: u32 = 32;
const DEG_FLOOD_V6: u32 = 1024;
const DEG_FLOOD_V4_ORIGIN: u32 = 1000;
const DEG_JUMP_FACTOR: u64 = 5;
const DEG_JUMP_MIN: u64 = 100;
const DEG_HISTORY_DAYS: usize = 7;
const DEG_JUMP_MIN_DAYS: usize = 3;

// p: the first peer that had the prefix, 0 once a second one had it and it was counted
#[derive(serde::Serialize, serde::Deserialize)]
struct Bucket { day: i64, p: FxHashMap<Key, u64>, n: u32, fired: u8 }
#[derive(serde::Serialize, serde::Deserialize)]
struct Origin { day: i64, n: u32, n4: u32, fired: u8 }

#[derive(Clone)]
pub struct Hit { pub kind: &'static str, pub aggregate: Net, pub more_specifics: u32, pub origin_more_specifics: u32, pub twice_median: Option<u64>, pub median_of_two: bool }

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Scale { buckets: FxHashMap<(u64, Net), Bucket>, origins: FxHashMap<u64, Origin>, history: FxHashMap<u64, Vec<u32>> }

fn twice_median(v: &[u32]) -> u64 {
    let mut s = v.to_vec();
    s.sort_unstable();
    let n = s.len();
    if n % 2 == 1 { 2 * s[n / 2] as u64 } else { s[n / 2 - 1] as u64 + s[n / 2] as u64 }
}

impl Scale {
    fn roll(history: &mut FxHashMap<u64, Vec<u32>>, origin: u64, n: u32) {
        let h = history.entry(origin).or_default();
        h.push(n);
        if h.len() > DEG_HISTORY_DAYS { let extra = h.len() - DEG_HISTORY_DAYS; h.drain(..extra); }
    }
    pub fn announce(&mut self, net: &Net, key: &Key, origin: u64, peer: u64, epoch: i64, out: &mut Vec<Hit>) {
        if epoch == 0 { return; }
        let (bucket, limit) = if net.v6 { (32u8, 48u8) } else { (16, 24) };
        if !(bucket < net.len && net.len <= limit) { return; }
        let day = epoch.div_euclid(86400);
        let aggregate = net.supernet(bucket);
        let b = self.buckets.entry((origin, aggregate)).or_insert_with(|| Bucket { day, p: FxHashMap::default(), n: 0, fired: 0 });
        if b.day != day { *b = Bucket { day, p: FxHashMap::default(), n: 0, fired: 0 }; }
        match b.p.get_mut(key) {
            None => { b.p.insert(key.clone(), peer); return; }
            Some(first) => { if *first == 0 || *first == peer { return; } *first = 0; }
        }
        b.n += 1;
        if let Some(o) = self.origins.get(&origin) { if o.day != day { let n = o.n; Self::roll(&mut self.history, origin, n); self.origins.remove(&origin); } }
        let o = self.origins.entry(origin).or_insert(Origin { day, n: 0, n4: 0, fired: 0 });
        o.n += 1;
        if !net.v6 { o.n4 += 1; }
        let even = self.history.get(&origin).is_some_and(|h| h.len() % 2 == 0);
        let hit = |kind, m| Hit { kind, aggregate, more_specifics: b.n, origin_more_specifics: o.n, twice_median: m, median_of_two: even };
        let before = out.len();
        if net.v6 && b.n >= DEG_FLOOD_V6 && b.fired & 2 == 0 { b.fired |= 2; out.push(hit("flood", None)); }
        else if !net.v6 && o.n4 >= DEG_FLOOD_V4_ORIGIN && o.fired & 2 == 0 { o.fired |= 2; out.push(hit("flood", None)); }
        if b.n >= DEG_EXCESS && b.fired & 1 == 0 && out.len() == before { b.fired |= 1; out.push(hit("excessive", None)); }
        if let Some(h) = self.history.get(&origin) {
            if h.len() >= DEG_JUMP_MIN_DAYS && o.fired & 4 == 0 && out.len() == before {
                let m2 = twice_median(h);
                if 2 * o.n as u64 >= (2 * DEG_JUMP_MIN).max(DEG_JUMP_FACTOR * m2) { o.fired |= 4; out.push(hit("jump", Some(m2))); }
            }
        }
    }
    // from a state of incident.py
    pub fn import_bucket(&mut self, origin: u64, aggregate: Net, day: i64, n: u32, fired: u8, p: Vec<(Key, u64)>) {
        self.buckets.insert((origin, aggregate), Bucket { day, p: p.into_iter().collect(), n, fired });
    }
    pub fn import_origin(&mut self, origin: u64, day: i64, n: u32, n4: u32, fired: u8) { self.origins.insert(origin, Origin { day, n, n4, fired }); }
    pub fn import_history(&mut self, origin: u64, history: Vec<u32>) { self.history.insert(origin, history); }
    pub fn collect_garbage(&mut self, epoch: i64) {
        let day = epoch.div_euclid(86400);
        self.buckets.retain(|_, b| b.day == day);
        self.buckets.shrink_to_fit();
        let ended: Vec<(u64, u32)> = self.origins.iter().filter(|(_, o)| o.day != day).map(|(k, o)| (*k, o.n)).collect();
        for (origin, n) in ended { Self::roll(&mut self.history, origin, n); self.origins.remove(&origin); }
    }
}
