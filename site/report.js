'use strict';

// The page of a shared result (/r/<id>): reads /api/v1/reports/<id> and draws it. Everything goes in with textContent, so a report can only
// ever be text: a table and a few sentences, with a colour on some cells.
(function () {
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === undefined || v === null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

  // a cell is a string or [string, class]: the verdicts are badges (the word says it, the colour only helps), the hops are the ticks of the path check
  function cell(c) {
    const [text, cls] = Array.isArray(c) ? c : [c, null];
    if (cls === 'valid' || cls === 'unknown' || cls === 'invalid') return el('td', {}, el('span', { class: `badge v-${cls}`, text }));
    const hop = { provider: 'yes', 'not-provider': 'no', none: 'na' }[cls];
    return el('td', { class: hop ? `hop ${hop}` : undefined, text });
  }

  function section(s) {
    const kids = [];
    if (s.heading) kids.push(el('h2', { text: s.heading }));
    if (s.text) kids.push(el('p', { text: s.text }));
    if (s.table) {
      kids.push(el('div', { class: 'table-wrap card', tabindex: '0', role: 'group', 'aria-label': s.heading || 'Table' }, el('table', { class: 'checks' },
        el('caption', { class: 'sr-only', text: s.heading || 'Table of the report' }),
        el('thead', {}, el('tr', {}, s.table.columns.map((c) => el('th', { scope: 'col', text: c })))),
        el('tbody', {}, s.table.rows.map((r) => el('tr', {}, r.map(cell)))))));
    }
    return el('section', {}, ...kids);
  }

  async function main() {
    if (!$('rp-body')) return;
    const m = /^\/r\/([0-9a-f]{32}|[0-9a-f]{12})\/?$/.exec(location.pathname);
    if (!m) { $('rp-sub').textContent = 'This address is not the one of a report.'; return; }
    try {
      const r = await fetch(`/api/v1/reports/${m[1]}`, { headers: { Accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      document.title = `${d.title} · ASPA Explorer`;
      $('rp-title').textContent = d.title;
      $('rp-sub').textContent = `Shared by a visitor on ${when(d.created)}; kept until ${when(d.expires).split(',')[0]}. This site has not checked that the content is true.`;
      $('rp-body').replaceChildren(...d.sections.map(section));
      const links = [];
      if (d.source) links.push(el('a', { href: d.source, text: 'Run it again with the data of today' }), ' · ');
      links.push(el('a', { href: `/api/v1/reports/${m[1]}`, text: 'This report as JSON' }));
      $('rp-note').replaceChildren('Unverified: anybody can create a report, and this site does not check that the title, the text and the tables are what it computed. The ASPAs may also have changed since. To see the real result, run it again with the data of today. ', ...links);
    } catch (err) {
      $('rp-sub').textContent = `The report is not available (${err.message}).`;
    }
  }
  main();
})();
