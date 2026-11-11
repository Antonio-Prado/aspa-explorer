'use strict';

// "Latest changes and quality" on the State of ASPA page: the ASPAs that appeared, changed or disappeared in the last
// 14 days (events.json of the history, classified by history.js) and the checks of quality.js on the ASPAs listed now.
// They were tabs of the home page until 1.64; #changes and #quality open them here.
(function () {
  // the sections that moved to the Right now page in 1.68: an old link (from a message, a bookmark) follows them there
  const moved = ['leaks-title', 'inv-title', 'val-title', 'rtr-title', 'leaks', 'invalid', 'validators', 'rtr'];
  const follow = () => { if (moved.includes(location.hash.slice(1))) { location.replace(`/now.html${location.hash}`); return true; } return false; };
  if (follow()) return;
  window.addEventListener('hashchange', follow);
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const DAYS = 14;
  const SEVERITY = { error: 'Error', warning: 'Warning', note: 'Note' };
  const KIND_TEXT = { new: 'new', changed: 'changed', removed: 'removed' };

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const asNum = (as) => Number(String(as).slice(2));
  const chip = (as) => (as === 'AS0' ? el('span', { class: 'chip zero', text: 'AS0 · no transit providers' }) : el('a', { class: 'chip', href: `/as/${as}`, text: as }));
  const day = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  async function getJson(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  // a list that shows its first n items and a button for the rest
  function longList(items, n, row) {
    const ul = el('ul', { class: 'changelist' });
    const draw = (k) => {
      ul.replaceChildren(...items.slice(0, k).map(row));
      if (items.length > k) ul.append(el('li', {}, el('button', { type: 'button', class: 'linkish', text: `Show all ${fmt.format(items.length)}`, onclick: () => draw(items.length) })));
    };
    draw(n);
    return ul;
  }

  function changeText(e) {
    if (e.kind === 'removed') return 'ASPA removed';
    const list = (ps, sign) => ps.slice(0, 6).map((p) => sign + p).join(' ') + (ps.length > 6 ? ` … (${ps.length})` : '');
    if (e.kind === 'new') return `new ASPA: ${e.providers.length === 1 && e.providers[0] === 'AS0' ? 'no transit providers (AS0)' : list(e.providers, '')}`;
    return `providers ${[list(e.added, '+'), list(e.dropped, '−')].filter(Boolean).join(' ')}`;
  }

  async function changes() {
    const body = $('changes-body');
    try {
      const all = AspaHistory.classify(await getJson('/api/v1/archive/events.json'));
      const cut = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
      const recent = all.filter((e) => e.date >= cut);
      if (!recent.length) {
        const last = all[all.length - 1];
        body.replaceChildren(el('p', { class: 'hint', text: `No ASPA changed in the last ${DAYS} days${last ? ` (the last change was on ${day(last.date)})` : ''}.` }));
        return;
      }
      const days = [...new Set(recent.map((e) => e.date))].sort().reverse();
      body.replaceChildren(...days.map((d, i) => {
        const ev = recent.filter((e) => e.date === d);
        const count = (k) => ev.filter((e) => e.kind === k).length;
        const summary = ['new', 'changed', 'removed'].filter(count).map((k) => `${fmt.format(count(k))} ${KIND_TEXT[k]}`).join(', ');
        return el('details', { open: i === 0 }, el('summary', {}, el('strong', { text: day(d) }), ` · ${summary}`),
          longList(ev, 25, (e) => el('li', { class: 'k-' + e.kind }, chip(e.customer), ' ', el('span', { text: changeText(e) }))));
      }));
    } catch (err) {
      body.replaceChildren(el('p', { class: 'error', text: `The changes are not available (${err.message}).` }));
    }
  }

  async function quality() {
    const body = $('quality-body'), tiles = $('quality-tiles');
    try {
      const data = await getJson('/data/aspas.json');
      const list = (data.aspas || []).map((a) => ({ customer: a.customer, providers: [...a.providers].sort((x, y) => asNum(x) - asNum(y)), source: a.source || [] }));
      let unseen = null;
      try { unseen = new Set((await getJson('/api/v1/archive/visibility.json')).unseen); } catch { /* the checks that need BGP are skipped */ }
      const findings = AspaQuality.check(list, { unseen, now: Date.now() });
      const affected = (sev) => new Set(findings.filter((f) => f.severity === sev).map((f) => f.customer)).size;
      tiles.replaceChildren(...['error', 'warning', 'note'].map((sev) => el('div', { class: `tile card sev-${sev}` },
        el('div', { class: 'label', text: sev === 'note' ? 'Notes' : `${SEVERITY[sev]}s` }),
        el('div', { class: 'value', text: fmt.format(affected(sev)) }),
        el('div', { class: 'note', text: `ASPA${affected(sev) === 1 ? '' : 's'} with ${sev === 'note' ? 'a note' : sev === 'error' ? 'an error' : 'a warning'}` }))));
      const groups = AspaQuality.ORDER.map((kind) => ({ kind, list: findings.filter((f) => f.kind === kind) })).filter((g) => g.list.length);
      const kids = groups.map((g, i) => {
        const info = AspaQuality.KINDS[g.kind];
        return el('details', { open: i === 0 && info.severity === 'error' },
          el('summary', {}, el('span', { class: `badge sev-${info.severity}`, text: SEVERITY[info.severity] }), ' ', el('strong', { text: info.title }), ` · ${fmt.format(g.list.length)}`),
          el('p', { class: 'hint', text: info.why }),
          longList(g.list, 20, (f) => el('li', {}, chip(f.customer), ' ', el('span', { text: f.detail }),
            g.kind === 'mutual' ? el('span', {}, ' · ', el('a', { href: `/network.html#routes=${f.customer}`, text: 'who is the provider?' })) : null)));
      });
      if (!kids.length) kids.push(el('p', { class: 'hint', text: 'No issue found.' }));
      if (!unseen) kids.push(el('p', { class: 'hint', text: 'The checks that need to know which ASes appear in BGP are not available at the moment.' }));
      body.replaceChildren(...kids);
    } catch (err) {
      body.replaceChildren(el('p', { class: 'error', text: `The quality checks are not available (${err.message}).` }));
    }
  }

  // the two tabs, with the arrow keys, Home and End
  function tabs() {
    const list = [...document.querySelectorAll('#latest [role="tab"]')];
    const select = (t, focus) => {
      for (const x of list) {
        const on = x === t;
        x.setAttribute('aria-selected', String(on));
        x.tabIndex = on ? 0 : -1;
        $(x.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) t.focus();
    };
    list.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(list[(to + list.length) % list.length], true);
      });
    });
    const fromHash = () => {
      const want = { changes: 'tab-changes', quality: 'tab-quality' }[location.hash.slice(1)];
      if (!want) return;
      select($(want));
      $('latest').scrollIntoView({ block: 'start' });
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }

  // the tables under "Go deeper" are closed: a link to one of them, or to anything inside one, opens it
  function openTarget() {
    const id = location.hash.slice(1);
    const t = id && document.getElementById(id);
    const box = t && t.closest('details.deeper');
    if (!box) return;
    box.open = true;
    t.scrollIntoView({ block: 'start' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    openTarget();
    window.addEventListener('hashchange', openTarget);
    if (!$('latest')) return;
    tabs();
    changes();
    quality();
  });
})();
