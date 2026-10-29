'use strict';

// The sections of the statistics page that follow an AS number from its allocation to its ASPA: /api/v1/resources.json, built once a day
// by scripts/build-resources.mjs. By RIR, region and economy (with the figures per million Internet users), by the year of the
// allocation and the width of the number, and the ASPAs that name AS numbers that should not be there.
(function () {
  const { el, fmt, pct, chip, country } = window.AspaUI;
  const $ = (id) => document.getElementById(id);
  const RIRS = { ripe: 'RIPE NCC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', afrinic: 'AFRINIC' };
  const num = (v) => (v === null || v === undefined ? '–' : fmt.format(v));
  const dec = (v) => (v === null || v === undefined ? '–' : v.toFixed(v < 10 ? 2 : 1));
  const n = (text) => el('td', { class: 'num', text });
  // the advertised AS numbers that have an ASPA, the ones that the shares count (an older file has only all the ASPAs)
  const adv = (x) => (x.aspa_advertised ?? x.aspa);

  function funnel(d) {
    const sum = (k) => d.registries.reduce((s, r) => s + r[k], 0);
    const rows = [...d.registries.map((r) => ({ name: RIRS[r.rir] || r.rir, ...r })), { name: 'All', allocated: sum('allocated'), advertised: sum('advertised'), aspa: sum('aspa'), aspa_advertised: d.registries.reduce((t, r) => t + adv(r), 0), reserved: sum('reserved'), available: sum('available'), total: true }];
    $('res-rir').replaceChildren(...rows.map((r) => el('tr', { class: r.total ? 'total' : undefined },
      el('th', { scope: 'row', text: r.name }), n(fmt.format(r.allocated)), n(fmt.format(r.advertised)), n(pct(r.advertised, r.allocated)),
      n(fmt.format(adv(r))), n(pct(adv(r), r.advertised)), n(fmt.format(r.reserved)), n(fmt.format(r.available)))));
    $('res-region').replaceChildren(...d.regions.map((g) => el('tr', {},
      el('th', { scope: 'row', text: g.region }), n(fmt.format(g.allocated)), n(fmt.format(g.advertised)), n(fmt.format(adv(g))), n(pct(adv(g), g.advertised)),
      n(g.users ? fmt.format(Math.round(g.users / 1e6)) : '–'), n(dec(g.aspa_per_million_users)))));
  }

  function economies(d) {
    const rows = d.economies;
    let shown = 25;
    const draw = () => {
      const by = $('eco-sort').value, min = Number($('eco-min').value);
      const val = (e) => (by === 'aspa' ? adv(e) : e[by]) ?? -1;              // "with an ASPA" is the column: the advertised ones
      const list = rows.filter((e) => e.cc !== 'ZZ' && e.advertised >= min).sort((a, b) => val(b) - val(a) || b.advertised - a.advertised);
      $('eco-rows').replaceChildren(...list.slice(0, shown).map((e) => el('tr', {},
        el('th', { scope: 'row', text: country(e.cc) }), el('td', { text: e.region || '' }), n(fmt.format(e.allocated)), n(fmt.format(e.advertised)), n(fmt.format(adv(e))),
        n(pct(adv(e), e.advertised)), n(e.users ? dec(e.users / 1e6) : '–'), n(dec(e.aspa_per_million_users)), n(dec(e.advertised_per_million_users)))));
      $('eco-more').hidden = list.length <= shown;
      $('eco-more').textContent = `Show ${fmt.format(Math.min(25, list.length - shown))} more`;
    };
    for (const id of ['eco-sort', 'eco-min']) $(id).addEventListener('change', () => { shown = 25; draw(); });
    $('eco-more').addEventListener('click', () => { shown += 25; draw(); });
    draw();
  }

  // a row with a bar for the share of the advertised numbers that have an ASPA, scaled to the best of the group
  function bars(box, items, labelOf) {
    const max = Math.max(0.01, ...items.map((i) => i.pct_aspa_of_advertised));
    box.replaceChildren(...items.map((i) => {
      const fill = el('span', { class: 'fill' });
      fill.style.width = `calc((100% - 13rem) * ${i.pct_aspa_of_advertised / max})`;
      const text = `${labelOf(i)}: ${fmt.format(adv(i))} of ${fmt.format(i.advertised)} advertised AS numbers have an ASPA (${i.pct_aspa_of_advertised.toFixed(2)}%), ${fmt.format(i.allocated)} allocated`;
      return el('div', { class: 'bar-row wide', role: 'img', 'aria-label': text, tabindex: '0', title: text },
        el('span', { class: 'lbl', text: labelOf(i) }),
        el('span', { class: 'plot' }, fill, el('span', { class: 'val', text: `${i.pct_aspa_of_advertised.toFixed(2)}% · ${fmt.format(adv(i))} / ${fmt.format(i.advertised)}` })));
    }));
  }

  function suspect(d) {
    const box = $('bogus-body');
    const kids = [];
    kids.push(el('p', { class: d.suspect.length ? 'hint' : 'hint', text: d.suspect.length
      ? `${fmt.format(d.suspect.length)} of the ${fmt.format(d.aspa_customers)} AS numbers that have an ASPA are not ones that the registries have allocated:`
      : `All the ${fmt.format(d.aspa_customers)} AS numbers that have an ASPA are allocated by a registry.` }));
    if (d.suspect.length) kids.push(el('ul', { class: 'plain' }, d.suspect.slice(0, 50).map((s) => el('li', {}, chip(s.asn), ` ${s.reason}`))));
    kids.push(el('p', { class: 'hint', text: d.suspect_providers.length
      ? `${fmt.format(d.suspect_providers.length)} provider${d.suspect_providers.length === 1 ? '' : 's'} named in ASPAs ${d.suspect_providers.length === 1 ? 'is' : 'are'} not allocated either (listed as available or reserved in a delegation file, private, reserved, or absent from the files):`
      : 'No ASPA names a provider that is not allocated.' }));
    if (d.suspect_providers.length) {
      kids.push(el('section', { class: 'card table-wrap', tabindex: '0', 'aria-label': 'ASPAs that name a provider that is not allocated' }, el('table', { class: 'checks live' },
        el('caption', { class: 'sr-only', text: 'ASPAs whose provider is an AS number that is not allocated, with the reason' }),
        el('thead', {}, el('tr', {}, ['Customer', 'Provider', 'Why'].map((t) => el('th', { scope: 'col', text: t })))),
        el('tbody', {}, d.suspect_providers.slice(0, 60).map((s) => el('tr', {}, el('td', {}, chip(s.customer)), el('td', {}, chip(s.provider)), el('td', { text: s.reason })))))));
      if (d.suspect_providers.length > 60) kids.push(el('p', { class: 'hint', text: `${fmt.format(d.suspect_providers.length - 60)} more are in the file.` }));
    }
    box.replaceChildren(...kids);
  }

  async function main() {
    if (!$('res-rir')) return;
    let d;
    try {
      const r = await fetch('/api/v1/resources.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch (err) {
      for (const id of ['res-note', 'age-note', 'bogus-body']) if ($(id)) $(id).replaceChildren(el('p', { class: 'error', text: `The numbers are not available (${err.message}). They are rebuilt once a day.` }));
      return;
    }
    funnel(d); economies(d);
    $('res-note').textContent = `${d.sources.registry}; ${d.sources.advertised}; ${d.sources.people}. The economy is where the AS number was registered, not where it is used. Percentages: advertised of allocated, and with an ASPA of advertised.`;
    bars($('age-years'), d.by_year.filter((y) => y.year >= 2005), (y) => String(y.year));
    bars($('age-width'), d.by_width, (w) => w.width);
    $('age-note').textContent = 'The year is the one of the allocation in the delegation files. A recent number is more likely to belong to a network that is run today, and the networks that started after the first ASPAs are more likely to publish one; the 16-bit numbers include the oldest networks.';
    suspect(d);
  }
  main();
})();
