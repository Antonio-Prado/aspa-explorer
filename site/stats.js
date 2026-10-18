'use strict';

// The statistics page: the charts of the ASPA data (over time, by RIR, providers per ASPA, most-named
// providers). The data are the same as on the home page: the validator's ASPAs through the same-origin
// proxy, and the daily history from the `history` branch of the public project.
const DATA_ASPAS = '/data/aspas.json';
const DATA_HISTORY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/history.json/raw?ref=history';
const RIR_NAMES = { afrinic: 'AFRINIC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', ripe: 'RIPE NCC' };
const RIR_ORDER = ['afrinic', 'apnic', 'arin', 'lacnic', 'ripe'];

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const asNum = (as) => Number(as.slice(2));
const rirName = (tal) => RIR_NAMES[tal] || tal.toUpperCase();

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/* ---------- tooltip ---------- */
const tip = () => $('tip');
function showTip(target, value, label, ev) {
  const t = tip();
  t.replaceChildren(el('strong', { text: value }), el('span', { text: label }));
  t.hidden = false;
  let x, y;
  if (ev && ev.clientX !== undefined && ev.type.startsWith('pointer')) { x = ev.clientX; y = ev.clientY; }
  else { const r = target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 12)) + 'px';
  t.style.top = Math.max(8, y - h - 12) + 'px';
}
function hideTip() { tip().hidden = true; }
function withTip(node, value, label) {
  node.addEventListener('pointermove', (e) => showTip(node, value, label, e));
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('focus', (e) => showTip(node, value, label, e));
  node.addEventListener('blur', hideTip);
  return node;
}

/* ---------- charts ---------- */
function barChart(container, rows, opts) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = opts.total;
  container.replaceChildren(...rows.map((r) => {
    const fill = el('span', { class: 'fill' });
    fill.style.width = `calc((100% - 4.5rem) * ${r.value / max})`;
    const share = total ? ` · ${(100 * r.value / total).toFixed(1)}% of ${opts.totalLabel}` : '';
    const row = el(r.href ? 'a' : 'div', {
      class: 'bar-row', href: r.href, tabindex: r.href ? undefined : '0', role: r.href ? undefined : 'img',
      'aria-label': `${r.label}: ${fmt.format(r.value)}`,
    },
      el('span', { class: 'lbl' + (opts.mono ? ' mono' : ''), text: r.label }),
      el('span', { class: 'plot' }, fill, el('span', { class: 'val', text: fmt.format(r.value) })));
    return withTip(row, fmt.format(r.value), r.label + share);
  }));
}

function columnChart(container, bins) {
  const max = Math.max(1, ...bins.map((b) => b.value));
  const total = bins.reduce((s, b) => s + b.value, 0);
  const cols = el('div', { class: 'columns' });
  const axis = el('div', { class: 'col-axis', 'aria-hidden': 'true' });
  for (const b of bins) {
    const fill = el('span', { class: 'fill' });
    fill.style.height = `calc((100% - 1.4rem) * ${b.value / max})`;
    const col = el('div', { class: 'col', tabindex: '0', role: 'img', 'aria-label': `${b.label} providers: ${fmt.format(b.value)} ASPAs` },
      el('span', { class: 'val', text: fmt.format(b.value) }), fill);
    withTip(col, fmt.format(b.value) + ' ASPAs', `${b.label} provider${b.label === '1' ? '' : 's'} · ${(100 * b.value / total).toFixed(1)}%`);
    cols.append(col);
    axis.append(el('span', { text: b.label }));
  }
  container.replaceChildren(cols, axis, el('div', { class: 'axis-title', text: 'Providers declared (AS0 counted as one)' }));
}

