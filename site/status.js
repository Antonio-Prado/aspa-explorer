'use strict';

// The status page: how old each piece of data is, judged against how often it should change.
(function () {
  const $ = (id) => document.getElementById(id);
  const { MIN, HOUR, DAY, dotState } = window.AspaStatus;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const c of kids) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const ago = (ms) => {
    const m = Math.round(ms / MIN);
    if (m < 2) return 'just now';
    if (m < 120) return `${m} minutes ago`;
    const h = Math.round(ms / HOUR);
    return h < 48 ? `${h} hours ago` : `${Math.round(ms / DAY)} days ago`;
  };
  const utc = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

  const LABEL = { ok: 'OK', late: 'Late', down: 'Down' };
  const CLASS = { ok: 'v-valid', late: 'v-unknown', down: 'v-invalid' };

  async function refresh() {
    const now = Date.now();
    const results = await window.AspaStatus.runAll(now);
    window.AspaStatus.paintDot(dotState(results));
    try { sessionStorage.setItem('aspa-status', JSON.stringify({ t: now, state: dotState(results) })); } catch { /* fine */ }
    $('rows').replaceChildren(...results.map(({ c, r }) => el('tr', {},
      el('th', { scope: 'row', text: c.name }),
      el('td', {}, el('span', { class: 'badge ' + CLASS[r.state], text: LABEL[r.state] })),
      el('td', { text: r.at ? `${r.day ? new Date(r.at).toISOString().slice(0, 10) : utc(r.at)}${r.day ? '' : ` (${ago(now - r.at)})`}${r.extra ? ` · ${r.extra}` : ''}` : (r.extra || 'unknown') }),
      el('td', { text: c.expected }))));
    const down = results.filter(({ r }) => r.state === 'down').length, late = results.filter(({ r }) => r.state === 'late').length;
    const msg = down ? `${down} part${down === 1 ? ' is' : 's are'} not working or very old.` : late ? `${late} part${late === 1 ? ' is' : 's are'} a little late.` : 'Everything is up to date.';
    // the answer first, as on the home page: green, amber or red, in one line
    const box = $('summary');
    box.className = `you res-verdict ${down ? 'v-no' : late ? 'v-late' : 'v-yes'}`;
    box.replaceChildren(el('p', { class: 'v-line' }, el('strong', { class: 'v-word', text: down ? 'A problem.' : late ? 'A little late.' : 'All good.' }), ' ', msg),
      el('p', { class: 'v-from', text: `Checked ${utc(now)} from your browser; the page checks again every minute.` }));
  }
  refresh();
  setInterval(refresh, MIN);
})();
