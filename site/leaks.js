'use strict';

// The "Route leaks today" section of the statistics page: /api/v1/leaks.json, built once a day by
// scripts/build-leaks.mjs from the table dumps of collectors of RIPE RIS and RouteViews.
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const CAIDA = { provider: 'a provider of the first', peer: 'a peer of the first', customer: 'a customer of the first', unknown: 'nothing' };

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const chip = (as) => el('a', { class: 'chip', href: `/as/${as}`, text: as });
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(a / b < 0.1 ? 2 : 1)}%` : '0%');


  // The daily totals (/api/v1/leaks-history.json): the places of possible leak and of gap, one point a day.
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };
  const SERIES = [{ key: 'leak', label: 'Possible leaks', cls: 's1' }, { key: 'gap', label: 'Gaps in ASPAs', cls: 's2' }];
  const dayLabel = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function drawHistory(box, rows) {
    const W = Math.max(280, box.clientWidth || 640), H = 200, m = { l: 46, r: 10, t: 10, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(1, ...rows.flatMap((r) => SERIES.map((s) => r[s.key])));
    const step = 10 ** Math.floor(Math.log10(max)), top = Math.ceil(max / step) * step;
    const x = (i) => m.l + (rows.length === 1 ? iw / 2 : (iw * i) / (rows.length - 1));
    const y = (v) => m.t + ih - (ih * v) / top;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Places of possible leak and of gap, one value a day, from ${dayLabel(rows[0].date)} to ${dayLabel(rows[rows.length - 1].date)}: ${SERIES.map((s) => `${s.label} ${rows[0][s.key]} then ${rows[rows.length - 1][s.key]}`).join('; ')}.` });
    for (let v = 0; v <= top; v += top / 4) {
      g.append(svg('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), svg('text', { class: 'tick', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt.format(Math.round(v))));
    }
    [0, rows.length - 1].forEach((i, k) => g.append(svg('text', { class: 'tick', x: x(i), y: H - 6, 'text-anchor': k ? 'end' : 'start' }, dayLabel(rows[i].date))));
    for (const s of SERIES) {
      g.append(svg('polyline', { class: `line ${s.cls}`, points: rows.map((r, i) => `${x(i).toFixed(1)},${y(r[s.key]).toFixed(1)}`).join(' ') }));
      if (rows.length === 1) g.append(svg('circle', { cx: x(0), cy: y(rows[0][s.key]), r: 3, fill: `var(--${s.cls})` }));
    }
    box.replaceChildren(g);
  }

  async function history() {
    const box = $('leaks-history');
    if (!box) return;
    let rows;
    try {
      const r = await fetch('/api/v1/leaks-history.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      rows = await r.json();
    } catch { box.replaceChildren(); $('leaks-history-note').textContent = 'The history of the leaks is not available.'; return; }
    if (!rows.length) return;
    $('leaks-history-note').textContent = rows.length < 2
      ? 'One point a day: the history starts on ' + dayLabel(rows[0].date) + ' and grows every day.'
      : `One point a day, ${rows.length} days. A change can come from the routes, from the ASPAs published that day or from the relationships dataset.`;
    const legend = $('leaks-history-legend');
    legend.replaceChildren(...SERIES.map((s) => el('li', {}, el('span', { class: `sw ${s.cls}`, 'aria-hidden': 'true' }), el('span', { class: 'lg', text: s.label }), ' ', el('span', { class: 'lv', text: fmt.format(rows[rows.length - 1][s.key]) }))));
    drawHistory(box, rows);
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => drawHistory(box, rows), 150); });
  }

  // 449,000,000 -> "449 M", 580,000 -> "580 k", 6,700,000,000 -> "6.7 billion"
  const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${fmt.format(Math.round(n / 1e6))} M` : n >= 1e3 ? `${fmt.format(Math.round(n / 1e3))} k` : fmt.format(n));
  const getJson = async (url) => { try { const r = await fetch(url, { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; } catch { return null; } };

  // The numbers of the project in two small lines under the title: the ASPAs, and the routes checked today.
  async function numbers(d) {
    const asBox = $('numbers'), routeBox = $('numbers-routes');
    if (!asBox || !routeBox) return;
    const [a, meta, hist] = await Promise.all([getJson('/api/v1/adoption.json'), getJson('/api/v1/meta.json'), getJson('/api/v1/leaks-history.json')]);
    const t = d.total;
    const first = [];
    if (a && a.seen) first.push(`${fmt.format(a.aspa)} of ${fmt.format(a.seen)} networks have an ASPA (${a.pct}%)`);
    if (meta && meta.events) first.push(`${fmt.format(meta.events)} changes to ASPAs recorded since 12 Oct 2023`);
    asBox.textContent = first.length ? `In numbers: ${first.join(' · ')}.` : '';
    const second = [`${short(t.routes)} routes checked today, from ${d.collectors.length} collectors${t.feeders ? ` and ${fmt.format(t.feeders)} feeder networks` : ''}`,
      `${pct(t.valid, t.routes)} valid, ${pct(t.unknown, t.routes)} unknown, ${pct(t.invalid, t.routes)} invalid`, `${fmt.format(d.places)} places of valley`];
    if (Array.isArray(hist) && hist.length > 1) second.push(`${short(hist.reduce((s, r) => s + r.routes, 0))} routes checked in ${hist.length} days`);
    routeBox.textContent = `${second.join(' · ')}.`;
  }

  async function main() {
    if (!$('leaks-sub')) return;
    let d;
    try {
      const r = await fetch('/api/v1/leaks.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch (err) {
      $('leaks-sub').textContent = `The route leaks are not available (${err.message}). They are rebuilt once a day.`;
      return;
    }
    numbers(d);
    const t = d.total;
    const when = d.collectors.map((c) => c.built).sort()[0];
    $('leaks-sub').textContent = `Every route of ${d.collectors.length} collectors, ${d.collectors.filter((c) => /^rrc/.test(c.collector)).length} of RIPE RIS and ${d.collectors.filter((c) => !/^rrc/.test(c.collector)).length} of RouteViews (${fmt.format(t.routes)} routes in the table dumps of ${new Date(when).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC) checked with the downstream ASPA verification. A valley is a route that came down from a provider or a peer and went up again.`;
    const tile = (label, value, note, cls) => el('div', { class: 'tile card ' + (cls || '') }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note }));
    $('leaks-tiles').replaceChildren(
      tile('Invalid routes', fmt.format(t.invalid), `${pct(t.invalid, t.routes)} of the routes`, 'v-invalid'),
      tile('Places of valley', fmt.format(d.places), 'distinct places'),
      tile('Possible leaks', fmt.format(d.kinds.leak), 'places'),
      tile('Gaps in ASPAs', fmt.format(d.kinds.gap), 'places'),
      tile('Unknown', pct(t.unknown, t.routes), 'of the routes, no ASPA to say', 'v-unknown'));

    const leaks = d.groups.filter((g) => g.kind === 'leak').slice(0, 15);
    $('leak-rows').replaceChildren(...(leaks.length ? leaks.map((g) => el('tr', {},
      el('td', {}, chip(g.from), ' ', chip(g.to)),
      el('td', {}, ...g.between.flatMap((a, i) => (i ? [' ', chip(a)] : [chip(a)]))),
      el('td', { text: CAIDA[g.caida] }),
      el('td', { class: 'num', text: fmt.format(g.routes) }), el('td', { class: 'num', text: fmt.format(g.feeders) }), el('td', { class: 'num', text: fmt.format(g.origins) }),
      el('td', {}, el('a', { href: `/#path=${encodeURIComponent([...g.example].reverse().map((a) => a.slice(2)).join(' '))}&from=down`, text: 'open the path' })))) : [el('tr', {}, el('td', { colspan: '7', text: 'None.' }))]));

    $('gap-rows').replaceChildren(...(d.gaps.length ? d.gaps.slice(0, 15).map((g) => el('tr', {},
      el('td', {}, chip(g.customer)), el('td', {}, chip(g.missing)),
      el('td', { class: 'num', text: fmt.format(g.places) }), el('td', { class: 'num', text: fmt.format(g.routes) }), el('td', { class: 'num', text: fmt.format(g.feeders) }))) : [el('tr', {}, el('td', { colspan: '5', text: 'None.' }))]));

    $('leaks-note').textContent = `${fmt.format(d.kinds.unclear)} more places have no relation in ${d.relationships || 'the relationships dataset'} and are not listed. The tables show the places seen by most feeders first. The relation is inferred from observed routes, so it can be out of date; a place is a candidate, not a verdict, and the ASPAs prove a valley only where they are published (${pct(t.unknown, t.routes)} of the routes cross an AS without one). A leak seen by one feeder only can be a leak at the feeder itself.`;
  }
  main();
  history();
})();
