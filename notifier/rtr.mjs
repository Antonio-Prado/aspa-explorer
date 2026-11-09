// Alerts on the anomalies that the RTR monitor finds in the session with the validator (rtr.json, written every five minutes by
// scripts/build-rtr.mjs from the telemetry of RAVEN's `rtr monitor`: an independent RTR client that follows the cache as a router would,
// with a detector that compares each sync with the ones before it). Each anomaly is announced once, to the subscribers of the status alerts
// (the topic "status"); the first poll only takes note of what is already in the file.
export const WHAT = {
  interval_since_ns: 'the time since the previous sync', sync_duration_ns: 'the duration of the sync',
  vrp_announced: 'the number of VRPs announced', vrp_withdrawn: 'the number of VRPs withdrawn',
  aspa_announced: 'the number of ASPAs announced', aspa_withdrawn: 'the number of ASPAs withdrawn',
  correlated: 'several measures of the sync at once',
  reset: 'the session was reset', error: 'an error in the session', disconnected: 'the session dropped', cache_not_ready: 'the cache was not ready',
};
export const MAX_LINES = 10;

const at = (a) => Date.parse(a && a.at);

// doc: rtr.json; saved: what this function returned the previous time (null the first time, which only takes note). Returns {events, saved}:
// the anomalies newer than the newest seen before, oldest first.
export function watchRtr(doc, saved) {
  const list = doc && doc.anomalies && Array.isArray(doc.anomalies.list) ? doc.anomalies.list.filter((a) => Number.isFinite(at(a))) : [];
  const newest = list.reduce((m, a) => Math.max(m, at(a)), 0);
  if (!saved || !Number.isFinite(saved.last)) return { events: [], saved: { last: newest } };
  const events = list.filter((a) => at(a) > saved.last).sort((a, b) => at(a) - at(b));
  return { events, saved: { last: Math.max(saved.last, newest) } };
}

const utc = (s) => new Date(s).toISOString().replace(/\.\d+Z$/, '').replace('T', ' ') + ' UTC';
const value = (k, v) => (k.endsWith('_ns') ? `${Math.round(v / 1e9)} s` : String(v));

export const describeRtrEvent = (a) => {
  const sev = a.severity === 'high' ? 'High' : a.severity === 'medium' ? 'Medium' : 'An';
  const what = WHAT[a.trigger] || a.trigger || 'something in the sync';
  const raw = a.raw && a.trigger in a.raw ? ` (${value(a.trigger, a.raw[a.trigger])}` + (a.z && Number.isFinite(a.z[a.trigger]) ? `, ${a.z[a.trigger]} deviations from the usual)` : ')') : '';
  if (a.category === 'structural') return `${sev} anomaly at ${utc(a.at)}: ${what}. The session itself misbehaved.`;
  return `${sev} anomaly at ${utc(a.at)}: ${what} was off the baseline${raw}. The sync was unlike the ones before it.`;
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