/* ---------- adoption over time ---------- */
// One chart, several metrics. "By RIR" is stacked areas (bottom to top, the categorical slots in
// fixed order); the others are a single line. The period and a logarithmic scale are options.
const HIST_RIRS = ['ripe', 'arin', 'apnic', 'lacnic', 'afrinic'];
const HIST_SRC = { ripe: 'RIPE NCC RPKI archive', aspa: 'this validator' };
const HIST_METRICS = {
  rir: { label: 'ASPAs, by RIR', unit: 'ASPAs', stacked: true, value: (r) => r.aspas },
  total: { label: 'ASPAs, total', unit: 'ASPAs', value: (r) => r.aspas },
  providers: { label: 'Provider ASes', unit: 'provider ASes', value: (r) => r.provider_ases,
    note: 'Distinct ASes named as a provider in at least one ASPA (AS0 excluded).' },
  median: { label: 'Median providers per ASPA', unit: 'providers', value: (r) => r.median_providers,
    note: 'Half of the ASPAs name this many providers or fewer (AS0 counted as one).' },
  zero: { label: 'No-provider ASPAs (AS0)', unit: 'ASPAs', value: (r) => r.no_provider_aspas,
    note: 'ASPAs in which the customer declares that it has no provider.' },
  coverage: { label: 'Coverage of the ASes seen in BGP', unit: '%', pct: true, nolog: true,
    value: (r) => (r.bgp_ases ? 100 * r.aspa_in_bgp / r.bgp_ases : null),
    note: 'Share of the ASes seen by the RIPE RIS route collectors that have an ASPA; before 16 October 2026 one sample a week.' },
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
const fmtDayLong = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayMs = (iso) => Date.parse(iso + 'T00:00:00Z');
function niceStep(max, ticks) {
  const raw = max / ticks, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw);
}
const fmtMetric = (mt, v) => (mt.pct ? `${v.toFixed(v < 10 ? 2 : 1)}%` : fmt.format(v));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let history = [];
let coverageNow = null;
const histOpt = { metric: 'rir', range: 'all', log: false };

// rows of the current metric and period (rows without a value for the metric are left out)
function histRows() {
  const mt = HIST_METRICS[histOpt.metric];
  let rows = history.filter((r) => mt.value(r) !== null && mt.value(r) !== undefined);
  if (histOpt.range !== 'all' && rows.length) {
    const from = dayMs(rows[rows.length - 1].date) - Number(histOpt.range) * 86400000;
    rows = rows.filter((r) => dayMs(r.date) >= from);
  }
  return rows;
}

function xTicks(t0, t1) {
  const ticks = [];
  const d0 = new Date(t0), span = (t1 - t0) / 86400000;
  if (span > 800) {
    for (let yr = d0.getUTCFullYear() + 1; Date.UTC(yr, 0, 1) <= t1; yr++) ticks.push({ iso: `${yr}-01-01`, label: String(yr) });
  } else {
    const every = span > 400 ? 2 : 1;
    let yr = d0.getUTCFullYear(), mo = d0.getUTCMonth() + 1, n = 0;
    for (; Date.UTC(yr, mo, 1) <= t1; mo++) {
      if (mo > 11) { mo = 0; yr++; }
      if (Date.UTC(yr, mo, 1) > t1) break;
      if (n++ % every) continue;
      ticks.push({ iso: `${yr}-${String(mo + 1).padStart(2, '0')}-01`, label: mo === 0 || ticks.length === 0 ? `${MONTHS[mo]} ${yr}` : MONTHS[mo] });
    }
  }
  return ticks;
}

