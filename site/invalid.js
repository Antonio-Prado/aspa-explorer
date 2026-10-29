'use strict';

// The "Invalid announcements" section of the statistics page: /api/v1/invalid.json, kept by scripts/watch-invalid.mjs from the
// stream of RIPE RIS Live, every ten minutes. The last 14 days: the share of invalid announcements by hour, the profile and the
// origins and prefixes with the most invalid announcements.
(function () {
  const { el, fmt, pct, chip, when, lineChart } = window.AspaUI;
  const $ = (id) => document.getElementById(id);
  const n = (text) => el('td', { class: 'num', text });
  const at = (iso) => `${new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
  const TOP = 20;

  function tile(label, value, note) { return el('div', { class: 'tile card' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note })); }

  const table = (box, rows, cells) => box.replaceChildren(...rows.map(cells));

  async function main() {
    if (!$('inv-tiles')) return;
    let d;
    try {
      const r = await fetch('/api/v1/invalid.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch (err) { $('inv-sub').textContent = `The report is not available (${err.message}). It is updated every ten minutes.`; return; }
    const p = d.profile;
    if (!p.announcements) { $('inv-sub').textContent = 'The first announcements are still being collected.'; return; }
    $('inv-sub').textContent = `${d.from} to ${d.to}, updated ${when(d.generated)}. About nine minutes in every ten of the stream of all the RIPE RIS collectors are read: ${fmt.format(p.announcements)} announcements, checked with the downstream verification, as the table dumps are.`;
    $('inv-tiles').replaceChildren(
      tile('Invalid announcements', fmt.format(p.invalid), `${p.invalid_share}% of ${fmt.format(p.announcements)} announcements`),
      tile('Origins with one', fmt.format(p.origins_with_invalid), `of ${fmt.format(p.origins)} origin ASes seen`),
      tile('Prefixes with one', fmt.format(p.prefixes_with_invalid), 'distinct prefixes'),
      tile('Announcements per second', p.announcements_per_second.toLocaleString('en-US'), p.peak_announcements_per_second.at ? `peak ${fmt.format(p.peak_announcements_per_second.v)} on ${at(p.peak_announcements_per_second.at)}` : ''),
      tile('Peak of invalid per second', fmt.format(p.peak_invalid_per_second.v), p.peak_invalid_per_second.at ? at(p.peak_invalid_per_second.at) : ''));
    const rows = d.hours.filter((h) => h.announcements > 0);
    if (rows.length > 1) {
      const values = rows.map((h) => (100 * h.invalid) / h.announcements);
      lineChart($('inv-chart'), rows.map((h) => at(h.at).split(',')[0]), values, {
        fmtY: (v) => `${v.toFixed(v < 1 ? 2 : 1)}%`, yTitle: 'Invalid announcements (%)',
        label: `Share of invalid announcements by hour, from ${at(rows[0].at)} to ${at(rows[rows.length - 1].at)}: from ${values[0].toFixed(2)}% to ${values[values.length - 1].toFixed(2)}%, highest ${Math.max(...values).toFixed(2)}%.`,
      });
    } else $('inv-chart').replaceChildren(el('p', { class: 'hint', text: 'The chart needs a few hours of data.' }));
    table($('inv-origins'), d.by_count.slice(0, TOP),
      (r) => el('tr', {}, el('td', {}, chip(r.asn)), n(fmt.format(r.invalid)), n(fmt.format(r.announcements)), n(`${r.share}%`), n(fmt.format(r.prefixes))));
    table($('inv-share'), d.by_share.slice(0, TOP),
      (r) => el('tr', {}, el('td', {}, chip(r.asn)), n(`${r.share}%`), n(fmt.format(r.invalid)), n(fmt.format(r.announcements)), n(fmt.format(r.prefixes))));
    table($('inv-prefixes'), d.prefixes.slice(0, TOP),
      (r) => el('tr', {}, el('td', {}, el('a', { class: 'aslink mono', href: `/#routes=${encodeURIComponent(r.prefix)}`, text: r.prefix })), el('td', {}, chip(r.origin)), n(fmt.format(r.invalid))));
    $('inv-note').textContent = `Invalid means that the ASPAs prove a valley in the path of the announcement: ${pct(p.invalid, p.announcements, 2)} of what was read. An origin with few announcements can have a high share: the second table only counts those with at least 100. Most announcements are unknown because most networks have no ASPA yet, so the valid share is low by construction. One origin can show up here for a single bad path that many collectors repeat.`;
  }
  main();
})();
