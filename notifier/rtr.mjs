// Alerts on the anomalies that the RTR monitor finds in the session with the validator (rtr.json, written every five minutes by
// scripts/build-rtr.mjs from the telemetry of RAVEN's `rtr monitor`: an independent RTR client that follows the cache as a router would,
// with a detector that compares each sync with the ones before it). Each anomaly is announced once, to the subscribers of the status alerts
// (the topic "status"); the first poll only takes note of what is already in the file. With several caches, each is watched on its own.
export const WHAT = {
  interval_since_ns: 'the time since the previous sync', sync_duration_ns: 'the duration of the sync',
  vrp_announced: 'the number of VRPs announced', vrp_withdrawn: 'the number of VRPs withdrawn',
  aspa_announced: 'the number of ASPAs announced', aspa_withdrawn: 'the number of ASPAs withdrawn',
  correlated: 'several measures of the sync at once',
  protocol_error: 'the cache sent records against the protocol',
  reset: 'the session was reset', error: 'an error in the session', disconnected: 'the session dropped', cache_not_ready: 'the cache was not ready',
  serial_stale: 'the cache answers but its serial has not advanced', serial_advancing: 'the serial of the cache advances again',
};
export const MAX_LINES = 10;

const at = (a) => Date.parse(a && a.at);

// A statistical anomaly is told only when it means something for a router. The detector says how far a sync is from the usual of its
// cache, which is not yet a reason to write to somebody: a sync a minute late on a cache polled every ten minutes is far from its usual
// and harms nobody. So a measure counts only above its median (z > 0) and above a floor that a fault would cross: a gap of half an hour
// between syncs, a sync of 10 s, a thousand VRPs or twenty ASPAs announced or withdrawn in one sync (about 0.1% of the VRPs and 0.5% of
// the ASPAs). A correlated anomaly needs two measures that count. RAVEN up to 0.4.0 also scored both tails and had no minimum deviation,
// so a cache that syncs every 600 s to the millisecond scored -90000 for a sync 9 s after the previous one and 341 for one of 0.7 s;
// later versions score the upper tail only, with a minimum deviation for each measure, and the floors here are the policy of the alerts.
export const FLOOR = { interval_since_ns: 1800e9, sync_duration_ns: 10e9, vrp_announced: 1000, vrp_withdrawn: 1000, aspa_announced: 20, aspa_withdrawn: 20 };
// A sync that brought nothing (no VRP and no ASPA announced or withdrawn) and came late is the refresh timer of a cache with nothing
// new to say: a cache whose serial stands still is asked again only when its refresh interval ends, an hour on some. That is the
// stall, which is told once when the serial has stood still for hours, not a fault of its own every hour for as long as it lasts.
const CHANGES = ['vrp_announced', 'vrp_withdrawn', 'aspa_announced', 'aspa_withdrawn'];
const empty = (a) => Boolean(a.raw) && CHANGES.every((k) => a.raw[k] === 0);
// `muted` are the measures that the alerts leave out for the cache of the anomaly (`alerts_muted` in rtr.json, from the list of the
// caches): a cache with a known fault, which would be told every day, keeps its anomalies on the page and stays quiet in the alerts.
// The VRPs announced again while the monitor held them (`repeated`, error 7 of RFC 8210) changed nothing, and in the delta of a cache
// that repeats records each is withdrawn as well: the floor is for the records that did change.
const changed = (a, k) => {
  const v = a.raw && a.raw[k];
  return Number.isFinite(v) && (k === 'vrp_announced' || k === 'vrp_withdrawn') && Number.isFinite(a.repeated) ? Math.max(0, v - a.repeated) : v;
};
function counts(a, k, muted) {
  const z = a.z && a.z[k], v = changed(a, k);
  if (muted.includes(k) || (k === 'interval_since_ns' && empty(a))) return false;
  return Number.isFinite(z) && z > 0 && (!(k in FLOOR) || (Number.isFinite(v) && v >= FLOOR[k]));
}
// the anomaly as it should be told (its trigger the strongest measure that counts), or null when it is not worth a message
export function worthTelling(a, muted = []) {
  if (a && a.category === 'structural' && muted.includes(a.trigger)) return null;
  if (!a || a.category !== 'statistical') return a;
  const z = a.z && typeof a.z === 'object' ? a.z : {};
  const keep = Object.keys(z).filter((k) => counts(a, k, muted)).sort((x, y) => z[y] - z[x]);
  if (a.trigger === 'correlated') return keep.length >= 2 ? a : null;
  if (!keep.length) {
    // an anomaly without z scores (an older file) is judged on its trigger's value alone
    const v = changed(a, a.trigger);
    return !Object.keys(z).length && !muted.includes(a.trigger) && !(a.trigger === 'interval_since_ns' && empty(a)) && (!(a.trigger in FLOOR) || (Number.isFinite(v) && v >= FLOOR[a.trigger])) ? a : null;
  }
  return keep.includes(a.trigger) ? a : { ...a, trigger: keep[0] };
}

