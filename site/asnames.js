'use strict';

// The name of an AS as a tooltip: when the pointer rests on an AS number (a chip, a link in a table or a path, a node
// of the graph) or the keyboard focus reaches it, the name that the RIR registry gives (the "holder" of RIPEstat's
// as-overview, e.g. "FIBERTELECOM-AS Fiber Telecom S.p.A.") becomes its tooltip. A name is asked once per page
// session and only for the ASes that are looked at. Suggested by Leo Vegoda of PeeringDB.
(function (root) {
  const API = 'https://stat.ripe.net/data/as-overview/data.json?sourceapp=aspa-explorer&resource=AS';
  const DWELL_MS = 250;            // the pointer has to rest this long: passing over a table asks for nothing
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

  // The text of the tooltip. Some registries (ARIN) start the name with the number again ("AS6453 - TATA ..."): it is
  // said once.
  function tooltipText(asn, holder) {
    const name = String(holder || '').replace(new RegExp(`^AS${asn}(?![0-9])\\s*-?\\s*`, 'i'), '').trim();
    return name ? `AS${asn}: ${name}` : '';
  }

  const api = { asnOf, holderOf, tooltipText };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.AspaNames = api;

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

  // The element that stands for an AS, and its number: a link to an AS (HTML or SVG) or an element with data-asn.
  function target(node) {
    const e = node && node.closest ? node.closest('a, [data-asn]') : null;
    if (!e) return null;
    const asn = asnOf(e.getAttribute('href') || e.getAttribute('xlink:href'), e.textContent, e.getAttribute('data-asn'));
    return asn ? { e, asn } : null;
  }

  // The tooltip: the title attribute of an HTML element, a <title> child for SVG. A title that the page set itself is kept.
  function show(t, name) {
    const text = tooltipText(t.asn, name);
    if (!text) return;
    if (t.e.namespaceURI === 'http://www.w3.org/2000/svg') {
      let title = t.e.querySelector(':scope > title');
      if (title && !title.hasAttribute('data-as-name')) return;
      if (!title) { title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.setAttribute('data-as-name', ''); t.e.prepend(title); }
      title.textContent = text;
    } else if (!t.e.title || t.e.hasAttribute('data-as-name')) {
      t.e.title = text;
      t.e.setAttribute('data-as-name', '');
    }
  }

  let timer = null;
  document.addEventListener('pointerover', (ev) => {
    const t = target(ev.target);
    clearTimeout(timer);
    if (!t) return;
    if (names.has(t.asn)) { show(t, names.get(t.asn)); return; }
    timer = setTimeout(() => nameOf(t.asn).then((name) => show(t, name)), DWELL_MS);
  });
  document.addEventListener('pointerout', () => clearTimeout(timer));
  document.addEventListener('focusin', (ev) => {
    const t = target(ev.target);
    if (t) nameOf(t.asn).then((name) => show(t, name));
  });
})(typeof self !== 'undefined' ? self : this);
