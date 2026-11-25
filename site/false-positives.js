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
    ['1a', 'Fixed: the missing AS added'], ['1b', 'An ASPA of the path withdrawn'], ['1c', 'Another change of an ASPA'],
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
      tile('Fixed by the operator', pct(c.places['1a'], t.places), `${fmt.format(c.places['1a'])} places: the missing AS added`),
      tile('ASPAs corrected', fmt.format(d.corrections.pairs), `providers added, by ${fmt.format(d.corrections.customers)} networks`),
      tile('Days to the fix', d.fix.median === null ? '–' : `${d.fix.median}`, d.fix.median === null ? '' : `median; half between ${d.fix.q1} and ${d.fix.q3}`),
    );
    $('fp-classes').replaceChildren(...CLASSES.filter(([k]) => c.places[k]).map(([k, name]) => el('tr', {},
      el('th', { scope: 'row', text: name }),
      num(`${fmt.format(c.places[k])} (${pct(c.places[k], t.places)})`), num(`${fmt.format(c.routes[k])} (${pct(c.routes[k], t.routes)})`))));
    const ff = d.feeder_fixes, bp = d.biggest_place;
    $('fp-classes-note').textContent = `Of the ${fmt.format(d.already.places)} places that were already there on the first day, ${fmt.format(d.already.fixed)} were fixed (${pct(d.already.fixed, d.already.places)}); of the ${fmt.format(d.appeared.places)} that appeared later, ${fmt.format(d.appeared.fixed)} (${pct(d.appeared.fixed, d.appeared.places)}). One missing provider makes many places, one for each way the routes go on from it: the ${fmt.format(c.places['1a'])} fixed places come from ${fmt.format(d.corrections.pairs)} providers added by ${fmt.format(d.corrections.customers)} networks. Read the places first: the routes are uneven`
      + (bp ? `, the biggest place alone has ${pct(bp.routes, t.routes)} of the Invalid routes. ` : '. ')
      + (ff.places ? `${pct(ff.routes, ff.of_routes)} of the routes of the fixed places come from the ${fmt.format(ff.places)} places where the ASPA that was fixed was the one of a feeder of the collector: when a feeder forgets a provider, every route it learned through that provider is Invalid at once.` : '');
    const b = d.fix.by_day, sum = (a, z) => b.slice(a - 1, z).reduce((x, y) => x + y, 0);
    $('fp-when-rows').replaceChildren(...[['1', 1, 1], ['2 to 7', 2, 7], ['8 to 14', 8, 14], [`15 to ${d.window}`, 15, d.window]].map(([label, a, z]) =>
      el('tr', {}, el('th', { scope: 'row', text: label }), num(`${fmt.format(sum(a, z))} (${pct(sum(a, z), d.fix.timed)})`))));
    $('fp-when-note').textContent = `Of the ${fmt.format(d.fix.places)} places fixed by the operator, ${fmt.format(d.fix.timed)} were first seen after the first day of the period, so that the day they appeared is known: the table counts those. A fix on day 1 means that the AS was in the next daily state of the ASPAs. The history cannot tell an ASPA that forgot a provider from one that followed a change of provider a few hours late. The fixes came almost all from the customer at the origin side (${fmt.format(d.fix.up)}), few from the side of the collector (${fmt.format(d.fix.down)}).`;
    const all = d.evidence.find((e) => e.id === 'all');
    $('fp-evidence-rows').replaceChildren(...d.evidence.map((e) => el('tr', {}, el('th', { scope: 'row', text: e.name }), num(fmt.format(e.places)), num(`${fmt.format(e.fixed)} (${pct(e.fixed, e.places)})`))));
    const r = d.rules;
    const row = (id) => d.evidence.find((e) => e.id === id);
    const short = row('short'), long = row('long');
    $('fp-evidence-note').textContent = (short && long ? `A place that lasts is seldom fixed, whatever the evidence says: ${pct(long.fixed, long.places)} of the ones seen on more than seven days, against ${pct(short.fixed, short.places)} of the ones seen on one or two${all ? ` and ${pct(all.fixed, all.places)} of all` : ''}. ` : '')
      + `The rule for a probable false positive picks ${fmt.format(r.probable_fp.picks)} places, of which ${fmt.format(r.probable_fp.fixed)} were fixed: the two do not measure the same thing, the rule describes the gaps that stay, the fixes the ones that are corrected. `
      + `Of the short places without evidence of transit, which could be short leaks, the operator fixed ${pct(r.short_no_evidence.fixed, r.short_no_evidence.picks)} (${fmt.format(r.short_no_evidence.fixed)} of ${fmt.format(r.short_no_evidence.picks)}).`;
  }

  // no-cache: the file has no version in its address, and an older copy has not the fields this script reads
  fetch('/data/false-positives.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(show)
    .catch(() => { $('fp-tiles').replaceChildren(el('p', { class: 'hint', text: 'The figures could not be loaded.' })); });
})();
