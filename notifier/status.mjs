// Alerts on the state of the parts of the service (the checks of the status page, kept by scripts/build-status.mjs in
// status-history.json, one sample every 15 minutes). A part that changes state is announced when two samples in a row
// show the new state, so a single bad sample does not cause a message, and the same for the way back. What the monitor
// itself stops doing is a part as well: when the last sample is older than three intervals, the history is not being written.
export const MONITOR = { id: 'monitor', name: 'Status monitor', expected: 'a sample every 15 minutes' };
const WORD = { o: 'OK', l: 'late', d: 'down' };
const RANK = { o: 0, l: 1, d: 2 };

// doc: the history file; saved: what this function returned the previous time (null the first time, which only takes note);
// now: seconds. Returns {events, saved}. An event is {id, name, expected, from, to, at, since}, the letters o, l, d; `since` is when the
// part had been in the state it leaves (seconds), or null when it is not known.
export function watchStatus(doc, saved, now) {
  if (!doc || !Array.isArray(doc.checks) || !Array.isArray(doc.samples) || !doc.samples.length) return { events: [], saved };
  const info = new Map([[MONITOR.id, MONITOR], ...doc.checks.map((c) => [c.id, c])]);
  const last = doc.samples[doc.samples.length - 1][0];
  const interval = doc.interval || 900;
  const state = saved ? { t: saved.t, committed: { ...saved.committed }, pending: { ...saved.pending }, since: { ...saved.since } } : { t: 0, committed: {}, pending: {}, since: {} };
  const events = [];
  // one reading of a part: the same rule for the samples and for the monitor
  const see = (id, letter, at) => {
    if (!(letter in WORD)) return;
    if (!(id in state.committed)) { state.committed[id] = letter; state.since[id] = at; return; }   // a part seen for the first time is a starting point
    if (letter === state.committed[id]) { delete state.pending[id]; return; }
    if (state.pending[id] === letter) {
      const c = info.get(id) || { name: id, expected: '' };
      events.push({ id, name: c.name, expected: c.expected, from: state.committed[id], to: letter, at, since: state.since[id] ?? null });
      state.committed[id] = letter; state.since[id] = at; delete state.pending[id];
    } else state.pending[id] = letter;
  };
  const first = !saved;
  doc.samples.forEach(([t, letters], n) => {
    if (!first && t <= state.t) return;
    // on the first run only the last sample is taken as the starting point
    if (first && n < doc.samples.length - 1) return;
    doc.checks.forEach((c, i) => see(c.id, letters[i], t));
  });
  see(MONITOR.id, now - last > 3 * interval ? 'd' : 'o', now);
  state.t = last;
  if (first) return { events: [], saved: state };
  return { events, saved: state };
}

const duration = (s) => {
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(s / 360) / 10;
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
};
const utc = (s) => new Date(s * 1000).toISOString().replace(/\.\d+Z$/, '').replace('T', ' ') + ' UTC';

export const describeStatusEvent = (e) => {
  const back = RANK[e.to] < RANK[e.from];
  const after = e.since ? ` after ${duration(e.at - e.since)}` : '';
  if (e.to === 'o') return `${e.name}: back to OK${after} (${utc(e.at)}).`;
  const was = back ? `improved from ${WORD[e.from]} to ${WORD[e.to]}` : `now ${WORD[e.to]} (was ${WORD[e.from]})`;
  const hint = e.id === MONITOR.id ? ' The history is not being written, so the other parts are not being watched either.' : (e.expected ? ` It should be updated ${e.expected}.` : '');
  return `${e.name}: ${was} since ${utc(e.at)}.${hint}`;
};

// the subject of a message for a set of events: the worst state reached, or the way back
export function statusSubject(events) {
  const worst = events.reduce((w, e) => (RANK[e.to] > RANK[w] ? e.to : w), 'o');
  if (worst === 'o') return events.length === 1 ? `ASPA Explorer: ${events[0].name} is back to OK` : 'ASPA Explorer: everything changed back to OK';
  const names = events.filter((e) => e.to === worst).map((e) => e.name);
  return `ASPA Explorer status: ${names.join(', ')} ${worst === 'd' ? 'down' : 'late'}`;
}
