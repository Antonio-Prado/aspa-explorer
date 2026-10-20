// What the notifier knows about each of the files it reads (the ASPAs, the places of valley, the state of the service, the invalid announcements)
// and about the delivery of the queue (its own source: reading can work while sending breaks, and the other way round):
// when it was last read well and how many times in a row it failed. A source that is down for a day must show in /api/v1/subscriptions/health,
// even when the others, and the queue of the messages, are fine.
export const SOURCES = ['aspas', 'leaks', 'status', 'invalid', 'delivery'];
export const BAD_AFTER = 3;          // failures in a row after which a source is called down

export function makePulse(names = SOURCES, now = () => Date.now()) {
  const s = Object.fromEntries(names.map((n) => [n, { lastOk: null, failures: 0 }]));
  const ok = (name) => { s[name].lastOk = now(); s[name].failures = 0; };
  const fail = (name) => { s[name].failures++; };
  // runs one read: a throw counts as a failure of the source and is given back to the caller
  const track = async (name, fn) => { try { const r = await fn(); ok(name); return r; } catch (err) { fail(name); throw err; } };
  const summary = (pollMs) => {
    const out = {};
    for (const [n, v] of Object.entries(s)) out[n] = { last_ok: v.lastOk && new Date(v.lastOk).toISOString(), failures_in_a_row: v.failures, ok: v.lastOk !== null && v.failures < BAD_AFTER && now() - v.lastOk < 3 * pollMs };
    return out;
  };
  return { ok, fail, track, summary, get: (n) => s[n] };
}
