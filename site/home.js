'use strict';

// The home page: the network of the visitor first, a search that opens the page of an AS, the ASPAs of today in a line,
// and the four areas of the site.
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
    numbers();
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
  // kept on this server, see build-client-origin.mjs), the API of the site gives the ASPA of that AS. With no answer the
  // whole block goes away: the search below is still there.
  async function verdict() {
    const card = $('home-you'), box = $('home-verdict');
    try {
      const me = await getJson('/client-ip');
      const n = Number(me.as);
      if (!(n > 0)) { card.hidden = true; return; }   // an address that no route covers
      const as = `AS${n}`;
      const d = await getJson(`/api/v1/as/${n}`);
      const a = d.aspa || {};
      const issues = Array.isArray(d.quality) ? d.quality.length : 0;
      const published = Boolean(a.published);
      let what;
      if (!published) what = `${as} has not published the list of its providers, so nobody can check its routes against it.`;
      else if (a.no_providers) what = `${as} declares that it has no providers (AS0).`;
      else {
        const k = (a.providers || []).length;
        what = `${as} declares ${k} provider${k === 1 ? '' : 's'}${issues ? `, with ${issues} thing${issues === 1 ? '' : 's'} to check` : ''}.`;
      }
      box.replaceChildren(
        el('p', { class: 'you-head' }, el('span', { class: 'you-as mono', 'data-asn': String(n), text: as }), ' ', el('span', { class: `you-tag ${published ? 'yes' : 'no'}`, text: published ? 'Has an ASPA' : 'No ASPA yet' })),
        el('p', { class: 'you-what', text: what }),
        el('p', { class: 'you-do' }, el('a', { class: 'you-go', href: `/as/${as}`, text: `See ${as} in full` }), published ? null : el('a', { href: '/examples.html', text: 'How to write its ASPA' })),
        el('p', { class: 'you-from', text: `From your address ${me.ip}, as RIPE RIS sees it.` }),
      );
    } catch {
      card.hidden = true;
    }
  }

  // The ASPAs of today: the count of the validator of the site (from the comparison of the validators, a small file) and,
  // from the daily adoption numbers, how many of the networks seen in BGP have one, as a sentence and as a bar.
  function numbers() {
    Promise.all([getJson('/api/v1/validators.json').catch(() => null), getJson('/api/v1/adoption.json').catch(() => null)]).then(([v, d]) => {
      const sources = v && Array.isArray(v.sources) ? v.sources : [];
      const r = sources.find((s) => s.id === 'routinator');
      const number = $('home-number');
      if (r && Number.isFinite(r.count)) number.textContent = fmt.format(r.count); else number.hidden = true;
      if (d && Number.isFinite(d.pct) && d.seen && Number.isFinite(d.aspa)) {
        const pct = `${d.pct.toFixed(1)}%`;
        $('home-share').textContent = `${fmt.format(d.aspa)} of the ${fmt.format(d.seen)} networks seen in BGP have one: ${pct}`;
        const bar = $('home-bar');
        bar.firstElementChild.style.width = `${Math.max(0, Math.min(100, d.pct))}%`;
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', `${pct} of the networks seen in BGP have an ASPA`);
        bar.hidden = false;
      }
    });
  }
})();
