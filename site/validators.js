'use strict';

// The "Validators compared" section of the statistics page: /api/v1/validators.json, built every hour by
// scripts/build-validators.mjs from the ASPAs of this site's Routinator and of two rpki-client validators.
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const SHORT = { routinator: 'Routinator (this site)', 'rpki-client': 'rpki-client', cloudflare: 'Cloudflare' };

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'unknown');
  const list = (ps) => {
    if (!ps) return el('span', { class: 'muted', text: 'not listed' });
    return el('span', { class: 'mono', text: ps.length > 4 ? `${ps.slice(0, 4).join(' ')} +${ps.length - 4}` : ps.join(' ') });
  };

  async function main() {
    if (!$('val-sub')) return;
    let d;
    try {
      const r = await fetch('/api/v1/validators.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch (err) {
      $('val-sub').textContent = `The comparison is not available (${err.message}). It is rebuilt every hour.`;
      return;
    }
    const ids = d.sources.map((s) => s.id);
    $('val-sub').textContent = `The ASPAs of ${d.sources.length} validators, read ${when(d.generated)}: this site's Routinator (NLnet Labs), rpki-client (OpenBSD, the console of the project) and the rpki-client that Cloudflare runs. Of ${fmt.format(d.customers)} customers, ${fmt.format(d.identical)} have the same providers in all of them.`;
    $('val-tiles').replaceChildren(...d.sources.map((s) => el('div', { class: 'tile card' },
      el('div', { class: 'label', text: SHORT[s.id] || s.name }),
      el('div', { class: 'value', text: s.count === null ? '–' : fmt.format(s.count) }),
      el('div', { class: 'note', text: s.error ? 'not reachable' : `built ${when(s.built)}${s.failed ? ` · ${s.failed} failed` : ''}` }))));

    const note = (x) => {
      if (x.as0) return 'AS0 next to other providers: the profile forbids it, and a validator may reject or trim the ASPA';
      const have = ids.filter((id) => x.providers[id]);
      if (have.length < ids.length) return `not in ${ids.filter((id) => !x.providers[id]).map((id) => SHORT[id] || id).join(' and ')}: another moment, or an object that fails there`;
      return 'the providers differ';
    };
    const head = el('tr', {}, el('th', { scope: 'col', text: 'ASPA of' }), ...ids.map((id) => el('th', { scope: 'col', text: SHORT[id] || id })), el('th', { scope: 'col', text: 'Why, perhaps' }));
    $('val-rows').replaceChildren(...(d.differences.length ? d.differences.slice(0, 30).map((x) => el('tr', {},
      el('td', {}, el('a', { class: 'chip', href: `/as/${x.customer}`, text: x.customer })),
      ...ids.map((id) => el('td', {}, list(x.providers[id]))),
      el('td', { text: note(x) }))) : [el('tr', {}, el('td', { colspan: String(ids.length + 2), text: 'None: the three agree.' }))]));
    $('val-head').replaceChildren(head);
    const pairs = d.pairs.map((p) => `${SHORT[p.a] || p.a} and ${SHORT[p.b] || p.b}: ${fmt.format(p.both)} in both, ${fmt.format(p.only_a)} only in the first, ${fmt.format(p.only_b)} only in the second, ${fmt.format(p.differ)} with other providers`).join('; ');
    $('val-note').textContent = `${fmt.format(d.differences_total)} differ${d.differences_total > 30 ? ' (the first 30 are listed)' : ''}. By pair: ${pairs}. The three read the same repositories at different moments and each may reject objects that the others accept, so a few differences are normal; a difference that lasts is worth a report to the validator.`;
  }
  main();
})();
