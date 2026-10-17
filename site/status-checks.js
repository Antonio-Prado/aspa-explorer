'use strict';

// The checks of the status page, and the dot next to "Status" in the menu of every page. Each check
// says how old a piece of data is, judged against how often it should change. The dot is green when all
// the checks are green, red when all are red and orange in between (a late check counts as not green).
(function (root) {
  const HISTORY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/history.json/raw?ref=history';
  const VISIBILITY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/visibility.json/raw?ref=history';
  const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

  // state from an age in ms and the two limits
  const byAge = (age, okMs, lateMs) => (age <= okMs ? 'ok' : age <= lateMs ? 'late' : 'down');
  // a file that gets a row of a given day: that day is expected from 07:30 UTC on
  function byDay(day, now) {
    const today = new Date(now).toISOString().slice(0, 10);
    const hourUtc = new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60;
    const expected = hourUtc >= 7.5 ? today : new Date(now - DAY).toISOString().slice(0, 10);
    const late = Math.round((Date.parse(expected) - Date.parse(day)) / DAY);
    return late <= 0 ? 'ok' : late === 1 ? 'late' : 'down';
  }
  // 'ok' (all green), 'down' (all red), 'warn' (anything else); no results at all is 'warn'
  function dotState(results) {
    if (!results.length) return 'warn';
    if (results.every((x) => x.r.state === 'ok')) return 'ok';
    if (results.every((x) => x.r.state === 'down')) return 'down';
    return 'warn';
  }

  const api = { byAge, byDay, dotState, MIN, HOUR, DAY };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  const get = async (url) => {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const checks = [
    { name: 'Validator (Routinator)', expected: 'every 10 minutes', run: async (now) => {
      const s = await get('/data/status.json');
      const t = Date.parse(s.lastUpdateDone);
      return { state: byAge(now - t, 30 * MIN, 2 * HOUR), at: t, extra: String(s.version || '').replace('/', ' ') };
    } },
    { name: 'Per-AS API, badges and feeds', expected: 'every 15 minutes', run: async (now) => {
      const m = await get('/api/v1/meta.json');
      const t = Date.parse(m.generated);
      return { state: byAge(now - t, 45 * MIN, 3 * HOUR), at: t, extra: `${m.aspas.toLocaleString('en-US')} ASPAs, ${m.ases.toLocaleString('en-US')} ASes` };
    } },
    { name: 'Daily history and changes', expected: 'once a day, about 06:30 UTC', run: async (now) => {
      const h = await get(HISTORY);
      const last = h[h.length - 1];
      return { state: byDay(last.date, now), at: Date.parse(last.date), day: true, extra: `${last.aspas.toLocaleString('en-US')} ASPAs on that day` };
    } },
    { name: 'BGP visibility (quality checks)', expected: 'once a day', run: async (now) => {
      const v = await get(VISIBILITY);
      return { state: byDay(v.date, now), at: Date.parse(v.date), day: true, extra: `${v.seen.toLocaleString('en-US')} ASes seen` };
    } },
    { name: 'Adoption numbers', expected: 'once a day', run: async (now) => {
      const a = await get('/api/v1/adoption.json');
      const t = Date.parse(a.generated);
      return { state: byAge(now - t, 36 * HOUR, 3 * DAY), at: t, extra: `${a.pct}% of the networks seen have an ASPA` };
    } },
    { name: 'Route leaks (table dumps)', expected: 'once a day', run: async (now) => {
      const l = await get('/api/v1/leaks.json');
      const t = Date.parse(l.generated);
      return { state: byAge(now - t, 36 * HOUR, 3 * DAY), at: t, extra: `${l.places.toLocaleString('en-US')} places of valley in ${Math.round(l.total.routes / 1e6)} million routes` };
    } },
    { name: 'Notifications', expected: 'checks the validator every 10 minutes', run: async (now) => {
      const h = await get('/api/v1/subscriptions/health');
      const t = h.last_poll ? Date.parse(h.last_poll) : 0;
      return { state: h.ok ? 'ok' : (t && now - t < 2 * HOUR ? 'late' : 'down'), at: t || null, extra: h.failures_in_a_row ? `${h.failures_in_a_row} failed read${h.failures_in_a_row === 1 ? '' : 's'} in a row` : '' };
    } },
  ];

  async function runAll(now = Date.now()) {
    return Promise.all(checks.map(async (c) => {
      try { return { c, r: await c.run(now) }; } catch (err) { return { c, r: { state: 'down', at: null, extra: `no answer (${err.message})` } }; }
    }));
  }

  const DOT_TEXT = {
    ok: 'all checks are green',
    warn: 'some checks are not green',
    down: 'all checks are red',
    unknown: 'checking',
  };
  function paintDot(state) {
    for (const a of document.querySelectorAll('.topnav a[href="/status.html"]')) {
      let dot = a.querySelector('.status-dot');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'status-dot';
        dot.setAttribute('aria-hidden', 'true');
        a.append(dot);
        const sr = document.createElement('span');
        sr.className = 'sr-only status-dot-text';
        a.append(sr);
      }
      dot.className = `status-dot ${state}`;
      a.title = `Status: ${DOT_TEXT[state]}`;
      a.querySelector('.status-dot-text').textContent = ` (${DOT_TEXT[state]})`;
    }
  }

  // The result is kept for a minute in sessionStorage, so moving between pages does not repeat the checks.
  async function paintFromChecks() {
    paintDot('unknown');
    try {
      const saved = JSON.parse(sessionStorage.getItem('aspa-status') || 'null');
      if (saved && Date.now() - saved.t < MIN && DOT_TEXT[saved.state]) { paintDot(saved.state); return; }
    } catch { /* no storage: the checks run */ }
    const state = dotState(await runAll());
    paintDot(state);
    try { sessionStorage.setItem('aspa-status', JSON.stringify({ t: Date.now(), state })); } catch { /* fine */ }
  }

  root.AspaStatus = Object.assign(api, { checks, runAll, paintDot });
  document.addEventListener('DOMContentLoaded', () => {
    // the status page runs the checks itself and paints the dot from them
    if (location.pathname === '/status.html') paintDot('unknown'); else paintFromChecks();
  });
})(typeof self !== 'undefined' ? self : this);
