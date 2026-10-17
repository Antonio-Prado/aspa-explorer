'use strict';

// The status page: how old each piece of data is, judged against how often it should change.
(function () {
  const $ = (id) => document.getElementById(id);
  const HISTORY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/history.json/raw?ref=history';
  const VISIBILITY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/visibility.json/raw?ref=history';
  const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const c of kids) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const get = async (url) => {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const ago = (ms) => {
    const m = Math.round(ms / MIN);
    if (m < 2) return 'just now';
    if (m < 120) return `${m} minutes ago`;
    const h = Math.round(ms / HOUR);
    return h < 48 ? `${h} hours ago` : `${Math.round(ms / DAY)} days ago`;
  };
  const utc = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

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
    { name: 'Notifications', expected: 'checks the validator every 10 minutes', run: async (now) => {
      const h = await get('/api/v1/subscriptions/health');
      const t = h.last_poll ? Date.parse(h.last_poll) : 0;
      return { state: h.ok ? 'ok' : (t && now - t < 2 * HOUR ? 'late' : 'down'), at: t || null, extra: h.failures_in_a_row ? `${h.failures_in_a_row} failed read${h.failures_in_a_row === 1 ? '' : 's'} in a row` : '' };
    } },
  ];

  const LABEL = { ok: 'OK', late: 'Late', down: 'Down' };
  const CLASS = { ok: 'v-valid', late: 'v-unknown', down: 'v-invalid' };

  async function refresh() {
    const now = Date.now();
    const results = await Promise.all(checks.map(async (c) => {
      try { return { c, r: await c.run(now) }; } catch (err) { return { c, r: { state: 'down', at: null, extra: `no answer (${err.message})` } }; }
    }));
    $('rows').replaceChildren(...results.map(({ c, r }) => el('tr', {},
      el('th', { scope: 'row', text: c.name }),
      el('td', {}, el('span', { class: 'badge ' + CLASS[r.state], text: LABEL[r.state] })),
      el('td', { text: r.at ? `${r.day ? new Date(r.at).toISOString().slice(0, 10) : utc(r.at)}${r.day ? '' : ` (${ago(now - r.at)})`}${r.extra ? ` · ${r.extra}` : ''}` : (r.extra || 'unknown') }),
      el('td', { text: c.expected }))));
    const down = results.filter(({ r }) => r.state === 'down').length, late = results.filter(({ r }) => r.state === 'late').length;
    const msg = down ? `${down} part${down === 1 ? ' is' : 's are'} not working or very old.` : late ? `${late} part${late === 1 ? ' is' : 's are'} a little late.` : 'Everything is up to date.';
    $('summary').replaceChildren(el('p', {}, el('span', { class: 'badge ' + (down ? 'v-invalid' : late ? 'v-unknown' : 'v-valid'), text: down ? 'Problem' : late ? 'Late' : 'OK' }), ' ', msg));
    $('checked').textContent = `Checked ${utc(now)}; the page checks again every minute.`;
  }
  refresh();
  setInterval(refresh, MIN);
})();