function drawHistory() {
  const box = $('chart-history');
  const rows = histRows();
  const mt = HIST_METRICS[histOpt.metric];
  if (rows.length < 2) {
    box.replaceChildren(el('p', { class: 'hint', text: 'Not enough data for this view.' }));
    box.onpointermove = box.onpointerleave = box.onfocus = box.onblur = box.onkeydown = null;
    return;
  }
  const log = histOpt.log && !mt.stacked && !mt.nolog;
  const W = Math.max(280, box.clientWidth), H = W < 520 ? 240 : 290;
  const m = { l: mt.pct ? 52 : 44, r: 10, t: 10, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = dayMs(rows[0].date), t1 = dayMs(rows[rows.length - 1].date);
  const vals = rows.map((r) => mt.value(r));
  const ymax = Math.max(1e-9, ...vals);
  let top, step, ticks = [];
  if (log) {
    top = 10 ** Math.max(1, Math.ceil(Math.log10(ymax)));
    for (let v = 1; v <= top; v *= 10) ticks.push(v);
  } else {
    step = niceStep(ymax, 4); top = Math.ceil(ymax / step - 1e-9) * step;
    for (let i = 0; i <= Math.round(top / step); i++) ticks.push(+(i * step).toFixed(6));
  }
  const x = (iso) => m.l + (t1 === t0 ? 0 : iw * (dayMs(iso) - t0) / (t1 - t0));
  const y = (v) => m.t + ih * (1 - (log ? Math.log10(Math.max(v, 1)) / Math.log10(top) : v / top));

  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' });
  for (const v of ticks) {
    g.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v > (log ? 1 : 0) ? 'grid' : 'axisline' }));
    const t = svg('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
    t.textContent = mt.pct ? `${+v.toFixed(3)}%` : fmt.format(v);
    g.append(t);
  }
  for (const tk of xTicks(t0, t1)) {
    g.append(svg('line', { x1: x(tk.iso), x2: x(tk.iso), y1: m.t + ih, y2: m.t + ih + 4, class: 'axisline' }));
    const t = svg('text', { x: x(tk.iso), y: H - 6, class: 'tick', 'text-anchor': 'middle' });
    t.textContent = tk.label;
    g.append(t);
  }
  if (mt.stacked) {
    // cumulative tops, bottom series first
    const acc = rows.map(() => 0);
    HIST_RIRS.forEach((rir, i) => {
      const lower = acc.slice();
      rows.forEach((r, k) => { acc[k] += r['aspas_' + rir] || 0; });
      const up = rows.map((r, k) => `${x(r.date).toFixed(1)},${y(acc[k]).toFixed(1)}`);
      const down = rows.map((r, k) => `${x(r.date).toFixed(1)},${y(lower[k]).toFixed(1)}`).reverse();
      g.append(svg('polygon', { points: up.concat(down).join(' '), class: `area s${i + 1}` }));
      // a RIR with no ASPA has no area to show: its line runs along the zero of the axis
      if (rows.every((r) => !r['aspas_' + rir])) {
        g.append(svg('polyline', { points: rows.map((r) => `${x(r.date).toFixed(1)},${y(0).toFixed(1)}`).join(' '), class: `line s${i + 1}` }));
      }
    });
  } else {
    const pts = rows.map((r, k) => `${x(r.date).toFixed(1)},${y(vals[k]).toFixed(1)}`);
    const base = m.t + ih;
    g.append(svg('polygon', { points: `${pts.join(' ')} ${x(rows[rows.length - 1].date).toFixed(1)},${base} ${x(rows[0].date).toFixed(1)},${base}`, class: 'fillarea s1' }));
    g.append(svg('polyline', { points: pts.join(' '), class: 'line s1' }));
  }
  const cross = svg('g', { class: 'cross', visibility: 'hidden' },
    svg('line', { y1: m.t, y2: m.t + ih, class: 'crossline' }));
  g.append(cross);
  box.replaceChildren(g);

  const rowAt = (clientX) => {
    const r = g.getBoundingClientRect();
    const t = t0 + (t1 - t0) * Math.min(1, Math.max(0, (clientX - r.left - m.l) / iw));
    let best = 0;
    for (let k = 1; k < rows.length; k++) if (Math.abs(dayMs(rows[k].date) - t) < Math.abs(dayMs(rows[best].date) - t)) best = k;
    return best;
  };
  const show = (k, clientX, clientY) => {
    const r = rows[k], px = x(r.date);
    cross.firstChild.setAttribute('x1', px); cross.firstChild.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    const t = tip();
    const extra = mt.stacked
      ? HIST_RIRS.map((q) => el('span', { class: 'trow' }, `${rirName(q)} ${fmt.format(r['aspas_' + q] || 0)}`))
      : mt.pct ? [el('span', { class: 'trow' }, `${fmt.format(r.aspa_in_bgp)} of ${fmt.format(r.bgp_ases)} ASes`)] : [];
    t.replaceChildren(el('strong', { text: `${fmtMetric(mt, vals[k])} ${mt.pct ? '' : mt.unit}`.trim() }),
      el('span', { text: `${fmtDayLong(r.date)} · ${HIST_SRC[r.src] || r.src || ''}` }), ...extra);
    t.hidden = false;
    const b = box.getBoundingClientRect();
    const cx = clientX !== undefined ? clientX : b.left + px, cy = clientY !== undefined ? clientY : b.top + m.t;
    t.style.left = Math.max(8, Math.min(window.innerWidth - t.offsetWidth - 8, cx + 14)) + 'px';
    t.style.top = Math.max(8, cy - t.offsetHeight - 12) + 'px';
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); hideTip(); };
  let cur = rows.length - 1;
  box.onpointermove = (e) => { cur = rowAt(e.clientX); show(cur, e.clientX, e.clientY); };
  box.onpointerleave = hide;
  box.onfocus = () => show(cur);
  box.onblur = hide;
  box.onkeydown = (e) => {
    const jump = { ArrowLeft: -1, ArrowRight: 1, PageDown: -30, PageUp: 30, Home: -1e9, End: 1e9 }[e.key];
    if (jump === undefined) return;
    e.preventDefault();
    cur = Math.min(rows.length - 1, Math.max(0, cur + jump));
    show(cur);
  };
}

