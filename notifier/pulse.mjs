// What the notifier knows about each of the files it reads (the ASPAs, the places of valley, the state of the service, the invalid announcements)
// and about the delivery of the queue (its own source: reading can work while sending breaks, and the other way round):
// when it was last read well and how many times in a row it failed. A source that is down for a day must show in /api/v1/subscriptions/health,
// even when the others, and the queue of the messages, are fine.
export const SOURCES = ['aspas', 'leaks', 'status', 'invalid', 'delivery'];
export const BAD_AFTER = 3;          // failures in a row after which a source is called down

// How old the data of a source may be (seconds) before the source is called stale, although it is read without errors: a file that nobody renews
// is served with HTTP 200 for as long as it is there. About three times the interval at which each one is made.
export const MAX_AGE = { aspas: 3600, leaks: 36 * 3600, status: 3600, invalid: 1800 };

export function makePulse(names = SOURCES, now = () => Date.now(), maxAge = MAX_AGE) {
  const s = Object.fromEntries(names.map((n) => [n, { lastOk: null, failures: 0, dataAt: null }]));
  const ok = (name, dataAt = null) => { s[name].lastOk = now(); s[name].failures = 0; if (dataAt !== null && Number.isFinite(dataAt)) s[name].dataAt = dataAt; };
  const fail = (name) => { s[name].failures++; };
  // runs one read: a throw counts as a failure of the source and is given back to the caller
  const track = async (name, fn) => { try { const r = await fn(); ok(name, typeof r === 'number' ? r : null); return r; } catch (err) { fail(name); throw err; } };
  const summary = (pollMs) => {
    const out = {};
    for (const [n, v] of Object.entries(s)) {
      const age = v.dataAt === null ? null : Math.max(0, Math.floor((now() - v.dataAt) / 1000));
      const fresh = !maxAge[n] || (age !== null && age <= maxAge[n]);
      out[n] = { last_ok: v.lastOk && new Date(v.lastOk).toISOString(), failures_in_a_row: v.failures, ...(maxAge[n] ? { data_generated: v.dataAt && new Date(v.dataAt).toISOString(), data_age_seconds: age, max_age_seconds: maxAge[n] } : {}),
        ok: v.lastOk !== null && v.failures < BAD_AFTER && now() - v.lastOk < 3 * pollMs && fresh };
    }
    return out;
  };
  return { ok, fail, track, summary, get: (n) => s[n] };
}
