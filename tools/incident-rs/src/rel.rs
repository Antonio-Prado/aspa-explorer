// The relationships of CAIDA (serial-2, bzip2) and check_route_leak of incident.py: a route that an AS learned from a
// provider or a peer and passed on to a provider or a peer.
use rustc_hash::FxHashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

const P2C: u8 = 1;
const C2P: u8 = 2;
const P2P: u8 = 3;

#[derive(Default)]
pub struct Relationships { table: FxHashMap<u64, u8> }

pub struct Leak { pub from: u64, pub by: u64, pub to: u64, pub kind: &'static str, pub learned_from: &'static str }

fn key(a: u64, b: u64) -> u64 { (a << 32) | (b & 0xffff_ffff) }

impl Relationships {
    pub fn load(file: &str) -> Relationships {
        let mut child = Command::new("bzip2").args(["-dc", file]).stdout(Stdio::piped()).spawn().expect("bzip2");
        let mut table = FxHashMap::default();
        for line in BufReader::new(child.stdout.take().unwrap()).lines() {
            let line = line.expect("read");
            if line.starts_with('#') { continue; }
            let mut p = line.trim().split('|');
            let (a, b, t) = match (p.next().and_then(|x| x.parse::<u64>().ok()), p.next().and_then(|x| x.parse::<u64>().ok()), p.next().and_then(|x| x.parse::<i64>().ok())) {
                (Some(a), Some(b), Some(t)) => (a, b, t),
                _ => continue,
            };
            // a later line replaces an earlier one, as the assignments of the Python dictionary do
            if t == -1 { table.insert(key(a, b), P2C); table.insert(key(b, a), C2P); } else if t == 0 { table.insert(key(a, b), P2P); table.insert(key(b, a), P2P); }
        }
        child.wait().expect("bzip2");
        Relationships { table }
    }
    pub fn is_empty(&self) -> bool { self.table.is_empty() }
    // whether CAIDA has the pair, in this order, with any relationship
    pub fn linked(&self, a: u64, b: u64) -> bool { self.table.contains_key(&key(a, b)) }
    // the path as the collector has it, neighbour first: the first AS that passes on what it should not
    pub fn leak(&self, path: &[u64]) -> Option<Leak> {
        if path.len() < 3 { return None; }
        for i in 1..path.len() - 1 {
            let (to, by, from) = (path[i - 1], path[i], path[i + 1]);
            let (inward, outward) = (self.table.get(&key(from, by)).copied(), self.table.get(&key(by, to)).copied());
            if matches!(inward, Some(P2C) | Some(P2P)) && matches!(outward, Some(C2P) | Some(P2P)) {
                return Some(Leak { from, by, to, kind: if outward == Some(C2P) { "UL" } else { "LL" }, learned_from: if inward == Some(P2C) { "provider" } else { "peer" } });
            }
        }
        None
    }
}
