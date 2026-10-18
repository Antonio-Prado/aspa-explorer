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

  const api = { RANGES, cellsOf, uptime, problems, fmtPct };
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
      const strip2 = el('div', { class: 'up-strip', tabindex: '0', role: 'group', 'aria-label': `${c.name}: ${fmtPct(u.pct)} OK in the ${r.label}. Use the left and right arrow keys to read the cells.` }, svg);
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
    $('upproblems').replaceChildren(...(shown.length ? shown.map((p) => el('li', {}, el('span', { class: 'badge ' + (p.state === 'd' ? 'v-invalid' : 'v-unknown'), text: NAME[p.state] }), ` ${p.name}: ${at(p.from)}, about ${duration(p.to - p.from)}`)) : [el('li', { text: `No problem in the ${r.label}.` })]));
    $('upmore').textContent = list.length > shown.length ? `${list.length - shown.length} older stretches are not listed.` : '';
    const as = doc.assumed ? ` Samples from ${at(doc.assumed.from)} to ${at(doc.assumed.to)} were not measured: all the parts are taken as OK in that period.` : '';
    $('upsub').textContent = `${doc.samples.length ? `${doc.samples.length.toLocaleString('en-US')} checks since ${at(doc.samples[0][0])}` : 'No check recorded yet'}; one is made every ${Math.round(doc.interval / 60)} minutes. A cell shows the worst state in its stretch of time.${as}`;
    for (const b of document.querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b.dataset.range === range));
  }

  async function main() {
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
