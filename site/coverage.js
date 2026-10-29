'use strict';

// Two sections of the statistics page made from the same file as the route leaks, /api/v1/leaks.json (the families of routes of the
// 30 collectors): how much of the address space the routes that ASPA proves valid cover, by length of the AS path, and the routes of
// IPv6 and IPv4 side by side with their ratio.
(function () {
  const { el, fmt, pct } = window.AspaUI;
  const $ = (id) => document.getElementById(id);
  const LABEL = { valid: 'Valid', unknown: 'Unknown', invalid: 'Invalid' };
  const KINDS = ['valid', 'unknown', 'invalid'];
  const n = (text) => el('td', { class: 'num', text });

  // a bar with the three verdicts side by side, each as wide as its share
  function stacked(parts, label) {
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    // the widths are set on the elements, not with a style attribute: the content security policy does not allow inline styles
    return el('span', { class: 'sbar', role: 'img', 'aria-label': label, title: label },
      parts.map((p) => { const seg = el('span', { class: `seg v-${p.k}` }); seg.style.width = `${((100 * p.v) / total).toFixed(2)}%`; return seg; }));
  }

  function byLength(box, f) {
    const rows = f.by_length.filter((b) => b.routes > 0);
    box.replaceChildren(...rows.map((b) => {
      const sp = { valid: b.span_valid, unknown: b.span_unknown, invalid: b.span_invalid };
      const spTotal = sp.valid + sp.unknown + sp.invalid;
      const label = `Paths of ${b.length}${b.length === 9 ? ' or more' : ''} ASes: ${fmt.format(b.routes)} routes, ${pct(b.valid, b.routes)} valid, ${pct(b.unknown, b.routes)} unknown, ${pct(b.invalid, b.routes, 2)} invalid; by address space ${pct(sp.valid, spTotal)} valid`;
      return el('tr', {},
        el('th', { scope: 'row', text: b.length === 9 ? '9 or more' : String(b.length) }),
        n(fmt.format(b.routes)),
        el('td', {}, stacked(KINDS.map((k) => ({ k, v: b[k] })), label)),
        n(pct(b.valid, b.routes)), n(pct(b.unknown, b.routes)), n(pct(b.invalid, b.routes, 2)),
        n(pct(sp.valid, spTotal)));
    }));
  }

  function shares(box, d) {
    const row = (name, f) => {
      const sp = f.span, t = sp.valid + sp.unknown + sp.invalid;
      return el('tr', {}, el('th', { scope: 'row', text: name }), n(fmt.format(f.routes)),
        n(pct(f.valid, f.routes)), n(pct(f.unknown, f.routes)), n(pct(f.invalid, f.routes, 2)),
        n(pct(sp.valid, t)), n(pct(sp.unknown, t)), n(pct(sp.invalid, t, 2)));
    };
    box.replaceChildren(row('IPv4 (addresses)', d.families.v4), row('IPv6 (/48s)', d.families.v6));
  }

  function sideBySide(box, d) {
    const a = d.families.v6, b = d.families.v4;
    const r = (x, y) => (y ? (x / y).toFixed(x / y < 10 ? 4 : 2) : '–');
    const sp = (f) => f.span.valid + f.span.unknown + f.span.invalid;
    const lines = [
      ['Routes of the collectors', fmt.format(a.routes), fmt.format(b.routes), r(a.routes, b.routes)],
      ['Origin ASes', fmt.format(a.origins), fmt.format(b.origins), r(a.origins, b.origins)],
      ['Average routes per origin AS', (a.routes / a.origins).toFixed(1), (b.routes / b.origins).toFixed(1), r(a.routes / a.origins, b.routes / b.origins)],
      ['Valid routes', pct(a.valid, a.routes), pct(b.valid, b.routes), r(a.valid / a.routes, b.valid / b.routes)],
      ['Unknown routes', pct(a.unknown, a.routes), pct(b.unknown, b.routes), r(a.unknown / a.routes, b.unknown / b.routes)],
      ['Invalid routes', pct(a.invalid, a.routes, 2), pct(b.invalid, b.routes, 2), r(a.invalid / a.routes, b.invalid / b.routes)],
      ['Address space of valid routes', pct(a.span.valid, sp(a)), pct(b.span.valid, sp(b)), r(a.span.valid / sp(a), b.span.valid / sp(b))],
      ['Average AS path length', a.avg_path.toFixed(3), b.avg_path.toFixed(3), r(a.avg_path, b.avg_path)],
      ['Average AS path length, weighted by address space', a.avg_path_weighted.toFixed(3), b.avg_path_weighted.toFixed(3), r(a.avg_path_weighted, b.avg_path_weighted)],
    ];
    box.replaceChildren(...lines.map(([name, v6, v4, ratio]) => el('tr', {}, el('th', { scope: 'row', text: name }), n(v6), n(v4), n(ratio))));
  }

  async function main() {
    if (!$('cov-rows-v4')) return;
    let d;
    try {
      const r = await fetch('/api/v1/leaks.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch (err) {
      for (const id of ['cov-sub', 'fam-sub']) $(id).textContent = `The numbers are not available (${err.message}). They are rebuilt once a day.`;
      return;
    }
    if (!d.families) { for (const id of ['cov-sub', 'fam-sub']) $(id).textContent = 'This part is filled in by the next daily run.'; return; }
    shares($('cov-shares'), d);
    byLength($('cov-rows-v4'), d.families.v4);
    byLength($('cov-rows-v6'), d.families.v6);
    $('cov-sub').textContent = `The routes of the ${(d.collectors || []).length || 30} collectors, ${fmt.format(d.total.routes)} in all, checked with the downstream verification. By address space each route counts for the addresses it covers (IPv6 in /48s), so a /16 weighs 256 times a /24; the same space seen by several collectors counts each time, and prefixes shorter than /8 in IPv4 or /16 in IPv6 (default routes and tests) are left out of it. In the bars, valid is green, unknown amber and invalid red (often too thin to see).`;
    $('fam-sub').textContent = 'The same routes told apart by the family of the prefix, with the ratio IPv6 / IPv4 in the last column, as in a comparison of the two tables.';
    sideBySide($('fam-rows'), d);
  }
  main();
})();
