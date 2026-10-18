'use strict';

// The number of networks with an ASPA over time, by RIR and by country: /api/v1/trends.json, built once a day by
// scripts/build-trends.mjs. The same chart is on the statistics page (with a menu and the code to embed it) and, alone,
// on /embed.html?country=IT (or ?rir=ripe), meant for another site's iframe.
(function (root) {
  // the values of one series of the file: 'all', 'rir:ripe' or 'cc:IT' (zeros when it has none)
  function seriesFor(doc, key) {
    if (key === 'all') return doc.total.slice();
    const [kind, id] = key.split(':');
    const set = kind === 'rir' ? doc.rir : doc.country;
    return (set && set[id]) ? set[id].slice() : doc.points.map(() => 0);
  }
  // a round number at or above the largest value, for the top of the axis
  function niceMax(v) {
    if (!(v > 0)) return 1;
    if (v < 10) return Math.ceil(v);
    const step = Math.pow(10, Math.floor(Math.log10(v))) / 2;
    return Math.ceil(v / step) * step;
  }

  const api = { seriesFor, niceMax };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.AspaTrends = api;

  const fmt = new Intl.NumberFormat('en-US');
  const RIRS = { ripe: 'RIPE NCC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', afrinic: 'AFRINIC', unknown: 'Not in a delegation file' };
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* the code is shown instead */ }
  const country = (cc) => { if (cc === 'ZZ') return 'Unknown'; try { return (names && names.of(cc)) || cc; } catch { return cc; } };
  const labelOf = (key) => (key === 'all' ? 'All networks' : key.startsWith('rir:') ? (RIRS[key.slice(4)] || key.slice(4)) : country(key.slice(3)));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); return n; };
  const month = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  // Draws the chart of one series into `box` and returns the text that says what it shows.
  function draw(box, doc, key) {
    const values = seriesFor(doc, key);
    const W = 640, H = 240, m = { l: 48, r: 12, t: 12, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const top = niceMax(Math.max(...values));
    const x = (i) => m.l + (values.length === 1 ? iw : (i / (values.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / top) * ih;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    for (const f of top < 4 ? [0, 1] : [0, 0.5, 1]) {
      s.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(top * f), y2: y(top * f), class: f ? 'grid' : 'axisline' }));
      const t = svg('text', { x: m.l - 6, y: y(top * f) + 4, class: 'tick', 'text-anchor': 'end' });
      t.textContent = fmt.format(Math.round(top * f));
      s.append(t);
    }
    const ticks = values.length > 3 ? [0, Math.floor((values.length - 1) / 2), values.length - 1] : [0, values.length - 1];
    for (const i of new Set(ticks)) {
      const t = svg('text', { x: x(i), y: H - 8, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle' });
      t.textContent = month(doc.points[i]);
      s.append(t);
    }
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    s.append(svg('polygon', { points: `${pts} ${x(values.length - 1).toFixed(1)},${y(0)} ${x(0).toFixed(1)},${y(0)}`, class: 'fillarea s1' }));
    s.append(svg('polyline', { points: pts, class: 'line s1' }));
    box.replaceChildren(s);
    const last = values[values.length - 1], first = values[0];
    const text = `${labelOf(key)}: ${fmt.format(last)} network${last === 1 ? '' : 's'} with an ASPA in ${month(doc.points[values.length - 1])}, from ${fmt.format(first)} in ${month(doc.points[0])}.`;
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', text);
    return text;
  }

  const keyOf = (params) => (params.get('country') ? `cc:${params.get('country').toUpperCase()}` : params.get('rir') ? `rir:${params.get('rir').toLowerCase()}` : 'all');
  const valid = (key) => key === 'all' || (key.startsWith('rir:') ? Object.keys(RIRS).includes(key.slice(4)) : /^cc:[A-Z]{2}$/.test(key));
  const embedQuery = (key) => (key === 'all' ? '' : key.startsWith('rir:') ? `?rir=${key.slice(4)}` : `?country=${key.slice(3)}`);

  async function main() {
    const box = document.getElementById('tr-chart');
    if (!box) return;
    const sub = document.getElementById('tr-sub');
    let doc;
    try {
      const r = await fetch('/api/v1/trends.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      doc = await r.json();
    } catch (err) { sub.textContent = `The numbers over time are not available (${err.message}). They are rebuilt once a day.`; return; }
    const embed = Boolean(document.getElementById('tr-embed'));
    let key = keyOf(new URLSearchParams(location.search));
    if (!valid(key)) key = 'all';
    const show = () => {
      sub.textContent = draw(box, doc, key);
      if (embed) { document.title = `ASPAs over time: ${labelOf(key)}`; document.getElementById('tr-title').textContent = `Networks with an ASPA: ${labelOf(key)}`; }
    };
    if (embed) { show(); return; }
    const sel = document.getElementById('tr-group');
    const opt = (k) => { const o = document.createElement('option'); o.value = k; o.textContent = labelOf(k); return o; };
    const g1 = document.createElement('optgroup'); g1.label = 'RIR';
    for (const id of ['afrinic', 'apnic', 'arin', 'lacnic', 'ripe']) g1.append(opt('rir:' + id));
    const g2 = document.createElement('optgroup'); g2.label = 'Country (where the AS number was registered)';
    for (const cc of Object.keys(doc.country).filter((c) => c !== 'ZZ').sort((a, b) => country(a).localeCompare(country(b)))) g2.append(opt('cc:' + cc));
    sel.append(opt('all'), g1, g2);
    sel.value = key;
    const code = document.getElementById('tr-code');
    const render = () => {
      show();
      code.value = `<iframe src="${location.origin}/embed.html${embedQuery(key)}" title="Networks with an ASPA: ${labelOf(key)}" width="680" height="380" style="border:0" loading="lazy"></iframe>`;
    };
    sel.addEventListener('change', () => { key = sel.value; render(); });
    const copy = document.getElementById('tr-copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code.value); copy.textContent = 'Copied'; } catch { code.select(); copy.textContent = 'Press Ctrl+C'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
    });
    code.addEventListener('focus', () => code.select());
    render();
  }
  main();
})(typeof self !== 'undefined' ? self : this);
