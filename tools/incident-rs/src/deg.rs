// DEG, check_deaggregation of incident.py: a more specific (a /24 or longer, a /48 or longer) under an aggregate (/16 to
// /22, a /32) that another AS originates, unless that is the ordinary use of address space (X-10: a ROA authorises the
// origin of the more specific, or CAIDA knows a link between the two origins). The more specifics seen before their
// aggregate wait for it, a day at most, and are judged when it comes (retroactive).
use crate::record::Net;
use crate::rel::Relationships;
use crate::roas::Roas;
use indexmap::IndexMap;
use rustc_hash::{FxBuildHasher, FxHashMap};

const BASELINE_TTL_SECONDS: i64 = 2_592_000;
const PENDING_TTL_SECONDS: i64 = 86_400;

// a more specific that waits: Python keys it by the text of the record, so a text that is not the way Python writes the
// network is another key (`odd`)
#[derive(PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
struct Waiting { net: Net, origin: u64, odd: Option<Box<str>> }

pub enum Hit {
    // the aggregate, its origin
    Specific(Net, u64),
    // the aggregate (the announcement itself) and the first five more specifics that waited: prefix, origin, when seen
    Retroactive(Net, Vec<(String, u64, i64)>),
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Deg {
    aggregates: FxHashMap<Net, (u64, i64)>,
    // in the order they came, as the dictionary of Python: the first five are the ones told
    pending: FxHashMap<Net, IndexMap<Waiting, i64, FxBuildHasher>>,
}

fn limits(v6: bool) -> (u8, u8, u8) { if v6 { (48, 32, 32) } else { (24, 22, 16) } }   // specific from, aggregate up to, covering from

impl Deg {
    pub fn announce(&mut self, net: &Net, text: &str, origin: u64, epoch: i64, rel: &Relationships, roas: &Roas) -> Option<Hit> {
        let (specific_min, aggregate_max, cover_from) = limits(net.v6);
        if net.len >= specific_min {
            for len in cover_from..=aggregate_max {
                let cover = net.supernet(len);
                if let Some((parent, _)) = self.aggregates.get(&cover) {
                    // the shortest aggregate decides, whatever it says
                    return if *parent != origin && !ordinary(net, origin, *parent, rel, roas) { Some(Hit::Specific(cover, *parent)) } else { None };
                }
            }
            for len in cover_from..=aggregate_max {
                let odd = if net.text() == text { None } else { Some(text.into()) };
                self.pending.entry(net.supernet(len)).or_default().insert(Waiting { net: *net, origin, odd }, epoch);
            }
        } else if net.len <= aggregate_max {
            // a shorter aggregate than the covering ones is never looked up: Python keeps it, to no effect
            if net.len < cover_from { return None; }
            self.aggregates.insert(*net, (origin, epoch));
            if let Some(waiting) = self.pending.remove(net) {
                let flagged: Vec<(String, u64, i64)> = waiting.iter()
                    .filter(|(w, _)| w.origin != origin && !ordinary(&w.net, w.origin, origin, rel, roas))
                    .take(5)
                    .map(|(w, ts)| (w.odd.as_ref().map(|s| s.to_string()).unwrap_or_else(|| w.net.text()), w.origin, *ts))
                    .collect();
                if !flagged.is_empty() { return Some(Hit::Retroactive(*net, flagged)); }
            }
        }
        None
    }
    // from a state of incident.py
    pub fn import_aggregate(&mut self, net: Net, origin: u64, ts: i64) { if net.len >= limits(net.v6).2 { self.aggregates.insert(net, (origin, ts)); } }
    pub fn import_pending(&mut self, cover: Net, text: &str, origin: u64, ts: i64) {
        if let Some(net) = Net::parse(text) {
            let odd = if net.text() == text { None } else { Some(text.into()) };
            self.pending.entry(cover).or_default().insert(Waiting { net, origin, odd }, ts);
        }
    }
    pub fn collect_garbage(&mut self, epoch: i64) {
        self.aggregates.retain(|_, (_, ts)| epoch - *ts <= BASELINE_TTL_SECONDS);
        self.pending.retain(|_, waiting| {
            if waiting.values().any(|ts| epoch - *ts > PENDING_TTL_SECONDS) {
                waiting.retain(|_, ts| epoch - *ts <= PENDING_TTL_SECONDS);
                waiting.shrink_to_fit();
            }
            !waiting.is_empty()
        });
    }
}

fn ordinary(sub: &Net, sub_origin: u64, parent_origin: u64, rel: &Relationships, roas: &Roas) -> bool {
    rel.linked(parent_origin, sub_origin) || rel.linked(sub_origin, parent_origin) || roas.authorises(sub, sub_origin)
}