// legend, accessible name and note follow the metric and the period
function describeHistory() {
  const mt = HIST_METRICS[histOpt.metric];
  const rows = histRows();
  const box = $('chart-history');
  const log = $('hist-log');
  log.disabled = !!(mt.stacked || mt.nolog);
  log.parentElement.classList.toggle('off', log.disabled);
  $('history-sub').textContent = mt.stacked ? 'Validated ASPA objects per day, stacked by RIR' : `${mt.label}, per day`;
  if (!rows.length) return;
  const first = rows[0], last = rows[rows.length - 1];
  const lastRow = history[history.length - 1];
  box.setAttribute('aria-label', `${mt.label} over time, from ${fmtMetric(mt, mt.value(first))} on ${fmtDayLong(first.date)} to ${fmtMetric(mt, mt.value(last))} on ${fmtDayLong(last.date)}. Use the left and right arrow keys to read single days; a table follows.`);
  $('history-legend').replaceChildren(...(mt.stacked ? HIST_RIRS.map((rir, i) => el('li', {},
    el('span', { class: `sw s${i + 1}`, 'aria-hidden': 'true' }),
    el('span', { class: 'lg', text: rirName(rir) }),
    el('span', { class: 'lv', text: fmt.format(lastRow['aspas_' + rir] || 0) })))
    : [el('li', {}, el('span', { class: 'sw s1', 'aria-hidden': 'true' }), el('span', { class: 'lg', text: mt.label }),
      el('span', { class: 'lv', text: `${fmtMetric(mt, mt.value(last))}${mt.pct ? '' : ''}` }))]));
  $('history-note').textContent = `${fmtDayLong(first.date)} to ${fmtDayLong(last.date)}. ` +
    (mt.stacked && !lastRow.aspas_afrinic ? 'AFRINIC has published none so far: its line runs along zero. ' : '') + (mt.note ? mt.note + ' ' : '') +
    'Days before 16 October 2026 come from the RIPE NCC RPKI archive; since then, from this site\'s validator.';
}


const HIST_COLS = ['date', 'src', 'aspas', 'provider_ases', 'median_providers', 'largest_provider_set', 'no_provider_aspas',
  'aspas_afrinic', 'aspas_apnic', 'aspas_arin', 'aspas_lacnic', 'aspas_ripe', 'bgp_ases', 'aspa_in_bgp'];
