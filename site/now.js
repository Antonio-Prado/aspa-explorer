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
    if (!fromHash(true)) select(tabs[0]);
    window.addEventListener('hashchange', () => fromHash(true));
  });
})();
