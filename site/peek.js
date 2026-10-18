'use strict';

// A quick look at any AS in the page: a click on the name of an AS (a chip or a link in a table) opens a small window with what the site knows about it,
// from /api/v1/as/<number>: whether it publishes an ASPA and with which providers, how many ASPAs name it as a provider, whether it is seen in BGP, the
// findings on its ASPA and its last change. A click with Ctrl, Cmd or Shift, or the middle button, still goes to the page of the AS.
(function (root) {
  // "AS3333" for a link to the page or the lookup of an AS, else null
  const asnOfHref = (href) => { const m = /^(?:#|\/as\/)(AS[1-9]\d{0,9})\/?$/i.exec(String(href || '')); return m ? m[1].toUpperCase() : null; };

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // The lines of the window for an answer of the per-AS API: [{label, text, chips?}] (chips: AS numbers to show as links).
  function summary(d) {
    const lines = [];
    const a = d.aspa || {};
    if (!a.published) lines.push({ label: 'ASPA', text: 'Publishes no ASPA: its routes can only come out unknown.' });
    else if (a.no_providers) lines.push({ label: 'ASPA', text: 'Publishes an ASPA that says it has no transit providers (AS0).' });
    else lines.push({ label: 'ASPA', text: `Publishes an ASPA with ${plural(a.providers.length, 'provider', 'providers')}:`, chips: a.providers.slice(0, 12), more: Math.max(0, a.providers.length - 12) });
    const p = d.provider_of || [];
    lines.push({ label: 'Named as a provider', text: p.length ? `by ${plural(p.length, 'ASPA', 'ASPAs')}${p.length > 12 ? ', for instance:' : ':'}` : 'by no ASPA.', chips: p.slice(0, 12), more: Math.max(0, p.length - 12) });
    lines.push({ label: 'Seen in BGP', text: d.seen_in_bgp === true ? 'Yes, the route collectors see routes it originates.' : d.seen_in_bgp === false ? 'No: the route collectors see no route that it originates.' : 'Not known.' });
    const q = d.quality || [];
    if (a.published) lines.push({ label: 'Quality', text: q.length ? `${plural(q.length, 'finding', 'findings')} on its ASPA: ${q.slice(0, 2).map((x) => x.message || x.code || String(x)).join('; ')}${q.length > 2 ? '…' : ''}` : 'No finding on its ASPA.' });
    const h = (d.history || [])[(d.history || []).length - 1];
    if (h) lines.push({ label: 'Last change', text: `${h.date}: ${h.kind === 'new' ? 'the ASPA appeared' : h.kind === 'removed' ? 'the ASPA was removed' : 'the providers changed'}${h.added && h.added.length ? `, added ${h.added.join(', ')}` : ''}${h.dropped && h.dropped.length ? `, dropped ${h.dropped.join(', ')}` : ''}.` });
    return lines;
  }

  const api = { asnOfHref, summary };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === undefined || v === null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  const cache = new Map();
  let dialog = null;

  function ensure() {
    if (dialog) return dialog;
    dialog = el('dialog', { class: 'peek', 'aria-labelledby': 'peek-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });     // a click on the backdrop
    document.body.append(dialog);
    return dialog;
  }

  async function show(asn) {
    const dlg = ensure();
    const num = asn.slice(2);
    const close = el('button', { type: 'button', class: 'linkish', text: 'Close' });
    close.addEventListener('click', () => dlg.close());
    dlg.replaceChildren(el('h2', { id: 'peek-title', text: asn }), el('p', { class: 'hint', 'aria-live': 'polite' }, el('span', { class: 'busy', text: 'Reading what the site knows' })), el('p', { class: 'peek-actions' }, close));
    if (!dlg.open) dlg.showModal();
    let d = cache.get(asn);
    try {
      if (!d) {
        const r = await fetch(`/api/v1/as/${num}`, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        d = await r.json();
        cache.set(asn, d);
      }
    } catch (err) {
      dlg.replaceChildren(el('h2', { id: 'peek-title', text: asn }), el('p', { class: 'error', text: `Not available (${err.message}).` }), el('p', { class: 'peek-actions' }, el('a', { href: `/as/${asn}`, text: `Open the page of ${asn}` }), ' · ', close));
      return;
    }
    const rows = summary(d).map((l) => el('div', { class: 'peek-row' }, el('dt', { text: l.label }), el('dd', {}, l.text, l.chips && l.chips.length ? el('ul', { class: 'chips' }, ...l.chips.map((c) => el('li', {}, el('a', { class: 'chip', href: `/as/${c}`, text: c }))), l.more ? el('li', { class: 'hint', text: `+${l.more} more` }) : null) : null)));
    const open = el('a', { href: `/as/${asn}`, text: `Open the page of ${asn}` });
    dlg.replaceChildren(el('h2', { id: 'peek-title', text: asn }), el('dl', { class: 'peek-list' }, ...rows), el('p', { class: 'peek-actions' }, open, ' · ', close));
    open.focus();
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a.chip, a.aslink');
    const asn = a && asnOfHref(a.getAttribute('href'));
    if (!asn) return;
    e.preventDefault();
    show(asn);
  });
  root.AspaPeek = api;
})(typeof self !== 'undefined' ? self : this);
