'use strict';

// The chart of the status page: the state of each part over time, from /api/v1/status-history.json, which
// scripts/build-status.mjs extends every 15 minutes. One strip for each part; each cell of a strip is a stretch of
// time and has the worst state seen in it (red, then orange, then green); a stretch with no sample is grey.
(function (root) {
  const HOUR = 3600, DAY = 86400;
  // the ranges: seconds covered and number of cells
  const RANGES = {
    '24h': { span: DAY, cells: 96, label: 'last 24 hours' },
    '7d': { span: 7 * DAY, cells: 84, label: 'last 7 days' },
    '30d': { span: 30 * DAY, cells: 120, label: 'last 30 days' },
    '90d': { span: 90 * DAY, cells: 90, label: 'last 90 days' },
  };
  const RANK = { o: 1, l: 2, d: 3 };
  const NAME = { o: 'OK', l: 'late', d: 'down' };

  // The cells of one check (its index in the letters) from `from` to `to`: '' (no sample), 'o', 'l' or 'd'.
  function cellsOf(samples, index, from, to, n) {
    const out = new Array(n).fill('');
    const w = (to - from) / n;
    for (const [t, s] of samples) {
      if (t < from || t > to) continue;
      const c = s[index];
      if (!RANK[c]) continue;
      const i = Math.min(n - 1, Math.floor((t - from) / w));
      if (!out[i] || RANK[c] > RANK[out[i]]) out[i] = c;
    }
    return out;
  }
  // The share of the samples in the range that are OK (null when there are none), and how many samples.
  function uptime(samples, index, from, to) {
    let ok = 0, all = 0;
    for (const [t, s] of samples) {
      if (t < from || t > to || !RANK[s[index]]) continue;
      all++;
      if (s[index] === 'o') ok++;
    }
    return { pct: all ? (100 * ok) / all : null, samples: all };
  }
  // Stretches that are not OK: runs of consecutive samples (no more than 1.5 intervals apart) in the same state.
  // Each one is { state, from, to } in seconds; a run ends at its last sample plus one interval.
  function problems(samples, index, from, to, interval) {
    const runs = [];
    let cur = null;
    for (const [t, s] of samples) {
      if (t < from || t > to) continue;
      const c = s[index];
      if (!RANK[c] || c === 'o') { cur = null; continue; }
      if (cur && cur.state === c && t - cur.last <= interval * 1.5) { cur.last = t; cur.to = t + interval; } else { cur = { state: c, from: t, last: t, to: t + interval }; runs.push(cur); }
    }
    return runs.map(({ state, from: a, to: b }) => ({ state, from: a, to: b }));
  }
  const fmtPct = (p) => (p === null ? 'no data' : p >= 99.995 ? '100%' : p >= 99 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`);

  // The months of /api/v1/status-months.json as rows for a table, newest first: for each part the share of the checks that found it OK, and
  // how complete the record is (the checks made against the checks that a full month would have, up to `now`, seconds).
  function monthRows(doc2, now, limit = 12) {
    const keys = Object.keys(doc2.months).sort().reverse().slice(0, limit);
    return keys.map((key) => {
      const start = Date.parse(`${key}-01T00:00:00Z`) / 1000;
      const d = new Date(start * 1000);
      const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
      const m = doc2.months[key];
      const expected = Math.max(1, Math.floor((Math.min(now, end) - start) / doc2.interval));
      const parts = {};
      for (const c of doc2.checks) {
        const [o, l, dn] = m.parts[c.id] || [0, 0, 0];
        const all = o + l + dn;
        parts[c.id] = { ok: all ? (100 * o) / all : null, late: all ? (100 * l) / all : 0, down: all ? (100 * dn) / all : 0, samples: all };
      }
      return { key, samples: m.samples, coverage: Math.min(100, (100 * m.samples) / expected), parts };
    });
  }
  const api = { RANGES, cellsOf, uptime, problems, fmtPct, monthRows };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = (attrs && attrs.ns) ? document.createElementNS(attrs.ns, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'ns' || v === undefined || v === null || v === false) continue;
      if (k === 'class') n.setAttribute('class', v); else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const SVG = 'http://www.w3.org/2000/svg';
  const at = (t) => new Date(t * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  const stamp = (t, span) => new Date(t * 1000).toLocaleString('en-GB', span > 2 * DAY ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const duration = (s) => (s < 90 * 60 ? `${Math.max(1, Math.round(s / 60))} min` : s < 2 * DAY ? `${Math.round(s / HOUR)} h` : `${Math.round(s / DAY)} days`);

  let doc = null;
  let range = '7d';
  try { const saved = localStorage.getItem('aspa-status-range'); if (RANGES[saved]) range = saved; } catch { /* fine */ }

  function strip(c, index, from, to, n) {
    const cells = cellsOf(doc.samples, index, from, to, n);
    const svg = el('svg', { ns: SVG, viewBox: `0 0 ${n} 1`, preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'up-svg' });
    cells.forEach((c2, i) => svg.append(el('rect', { ns: SVG, x: i, y: 0, width: 1.02, height: 1, class: `up-${c2 || 'n'}` })));
    return { svg, cells };
  }

  function render() {
    const r = RANGES[range];
    const last = doc.samples.length ? doc.samples[doc.samples.length - 1][0] : Math.floor(Date.now() / 1000);
    const to = Math.max(last, Math.floor(Date.now() / 1000));
    const from = to - r.span;
    // a period that starts before the first check is named by the first check: the share counts only what was recorded
    const first = doc.samples.length ? doc.samples[0][0] : null;
    const period = first && first > from ? `checks since ${at(first)}` : r.label;
    const rows = [];
    const body = [];
    const list = [];
    doc.checks.forEach((c, index) => {
      const { svg, cells } = strip(c, index, from, to, r.cells);
      const u = uptime(doc.samples, index, from, to);
      const w = (to - from) / r.cells;
      const show = (i) => {
        const a = from + i * w;
        $('uphover').textContent = `${c.name}, ${stamp(a, r.span)} to ${stamp(a + w, r.span)} UTC: ${cells[i] ? NAME[cells[i]] : 'no sample'}`;
      };
      const strip2 = el('div', { class: 'up-strip', tabindex: '0', role: 'group', 'aria-label': `${c.name}: ${fmtPct(u.pct)} OK in the ${period}. Use the left and right arrow keys to read the cells.` }, svg);
      let pos = cells.length - 1;
      strip2.addEventListener('pointermove', (e) => { const b = strip2.getBoundingClientRect(); pos = Math.max(0, Math.min(cells.length - 1, Math.floor(((e.clientX - b.left) / b.width) * cells.length))); show(pos); });
      strip2.addEventListener('pointerleave', () => { $('uphover').textContent = ''; });
      strip2.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        pos = Math.max(0, Math.min(cells.length - 1, pos + (e.key === 'ArrowLeft' ? -1 : 1)));
        show(pos);
      });
      strip2.addEventListener('focus', () => show(pos));
      rows.push(el('div', { class: 'up-row' }, el('div', { class: 'up-name', text: c.name }), strip2, el('div', { class: 'up-pct', text: fmtPct(u.pct) })));
      const ps = problems(doc.samples, index, from, to, doc.interval);
      body.push(el('tr', {}, el('th', { scope: 'row', text: c.name }), el('td', { text: fmtPct(u.pct) }), el('td', { text: String(ps.filter((p) => p.state === 'l').length) }), el('td', { text: String(ps.filter((p) => p.state === 'd').length) })));
      for (const p of ps) list.push({ name: c.name, ...p });
    });
    const axis = el('div', { class: 'up-axis', 'aria-hidden': 'true' }, el('span', { text: stamp(from, r.span) }), el('span', { text: stamp(to, r.span) }));
    $('upchart').replaceChildren(...rows, el('div', { class: 'up-row' }, el('div'), axis, el('div')));
    $('uptable').replaceChildren(...body);
    list.sort((a, b) => b.from - a.from);
    const shown = list.slice(0, 12);
    $('upproblems').replaceChildren(...(shown.length ? shown.map((p) => el('li', {}, el('span', { class: 'badge ' + (p.state === 'd' ? 'v-invalid' : 'v-unknown'), text: NAME[p.state] }), ` ${p.name}: ${at(p.from)}, about ${duration(p.to - p.from)}`)) : [el('li', { text: `No problem in the ${period}.` })]));
    $('upmore').textContent = list.length > shown.length ? `${list.length - shown.length} older stretches are not listed.` : '';
    const as = doc.assumed ? ` Samples from ${at(doc.assumed.from)} to ${at(doc.assumed.to)} were not measured: all the parts are taken as OK in that period.` : '';
    $('upsub').textContent = `${doc.samples.length ? `${doc.samples.length.toLocaleString('en-US')} checks since ${at(doc.samples[0][0])}` : 'No check recorded yet'}; one is made every ${Math.round(doc.interval / 60)} minutes. A cell shows the worst state in its stretch of time.${as}`;
    for (const b of document.querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b.dataset.range === range));
  }

  const monthName = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  async function months() {
    if (!$('mo-table')) return;
    try {
      const res = await fetch('/api/v1/status-months.json', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const rows = monthRows(d, Math.floor(Date.now() / 1000), 6);
      if (!rows.length) { $('mo-sub').textContent = 'No month recorded yet.'; return; }
      $('mo-head').replaceChildren(el('th', { scope: 'col', text: 'Part' }), ...rows.map((r) => el('th', { scope: 'col', text: monthName(r.key) })));
      const cell = (x) => {
        if (x.ok === null) return el('td', { text: 'no data' });
        const extra = [x.late > 0.05 && `late ${fmtPct(x.late)}`, x.down > 0.05 && `down ${fmtPct(x.down)}`].filter(Boolean);
        return el('td', { class: 'num' }, fmtPct(x.ok), extra.length ? el('span', { class: 'hint', text: ` (${extra.join(', ')})` }) : null);
      };
      $('mo-rows').replaceChildren(
        ...d.checks.map((c) => el('tr', {}, el('th', { scope: 'row', text: c.name }), ...rows.map((r) => cell(r.parts[c.id])))),
        el('tr', { class: 'total' }, el('th', { scope: 'row', text: 'Checks recorded' }), ...rows.map((r) => el('td', { class: 'num', text: `${r.samples.toLocaleString('en-US')} (${Math.round(r.coverage)}%)` }))));
      $('mo-sub').textContent = `Share of the checks, one every ${Math.round(d.interval / 60)} minutes, that found each part OK in each month (UTC); late and down are given when they are more than a twentieth of a percent. The last row says how many checks were recorded and what share of a full month that is: a month with gaps counts only the checks that were made.${d.assumed ? ` The checks from ${at(d.assumed.from)} to ${at(d.assumed.to)} were not measured and are taken as OK.` : ''}`;
    } catch (err) { $('mo-sub').textContent = `The months are not available (${err.message}).`; }
  }

  async function main() {
    months();
    if (!$('upchart')) return;
    for (const b of document.querySelectorAll('[data-range]')) {
      b.addEventListener('click', () => {
        range = b.dataset.range;
        try { localStorage.setItem('aspa-status-range', range); } catch { /* fine */ }
        if (doc) render();
      });
    }
    try {
      const res = await fetch('/api/v1/status-history.json', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = await res.json();
    } catch (err) {
      $('upsub').textContent = `The history is not available (${err.message}). It is extended every 15 minutes.`;
      return;
    }
    render();
  }
  root.AspaStatusHistory = api;
  main();
})(typeof self !== 'undefined' ? self : this);
