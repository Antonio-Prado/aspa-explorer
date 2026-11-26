'use strict';

// The adoption page: reads /api/v1/adoption.json (built once a day by scripts/build-adoption.mjs).
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  // "26 Nov 2026, 04:50 UTC" for a time, "25 Nov 2026" for a day: every number of the page says what moment it is of
  const when = (iso) => `${new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
  const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const RIRS = { ripe: 'RIPE NCC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', afrinic: 'AFRINIC', unknown: 'Not in a delegation file' };
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* the code is shown instead */ }
  const country = (cc) => {
    if (cc === 'ZZ') return 'Unknown';
    try { return (names && names.of(cc)) || cc; } catch { return cc; }
  };

  // the flag of a country in front of its name (asnames.js draws it), or nothing for a code that has none
  const flag = (cc) => (window.AspaNames && window.AspaNames.flagEl(cc)) || '';

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
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
    // when the numbers of adoption were built and what moment each of their sources is of (the files of before 1.113 do not say)
    const m = d.measured || {};
    const of = (t, text) => (t ? ` (${text(t)})` : '');
    const regDays = Array.isArray(m.registry) ? m.registry.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) : [];
    $('meta').textContent = `Built ${when(d.generated)}, once a day${m.bgp ? `: the networks seen in BGP are the ones in the tables of the collectors at ${when(m.bgp)}` : ''}${m.aspas ? `, the ASPAs the ones of the validator at ${when(m.aspas)}` : ''}. Each part below says the time of its own numbers.`;
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
      el('td', {}, ...(t.cc ? [flag(t.cc), country(t.cc)] : [])),
      el('td', { class: 'num', text: fmt.format(t.cone) }),
      el('td', {}, t.aspa
        ? el('span', { class: 'badge v-valid', text: t.providers === 0 ? 'yes, AS0 (no transit providers)' : `yes, ${t.providers} provider${t.providers === 1 ? '' : 's'}` })
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
        el('th', { scope: 'row' }, flag(c.cc), country(c.cc)),
        el('td', { class: 'num', text: fmt.format(c.seen) }),
        // the networks that a ROA names as an origin (a file built before the ROAs were read has none: a dash)
        el('td', { class: 'num', text: typeof c.roa === 'number' ? fmt.format(c.roa) : '–' }), el('td', { class: 'num', text: typeof c.roa_pct === 'number' ? pct(c.roa_pct) : '–' }),
        el('td', { class: 'num', text: fmt.format(c.aspa) }),
        el('td', { class: 'cov-col' }, el('span', { class: 'mini' }, fill), ' ', pct(c.pct)));
    };
    const drawCc = paged(ccRow, $('cc-rows'), $('cc-more'), 25);
    const applyCc = () => {
      const min = Number($('cc-min').value);
      const by = $('cc-sort').value;
      drawCc(d.by_country.filter((c) => c.seen >= min && c.cc !== 'ZZ').sort((a, b) => (b[by] || 0) - (a[by] || 0) || b.seen - a.seen));
    };
    $('cc-min').addEventListener('change', applyCc);
    $('cc-sort').addEventListener('change', applyCc);
    applyCc();

    $('sources').textContent = `Sources, and the moment each one is of: ASPAs from ${d.sources.aspas}${of(m.aspas, (t) => `its run of ${when(t)}`)};${d.sources.roas ? ` ROAs from ${d.sources.roas}${of(m.roas, (t) => `its run of ${when(t)}`)};` : ''} networks seen: ${d.sources.bgp}${of(m.bgp, (t) => `the tables of ${when(t)}`)}; country and registry: ${d.sources.registry}${regDays.length ? ` (of ${regDays.map(dayText).join(' and ')})` : ''}; size: ${d.sources.size} (The CAIDA AS Relationships Dataset, www.caida.org/catalog/datasets/as-relationships/). ${fmt.format(d.aspa_not_seen)} ASPA customers are not seen in BGP and are not counted. These numbers, the ones by size, by RIR and by country and the largest networks were built together, ${when(d.generated)}.`;
    const ccAsOf = $('cc-asof');
    if (ccAsOf) ccAsOf.textContent = `Numbers of ${when(d.generated)}${m.bgp ? `: the networks in the tables of the collectors at ${when(m.bgp)}` : ''}${m.aspas ? `, the ASPAs${m.roas ? ' and the ROAs' : ''} of the validator at ${when(m.aspas)}` : ''}.`;
  }

  // "Who has an ASPA": by size and by RIR are two tabs, with the arrow keys, Home and End; the old addresses of the two
  // charts (#size-title, #rir-title) select their tab
  function whoTabs() {
    const list = [...document.querySelectorAll('#who [role="tab"]')];
    if (!list.length) return;
    const select = (t, focus) => {
      for (const x of list) {
        const on = x === t;
        x.setAttribute('aria-selected', String(on));
        x.tabIndex = on ? 0 : -1;
        $(x.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) t.focus();
    };
    list.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(list[(to + list.length) % list.length], true);
      });
    });
    const fromHash = () => {
      const want = { 'size-title': 'tab-size', 'rir-title': 'tab-rir' }[location.hash.slice(1)];
      if (!want) return;
      select($(want));
      $('who').scrollIntoView({ block: 'start' });
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whoTabs); else whoTabs();
  main();
})();
