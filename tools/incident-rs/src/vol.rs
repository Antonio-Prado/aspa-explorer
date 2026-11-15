// The volatility of a prefix and of an origin, extra_detectors.py: VOL-DC (check_slow_convergence: a prefix that keeps
// receiving updates with no pause of a minute, for ten minutes and a hundred updates) and VOL-AC (check_amplified_churn:
// an origin with thousands of updates in five minutes, for hundreds of prefixes, seen from many peers).
use crate::record::Key;
use rustc_hash::{FxHashMap, FxHashSet};

const VOL_DC_GAP: i64 = 60;
const VOL_DC_SECONDS: i64 = 600;
const VOL_DC_UPDATES: u32 = 100;
const VOL_AC_WINDOW: i64 = 300;
const VOL_AC_UPDATES: u32 = 3000;
const VOL_AC_PREFIXES: usize = 300;
const VOL_AC_PEERS: usize = 8;

struct Burst { start: i64, last: i64, n: u32, fired: bool }
struct Window { start: i64, n: u32, prefixes: FxHashSet<Key>, peers: FxHashSet<u64>, fired: bool }

#[derive(Default)]
pub struct Vol { bursts: FxHashMap<Key, Burst>, churn: FxHashMap<u64, Window> }

impl Vol {
    // -> (seconds of the burst, updates) when the burst becomes a delayed convergence
    pub fn update(&mut self, key: &Key, epoch: i64) -> Option<(i64, u32)> {
        if epoch == 0 { return None; }
        match self.bursts.get_mut(key) {
            Some(b) if epoch - b.last <= VOL_DC_GAP => {
                b.n += 1;
                b.last = epoch;
                if !b.fired && epoch - b.start >= VOL_DC_SECONDS && b.n >= VOL_DC_UPDATES { b.fired = true; return Some((epoch - b.start, b.n)); }
                None
            }
            Some(b) => { *b = Burst { start: epoch, last: epoch, n: 1, fired: false }; None }
            None => { self.bursts.insert(key.clone(), Burst { start: epoch, last: epoch, n: 1, fired: false }); None }
        }
    }
    // -> (updates, peers) when the window of the origin becomes an amplified churn
    pub fn announce(&mut self, key: &Key, origin: u64, peer: u64, epoch: i64) -> Option<(u32, usize)> {
        if epoch == 0 { return None; }
        let fresh = || Window { start: epoch, n: 0, prefixes: FxHashSet::default(), peers: FxHashSet::default(), fired: false };
        let w = self.churn.entry(origin).or_insert_with(fresh);
        if epoch - w.start >= VOL_AC_WINDOW { *w = fresh(); }
        w.n += 1;
        if w.prefixes.len() < VOL_AC_PREFIXES { w.prefixes.insert(key.clone()); }
        w.peers.insert(peer);
        if !w.fired && w.n >= VOL_AC_UPDATES && w.prefixes.len() >= VOL_AC_PREFIXES && w.peers.len() >= VOL_AC_PEERS { w.fired = true; return Some((w.n, w.peers.len())); }
        None
    }
    pub fn collect_garbage(&mut self, epoch: i64) {
        self.bursts.retain(|_, b| epoch - b.last <= VOL_DC_GAP);
        self.bursts.shrink_to_fit();
        self.churn.retain(|_, w| epoch - w.start < VOL_AC_WINDOW);
    }
}
