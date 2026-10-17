'use strict';

// The adoption page: reads /api/v1/adoption.json (built once a day by scripts/build-adoption.mjs).
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const RIRS = { ripe: 'RIPE NCC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', afrinic: 'AFRINIC', unknown: 'Not in a delegation file' };
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* the code is shown instead */ }
  const country = (cc) => {
    if (cc === 'ZZ') return 'Unknown';
    try { return (names && names.of(cc)) || cc; } catch { return cc; }
  };

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  const pct = (v) => `${v.toFixed(v < 10 ? 2 : 1)}%`;
  // a row with a bar scaled to the best coverage in the group
  function covRows(container, rows, labelOf) {
    const max = Math.max(0.01, ...rows.map((r) => r.pct));
    container.replaceChildren(...rows.map((r) => {
      const fill = el('span', { class: 'fill' });
      fill.style.width = `calc((100% - 13rem) * ${r.pct / max})`;
      const text = `${labelOf(r)}: ${fmt.format(r.aspa)} of ${fmt.format(r.seen)} networks have an ASPA (${pct(r.pct)})`;
      return el('div', { class: 'bar-row wide', role: 'img', 'aria-label': text, tabindex: '0', title: text },
        el('span', { class: 'lbl', text: labelOf(r) }),
        el('span', { class: 'plot' }, fill, el('span', { class: 'val', text: `${pct(r.pct)} · ${fmt.format(r.aspa)} / ${fmt.format(r.seen)}` })));
    }));
  }

  function paged(rowsFn, tbody, button, step) {
    let n = step, all = [];
    const draw = () => {
      tbody.replaceChildren(...all.slice(0, n).map(rowsFn));
      button.hidden = all.length <= n;
      button.textContent = `Show ${fmt.format(Math.min(step, all.length - n))} more`;
    };
    button.addEventListener('click', () => { n += step; draw(); });
    return (list) => { all = list; n = step; draw(); };
  }

  async function main() {
    let d;
    try {
      const r = await fetch('/api/v1/adoption.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch (err) {
      $('meta').textContent = '';
      $('tiles').replaceChildren(el('p', { class: 'error', text: `Could not load the adoption data (${err.message}). It is rebuilt once a day; try again later.` }));
      return;
    }
    $('meta').textContent = `Built ${new Date(d.generated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
    const tile = (label, value, note) => el('div', { class: 'tile card' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note }));
    const top = d.top_transit;
    $('tiles').replaceChildren(
      tile('Networks seen in BGP', fmt.format(d.seen), 'ASes seen by the RIPE RIS collectors'),
      tile('With an ASPA', fmt.format(d.aspa), `${pct(d.pct)} of those seen`),
      tile(`Top ${top.length} transit networks`, `${fmt.format(d.top_transit_with_aspa)} with an ASPA`, `${fmt.format(top.length - d.top_transit_with_aspa)} without`),
      tile('Countries', fmt.format(d.by_country.filter((c) => c.cc !== 'ZZ').length), 'where seen ASes are registered'));

    covRows($('by-size'), d.by_size, (r) => r.label);
    covRows($('by-rir'), d.by_rir, (r) => RIRS[r.rir] || r.rir);

    // largest transit networks
    const topRow = (t, i) => el('tr', {},
      el('td', { class: 'num', text: String(t.rank) }),
      el('td', {}, el('a', { class: 'chip', href: `/as/${t.asn}`, text: t.asn })),
      el('td', { text: t.cc ? country(t.cc) : '' }),
      el('td', { class: 'num', text: fmt.format(t.cone) }),
      el('td', {}, t.aspa
        ? el('span', { class: 'badge v-valid', text: t.providers === 0 ? 'yes, AS0 (no providers)' : `yes, ${t.providers} provider${t.providers === 1 ? '' : 's'}` })
        : el('span', { class: 'badge v-unknown', text: 'none' })));
    const ranked = top.map((t, i) => ({ ...t, rank: i + 1 }));
    const drawTop = paged(topRow, $('top-rows'), $('top-more'), 25);
    const applyTop = () => drawTop($('top-missing').checked ? ranked.filter((t) => !t.aspa) : ranked);
    $('top-missing').addEventListener('change', applyTop);
    $('top-sub').textContent = `The ${top.length} largest networks seen in BGP, by customer cone: ${fmt.format(d.top_transit_with_aspa)} have an ASPA. Each AS opens its page.`;
    applyTop();

    // by country
    const ccRow = (c) => {
      const fill = el('span', { class: 'fill' });
      fill.style.width = `${Math.min(100, c.pct * 2)}%`;
      return el('tr', {},
        el('th', { scope: 'row', text: country(c.cc) }),
        el('td', { class: 'num', text: fmt.format(c.seen) }), el('td', { class: 'num', text: fmt.format(c.aspa) }),
        el('td', { class: 'cov-col' }, el('span', { class: 'mini' }, fill), ' ', pct(c.pct)));
    };
    const drawCc = paged(ccRow, $('cc-rows'), $('cc-more'), 25);
    const applyCc = () => {
      const min = Number($('cc-min').value);
      const by = $('cc-sort').value;
      drawCc(d.by_country.filter((c) => c.seen >= min && c.cc !== 'ZZ').sort((a, b) => b[by] - a[by] || b.seen - a.seen));
    };
    $('cc-min').addEventListener('change', applyCc);
    $('cc-sort').addEventListener('change', applyCc);
    applyCc();

    $('sources').textContent = `Sources: ASPAs from ${d.sources.aspas}; networks seen: ${d.sources.bgp}; country and registry: ${d.sources.registry}; size: ${d.sources.size} (The CAIDA AS Relationships Dataset, www.caida.org/catalog/datasets/as-relationships/). ${fmt.format(d.aspa_not_seen)} ASPA customers are not seen in BGP and are not counted.`;
  }
  main();
})();
