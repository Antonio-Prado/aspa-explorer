'use strict';

// The home page: a search that opens the page of an AS, three numbers, and the three areas of the site.
// Until 1.64 the tools were on this page, so the old addresses (/#AS680, /#path=…, /#routes=…, /#changes, /#quality)
// are sent where those things are now.
(function () {
  const h = location.hash.slice(1);
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return ''; } };
  const asOf = (s) => {
    const m = String(s).trim().match(/^(?:as\s*)?(\d{1,10})$/i);
    return m && Number(m[1]) <= 4294967295 ? 'AS' + Number(m[1]) : null;
  };
  if (h) {
    let to = null;
    if (h.startsWith('path=') || h.startsWith('routes=')) to = `/network.html#${h}`;
    else if (h === 'changes' || h === 'quality') to = `/statistics.html#${h}`;
    else if (h === 'all') to = '/api.html#download';
    else if (asOf(dec(h))) to = `/as/${asOf(dec(h))}`;
    if (to) { location.replace(to); return; }
  }

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const getJson = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

  document.addEventListener('DOMContentLoaded', () => {
    $('home-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const as = asOf($('home-asn').value);
      if (!as) { $('home-error').textContent = 'Type an AS number, such as AS680 or 680.'; $('home-asn').focus(); return; }
      location.assign(`/as/${as}`);
    });

    // where ASPA stands, in one sentence: the count of the validator of the site (from the comparison of the validators, a
    // small file) and the daily adoption numbers; then the largest transit networks, as a table of status
    const answer = $('home-answer');
    Promise.all([getJson('/api/v1/validators.json').catch(() => null), getJson('/api/v1/adoption.json').catch(() => null)]).then(([v, d]) => {
      const r = v && (v.sources || []).find((s) => s.id === 'routinator');
      const parts = [];
      if (r && Number.isFinite(r.count)) parts.push(el('strong', { text: fmt.format(r.count) }), ' networks have published an ASPA.');
      if (d && Number.isFinite(d.pct) && d.seen) parts.push(' That is ', el('mark', { class: 'hl', text: `${d.pct.toFixed(1)}%` }), ` of the ${fmt.format(d.seen)} networks seen in BGP.`);
      const top = d && Array.isArray(d.top_transit) ? d.top_transit : [];
      if (top.length && Number.isFinite(d.top_transit_with_aspa)) parts.push(` Of the ${top.length} largest transit networks, `, el('strong', { text: String(d.top_transit_with_aspa) }), ` ${d.top_transit_with_aspa === 1 ? 'has' : 'have'} one.`);
      answer.replaceChildren(...(parts.length ? parts : ['The numbers are not available at the moment.']));
      transit(top);
    });
  });

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  // the table of the largest transit networks: the first 15, then all of them on request
  function transit(top) {
    const body = $('transit-rows');
    if (!top.length) { body.replaceChildren(el('tr', {}, el('td', { colspan: '5', text: 'The list is not available at the moment.' }))); return; }
    const row = (t, i) => el('tr', {},
      el('td', { class: 'num muted', text: String(i + 1) }),
      el('td', {}, el('a', { class: 'mono', href: `/as/${t.asn}`, text: t.asn })),
      el('td', { text: t.cc || '' }),
      el('td', { class: 'num', text: fmt.format(t.cone) }),
      t.aspa
        ? el('td', { class: 'state yes', text: t.providers === 0 ? 'published, no providers' : 'published' })
        : el('td', { class: 'state no', text: 'none' }));
    const draw = (n) => {
      body.replaceChildren(...top.slice(0, n).map(row));
      const more = $('transit-more');
      more.replaceChildren(n < top.length
        ? el('button', { type: 'button', class: 'linkish', text: `Show all ${top.length}`, onclick: () => draw(top.length) })
        : el('a', { href: '/statistics.html#top-title', text: 'The same list, with filters, on the statistics page' }));
    };
    draw(15);
  }
})();
