'use strict';

// The name of an AS as a tooltip: when the pointer rests on an AS number (a chip, a link in a table or a path, a node
// of the graph, a bar of a chart, or the number written in a sentence, a cell or a heading) or the keyboard focus reaches it, a small box under it gives the name that the
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

  // The AS number written at a place of a text: "AS1299" in "AS680 → AS1299" when the offset is on it or at one of its
  // ends, with where it starts and ends. A name that only starts like one (AS-SET, ASN, AS1299x) and AS0 give null.
  function asnAt(text, offset) {
    const re = /(^|[^A-Za-z0-9])AS([1-9]\d{0,9})(?![A-Za-z0-9])/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const start = m.index + m[1].length, end = m.index + m[0].length;
      if (start > offset) break;
      if (offset <= end) return { asn: m[2], start, end };
    }
    return null;
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

  // The flag of the country where an AS is registered (the delegation files of the registries, /api/v1/asn-registry.json):
  // the file of a two-letter code, or null for a code that is no country (ZZ, unknown; AP, the Asia-Pacific region).
  function flagSrc(cc) {
    const c = String(cc || '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(c) && c !== 'zz' && c !== 'ap' ? `/img/flags/${c}.svg` : null;
  }

  // The country of a value of the registry file ("ITr": the code and a letter for the registry), or '' when it has none.
  function countryIn(value) {
    const m = /^([A-Z]{2})[a-z]?$/.exec(String(value || ''));
    return m && m[1] !== 'ZZ' ? m[1] : '';
  }

  const api = { asnOf, asnAt, holderOf, nameText, tooltipText, place, flagSrc, countryIn };
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

  // The name of a country in English, or its code where the browser has no names.
  let regions = null;
  try { regions = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* the code is shown */ }
  const countryName = (cc) => { try { return (regions && regions.of(cc)) || cc; } catch { return cc; } };

  // The flag as an image, or null. It stands next to the name of the country or to an AS number, so it has no text of
  // its own unless `alt` gives one; a flag that does not load takes itself away.
  function flagEl(cc, alt) {
    const src = flagSrc(cc);
    if (!src) return null;
    const img = document.createElement('img');
    img.className = 'flag';
    img.src = src;
    img.alt = alt || '';
    img.width = 20;
    img.height = 15;
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove());
    return img;
  }

  // The country where an AS is registered: the registry file is asked once, the first time a country is wanted.
  let registry = null;             // Promise of {asn: "ITr"}
  const countryOf = (asn) => {
    if (!registry) {
      registry = fetch('/api/v1/asn-registry.json', { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j && j.asns) || {}, () => ({}));
    }
    return registry.then((m) => countryIn(m[asn]));
  };
  const countries = new Map();     // asn -> code, once known

  // The flag of the country where its number is registered, in front of every AS that is an element of its own: a chip, a
  // link to the page of an AS whose text is the number, an element with data-asn. It is put once, when the element comes
  // into the page, from the same file of the registries. No flag for an AS written inside a sentence (it is plain text),
  // for the ASes of a chart or of the graph (SVG), for AS0 and for an AS that is in no registry, for an element marked
  // data-noflag, and in a row of a table that shows the flag of a country already.
  const AS_ALONE = /^\s*AS([1-9]\d{0,9})\s*$/;
  function flagOn(e) {
    if (e.dataset.flag || e.closest('svg, .as-tip, [data-noflag], [contenteditable]')) return;
    const m = AS_ALONE.exec(e.textContent);
    if (!m) return;
    const chip = e.classList.contains('chip');
    if (e.tagName === 'A' ? !(chip || asnOf(e.getAttribute('href'), '', null) === m[1]) : !(chip || e.hasAttribute('data-asn'))) return;
    e.dataset.flag = '1';
    countryOf(m[1]).then((cc) => {
      if (!cc || !e.isConnected) return;
      const row = e.closest('tr');
      if (row && [...row.querySelectorAll('img.flag')].some((f) => !e.contains(f))) return;
      const f = flagEl(cc);
      if (f) e.prepend(f);
    });
  }
  function flagsIn(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches('a, .chip, [data-asn]')) flagOn(node);
    for (const e of node.querySelectorAll('a, .chip, [data-asn]')) flagOn(e);
  }
  const startFlags = () => {
    flagsIn(document.body);
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) flagsIn(n); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startFlags); else startFlags();

  // For a page with a tooltip of its own (the charts of the statistics), which shows the name in it: the name when it
  // is known (undefined when it was not asked yet), and the promise of it.
  root.AspaNames = { ...api, known: (asn) => names.get(asn), nameOf, flagEl, countryName, countryOf };

  // The element that stands for an AS, and its number: a link to an AS (HTML or SVG) or an element with data-asn.
  // An element whose page set a title or a tooltip of its own (a title attribute, a <title> in SVG, data-own-tip)
  // keeps it, and gets no box.
  // An element with data-tip (the code of a type of incident, for instance) shows that text in the same box.
  function target(node) {
    const own = node && node.closest ? node.closest('[data-tip]') : null;
    if (own) return { e: own, text: own.getAttribute('data-tip') };
    const e = node && node.closest ? node.closest('a, [data-asn]') : null;
    if (!e || e.hasAttribute('title') || e.hasAttribute('data-own-tip') || e.querySelector('title')) return null;
    const asn = asnOf(e.getAttribute('href') || e.getAttribute('xlink:href'), e.textContent, e.getAttribute('data-asn'));
    return asn ? { e, asn } : null;
  }

  // An AS number in plain text (a sentence, a cell, a heading) that is under the pointer: the word, not its element,
  // is what the box is about. Text with a tooltip of its own, a chart and a field are left alone.
  const inside = (r, x, y) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
  function textTarget(x, y) {
    let node = null, offset = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    const e = node && node.nodeType === 3 ? node.parentElement : null;
    if (!e || e.closest('[title], [data-own-tip], [data-tip], svg, .as-tip, [contenteditable]')) return null;
    const at = asnAt(node.nodeValue, offset);
    if (!at) return null;
    const range = document.createRange();
    range.setStart(node, at.start);
    range.setEnd(node, at.end);
    const rect = Array.from(range.getClientRects()).find((r) => inside(r, x, y));   // the caret snaps to the nearest text
    return rect ? { e, asn: at.asn, rect } : null;
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
    if (current && !current.rect) describe(current.e, false);
    current = null;
    if (tip) tip.hidden = true;
  }

  function render(t, text, cc) {
    const b = box();
    const layer = t.e.closest('dialog[open]') || document.body;   // a modal dialog covers whatever is outside it
    if (b.parentNode !== layer) layer.append(b);
    b.textContent = cc ? `${text} · ${countryName(cc)}` : text;
    const flag = cc ? flagEl(cc) : null;
    if (flag) b.prepend(flag);
    b.hidden = false;
    const r = t.rect || t.e.getBoundingClientRect();
    const p = place(r, b.offsetWidth, b.offsetHeight, document.documentElement.clientWidth, window.innerHeight);
    b.style.left = `${p.left}px`;
    b.style.top = `${p.top}px`;
  }

  function show(t) {
    current = t;
    if (!t.rect) describe(t.e, true);
    if (t.text) { render(t, t.text); return; }
    // the name first, and the country where the AS is registered when the registry file has arrived
    const paint = (name) => {
      const text = tooltipText(t.asn, name);
      if (text) render(t, text, countries.get(t.asn)); else hide();
    };
    if (!countries.has(t.asn)) {
      countryOf(t.asn).then((cc) => {
        countries.set(t.asn, cc);
        if (current === t && cc && tip && !tip.hidden && names.get(t.asn)) paint(names.get(t.asn));
      });
    }
    if (names.has(t.asn)) { paint(names.get(t.asn)); return; }
    render(t, `AS${t.asn}: …`);
    nameOf(t.asn).then((name) => { if (current === t) paint(name); });
  }

  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return;                 // a tap opens the link: there is nothing to rest on
    const t = target(ev.target);
    if (current && t && t.e === current.e) return;          // moving inside the same element
    clearTimeout(timer);
    if (!t) { if (current) hide(); return; }
    timer = setTimeout(() => show(t), t.text || !names.has(t.asn) ? SHOW_MS : 0);
  });
  // an AS number in plain text: asked where the pointer rests, and left when the pointer goes off the word
  document.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    const x = ev.clientX, y = ev.clientY;
    if (current && current.rect) {
      if (inside(current.rect, x, y)) return;
      hide();
    }
    if (current || target(ev.target)) return;               // a link or a marked element: pointerover has it
    clearTimeout(timer);
    timer = setTimeout(() => { const t = textTarget(x, y); if (t) show(t); }, SHOW_MS);
  }, { passive: true });
  // a tap (or a click) on an element with data-tip opens and closes its box: there is no pointer to rest on a touch screen
  document.addEventListener('click', (ev) => {
    const t = target(ev.target);
    if (!t || !t.text) { if (current && current.text) hide(); return; }      // a tap elsewhere closes it
    if (current && current.e === t.e && tip && !tip.hidden) hide(); else { clearTimeout(timer); show(t); }
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