function downloadHistory(kind) {
  const body = kind === 'csv'
    ? [HIST_COLS.join(','), ...history.map((r) => HIST_COLS.map((c) => (r[c] === undefined ? '' : r[c])).join(','))].join('\n') + '\n'
    : JSON.stringify(history);
  const url = URL.createObjectURL(new Blob([body], { type: kind === 'csv' ? 'text/csv' : 'application/json' }));
  const a = el('a', { href: url, download: `aspa-history.${kind}` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderHistory(rows) {
  history = rows;
  const box = $('chart-history');
  box.setAttribute('role', 'img');
  box.setAttribute('tabindex', '0');
  // table view: the last day of each month
  const byMonth = new Map();
  for (const r of rows) byMonth.set(r.date.slice(0, 7), r);
  const cov = (r) => (r.bgp_ases ? fmtMetric(HIST_METRICS.coverage, 100 * r.aspa_in_bgp / r.bgp_ases) : '–');
  $('history-rows').replaceChildren(...[...byMonth.values()].reverse().map((r) => el('tr', {},
    el('th', { scope: 'row', text: fmtDayLong(r.date) }),
    el('td', { text: fmt.format(r.aspas) }),
    ...HIST_RIRS.map((q) => el('td', { text: fmt.format(r['aspas_' + q] || 0) })),
    el('td', { text: fmt.format(r.provider_ases || 0) }),
    el('td', { text: cov(r) }))));
  describeHistory();
  drawHistory();
}

function setupHistoryControls() {
  const apply = () => { describeHistory(); drawHistory(); };
  $('hist-metric').addEventListener('change', (e) => { histOpt.metric = e.target.value; apply(); });
  $('hist-range').addEventListener('change', (e) => { histOpt.range = e.target.value; apply(); });
  $('hist-log').addEventListener('change', (e) => { histOpt.log = e.target.checked; apply(); });
  $('dl-csv').addEventListener('click', () => downloadHistory('csv'));
  $('dl-json').addEventListener('click', () => downloadHistory('json'));
}

async function loadHistory() {
  try {
    const rows = (await getJson(DATA_HISTORY)).filter((r) => r && r.date && r.aspas >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) throw new Error('not enough data');
    renderHistory(rows);
  } catch (err) {
    $('chart-history').replaceChildren(el('p', { class: 'error', text: `The history is not available (${err.message}).` }));
  }
}
let historyWidth = 0;
new ResizeObserver(() => {
  const w = $('chart-history') && $('chart-history').clientWidth;
  if (w && w !== historyWidth) { historyWidth = w; drawHistory(); }
}).observe(document.documentElement);

/* ---------- the charts of the ASPAs ---------- */
function renderStats(aspas) {
  const byProvider = new Map();
  for (const a of aspas) for (const p of a.providers) if (p !== 'AS0') (byProvider.get(p) || byProvider.set(p, []).get(p)).push(a.customer);
  const sizes = aspas.map((a) => a.providers.length).sort((x, y) => x - y);

  // per RIR: count by trust anchor of the (first) source object
  const perTal = new Map(RIR_ORDER.map((t) => [t, 0]));
  for (const a of aspas) perTal.set(a.tal, (perTal.get(a.tal) || 0) + 1);
  barChart($('chart-rir'), [...perTal].map(([t, v]) => ({ label: rirName(t), value: v })),
    { total: aspas.length, totalLabel: 'all ASPAs' });

  const top = [...byProvider].map(([as, list]) => ({ as, n: list.length }))
    .sort((x, y) => y.n - x.n || asNum(x.as) - asNum(y.as)).slice(0, 10);
  barChart($('chart-prov'), top.map((p) => ({ label: p.as, value: p.n, href: '/#' + p.as })),
    { mono: true, total: aspas.length, totalLabel: 'all ASPAs' });

  const bins = [];
  for (let i = 1; i <= 9; i++) bins.push({ label: String(i), value: 0 });
  bins.push({ label: '10+', value: 0 });
  for (const n of sizes) bins[Math.min(n, 10) - 1].value++;
  columnChart($('chart-size'), bins);
}

async function loadAspas() {
  try {
    const data = await getJson(DATA_ASPAS);
    renderStats((data.aspas || []).map((a) => ({
      customer: a.customer, providers: [...a.providers],
      tal: (a.source && a.source[0] && a.source[0].tal) || a.ta || '?',
    })));
  } catch (err) {
    for (const id of ['chart-rir', 'chart-size', 'chart-prov']) $(id).replaceChildren(el('p', { class: 'error', text: `The ASPA data is not available (${err.message}).` }));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupHistoryControls();
  loadAspas();
  loadHistory();
});
