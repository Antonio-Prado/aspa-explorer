// The ROAs of the day (the JSON that incident.py reads, xz) and check_prefix_hijack: an announcement whose origin no
// covering ROA authorises, or authorises only for a shorter prefix.
use crate::record::Net;
use rustc_hash::FxHashMap;
use serde::Deserialize;
use std::io::Read;
use std::process::{Command, Stdio};

#[derive(Deserialize)]
struct File { #[serde(default)] roas: Vec<Entry> }

#[derive(Deserialize)]
struct Entry {
    #[serde(default)] prefix: Option<String>,
    #[serde(default)] asn: Option<serde_json::Value>,
    #[serde(default, rename = "maxLength")] max_length: Option<serde_json::Value>,
    #[serde(default, rename = "max_length")] max_length_snake: Option<serde_json::Value>,
}

// Python keeps the ROAs by the text of their prefix and looks the covering prefixes up by the text that ipaddress gives
// them: a ROA whose text is not written that way is found only by an announcement with exactly that text. Those go in `odd`.
#[derive(Default)]
pub struct Roas { table: FxHashMap<Net, Vec<(u64, u8)>>, odd: FxHashMap<String, Vec<(u64, u8)>> }

fn number(v: &Option<serde_json::Value>) -> Option<u64> {
    match v { Some(serde_json::Value::Number(n)) => n.as_u64(), Some(serde_json::Value::String(s)) => s.parse().ok(), _ => None }
}

impl Roas {
    pub fn load(file: &str) -> Roas {
        let mut child = Command::new("xz").args(["-dc", file]).stdout(Stdio::piped()).spawn().expect("xz");
        let mut text = Vec::new();
        child.stdout.take().unwrap().read_to_end(&mut text).expect("read");
        child.wait().expect("xz");
        let parsed: File = serde_json::from_slice(&text).expect("the ROA file");
        let mut out = Roas::default();
        for e in parsed.roas {
            let (prefix, asn) = match (e.prefix, e.asn) { (Some(p), Some(a)) if !p.is_empty() => (p, a), _ => continue };
            let asn = match &asn { serde_json::Value::Number(n) => n.as_u64(), serde_json::Value::String(s) => s.replace("AS", "").parse().ok(), _ => None };
            let (asn, net) = match (asn, Net::parse(&prefix)) { (Some(a), Some(n)) if a != 0 || true => (a, n), _ => continue };
            // maxLength, or max_length, or the length of the prefix when neither says a number other than zero
            let max_len = number(&e.max_length).filter(|v| *v != 0).or_else(|| number(&e.max_length_snake).filter(|v| *v != 0)).unwrap_or(net.len as u64) as u8;
            let list = if net.text() == prefix { out.table.entry(net).or_default() } else { out.odd.entry(prefix).or_default() };
            if !list.contains(&(asn, max_len)) { list.push((asn, max_len)); }
        }
        out
    }
    pub fn is_empty(&self) -> bool { self.table.is_empty() && self.odd.is_empty() }
    // roa_authorises: a ROA of the prefix or of a covering one has this origin and a maxLength that allows the prefix
    pub fn authorises(&self, net: &Net, origin: u64) -> bool {
        let min_len: u8 = if net.v6 { 16 } else { 8 };
        if net.len < min_len { return false; }
        (min_len..=net.len).rev().any(|i| self.table.get(&net.supernet(i)).is_some_and(|list| list.iter().any(|(asn, max_len)| *asn == origin && net.len <= *max_len)))
    }
    // -> ("Invalid_Length" | "Invalid_Origin", the covering ROAs as (asn, maxLength), in order)
    pub fn hijack(&self, net: &Net, text: &str, origin: u64) -> Option<(&'static str, Vec<(u64, u8)>)> {
        let mut covering: Vec<(u64, u8)> = Vec::new();
        let mut add = |list: &Vec<(u64, u8)>| for r in list { if !covering.contains(r) { covering.push(*r); } };
        // the prefix itself, by its text
        if let Some(list) = self.odd.get(text) { add(list); } else if net.text() == text { if let Some(list) = self.table.get(net) { add(list); } }
        let min_len: u8 = if net.v6 { 16 } else { 8 };
        if net.len > min_len {
            let mut i = net.len - 1;
            loop {
                if let Some(list) = self.table.get(&net.supernet(i)) { add(list); }
                if i == min_len { break; }
                i -= 1;
            }
        }
        if covering.is_empty() { return None; }
        let (mut valid, mut invalid_length) = (false, false);
        for (asn, max_len) in &covering {
            if *asn == origin { if net.len <= *max_len { valid = true; break; } else { invalid_length = true; } }
        }
        if valid { return None; }
        covering.sort();
        Some((if invalid_length { "Invalid_Length" } else { "Invalid_Origin" }, covering))
    }
}
