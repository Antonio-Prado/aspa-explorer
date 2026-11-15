// ATR: the session. The withdrawals of a session (collector, peer AS) in the last ten seconds, counted by second as
// process_record of incident.py does (more than 500 is a mass withdrawal), the changes of state of the session (type S),
// which a mass withdrawal that follows within two minutes is told with, and the NOTIFICATIONs that end a session because
// of an update (type N, code 3: X-6 of extra_detectors.py).
use rustc_hash::FxHashMap;

const WINDOW: i64 = 10;
const SESSION_EVENT_SECONDS: i64 = 120;
const ATTRIBUTE_SUBCODES: [i64; 4] = [1, 4, 5, 9];

#[derive(Default)]
struct Withdrawals { by_second: Vec<(i64, u32)>, count: u32, last: i64 }

pub type Session = (u16, u64);

#[derive(Default)]
pub struct Atr { collectors: Vec<String>, windows: FxHashMap<Session, Withdrawals>, states: FxHashMap<Session, (i64, String)> }

impl Atr {
    pub fn session(&mut self, collector: &str, peer: u64) -> Session {
        let c = match self.collectors.iter().position(|x| x == collector) { Some(i) => i, None => { self.collectors.push(collector.to_string()); self.collectors.len() - 1 } };
        (c as u16, peer)
    }
    // `rrc00_34800`, or the AS alone when the record does not say its collector (session_tag)
    pub fn tag(&self, s: Session) -> String { let c = &self.collectors[s.0 as usize]; if c == "None" { s.1.to_string() } else { format!("{}_{}", c, s.1) } }
    // one more withdrawal of the session: how many in the last ten seconds
    pub fn withdrawal(&mut self, s: Session, epoch: i64) -> u32 {
        let w = self.windows.entry(s).or_default();
        match w.by_second.iter_mut().find(|(t, _)| *t == epoch) { Some((_, n)) => *n += 1, None => w.by_second.push((epoch, 1)) }
        w.count += 1;
        w.last = w.last.max(epoch);
        let mut gone = 0;
        w.by_second.retain(|(t, n)| if epoch - *t > WINDOW { gone += *n; false } else { true });
        w.count -= gone;
        w.count
    }
    pub fn state(&mut self, s: Session, epoch: i64, state: &str) { self.states.insert(s, (epoch, state.to_string())); }
    // the change of state of the session in the last two minutes
    pub fn note(&self, s: Session, epoch: i64) -> Option<&str> {
        self.states.get(&s).filter(|(t, _)| (0..=SESSION_EVENT_SECONDS).contains(&(epoch - *t))).map(|(_, st)| st.as_str())
    }
    pub fn collect_garbage(&mut self, epoch: i64) {
        self.windows.retain(|_, w| epoch - w.last <= WINDOW);
        self.states.retain(|_, (t, _)| epoch - *t <= SESSION_EVENT_SECONDS);
    }
}

// atr_type: MA when the subcode says that the fault is in an attribute, EH for another UPDATE message error
pub fn kind(code: Option<i64>, subcode: Option<i64>) -> Option<&'static str> {
    if code != Some(3) { return None; }
    Some(if subcode.is_some_and(|s| ATTRIBUTE_SUBCODES.contains(&s)) { "MA" } else { "EH" })
}
