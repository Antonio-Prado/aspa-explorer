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

    verdict();

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

  // The answer for the network the visitor is on: /client-ip gives the address and the AS that originates it in BGP (a map
  // kept on this server, see build-client-origin.mjs), the API of the site gives the ASPA of that AS.
  async function verdict() {
    const box = $('home-verdict');
    const say = (kind, ...line) => {
      box.className = `you v-${kind}`;
      box.replaceChildren(...line);
    };
    try {
      const me = await getJson('/client-ip');
      const n = Number(me.as);
      const from = el('p', { class: 'v-from', text: `Seen from your address ${me.ip}${n > 0 ? `, which AS${n} originates in BGP (RIPE RIS)` : ''}.` });
      if (!(n > 0)) {
        say('unknown', el('p', { class: 'v-line', text: 'We cannot tell which network your address belongs to: no route of the RIPE RIS collectors covers it.' }), from);
        return;
      }
      const as = `AS${n}`;
      const d = await getJson(`/api/v1/as/${n}`);
      const a = d.aspa || {};
      const issues = Array.isArray(d.quality) ? d.quality.length : 0;
      const page = el('a', { href: `/as/${as}`, text: `See the page of ${as}` });
      if (a.published && a.no_providers) {
        say('yes', el('p', { class: 'v-line' }, el('strong', { class: 'v-word', text: 'Yes.' }), ` Your network, ${as}, has an ASPA that declares it has no providers (AS0).`),
          el('p', { class: 'v-links' }, page), from);
      } else if (a.published) {
        const k = (a.providers || []).length;
        say('yes', el('p', { class: 'v-line' }, el('strong', { class: 'v-word', text: 'Yes.' }), ` Your network, ${as}, has an ASPA with ${k} provider${k === 1 ? '' : 's'}${issues ? `, and ${issues} thing${issues === 1 ? '' : 's'} to check` : ''}.`),
          el('p', { class: 'v-links' }, page), from);
      } else {
        say('no', el('p', { class: 'v-line' }, el('strong', { class: 'v-word', text: 'Not yet.' }), ` Your network, ${as}, has no ASPA.`),
          el('p', { class: 'v-links' }, el('a', { href: '/examples.html', text: 'How to publish one' }), ' · ', page), from);
      }
    } catch {
      box.hidden = true;   // no answer: the search below is still there
    }
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
