// VOL-FO, check_state_volatility of incident.py: a prefix that one session announces and withdraws VOL_FO_FLAPS times or
// more within VOL_FO_WINDOW seconds.
use crate::record::{Key as Prefix, Net};
use rustc_hash::FxHashMap;

const VOL_FO_FLAPS: usize = 10;
const VOL_FO_WINDOW: i64 = 300;
const VOL_FO_MIN_PEERS: usize = 3;

#[derive(PartialEq, Eq, Hash, Clone, Copy)]
struct Key { addr: u128, peer: u32, collector: u16, len: u8, v6: bool }

// the events of the window: the time and one bit for an announcement; nearly always one
enum Events { One(i64), Many(Vec<i64>) }

#[derive(Default)]
pub struct Flaps { table: FxHashMap<Key, Events>, collectors: Vec<String>, peers: FxHashMap<Prefix, Vec<(u64, i64)>> }

impl Flaps {
    // one more event of the prefix from the session; the number of events of the window when it is a flap, 0 otherwise
    pub fn event(&mut self, net: &Net, collector: &str, peer: u64, epoch: i64, announce: bool) -> usize {
        let c = match self.collectors.iter().position(|x| x == collector) { Some(i) => i, None => { self.collectors.push(collector.to_string()); self.collectors.len() - 1 } } as u16;
        let key = Key { addr: net.addr, peer: peer as u32, collector: c, len: net.len, v6: net.v6 };
        let code = (epoch << 1) | announce as i64;
        match self.table.get_mut(&key) {
            None => { self.table.insert(key, Events::One(code)); 0 }
            Some(slot) => {
                if let Events::One(first) = slot { *slot = Events::Many(vec![*first]); }
                let list = match slot { Events::Many(l) => l, Events::One(_) => unreachable!() };
                list.push(code);
                let oldest = epoch - VOL_FO_WINDOW;
                let drop = list.iter().take_while(|c| (**c >> 1) < oldest).count();
                if drop > 0 { list.drain(..drop); }
                if list.len() >= VOL_FO_FLAPS && list.iter().any(|c| c & 1 == 1) && !list.iter().all(|c| c & 1 == 1) { list.len() } else { 0 }
            }
        }
    }
    // flapping_prefix: the peers (AS numbers) that flap the prefix within the window; how many, when they are enough for an incident
    pub fn flapping(&mut self, prefix: &Prefix, peer: u64, epoch: i64) -> usize {
        let peers = self.peers.entry(prefix.clone()).or_default();
        match peers.iter_mut().find(|(p, _)| *p == peer) { Some((_, t)) => *t = epoch, None => peers.push((peer, epoch)) }
        peers.retain(|(_, t)| epoch - *t <= VOL_FO_WINDOW);
        if peers.len() < VOL_FO_MIN_PEERS { 0 } else { peers.len() }
    }
    pub fn collect_garbage(&mut self, epoch: i64) {
        self.peers.retain(|_, v| v.iter().map(|(_, t)| *t).max().is_some_and(|t| epoch - t <= VOL_FO_WINDOW));
        self.table.retain(|_, v| { let last = match v { Events::One(c) => *c, Events::Many(l) => *l.last().unwrap() }; epoch - (last >> 1) <= VOL_FO_WINDOW });
        self.table.shrink_to_fit();
    }
}
