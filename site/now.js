'use strict';

// The Right now page: its four parts are four tabs, and the less used tables of each part are closed under "deeper"
// boxes. Without this script the four parts are shown one after the other, with the line of links at the top.
// A link to a part (#inv-title, #leaks-title, #val-title, #rtr-title, or the older #invalid, #leaks, #validators, #rtr),
// or to anything inside one, selects its tab and opens the box it is in; choosing a tab puts its part in the address,
// so that the address can be shared.
(function () {
  const $ = (id) => document.getElementById(id);
  const OLD = { invalid: 'inv-title', leaks: 'leaks-title', validators: 'val-title', rtr: 'rtr-title' };

  document.addEventListener('DOMContentLoaded', () => {
    const list = $('now-tabs');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panelOf = (t) => $(t.getAttribute('aria-controls'));
    const select = (tab, { focus = false, remember = false } = {}) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panelOf(t).hidden = !on;
      }
      if (focus) tab.focus();
      if (remember) {
        const h = panelOf(tab).querySelector('h2');
        if (h && h.id) history.replaceState(null, '', `#${h.id}`);
      }
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t, { remember: true }));
      t.addEventListener('keydown', (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(tabs[(to + tabs.length) % tabs.length], { focus: true, remember: true });
      });
    });

    const fromHash = (scroll) => {
      const id = OLD[location.hash.slice(1)] || location.hash.slice(1);
      const target = id && $(id);
      const panel = target && target.closest('[role="tabpanel"]');
      if (!panel) return false;
      select(tabs.find((t) => panelOf(t) === panel));
      const box = target.closest('details.deeper');
      if (box) box.open = true;
      if (scroll) (target === panel.querySelector('h2') ? list : target).scrollIntoView({ block: 'start' });
      return true;
    };

    $('now-jump').hidden = true;
    list.hidden = false;
    glance((id) => { select($(id), { remember: true }); list.scrollIntoView({ block: 'start' }); });
    if (!fromHash(true)) select(tabs[0]);
    window.addEventListener('hashchange', () => fromHash(true));
  });

  // One number for each part, above the tabs: a visitor sees the state of the four at once, and a press on one opens its
  // tab. The four files are the ones that the parts read (the browser has them already, or is fetching them).
  function glance(open) {
    const box = $('now-glance');
    if (!box) return;
    const fmt = new Intl.NumberFormat('en-US');
    const getJson = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const tile = (tab, label, value, note) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile card';
      for (const [cls, text] of [['label', label], ['value', value], ['note', note]]) {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        b.append(s);
      }
      b.addEventListener('click', () => open(tab));
      return b;
    };
    Promise.all(['invalid', 'leaks', 'validators', 'rtr'].map((n) => getJson(`/api/v1/${n}.json`))).then(([inv, leaks, val, rtr]) => {
      const tiles = [];
      const p = inv && inv.profile;
      if (p && Number.isFinite(p.invalid_share)) tiles.push(tile('tab-inv', 'Invalid announcements', `${p.invalid_share.toFixed(2)}%`, `of the announcements since ${inv.from}`));
      if (leaks && Number.isFinite(leaks.places)) tiles.push(tile('tab-leaks', 'Valleys today', fmt.format(leaks.places), "places of valley in today's tables"));
      if (val && Number.isFinite(val.identical) && val.customers) tiles.push(tile('tab-val', 'Validators compared', `${fmt.format(val.identical)} of ${fmt.format(val.customers)}`, `ASPAs are the same in the ${(val.sources || []).length} validators`));
      const caches = rtr && Array.isArray(rtr.caches) ? rtr.caches : [];
      if (caches.length) {
        const up = caches.filter((c) => c.session && c.session.connected).length;
        const stale = caches.filter((c) => c.session && c.session.serial_stale).length;
        tiles.push(tile('tab-rtr', 'RTR caches', `${up} of ${caches.length} connected`, stale ? `${stale} with a serial that stands still` : 'all with a serial that moves'));
      }
      if (!tiles.length) return;
      box.replaceChildren(...tiles);
      box.hidden = false;
    });
  }
})();
