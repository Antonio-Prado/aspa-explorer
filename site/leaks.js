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


  // ---- the collectors compared, and RIS against RouteViews on the same places
  const pct1 = (a, b) => (b ? `${((100 * a) / b).toFixed(a / b < 0.1 ? 2 : 1)}%` : '0%');
  const METRICS = {
    places: { label: 'Places of valley seen', value: (c) => c.places, fmt: (v) => fmt.format(v) },
    only: { label: 'Places that only this collector sees', value: (c) => c.only, fmt: (v) => fmt.format(v) },
    invalid: { label: 'Invalid routes, as a share of its routes', value: (c) => (c.routes ? (100 * c.invalid) / c.routes : 0), fmt: (v) => `${v.toFixed(v < 1 ? 3 : 2)}%` },
    feeders: { label: 'Feeder networks', value: (c) => c.feeders, fmt: (v) => fmt.format(v) },
    routes: { label: 'Routes read', value: (c) => c.routes, fmt: (v) => short(v) },
  };
  const swatch = (cls, label, value) => el('li', {}, el('span', { class: `sw ${cls}`, 'aria-hidden': 'true' }), el('span', { class: 'lg', text: label }), value === undefined ? null : ' ', value === undefined ? null : el('span', { class: 'lv', text: value }));

  // One horizontal bar for each row {label, value, text, cls, tip}; the table for screen readers has the same numbers.
  function barsChart(box, rows, caption) {
    const W = Math.max(300, box.clientWidth || 640), L = Math.min(150, W * 0.45), R = 84, rh = 22, H = rows.length * rh + 6;
    const max = Math.max(...rows.map((r) => r.value), 1e-9), iw = W - L - R;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bars-svg', 'aria-hidden': 'true' });
    rows.forEach((r, i) => {
      const y = 3 + i * rh, w = Math.max(r.value > 0 ? 2 : 0, (iw * r.value) / max);
      g.append(svg('text', { class: 'tick', x: L - 6, y: y + 14, 'text-anchor': 'end' }, r.label),
        svg('rect', { class: r.cls, x: L, y, width: w.toFixed(1), height: rh - 6, rx: 2 }, svg('title', {}, r.tip || `${r.label}: ${r.text}`)),
        svg('text', { class: 'tick', x: L + w + 6, y: y + 14 }, r.text));
    });
    const table = el('div', { class: 'sr-only' }, el('table', {}, el('caption', { text: caption }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Collector' }), el('th', { scope: 'col', text: 'Value' }))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, el('th', { scope: 'row', text: r.label }), el('td', { text: r.text }))))));
    box.replaceChildren(g, table);
  }

  function drawCollectors(d) {
    const key = $('coll-metric').value, mt = METRICS[key];
    const rows = d.collectors.map((c) => ({ label: c.collector, value: mt.value(c), text: mt.fmt(mt.value(c)), cls: c.source === 'RIS' ? 's1' : 's2', tip: `${c.collector} (${c.source}): ${mt.fmt(mt.value(c))}` }))
      .sort((a, b) => b.value - a.value);
    barsChart($('coll-chart'), rows, `${mt.label}, for each collector`);
  }

  function collectors(d) {
    const sub = $('coll-sub');
    if (!sub) return;
    if (!d.collectors.every((c) => typeof c.places === 'number')) {
      sub.textContent = 'The figures of each collector come with the next daily build.';
      $('coll-metric').closest('.histctl').hidden = true;
      return;
    }
    const ris = d.collectors.filter((c) => c.source === 'RIS'), rv = d.collectors.filter((c) => c.source !== 'RIS');
    sub.textContent = `The ${ris.length} collectors of RIPE RIS and the ${rv.length} of RouteViews, each with the routes it reads, the places of valley it sees and the places that no other collector sees. A collector that sees many places alone has peers that the others do not have.`;
    $('coll-legend').replaceChildren(swatch('s1', 'RIPE RIS'), swatch('s2', 'RouteViews'));
    $('coll-metric').addEventListener('change', () => drawCollectors(d));
    drawCollectors(d);
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => drawCollectors(d), 150); });
  }

  // 100% stacked bars: the places seen by RIS alone, by both projects and by RouteViews alone
  function drawCompare(rows) {
    const box = $('cmp-chart');
    const W = Math.max(300, box.clientWidth || 640), L = Math.min(190, W * 0.45), R = 8, rh = 26, H = rows.length * rh + 6, iw = W - L - R;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bars-svg', 'aria-hidden': 'true' });
    rows.forEach((r, i) => {
      const y = 3 + i * rh, total = r.ris + r.both + r.rv;
      g.append(svg('text', { class: 'tick', x: L - 6, y: y + 15, 'text-anchor': 'end' }, `${r.label} (${fmt.format(total)})`));
      let x = L;
      for (const [cls, n, name] of [['s1', r.ris, 'RIS only'], ['s3', r.both, 'both'], ['s2', r.rv, 'RouteViews only']]) {
        const w = total ? (iw * n) / total : 0;
        if (!w) continue;
        g.append(svg('rect', { class: cls, x: x.toFixed(1), y, width: w.toFixed(1), height: rh - 6 }, svg('title', {}, `${r.label}, ${name}: ${fmt.format(n)} (${pct1(n, total)})`)));
        x += w;
      }
    });
    const table = el('div', { class: 'sr-only' }, el('table', {}, el('caption', { text: 'Places of valley seen by RIPE RIS only, by both projects and by RouteViews only' }),
      el('thead', {}, el('tr', {}, ...['Places', 'RIS only', 'Both', 'RouteViews only'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, el('th', { scope: 'row', text: r.label }), el('td', { text: fmt.format(r.ris) }), el('td', { text: fmt.format(r.both) }), el('td', { text: fmt.format(r.rv) }))))));
    box.replaceChildren(g, table);
  }

  function compare(d) {
    const sub = $('cmp-sub');
    if (!sub) return;
    const c = d.comparison;
    if (!c) { sub.textContent = 'The comparison comes with the next daily build.'; return; }
    const all = c.all, tot = all.ris + all.both + all.rv;
    const rows = [
      { label: 'All places', ...all }, { label: 'Possible leaks', ...all.kinds.leak }, { label: 'Gaps in ASPAs', ...all.kinds.gap },
      { label: '3+ feeders', ...c.strong },
    ];
    sub.textContent = `The same places of valley, told apart by who sees them: ${fmt.format(all.both)} of ${fmt.format(tot)} (${pct1(all.both, tot)}) are seen by both RIPE RIS and RouteViews, ${fmt.format(all.ris)} (${pct1(all.ris, tot)}) only by RIS and ${fmt.format(all.rv)} (${pct1(all.rv, tot)}) only by RouteViews.`;
    $('cmp-legend').replaceChildren(swatch('s1', 'RIS only'), swatch('s3', 'both'), swatch('s2', 'RouteViews only'));
    drawCompare(rows);
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => drawCompare(rows), 150); });
    const s = c.strong, st = s.ris + s.both + s.rv;
    const f = c.feeders;
    $('cmp-note').textContent = `Of the places seen by at least ${d.min_feeders || 3} feeders, ${pct1(s.both, st)} are seen by both projects. ${f ? `RIS has ${fmt.format(f.ris)} feeder networks, RouteViews ${fmt.format(f.rv)}, and ${fmt.format(f.both)} feed both.` : ''} A place that only one project sees is not wrong: it can come from a peer that the other has not, or from a leak that lasts a few hours, since the tables are taken at different times.`;
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
    collectors(d);
    compare(d);
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
