'use strict';

// Small helpers shared by the sections of the statistics page that were added later (resources.js, coverage.js, invalid.js):
// building elements without innerHTML, number formats and a line chart.
(function (root) {
  const fmt = new Intl.NumberFormat('en-US');
  const pct = (a, b, digits = 1) => (b ? `${((100 * a) / b).toFixed(a / b < 0.01 ? 2 : digits)}%` : '0%');
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };
  const chip = (as) => el('a', { class: 'chip', href: `/as/${as}`, text: as });
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  // a round number at or above v, for the top of an axis
  function niceTop(v) {
    if (!(v > 0)) return 1;
    const step = Math.pow(10, Math.floor(Math.log10(v))) / 2;
    return Math.max(step, Math.ceil(v / step) * step);
  }
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* the code is shown instead */ }
  const country = (cc) => { if (cc === 'ZZ') return 'Unknown'; try { return (names && names.of(cc)) || cc; } catch { return cc; } };

  // A line chart of one series: values with a label for each (the first, the middle and the last are written on the axis).
  // fmtY writes a value of the axis; label describes the chart for a screen reader.
  function lineChart(box, labels, values, { fmtY = (v) => fmt.format(v), label = '', height = 200 } = {}) {
    const W = Math.max(280, box.clientWidth || 640), H = height, m = { l: 52, r: 10, t: 10, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const top = niceTop(Math.max(...values, 0));
    const x = (i) => m.l + (values.length === 1 ? iw / 2 : (iw * i) / (values.length - 1));
    const y = (v) => m.t + ih - (ih * v) / top;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4;
      g.append(svg('line', { class: k ? 'grid' : 'axisline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), svg('text', { class: 'tick', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmtY(v)));
    }
    const idx = values.length > 2 ? [0, Math.floor((values.length - 1) / 2), values.length - 1] : values.map((_, i) => i);
    idx.forEach((i) => g.append(svg('text', { class: 'tick', x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle' }, labels[i])));
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    g.append(svg('polygon', { class: 'fillarea s1', points: `${pts} ${x(values.length - 1).toFixed(1)},${y(0)} ${x(0).toFixed(1)},${y(0)}` }), svg('polyline', { class: 'line s1', points: pts }));
    box.replaceChildren(g);
  }

  root.AspaUI = { el, svg, fmt, pct, chip, when, niceTop, country, lineChart };
})(typeof self !== 'undefined' ? self : this);
