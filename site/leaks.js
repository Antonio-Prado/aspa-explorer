'use strict';

// The "Route leaks today" section of the statistics page: /api/v1/leaks.json, built once a day by
// scripts/build-leaks.mjs from the table dumps of three RIPE RIS collectors.
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
    const t = d.total;
    const when = d.collectors.map((c) => c.built).sort()[0];
    $('leaks-sub').textContent = `Every route of ${d.collectors.map((c) => c.collector).join(', ')} (${fmt.format(t.routes)} routes in the table dumps of ${new Date(when).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC) checked with the downstream ASPA verification. A valley is a route that came down from a provider or a peer and went up again.`;
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
})();