// doc: rtr.json, with its `caches` (or the single cache of its top level); saved: what this function returned the previous time (null
// the first time, which only takes note). Returns {events, saved}: the anomalies newer than the newest seen before on their cache,
// oldest first, each with the `cache` it belongs to; `saved.last` keeps the newest time seen for each cache id.
export function watchRtr(doc, saved) {
  const caches = doc && Array.isArray(doc.caches) && doc.caches.length ? doc.caches : (doc ? [{ id: doc.cache_id || 'routinator', name: doc.cache_name || doc.cache || 'the validator', anomalies: doc.anomalies }] : []);
  const old = saved && saved.last && typeof saved.last === 'object' ? saved.last : (saved && Number.isFinite(saved.last) ? { routinator: saved.last } : null);
  const oldStale = saved && saved.stale && typeof saved.stale === 'object' ? saved.stale : {};
  const oldTold = saved && saved.told && typeof saved.told === 'object' ? saved.told : {};
  const next = {}, stale = {}, told = {}, events = [];
  const when = doc && Number.isFinite(Date.parse(doc.generated)) ? doc.generated : new Date().toISOString();
  for (const c of caches) {
    const list = c.anomalies && Array.isArray(c.anomalies.list) ? c.anomalies.list.filter((a) => Number.isFinite(at(a))) : [];
    const newest = list.reduce((m, a) => Math.max(m, at(a)), 0);
    const seen = old && Number.isFinite(old[c.id]) ? old[c.id] : null;
    if (seen !== null) for (const a of list) {
      const t = at(a) > seen ? worthTelling(a, Array.isArray(c.alerts_muted) ? c.alerts_muted : []) : null;
      if (t) events.push({ ...t, cache: c.name || c.id, cache_id: c.id });
    }
    next[c.id] = seen === null ? newest : Math.max(seen, newest);
    // the serial that stops advancing while the cache answers (and its recovery): the builder says so, the first poll only takes note.
    // The stall is told once for each serial that stalls (`since`): a session that drops and comes back with the same serial is the
    // same stall, not a new one, and its coming back is not a recovery; the recovery is a serial later than the one that stalled.
    const isStale = Boolean(c.session && c.session.serial_stale);
    const since = c.session && c.session.last_serial_change ? c.session.last_serial_change : null;
    stale[c.id] = isStale;
    told[c.id] = c.id in oldTold ? oldTold[c.id] : (oldStale[c.id] ? '' : null);   // a state saved before 1.62.3 knows the stall but not its serial
    if (old && c.id in oldStale) {
      if (isStale && !oldStale[c.id] && (since === null || told[c.id] !== since)) {
        events.push({ at: when, cache: c.name || c.id, cache_id: c.id, severity: 'high', category: 'structural', trigger: 'serial_stale', since, hours: c.session.stale_after_s ? Math.round(c.session.stale_after_s / 3600) : null });
        told[c.id] = since;
      } else if (!isStale && told[c.id] !== null && !(c.session && c.session.connected === false) && (since === null || told[c.id] === '' || Date.parse(since) > Date.parse(told[c.id]))) {
        events.push({ at: when, cache: c.name || c.id, cache_id: c.id, severity: 'medium', category: 'structural', trigger: 'serial_advancing' });
        told[c.id] = null;
      }
    } else if (isStale && !old) told[c.id] = since;   // the first poll: what is already stale is not news later either
  }
  if (!old) return { events: [], saved: { last: next, stale, told } };
  return { events: events.sort((a, b) => at(a) - at(b)), saved: { last: next, stale, told } };
}

const utc = (s) => new Date(s).toISOString().replace(/\.\d+Z$/, '').replace('T', ' ') + ' UTC';
const value = (k, v) => (k.endsWith('_ns') ? `${Math.round(v / 1e9)} s` : String(v));

export const describeRtrEvent = (a) => {
  const sev = a.severity === 'high' ? 'High' : a.severity === 'medium' ? 'Medium' : 'An';
  const what = WHAT[a.trigger] || a.trigger || 'something in the sync';
  const raw = a.raw && a.trigger in a.raw ? ` (${value(a.trigger, a.raw[a.trigger])}` + (a.z && Number.isFinite(a.z[a.trigger]) ? `, ${a.z[a.trigger]} deviations from the usual)` : ')') : '';
  const where = a.cache ? ` on ${a.cache}` : '';
  if (a.trigger === 'serial_stale') return `${sev} anomaly${where} at ${utc(a.at)}: ${what}${a.since ? ` since ${utc(a.since)}` : ''}${a.hours ? ` (more than ${a.hours} hours)` : ''}. The validator behind it, or the node of it that answers this session, has stopped publishing or stalled: its routers keep old data without an alarm.`;
  if (a.trigger === 'serial_advancing') return `${sev} anomaly${where} at ${utc(a.at)}: ${what}.`;
  if (a.trigger === 'protocol_error') return `${sev} anomaly${where} at ${utc(a.at)}: ${what}${a.repeated ? `, ${a.repeated} VRP${a.repeated === 1 ? '' : 's'} announced again while held` : ''}${a.unknown ? `${a.repeated ? ' and' : ','} ${a.unknown} record${a.unknown === 1 ? '' : 's'} withdrawn while not held` : ''}. A router that applies such a delta as it comes can lose valid records, or drops the session (RFC 8210, errors 6 and 7).`;
  if (a.category === 'structural') return `${sev} anomaly${where} at ${utc(a.at)}: ${what}. The session itself misbehaved.`;
  return `${sev} anomaly${where} at ${utc(a.at)}: ${what} was off the baseline${raw}. The sync was unlike the ones before it.`;
};

// the lines of a message for a set of events: at most MAX_LINES, then how many more
export const describeRtrEvents = (events) => {
  const lines = events.slice(0, MAX_LINES).map(describeRtrEvent);
  if (events.length > MAX_LINES) lines.push(`And ${events.length - MAX_LINES} more, on the Right now page.`);
  return lines;
};

export function rtrSubject(events) {
  const high = events.some((e) => e.severity === 'high');
  return `ASPA Explorer: ${events.length === 1 ? 'an anomaly' : `${events.length} anomalies`} in the RTR session with the validator${high ? ' (high)' : ''}`;
}
