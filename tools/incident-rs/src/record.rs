// A record of the files that stream.py and mrt2records.py write (one JSON object a line), and what is read from it.
use serde::Deserialize;
use std::net::IpAddr;

#[derive(Deserialize)]
pub struct Rec<'a> {
    #[serde(rename = "type")]
    pub kind: &'a str,
    #[serde(default)]
    pub collector: Option<&'a str>,
    #[serde(default)]
    pub timestamp: Option<&'a str>,
    #[serde(default)]
    pub prefix: Option<&'a str>,
    #[serde(default)]
    pub peer: Option<u64>,
    #[serde(default)]
    pub origin: Option<u64>,
    #[serde(default, rename = "compressed_path")]
    pub path: Option<Vec<u64>>,
}

// the same without the fields that can hold something else than numbers (an AS path with an AS_SET): the record still counts
#[derive(Deserialize)]
struct Bare<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(default)]
    collector: Option<&'a str>,
    #[serde(default)]
    timestamp: Option<&'a str>,
    #[serde(default)]
    prefix: Option<&'a str>,
    #[serde(default)]
    peer: Option<u64>,
}

pub fn parse(line: &[u8]) -> Option<Rec<'_>> {
    if let Ok(r) = serde_json::from_slice::<Rec>(line) { return Some(r); }
    let b: Bare = serde_json::from_slice(line).ok()?;
    Some(Rec { kind: b.kind, collector: b.collector, timestamp: b.timestamp, prefix: b.prefix, peer: b.peer, origin: None, path: None })
}

// "YYYY-MM-DD HH:MM:SS" (UTC) -> seconds since the epoch, 0 when it is not one (as parse_timestamp of incident.py);
// the records of the same second follow each other, so the last answer is kept
#[derive(Default)]
pub struct Clock { last: String, epoch: i64 }

impl Clock {
    pub fn epoch(&mut self, s: &str) -> i64 {
        if s != self.last { self.last.clear(); self.last.push_str(s); self.epoch = epoch_of(s); }
        self.epoch
    }
}

fn epoch_of(s: &str) -> i64 {
    let b = s.as_bytes();
    if b.len() < 19 { return 0; }
    let num = |a: usize, n: usize| -> Option<i64> {
        let mut v = 0i64;
        for &c in &b[a..a + n] { if !c.is_ascii_digit() { return None; } v = v * 10 + (c - b'0') as i64; }
        Some(v)
    };
    let (y, m, d, hh, mm, ss) = match (num(0, 4), num(5, 2), num(8, 2), num(11, 2), num(14, 2), num(17, 2)) {
        (Some(y), Some(m), Some(d), Some(hh), Some(mm), Some(ss)) => (y, m, d, hh, mm, ss),
        _ => return 0,
    };
    // days from the civil date (the algorithm of Howard Hinnant)
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) * 86400 + hh * 3600 + mm * 60 + ss
}

// A prefix as numbers: the address with the host bits cleared (as ip_network(strict=False)), its length, its family; and
// whether the text it came from is the way Python writes that network, which decides if a table keyed by text has it.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Net { pub addr: u128, pub len: u8, pub v6: bool }

impl Net {
    pub fn parse(s: &str) -> Option<Net> {
        let (a, l) = match s.split_once('/') { Some((a, l)) => (a, Some(l)), None => (s, None) };
        let ip: IpAddr = a.parse().ok()?;
        let (addr, v6, bits) = match ip { IpAddr::V4(x) => (u32::from(x) as u128, false, 32u8), IpAddr::V6(x) => (u128::from(x), true, 128u8) };
        let len: u8 = match l { Some(l) => l.parse().ok()?, None => bits };
        if len > bits { return None; }
        Some(Net { addr: addr & mask(len, bits), len, v6 })
    }
    pub fn bits(&self) -> u8 { if self.v6 { 128 } else { 32 } }
    pub fn supernet(&self, len: u8) -> Net { Net { addr: self.addr & mask(len, self.bits()), len, v6: self.v6 } }
    pub fn text(&self) -> String {
        if self.v6 { format!("{}/{}", std::net::Ipv6Addr::from(self.addr), self.len) } else { format!("{}/{}", std::net::Ipv4Addr::from(self.addr as u32), self.len) }
    }
}

fn mask(len: u8, bits: u8) -> u128 {
    if len == 0 { 0 } else { let all = if bits == 32 { u32::MAX as u128 } else { u128::MAX }; all & !((1u128 << (bits - len)) - 1).wrapping_sub(0) & all }
}
