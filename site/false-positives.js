'use strict';

// The False positives page: /data/false-positives.json, written by tools/false-positives/summary.mjs from the table dumps of a
// route collector and the history of the ASPAs. Aggregates only.
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const pct = (n, of) => (of ? `${((100 * n) / of).toFixed(1)}%` : '–');
  const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
      if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const k of kids) e.append(k);
    return e;
  };
  const num = (text) => el('td', { class: 'num', text });
  const tile = (label, value, note) => el('div', { class: 'tile card' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note }));
  const CLASSES = [
    ['1a', 'Fixed: the missing provider added'], ['1b', 'An ASPA of the path withdrawn'], ['1c', 'Another change of an ASPA'],
    ['4', 'Structural: sibling or scrubbing'], ['2', 'Probable false positive'], ['5', 'Undetermined'],
  ];

  function show(d) {
    const c = d.classes, t = d.totals;
    $('fp-collectors').textContent = d.collectors.length === 1 ? `the RIPE RIS collector ${d.collectors[0]}` : `${d.collectors.length} RIPE RIS collectors (${d.collectors.join(', ')})`;
    $('fp-from').textContent = day(d.period.from);
    $('fp-to').textContent = day(d.period.to);
    $('fp-window').textContent = String(d.window);
    $('fp-tiles').replaceChildren(
      tile('Places of valley', fmt.format(t.places), `${fmt.format(d.invalid_routes)} Invalid routes of ${fmt.format(d.routes_read)} read`),
      tile('Fixed by the operator', pct(c.places['1a'], t.places), `${fmt.format(c.places['1a'])} places: the missing provider added`),
      tile('Failing pairs fixed', pct(c.pairs['1a'], t.pairs), `${fmt.format(c.pairs['1a'])} of ${fmt.format(t.pairs)} customers and missing ASes`),
      tile('Days to the fix', d.fix.median === null ? '–' : `${d.fix.median}`, d.fix.median === null ? '' : `median; half between ${d.fix.q1} and ${d.fix.q3}`),
    );
    $('fp-classes').replaceChildren(...CLASSES.filter(([k]) => c.places[k] || c.pairs[k]).map(([k, name]) => el('tr', {},
      el('th', { scope: 'row', text: name }),
      num(`${fmt.format(c.places[k])} (${pct(c.places[k], t.places)})`), num(`${fmt.format(c.pairs[k])} (${pct(c.pairs[k], t.pairs)})`), num(`${fmt.format(c.routes[k])} (${pct(c.routes[k], t.routes)})`))));
    const fr = d.feeder_routes, bp = d.biggest_place;
    $('fp-classes-note').textContent = `A failing pair is counted once, in the first class of the places it is in. Read the places and the pairs first: the routes are uneven. `
      + (bp ? `The biggest place alone has ${pct(bp.routes, t.routes)} of the Invalid routes, ` : '')
      + `and ${pct(fr.at_feeder, fr.of)} of the routes of the fixed places come from places where the ASPA that missed a provider was the one of a feeder of the collector: when a feeder forgets a provider, every route it sends is Invalid at once.`;
    const b = d.fix.by_day, sum = (a, z) => b.slice(a - 1, z).reduce((x, y) => x + y, 0);
    $('fp-when-rows').replaceChildren(...[['1', 1, 1], ['2 to 7', 2, 7], ['8 to 14', 8, 14], [`15 to ${d.window}`, 15, d.window]].map(([label, a, z]) =>
      el('tr', {}, el('th', { scope: 'row', text: label }), num(`${fmt.format(sum(a, z))} (${pct(sum(a, z), d.fix.places)})`))));
    $('fp-when-note').textContent = `Of the ${fmt.format(d.fix.places)} places fixed by the operator, most were fixed the day after they were first seen: new or changed ASPAs that missed a provider and were corrected at once. The fixes came almost all from the customer at the origin side (${fmt.format(d.fix.up)}), few from the side of the collector (${fmt.format(d.fix.down)}).`;
    const all = d.evidence.find((e) => e.id === 'all');
    $('fp-evidence-rows').replaceChildren(...d.evidence.map((e) => el('tr', {}, el('th', { scope: 'row', text: e.name }), num(fmt.format(e.places)), num(`${fmt.format(e.fixed)} (${pct(e.fixed, e.places)})`))));
    const r = d.rules;
    $('fp-evidence-note').textContent = `The fixes come soon or not at all: a place that lasts is seldom fixed, whatever the evidence says, and that is why the places that CAIDA explains with a provider were fixed less often than the average${all ? ` (${pct(all.fixed, all.places)})` : ''}. `
      + `So the rule for a probable false positive picks ${fmt.format(r.probable_fp.picks)} places, of which ${fmt.format(r.probable_fp.fixed)} were fixed, and finds ${fmt.format(r.probable_fp.of_fixed)} of the ${fmt.format(d.fix.places)} fixed places: it describes the gaps that stay, not the ones that are corrected. `
      + `The short places without evidence of transit, which would look like short leaks, were fixed by the operator in ${pct(r.short_no_evidence.fixed, r.short_no_evidence.picks)} of the cases (${fmt.format(r.short_no_evidence.fixed)} of ${fmt.format(r.short_no_evidence.picks)}).`;
    const names = { 'RLK-UL': 'Upward leak', 'RLK-LL': 'Lateral leak', 'RLK-FP': 'Full propagation', 'RLK-PV': 'Persistent valley' };
    const inc = d.incidents;
    $('fp-leak-rows').replaceChildren(...Object.entries(inc.by_subtype).map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: `${k} ${names[k] || ''}` }),
      num(fmt.format(v.incidents)), ...['1a', '4', '3', '2', '5'].map((x) => num(`${fmt.format(v[x] || 0)} (${pct(v[x] || 0, v.incidents)})`)))));
    $('fp-leaks-note').textContent = inc.from
      ? `The leaks of ${day(inc.from)} to ${day(inc.to)} that the ASPAs of the day prove Invalid: ${fmt.format(inc.total)}, of which ${fmt.format(inc.alone)} can be followed and ${fmt.format(inc.full_window)} began early enough to be followed for ${d.window} days. A persistent valley is an AS that is in a valley all day: a relationship that CAIDA gets wrong more often than a leak.`
      : '';
  }

  fetch('/data/false-positives.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(show)
    .catch(() => { $('fp-tiles').replaceChildren(el('p', { class: 'hint', text: 'The figures could not be loaded.' })); });
})();
