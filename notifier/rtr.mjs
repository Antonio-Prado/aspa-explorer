// Alerts on the anomalies that the RTR monitor finds in the session with the validator (rtr.json, written every five minutes by
// scripts/build-rtr.mjs from the telemetry of RAVEN's `rtr monitor`: an independent RTR client that follows the cache as a router would,
// with a detector that compares each sync with the ones before it). Each anomaly is announced once, to the subscribers of the status alerts
// (the topic "status"); the first poll only takes note of what is already in the file. With several caches, each is watched on its own.
export const WHAT = {
  interval_since_ns: 'the time since the previous sync', sync_duration_ns: 'the duration of the sync',
  vrp_announced: 'the number of VRPs announced', vrp_withdrawn: 'the number of VRPs withdrawn',
  aspa_announced: 'the number of ASPAs announced', aspa_withdrawn: 'the number of ASPAs withdrawn',
  correlated: 'several measures of the sync at once',
  reset: 'the session was reset', error: 'an error in the session', disconnected: 'the session dropped', cache_not_ready: 'the cache was not ready',
  serial_stale: 'the cache answers but its serial has not advanced', serial_advancing: 'the serial of the cache advances again',
};
export const MAX_LINES = 10;

const at = (a) => Date.parse(a && a.at);

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
    if (seen !== null) for (const a of list) if (at(a) > seen) events.push({ ...a, cache: c.name || c.id, cache_id: c.id });
    next[c.id] = seen === null ? newest : Math.max(seen, newest);
    // the serial that stops advancing while the cache answers (and its recovery): the builder says so, the first poll only takes note.
    // The stall is told once for each serial that stalls (`since`): a session that drops and comes back with the same serial is the
    // same stall, not a new one, and its coming back is not a recovery; the recovery is a serial later than the one that stalled.
    const isStale = Boolean(c.session && c.session.serial_stale);
    const since = c.session && c.session.last_serial_change ? c.session.last_serial_change : null;
    stale[c.id] = isStale;
    told[c.id] = c.id in oldTold ? oldTold[c.id] : (oldStale[c.id] ? since : null);   // a state saved before 1.62.3 knows the stall but not its serial
    if (old && c.id in oldStale) {
      if (isStale && !oldStale[c.id] && (since === null || told[c.id] !== since)) {
        events.push({ at: when, cache: c.name || c.id, cache_id: c.id, severity: 'high', category: 'structural', trigger: 'serial_stale', since, hours: c.session.stale_after_s ? Math.round(c.session.stale_after_s / 3600) : null });
        told[c.id] = since;
      } else if (!isStale && told[c.id] !== null && !(c.session && c.session.connected === false) && (since === null || Date.parse(since) > Date.parse(told[c.id]))) {
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
  if (a.category === 'structural') return `${sev} anomaly${where} at ${utc(a.at)}: ${what}. The session itself misbehaved.`;
  return `${sev} anomaly${where} at ${utc(a.at)}: ${what} was off the baseline${raw}. The sync was unlike the ones before it.`;
};

// the lines of a message for a set of events: at most MAX_LINES, then how many more
export const describeRtrEvents = (events) => {
  const lines = events.slice(0, MAX_LINES).map(describeRtrEvent);
  if (events.length > MAX_LINES) lines.push(`And ${events.length - MAX_LINES} more, on the statistics page.`);
  return lines;
};

export function rtrSubject(events) {
  const high = events.some((e) => e.severity === 'high');
  return `ASPA Explorer: ${events.length === 1 ? 'an anomaly' : `${events.length} anomalies`} in the RTR session with the validator${high ? ' (high)' : ''}`;
}
