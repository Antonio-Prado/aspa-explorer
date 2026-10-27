'use strict';

// The name of an AS as a tooltip: when the pointer rests on an AS number (a chip, a link in a table or a path, a node
// of the graph, a bar of a chart) or the keyboard focus reaches it, a small box under it gives the name that the
// registry of its RIR records (the "holder" of RIPEstat's as-overview, e.g. "FIBERTELECOM-AS Fiber Telecom S.p.A.").
// The box is the page's own, not the title attribute: the browser shows a title only after a second or more, and not
// at all when it is set while the pointer is already resting. A name is asked once per visit, and only for the ASes
// that are looked at. Suggested by Leo Vegoda of PeeringDB.
(function (root) {
  const API = 'https://stat.ripe.net/data/as-overview/data.json?sourceapp=aspa-explorer&resource=AS';
  const SHOW_MS = 120;             // the pointer has to rest this long: moving across a table asks for nothing
  const STORE = 'aspa-as-names';   // sessionStorage key: names already asked in this tab

  // The AS number (a string of digits) of a link or a label: "#AS3333", "/#AS3333", "/as/AS3333", or a text "AS3333".
  // AS0 and anything else give null.
  function asnOf(href, text, data) {
    if (data && /^[1-9]\d{0,9}$/.test(data)) return data;
    const h = /(?:^|\/|#)AS([1-9]\d{0,9})\/?$/i.exec(String(href || ''));
    if (h) return h[1];
    const t = /^\s*AS([1-9]\d{0,9})\s*$/i.exec(String(text || ''));
    return t ? t[1] : null;
  }

  // The name in an answer of as-overview, or '' when the registry has none.
  function holderOf(json) {
    const h = json && json.data && json.data.holder;
    return typeof h === 'string' ? h.trim().slice(0, 200) : '';
  }

  // The name without the number: some registries (ARIN) start it with the number again ("AS6453 - TATA ...").
  function nameText(asn, holder) {
    return String(holder || '').replace(new RegExp(`^AS${asn}(?![0-9])\\s*-?\\s*`, 'i'), '').trim();
  }

  // The text of the tooltip, with the number said once.
  function tooltipText(asn, holder) {
    const name = nameText(asn, holder);
    return name ? `AS${asn}: ${name}` : '';
  }

  // Where the box goes: under the element, or over it when there is no room below; inside the window, 8 px from its
  // edges. r: the box of the element, w and h: the size of the tooltip, vw and vh: the size of the window.
  function place(r, w, h, vw, vh) {
    const gap = 6, edge = 8;
    const below = r.bottom + gap + h <= vh - edge || r.top - gap - h < edge;
    const top = below ? r.bottom + gap : r.top - gap - h;
    const left = Math.min(Math.max(edge, r.left), Math.max(edge, vw - edge - w));
    return { left: Math.round(left), top: Math.round(top) };
  }

  const api = { asnOf, holderOf, nameText, tooltipText, place };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  const names = new Map();         // asn -> name ('' when the registry has none or the request failed)
  const asked = new Map();         // asn -> Promise of the name
  try { for (const [k, v] of Object.entries(JSON.parse(sessionStorage.getItem(STORE) || '{}'))) names.set(k, v); } catch { /* no storage */ }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(Object.fromEntries(names))); } catch { /* full or blocked */ } };

  function nameOf(asn) {
    if (names.has(asn)) return Promise.resolve(names.get(asn));
    if (!asked.has(asn)) {
      asked.set(asn, fetch(API + asn, { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => holderOf(j), () => '')
        .then((name) => { names.set(asn, name); save(); return name; }));
    }
    return asked.get(asn);
  }

  // For a page with a tooltip of its own (the charts of the statistics), which shows the name in it: the name when it
  // is known (undefined when it was not asked yet), and the promise of it.
  root.AspaNames = { ...api, known: (asn) => names.get(asn), nameOf };

  // The element that stands for an AS, and its number: a link to an AS (HTML or SVG) or an element with data-asn.
  // An element whose page set a title or a tooltip of its own (a title attribute, a <title> in SVG, data-own-tip)
  // keeps it, and gets no box.
  function target(node) {
    const e = node && node.closest ? node.closest('a, [data-asn]') : null;
    if (!e || e.hasAttribute('title') || e.hasAttribute('data-own-tip') || e.querySelector('title')) return null;
    const asn = asnOf(e.getAttribute('href') || e.getAttribute('xlink:href'), e.textContent, e.getAttribute('data-asn'));
    return asn ? { e, asn } : null;
  }

  let tip = null;                  // the box, made on first use
  let current = null;              // the element the box is about
  let timer = null;

  function box() {
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'as-name-tip';
      tip.className = 'as-tip';
      tip.setAttribute('role', 'tooltip');
      tip.hidden = true;
      document.body.append(tip);
    }
    return tip;
  }

  function describe(e, on) {
    const ids = (e.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== 'as-name-tip');
    if (on) ids.push('as-name-tip');
    if (ids.length) e.setAttribute('aria-describedby', ids.join(' ')); else e.removeAttribute('aria-describedby');
  }

  function hide() {
    clearTimeout(timer);
    if (current) describe(current.e, false);
    current = null;
    if (tip) tip.hidden = true;
  }

  function render(t, text) {
    const b = box();
    const layer = t.e.closest('dialog[open]') || document.body;   // a modal dialog covers whatever is outside it
    if (b.parentNode !== layer) layer.append(b);
    b.textContent = text;
    b.hidden = false;
    const r = t.e.getBoundingClientRect();
    const p = place(r, b.offsetWidth, b.offsetHeight, document.documentElement.clientWidth, window.innerHeight);
    b.style.left = `${p.left}px`;
    b.style.top = `${p.top}px`;
  }

  function show(t) {
    current = t;
    describe(t.e, true);
    if (names.has(t.asn)) {
      const text = tooltipText(t.asn, names.get(t.asn));
      if (text) render(t, text); else hide();
      return;
    }
    render(t, `AS${t.asn}: …`);
    nameOf(t.asn).then((name) => {
      if (current !== t) return;
      const text = tooltipText(t.asn, name);
      if (text) render(t, text); else hide();
    });
  }

  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return;                 // a tap opens the link: there is nothing to rest on
    const t = target(ev.target);
    if (current && t && t.e === current.e) return;          // moving inside the same element
    clearTimeout(timer);
    if (!t) { if (current) hide(); return; }
    timer = setTimeout(() => show(t), names.has(t.asn) ? 0 : SHOW_MS);
  });
  document.addEventListener('pointerout', (ev) => {
    const leaving = target(ev.target);
    if (leaving && ev.relatedTarget && leaving.e.contains(ev.relatedTarget)) return;
    clearTimeout(timer);
    if (current && leaving && leaving.e === current.e) hide();
  });
  // the keyboard focus, not the focus that a click or a page gives (the link of a window that opens)
  document.addEventListener('focusin', (ev) => {
    const t = target(ev.target);
    if (t && ev.target.matches(':focus-visible')) show(t); else if (current) hide();
  });
  document.addEventListener('focusout', () => hide());
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && current) hide(); });
  document.addEventListener('scroll', () => { if (current) hide(); }, { capture: true, passive: true });   // the page or a box inside it
  document.addEventListener('close', () => { if (current) hide(); }, true);                             // a dialog that closes
})(typeof self !== 'undefined' ? self : this);
