// ASM, the candidates of AS path manipulation of extra_detectors.py: by the AS numbers of the path (check_path_asns: an AS
// that comes back, a number that is private, reserved or not allocated) and, when those say nothing, by its links
// (check_forged_link: a link that neither CAIDA nor the table of the collector at the start of the day knows).
use crate::reg::Registry;
use crate::rel::Relationships;
use rustc_hash::FxHashSet;

#[derive(Default)]
pub struct Links { known: FxHashSet<(u64, u64)> }

impl Links { pub fn len(&self) -> usize { self.known.len() / 2 } }

impl Links {
    pub fn load(file: &str) -> Links { Links::load_all(&[file.to_string()]) }
    pub fn load_all(files: &[String]) -> Links {
        let mut known = FxHashSet::default();
        for file in files { for line in std::fs::read_to_string(file).expect("the file of the links").lines() {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() != 2 { continue; }
            if let (Ok(a), Ok(b)) = (p[0].parse::<u64>(), p[1].parse::<u64>()) { known.insert((a, b)); known.insert((b, a)); }
        } }
        Links { known }
    }
}

pub enum Hit {
    // PE or EX, the AS number, why ("loop", "private", "reserved", "available")
    Number(&'static str, u64, &'static str),
    // FI or PS, the link
    Link(&'static str, u64, u64),
}

pub fn check(path: &[u64], reg: &Registry, rel: &Relationships, links: &Links) -> Option<Hit> {
    if path.len() < 2 { return None; }
    for (i, asn) in path.iter().enumerate() {
        if path[..i].contains(asn) { return Some(Hit::Number("PE", *asn, "loop")); }
    }
    for asn in path {
        match reg.asn_kind(*asn) {
            Some("private") => return Some(Hit::Number("EX", *asn, "private")),
            Some(kind) => return Some(Hit::Number("PE", *asn, kind)),
            None => {}
        }
    }
    if rel.is_empty() { return None; }
    let mut first = None;
    for i in 0..path.len() - 1 {
        let (a, b) = (path[i], path[i + 1]);
        if !rel.linked(a, b) && !links.known.contains(&(a, b)) {
            if i == path.len() - 2 { return Some(Hit::Link("FI", a, b)); }
            if first.is_none() { first = Some((a, b)); }
        }
    }
    first.map(|(a, b)| Hit::Link("PS", a, b))
}
