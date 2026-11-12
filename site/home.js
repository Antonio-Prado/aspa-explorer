'use strict';

// The home page: a search that opens the page of an AS, the network of the visitor in one line, the ASPAs over time with
// three numbers, and the three areas of the site.
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
    chart();
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

  // The answer for the network the visitor is on, in one line: /client-ip gives the address and the AS that originates it in
  // BGP (a map kept on this server, see build-client-origin.mjs), the API of the site gives the ASPA of that AS.
  async function verdict() {
    const box = $('home-verdict');
    try {
      const me = await getJson('/client-ip');
      const n = Number(me.as);
      if (!(n > 0)) { box.hidden = true; return; }   // an address that no route covers: the search above is still there
      const as = `AS${n}`;
      const d = await getJson(`/api/v1/as/${n}`);
      const a = d.aspa || {};
      const issues = Array.isArray(d.quality) ? d.quality.length : 0;
      const link = el('a', { class: 'mono', href: `/as/${as}`, text: as });
      const from = el('span', { class: 'you-from', text: `(from your address ${me.ip}, as RIPE RIS sees it)` });
      if (a.published) {
        const k = (a.providers || []).length;
        const what = a.no_providers ? 'It declares that it has no providers (AS0).' : `${k} provider${k === 1 ? '' : 's'}${issues ? `, ${issues} thing${issues === 1 ? '' : 's'} to check` : ''}.`;
        box.replaceChildren('You are on ', link, ' ', el('span', { class: 'you-tag yes', text: 'Has an ASPA' }), ' ', what, ' ', from);
      } else {
        box.replaceChildren('You are on ', link, ' ', el('span', { class: 'you-tag no', text: 'No ASPA yet' }), ' ', el('a', { href: '/examples.html', text: 'What it should publish' }), ' ', from);
      }
    } catch {
      box.hidden = true;
    }
  }

  // The numbers under the chart: the count of the validator of the site (from the comparison of the validators, a small file)
  // and the daily adoption numbers.
  function numbers() {
    Promise.all([getJson('/api/v1/validators.json').catch(() => null), getJson('/api/v1/adoption.json').catch(() => null)]).then(([v, d]) => {
      const sources = v && Array.isArray(v.sources) ? v.sources : [];
      const r = sources.find((s) => s.id === 'routinator');
      const number = $('home-number');
      if (r && Number.isFinite(r.count)) number.textContent = fmt.format(r.count); else number.hidden = true;
      const fig = (value, ...text) => el('div', {}, el('dt', { text: value }), el('dd', {}, ...text));
      const figs = [];
      if (d && Number.isFinite(d.pct) && d.seen) figs.push(fig(`${d.pct.toFixed(1)}%`, `of the ${fmt.format(d.seen)} networks seen in BGP have one`));
      const top = d && Array.isArray(d.top_transit) ? d.top_transit.length : 0;
      if (top && Number.isFinite(d.top_transit_with_aspa)) figs.push(fig(`${d.top_transit_with_aspa} of ${top}`, `of the largest transit networks ${d.top_transit_with_aspa === 1 ? 'has' : 'have'} one. `, el('a', { href: '/statistics.html#top-title', text: 'Which ones' })));
      if (sources.length > 1) figs.push(fig(`${sources.length} validators`, 'compared every hour, two of them ours. ', el('a', { href: '/now.html#validators', text: 'How they differ' })));
      $('home-figs').replaceChildren(...figs);
    });
  }

  // The ASPAs over time, from /api/v1/trends.json (the end of each month since the first ASPA, then today): a line on a time
  // axis, with a tick at the start of each year.
  function chart() {
    const box = $('home-chart');
    getJson('/api/v1/trends.json').then((doc) => {
      const days = doc.points.map((p) => Date.parse(p + 'T00:00:00Z'));
      const values = doc.total;
      if (!(values.length > 1)) throw new Error('no series');
      const NS = 'http://www.w3.org/2000/svg';
      // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
      const svg = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; };
      const W = 760, H = 260, m = { l: 48, r: 8, t: 10, b: 26 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const top = window.AspaTrends.niceMax(Math.max(...values));
      const t0 = days[0], t1 = days[days.length - 1];
      const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
      const y = (v) => m.t + ih - (v / top) * ih;
      const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
      for (const f of [0, 0.5, 1]) {
        s.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(top * f), y2: y(top * f), class: f ? 'grid' : 'axisline' }));
        s.append(svg('text', { x: m.l - 6, y: y(top * f) + 4, class: 'tick', 'text-anchor': 'end' }, fmt.format(Math.round(top * f))));
      }
      for (let yr = new Date(t0).getUTCFullYear() + 1; Date.UTC(yr, 0, 1) < t1; yr++) {
        const at = x(Date.UTC(yr, 0, 1));
        s.append(svg('line', { x1: at, x2: at, y1: y(0), y2: y(0) + 4, class: 'axisline' }));
        s.append(svg('text', { x: at, y: H - 8, class: 'tick', 'text-anchor': 'middle' }, String(yr)));
      }
      const pts = values.map((v, i) => `${x(days[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      s.append(svg('polygon', { points: `${pts} ${x(t1).toFixed(1)},${y(0)} ${x(t0).toFixed(1)},${y(0)}`, class: 'fillarea s1' }));
      s.append(svg('polyline', { points: pts, class: 'line s1' }));
      box.replaceChildren(s);
      const month = (t) => new Date(t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const last = values[values.length - 1];
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', `Networks with an ASPA at the end of each month: ${fmt.format(values[0])} in ${month(t0)}, ${fmt.format(last)} in ${month(t1)}.`);
      // a year before the last point: the last month end at or before it
      let ago = null;
      for (let i = 0; i < days.length; i++) if (days[i] <= t1 - 365 * 86400e3) ago = values[i];
      $('home-since').textContent = `${ago !== null ? `up from ${fmt.format(ago)} a year ago and ` : 'from '}${fmt.format(values[0])} in ${month(t0)}`;
      $('home-caption').textContent = 'Networks with an ASPA at the end of each month, from the history of the validator of this site.';
    }).catch(() => { box.hidden = true; });
  }
})();
