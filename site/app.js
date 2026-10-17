'use strict';

// Data comes from Routinator via the same-origin proxy configured in nginx.
const DATA_ASPAS = '/data/aspas.json';
const DATA_STATUS = '/data/status.json';
// Daily history of the ASPA counts: the `history` branch of the public project, through the GitLab API (CORS open).
const DATA_VISIBILITY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/visibility.json/raw?ref=history';
const DATA_EVENTS = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/events.json/raw?ref=history';
const DATA_HISTORY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/history.json/raw?ref=history';
const PAGE = 20;
const RIR_NAMES = { afrinic: 'AFRINIC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', ripe: 'RIPE NCC' };
const RIR_ORDER = ['afrinic', 'apnic', 'arin', 'lacnic', 'ripe'];

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

let aspas = [];            // [{customer, providers, source}] sorted by customer number
let byCustomer = new Map(); // 'AS123' -> aspa
let byProvider = new Map(); // 'AS123' -> ['AS456', ...] customers naming it
let aspaSets = new Map();   // 'AS123' -> Set of its providers, for the path checker
let shown = 0;
let filtered = [];

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

const asNum = (as) => Number(as.slice(2));
const rirName = (tal) => RIR_NAMES[tal] || tal.toUpperCase();

// Accepts "AS680", "as 680", "680"; returns "AS680" or null.
function normalizeAsn(input) {
  const m = String(input).trim().match(/^(?:as\s*)?(\d{1,10})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 4294967295 ? 'AS' + n : null;
}

function fmtDate(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
const fmtDay = (iso) => (iso ? iso.slice(0, 10) : '?');

function asChip(as) {
  if (as === 'AS0') return el('span', { class: 'chip zero', text: 'AS0 · no providers' });
  return el('a', { class: 'chip', href: '#' + as, text: as });
}

function chipList(list, limit) {
  const ul = el('ul', { class: 'chips' });
  const render = (n) => {
    ul.replaceChildren(...list.slice(0, n).map((as) => el('li', {}, asChip(as))));
    if (list.length > n) {
      ul.append(el('li', {}, el('button', {
        type: 'button', class: 'linkish', text: `+${fmt.format(list.length - n)} more`,
        onclick: () => render(list.length),
      })));
    }
  };
  render(limit || list.length);
  return ul;
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

function renderOverview(status) {
  const providerCount = byProvider.size;
  const zero = aspas.filter((a) => a.providers.length === 1 && a.providers[0] === 'AS0').length;
  const sizes = aspas.map((a) => a.providers.length).sort((x, y) => x - y);
  const median = sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : 0;

  const tile = (label, value, note) => el('div', { class: 'tile card' },
    el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), note && el('div', { class: 'note', text: note }));
  $('tiles').replaceChildren(
    tile('ASPAs', fmt.format(aspas.length), 'customer ASes with a valid ASPA'),
    tile('Provider ASes', fmt.format(providerCount), 'distinct ASes named as a provider'),
    tile('Median providers', String(median), `largest set: ${fmt.format(sizes[sizes.length - 1] || 0)}`),
    tile('No-provider ASPAs', fmt.format(zero), 'customer declares AS0'),
  );

  // per RIR: count by trust anchor of the (first) source object
  const perTal = new Map(RIR_ORDER.map((t) => [t, 0]));
  for (const a of aspas) perTal.set(a.tal, (perTal.get(a.tal) || 0) + 1);
  barChart($('chart-rir'), [...perTal].map(([t, v]) => ({ label: rirName(t), value: v })),
    { total: aspas.length, totalLabel: 'all ASPAs' });

  const top = [...byProvider].map(([as, list]) => ({ as, n: list.length }))
    .sort((x, y) => y.n - x.n || asNum(x.as) - asNum(y.as)).slice(0, 10);
  barChart($('chart-prov'), top.map((p) => ({ label: p.as, value: p.n, href: '#' + p.as })),
    { mono: true, total: aspas.length, totalLabel: 'all ASPAs' });

  const bins = [];
  for (let i = 1; i <= 9; i++) bins.push({ label: String(i), value: 0 });
  bins.push({ label: '10+', value: 0 });
  for (const n of sizes) bins[Math.min(n, 10) - 1].value++;
  columnChart($('chart-size'), bins);

  const done = status && status.lastUpdateDone;
  $('meta').textContent = `${fmt.format(aspas.length)} ASPAs · last validation ${fmtDate(done)}` +
    (status && status.version ? ` · ${status.version.replace('/', ' ')}` : '');
}


/* ---------- adoption over time ---------- */
// One chart, several metrics. "By RIR" is stacked areas (bottom to top, the categorical slots in
// fixed order); the others are a single line. The period and a logarithmic scale are options.
const HIST_RIRS = ['ripe', 'arin', 'apnic', 'lacnic'];
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
      ? HIST_RIRS.filter((q) => r['aspas_' + q]).map((q) => el('span', { class: 'trow' }, `${rirName(q)} ${fmt.format(r['aspas_' + q])}`))
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
    (mt.stacked ? 'AFRINIC has published none so far. ' : '') + (mt.note ? mt.note + ' ' : '') +
    'Days before 16 October 2026 come from the RIPE NCC RPKI archive; since then, from this site\'s validator.';
}

function addCoverageTile() {
  const old = $('tile-coverage');
  if (old) old.remove();
  const last = [...history].reverse().find((r) => r.bgp_ases);
  if (!last || !$('tiles').children.length) return;
  $('tiles').append(el('div', { class: 'tile card', id: 'tile-coverage' },
    el('div', { class: 'label', text: 'Coverage' }),
    el('div', { class: 'value', text: fmtMetric(HIST_METRICS.coverage, 100 * last.aspa_in_bgp / last.bgp_ases) }),
    el('div', { class: 'note', text: `of ${fmt.format(last.bgp_ases)} ASes seen in BGP have an ASPA` })));
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
  addCoverageTile();
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


/* ---------- ASPA quality ---------- */
// Findings of site/quality.js on the ASPAs listed on the page; the checks that need to know which ASes
// appear in BGP use visibility.json (written daily by the snapshot job) and are skipped without it.
let findings = [];
let unseen = null;
const SEVERITY = { error: 'Error', warning: 'Warning', note: 'Note' };

function computeQuality() {
  findings = AspaQuality.check(aspas.map((a) => ({ customer: a.customer, providers: a.providers, source: a.source })), { unseen, now: Date.now() });
}

function renderQuality() {
  const body = $('quality-body');
  const tiles = $('quality-tiles');
  const affected = (sev) => new Set(findings.filter((f) => f.severity === sev).map((f) => f.customer)).size;
  tiles.replaceChildren(...['error', 'warning', 'note'].map((sev) => el('div', { class: `tile card sev-${sev}` },
    el('div', { class: 'label', text: sev === 'note' ? 'Notes' : `${SEVERITY[sev]}s` }),
    el('div', { class: 'value', text: fmt.format(affected(sev)) }),
    el('div', { class: 'note', text: `ASPA${affected(sev) === 1 ? '' : 's'} with ${sev === 'note' ? 'a note' : sev === 'error' ? 'an error' : 'a warning'}` }))));
  const groups = AspaQuality.ORDER.map((kind) => ({ kind, list: findings.filter((f) => f.kind === kind) })).filter((g) => g.list.length);
  const kids = groups.map((g, i) => {
    const info = AspaQuality.KINDS[g.kind];
    const ul = el('ul', { class: 'changelist' });
    const draw = (n) => {
      ul.replaceChildren(...g.list.slice(0, n).map((f) => el('li', {}, asChip(f.customer), ' ', el('span', { text: f.detail }))));
      if (g.list.length > n) ul.append(el('li', {}, el('button', { type: 'button', class: 'linkish', text: `Show all ${fmt.format(g.list.length)}`, onclick: () => draw(g.list.length) })));
    };
    draw(20);
    return el('details', { open: i === 0 && info.severity === 'error' },
      el('summary', {}, el('span', { class: `badge sev-${info.severity}`, text: SEVERITY[info.severity] }), ' ', el('strong', { text: info.title }), ` · ${fmt.format(g.list.length)}`),
      el('p', { class: 'hint', text: info.why }), ul);
  });
  if (!kids.length) kids.push(el('p', { class: 'hint', text: 'No issue found.' }));
  if (!unseen) kids.push(el('p', { class: 'hint', text: 'The checks that need to know which ASes appear in BGP are not available at the moment.' }));
  body.replaceChildren(...kids);
}

async function loadVisibility() {
  try { unseen = new Set((await getJson(DATA_VISIBILITY)).unseen); } catch (err) { unseen = null; }
}

function renderAsQuality(as) {
  const box = $('as-quality');
  if (!box || !as) return;
  const mine = findings.filter((f) => f.customer === as);
  const out = [el('h4', { text: 'Quality' })];
  if (!byCustomer.has(as)) out.push(el('p', { text: `${as} has no ASPA to check.` }));
  else if (!mine.length) out.push(el('p', { text: `No issue found in the ASPA of ${as}${unseen ? '' : ' (the checks that need BGP visibility are not available at the moment)'}.` }));
  else {
    out.push(el('ul', { class: 'timeline' }, ...mine.map((f) => el('li', {},
      el('span', { class: `badge sev-${f.severity}`, text: SEVERITY[f.severity] }), ' ',
      el('span', { text: `${AspaQuality.KINDS[f.kind].title}: ${as} ${f.detail}` })))));
  }
  out.push(el('p', {}, el('a', { href: `#routes=${as}`, text: `Check the routes ${as} originates` }), ' against the ASPAs, and compare its neighbours with its providers.'));
  box.replaceChildren(...out);
}


/* ---------- changes: recent days and the history of one AS ---------- */
// events.json (see history.js) classified into new / changed / removed; null until it has loaded
let changes = null;
let firstSeen = new Map();   // provider -> first day an ASPA named it
let changesFirstDay = '';
let lookupAs = null;
const CHANGE_DAYS = 14;
const KIND_TEXT = { new: 'new', changed: 'changed', removed: 'removed' };
const fmtDayShort = (iso) => fmtDayLong(iso);

function changeText(e) {
  if (e.kind === 'removed') return 'ASPA removed';
  const list = (ps, sign) => ps.slice(0, 6).map((p) => sign + p).join(' ') + (ps.length > 6 ? ` … (${ps.length})` : '');
  if (e.kind === 'new') return `new ASPA: ${e.providers.length === 1 && e.providers[0] === 'AS0' ? 'no providers (AS0)' : list(e.providers, '')}`;
  return `providers ${[list(e.added, '+'), list(e.dropped, '−')].filter(Boolean).join(' ')}`;
}

function renderChanges() {
  const body = $('changes-body');
  const cut = new Date(Date.now() - CHANGE_DAYS * 86400000).toISOString().slice(0, 10);
  const recent = changes.filter((e) => e.date >= cut);
  if (!recent.length) {
    const last = changes[changes.length - 1];
    body.replaceChildren(el('p', { class: 'hint', text: `No ASPA changed in the last ${CHANGE_DAYS} days${last ? ` (the last change was on ${fmtDayLong(last.date)})` : ''}.` }));
    return;
  }
  const days = [...new Set(recent.map((e) => e.date))].sort().reverse();
  body.replaceChildren(...days.map((d, i) => {
    const ev = recent.filter((e) => e.date === d);
    const count = (k) => ev.filter((e) => e.kind === k).length;
    const summary = ['new', 'changed', 'removed'].filter(count).map((k) => `${fmt.format(count(k))} ${KIND_TEXT[k]}`).join(', ');
    const ul = el('ul', { class: 'changelist' });
    const draw = (n) => {
      ul.replaceChildren(...ev.slice(0, n).map((e) => el('li', { class: 'k-' + e.kind }, asChip(e.customer), ' ', el('span', { text: changeText(e) }))));
      if (ev.length > n) ul.append(el('li', {}, el('button', { type: 'button', class: 'linkish', text: `Show all ${fmt.format(ev.length)}`, onclick: () => draw(ev.length) })));
    };
    draw(25);
    return el('details', { open: i === 0 }, el('summary', {}, el('strong', { text: fmtDayLong(d) }), ` · ${summary}`), ul);
  }));
}

function renderAsHistory(as) {
  const box = $('as-history');
  if (!box || !as) return;
  if (!changes) { box.replaceChildren(el('h4', { text: 'History' }), el('p', { class: 'hint', text: 'Loading the history…' })); return; }
  const own = changes.filter((e) => e.customer === as);
  const named = firstSeen.get(as);
  const since = (d) => (d === changesFirstDay ? `${fmtDayLong(d)} (the start of the archive, so possibly earlier)` : fmtDayLong(d));
  const lines = own.map((e) => el('li', { class: 'k-' + e.kind }, el('time', { datetime: e.date, text: fmtDayShort(e.date) }), ' · ', changeText(e)));
  const out = [el('h4', { text: 'History' })];
  if (!own.length && !named) out.push(el('p', { text: `No ASPA of ${as} or naming ${as} as a provider has been seen since ${fmtDayLong(changesFirstDay)}.` }));
  else {
    if (own.length) out.push(el('p', { text: `The ASPA of ${as}, since ${fmtDayLong(changesFirstDay)}:` }), el('ul', { class: 'timeline' }, ...lines));
    else out.push(el('p', { text: `${as} has never published an ASPA since ${fmtDayLong(changesFirstDay)}.` }));
    if (named) out.push(el('p', { text: `First named as a provider in an ASPA on ${since(named)}.` }));
  }
  box.replaceChildren(...out);
}

async function loadEvents() {
  try {
    const events = await getJson(DATA_EVENTS);
    changes = AspaHistory.classify(events);
    changesFirstDay = events.length ? events[0][0] : '';
    firstSeen = new Map();
    for (const e of changes) for (const p of e.added) if (p !== 'AS0' && !firstSeen.has(p)) firstSeen.set(p, e.date);
    renderChanges();
    renderAsHistory(lookupAs);
  } catch (err) {
    $('changes-body').replaceChildren(el('p', { class: 'error', text: `The changes are not available (${err.message}).` }));
  }
}


/* ---------- AS path check ---------- */
const HOP_CLASS = { 'Provider+': 'yes', 'Not Provider+': 'no', 'No Attestation': 'na' };

function hopCell(customer, provider, outcome) {
  const text = outcome === 'No Attestation' ? `${customer} has no ASPA`
    : `${customer} ${outcome === 'Provider+' ? 'lists' : 'does not list'} ${provider}`;
  return el('td', { class: 'hop ' + HOP_CLASS[outcome] }, text);
}

function pathVerdict(v, missing) {
  const first = v.path[0];
  const last = v.path[v.N - 1];
  if (v.N <= 1) return 'A path with a single AS is valid: there is nothing to check.';
  if (v.result === 'Valid') {
    return v.direction === 'up'
      ? `Every hop from the origin ${first} to the neighbour ${last} is attested as customer to provider.`
      : 'The up-ramp and the down-ramp together cover the whole path: it has the shape of a valley-free route that a provider can send (an uphill run, at most one lateral hop, then a downhill run).';
  }
  if (v.result === 'Unknown') {
    return 'Nothing in the ASPAs contradicts the path, but some ASes publish no ASPA, so it cannot be proven valid'
      + (missing.length ? `: ${missing.join(', ')}.` : '.');
  }
  if (v.direction === 'up') {
    const i = v.maxUp;
    return `${v.path[i - 1]} publishes an ASPA that does not list ${v.path[i]} as a provider, so the route is not a plain climb from the origin to the neighbour.`;
  }
  return `Even in the best case the up-ramp (at most ${v.maxUp} of ${v.N} ASes, from the origin ${first}) and the down-ramp (at most ${v.maxDown}, from the neighbour ${last}) do not meet: part of the path is a valley, which is how a route leak or a forged path segment looks.`;
}

// The verdict and the hop-by-hop table of a path, as nodes: shown in the AS path box and, for a route,
// under its row in the table of the routes seen in BGP.
function pathCheckNodes(text, direction) {
  const parsed = AspaVerify.parsePath(text);
  if (parsed.error) return [el('p', { class: 'error', text: parsed.error })];
  if (!aspas.length) return [el('p', { class: 'error', text: 'The ASPA data is still loading; try again in a moment.' })];
  const v = AspaVerify.verify(aspaSets, parsed.path, direction);
  const missing = [...new Set(v.path.filter((as) => !aspaSets.has(as)))];
  const kids = [
    el('p', { class: 'verdict v-' + v.result.toLowerCase() }, el('strong', { text: v.result }), ' ', pathVerdict(v, missing)),
    el('p', { class: 'src' }, `Path from the origin to the neighbour${v.path.length < parsed.path.length ? ' (prepending removed)' : ''}: ${v.path.join(' → ')}`),
  ];
  if (v.N > 1) {
    const down = direction === 'down';
    const head = el('tr', {}, el('th', { scope: 'col', text: 'Hop' }), el('th', { scope: 'col', text: 'Uphill check' }));
    if (down) head.append(el('th', { scope: 'col', text: 'Downhill check' }));
    const rows = [];
    for (let i = 1; i < v.N; i++) {
      const row = el('tr', {}, el('th', { scope: 'row', text: `${v.path[i - 1]} → ${v.path[i]}` }),
        hopCell(v.path[i - 1], v.path[i], v.up[i]));
      if (down) row.append(hopCell(v.path[i], v.path[i - 1], v.down[i + 1]));
      rows.push(row);
    }
    kids.push(el('div', { class: 'table-wrap card' }, el('table', { class: 'checks' },
      el('caption', { class: 'sr-only', text: 'ASPA checks for each hop, from the origin towards the neighbour' }),
      el('thead', {}, head), el('tbody', {}, ...rows))));
    const ramps = [`Up-ramp, from the origin: ${v.minUp} AS${v.minUp === 1 ? '' : 'es'} certain, up to ${v.maxUp} possible.`];
    if (down) ramps.push(`Down-ramp, from the neighbour: ${v.minDown} AS${v.minDown === 1 ? '' : 'es'} certain, up to ${v.maxDown} possible.`);
    kids.push(el('p', { class: 'src', text: ramps.join(' ') + ` The path has ${v.N} ASes.` }));
  }
  return kids;
}

function renderPathCheck(text, direction) {
  $('pathresult').replaceChildren(...pathCheckNodes(text, direction));
}

/* ---------- routes seen in BGP ---------- */
// The routes that the RIPE RIS collectors see for a prefix, or originated by an AS (RIPEstat, bgp-state),
// each distinct AS path checked with the downstream procedure: most of the networks that feed a collector
// send it their full table, as a provider does to a customer, and a full table includes the routes they
// learned from their own providers, which the upstream procedure would wrongly call leaks.
const LIVE_API = 'https://stat.ripe.net/data/bgp-state/data.json?resource=';
const LIVE_MAX_BYTES = 12 * 1024 * 1024;
const PREFIX_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+:[0-9a-f:]*\/\d{1,3})$/i;

function parseLiveQuery(text) {
  const t = String(text).trim();
  if (PREFIX_RE.test(t)) return { resource: t.toLowerCase(), label: t.toLowerCase(), kind: 'prefix' };
  const as = normalizeAsn(t);
  return as ? { resource: as, label: as, kind: 'as' } : null;
}

async function fetchRoutes(resource) {
  const r = await fetch(LIVE_API + encodeURIComponent(resource), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`RIPEstat answered HTTP ${r.status}`);
  // read at most LIVE_MAX_BYTES: an AS that originates many prefixes can have a huge answer
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIVE_MAX_BYTES) { reader.cancel(); throw new Error('the answer is too large: try one of its prefixes instead'); }
    chunks.push(value);
  }
  const data = JSON.parse(await new Blob(chunks).text());
  if (data.status !== 'ok') throw new Error((data.messages && data.messages[0] && data.messages[0][1]) || 'RIPEstat returned an error');
  return data.data;
}

// Distinct AS paths of the routes, each with its verdict and the number of routes that have it.
function checkRoutes(routes) {
  const byPath = new Map();
  let skipped = 0;
  for (const rt of routes) {
    if (!Array.isArray(rt.path) || !rt.path.length || !rt.path.every((n) => Number.isInteger(n))) { skipped++; continue; }
    const key = rt.path.join(' ');
    const e = byPath.get(key) || { bgp: rt.path, routes: 0, prefixes: new Set() };
    e.routes++; e.prefixes.add(rt.target_prefix);
    byPath.set(key, e);
  }
  const rows = [...byPath.values()].map((e) => {
    const path = e.bgp.map((n) => 'AS' + n).reverse();            // origin first, as the procedure wants it
    const v = AspaVerify.verify(aspaSets, path, 'down');
    const missing = [...new Set(v.path.filter((as) => !aspaSets.has(as)))];
    let why = '';
    if (v.result === 'Invalid') why = `a valley between ${v.path[v.maxUp - 1]} and ${v.path[v.N - v.maxDown]}`;
    else if (v.result === 'Unknown') why = `no ASPA from ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}`;
    return { v, result: v.result, why, shown: compressBgp(e.bgp), routes: e.routes, prefixes: e.prefixes.size };
  });
  const order = { Invalid: 0, Unknown: 1, Valid: 2 };
  rows.sort((a, b) => order[a.result] - order[b.result] || b.routes - a.routes);
  return { rows, skipped };
}
const compressBgp = (p) => p.filter((n, i) => i === 0 || n !== p[i - 1]);

// The AS right before the origin in each path, compared with the providers in the ASPA of the origin.
function neighbourPanel(origin, rows) {
  const as = 'AS' + origin;
  const byN = new Map();
  for (const r of rows) {
    if (r.shown.length < 2 || r.shown[r.shown.length - 1] !== origin) continue;
    const n = 'AS' + r.shown[r.shown.length - 2];
    const e = byN.get(n) || { routes: 0, Valid: 0, Unknown: 0, Invalid: 0 };
    e.routes += r.routes; e[r.result] += r.routes;
    byN.set(n, e);
  }
  if (!byN.size) return null;
  const listed = aspaSets.get(as);
  const list = [...byN].sort((a, b) => b[1].routes - a[1].routes);
  const status = (n) => (!listed ? 'no ASPA' : listed.has(n) ? 'listed' : 'not listed');
  const unlisted = list.filter(([n]) => listed && !listed.has(n));
  const notSeen = listed ? [...listed].filter((p) => p !== 'AS0' && !byN.has(p)) : [];
  const head = el('tr', {}, ...['Neighbour', 'Routes', `In the ASPA of ${as}`, 'Valid', 'Unknown', 'Invalid'].map((t, i) => el('th', { scope: 'col', class: i === 1 || i > 2 ? 'num' : undefined, text: t })));
  const trs = list.slice(0, 15).map(([n, e]) => el('tr', {},
    el('td', {}, asChip(n)), el('td', { class: 'num', text: fmt.format(e.routes) }),
    el('td', {}, el('span', { class: 'badge nb-' + status(n).replace(' ', '-'), text: status(n) })),
    el('td', { class: 'num', text: fmt.format(e.Valid) }), el('td', { class: 'num', text: fmt.format(e.Unknown) }), el('td', { class: 'num', text: fmt.format(e.Invalid) })));
  const notes = [];
  if (!listed) notes.push(`${as} has no ASPA. These are the networks next to it in the routes; the ones that are its providers are the ones to list.`);
  else {
    if (unlisted.length) notes.push(`${fmt.format(unlisted.length)} neighbour${unlisted.length === 1 ? ' is' : 's are'} not in the ASPA of ${as}. That is expected for peers and customers, which an ASPA does not list; it is a gap only for a neighbour that is a provider of ${as}.`);
    const bad = unlisted.filter(([, e]) => e.Invalid > 0);
    if (bad.length) notes.push(`Invalid routes come through ${bad.slice(0, 6).map(([n, e]) => `${n} (${fmt.format(e.Invalid)})`).join(', ')}${bad.length > 6 ? ` and ${bad.length - 6} more` : ''}: look at those first.`);
  }
  if (notSeen.length) notes.push(`Listed but not seen next to ${as} in these routes: ${notSeen.slice(0, 8).join(', ')}${notSeen.length > 8 ? ` and ${notSeen.length - 8} more` : ''} (a backup provider, or one the collectors do not see).`);
  return el('div', {},
    el('h3', { class: 'subhead', text: `Neighbours of ${as} in these routes` }),
    el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': `Neighbours of ${as} in the routes` }, el('table', { class: 'checks live nb' },
      el('caption', { class: 'sr-only', text: `The AS before ${as} in the paths, how many routes go through it and whether the ASPA of ${as} lists it` }),
      el('thead', {}, head), el('tbody', {}, ...trs))),
    ...notes.map((t) => el('p', { class: 'hint', text: t })));
}

/* ---------- origin validation of the prefixes (ROAs) ---------- */
const ROV_MAX = 200;       // prefix + origin pairs checked per request
const ROV_PARALLEL = 6;

// What Routinator says about a route: its validity state and, for an invalid one, why.
async function fetchValidity(origin, prefix) {
  const r = await fetch(`/data/validity/AS${origin}/${prefix}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const v = (await r.json()).validated_route.validity;
  return { state: v.state, reason: v.reason || '', vrps: v.VRPs || {} };
}

// Distinct prefix and origin pairs of the routes, with the number of routes that have each.
function routePairs(routes) {
  const pairs = new Map();
  for (const rt of routes) {
    if (!Array.isArray(rt.path) || !rt.path.length || !rt.path.every((n) => Number.isInteger(n)) || !PREFIX_RE.test(String(rt.target_prefix))) continue;
    const origin = rt.path[rt.path.length - 1];
    const key = `${origin} ${rt.target_prefix}`;
    const e = pairs.get(key) || { origin, prefix: String(rt.target_prefix).toLowerCase(), routes: 0 };
    e.routes++;
    pairs.set(key, e);
  }
  return [...pairs.values()];
}

function whyInvalid(v) {
  const roas = (list) => [...new Set((list || []).map((x) => x.asn))];
  if (v.reason === 'length') {
    const max = Math.max(...(v.vrps.unmatched_length || []).map((x) => Number(x.max_length)));
    return `longer than the ROA allows${Number.isFinite(max) ? ` (maximum /${max})` : ''}`;
  }
  const others = roas(v.vrps.unmatched_as);
  return others.length ? `the ROA is for ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}` : 'no ROA for this origin';
}

// The answer for the pairs, filled in as the checks come back (a few at a time).
function rovPanel(all) {
  const pairs = all.slice(0, ROV_MAX);
  const counts = { valid: 0, invalid: 0, 'not-found': 0, error: 0 };
  const bad = [];
  let done = 0, next = 0;
  const progress = el('p', { class: 'src' });
  const tiles = el('div', { class: 'tiles live-tiles' });
  const detail = el('div');
  const tile = (cls, label, key, note) => el('div', { class: 'tile card ' + cls },
    el('div', { class: 'label', text: label }), el('div', { class: 'value', text: fmt.format(counts[key]) }), el('div', { class: 'note', text: note }));
  const paint = () => {
    tiles.replaceChildren(tile('v-valid', 'Valid', 'valid', 'a ROA matches'), tile('v-unknown', 'Not found', 'not-found', 'no ROA covers it'), tile('v-invalid', 'Invalid', 'invalid', 'a ROA says otherwise'));
    const finished = done === pairs.length;
    progress.textContent = `${finished ? 'Checked' : `Checking… ${fmt.format(done)} of`} ${fmt.format(pairs.length)} prefix${pairs.length === 1 ? '' : 'es'} against the ROAs of the validator${all.length > pairs.length ? `; the first ${fmt.format(pairs.length)} of ${fmt.format(all.length)}` : ''}${counts.error ? `; ${fmt.format(counts.error)} could not be checked` : ''}.`;
    if (!finished || !bad.length) { detail.replaceChildren(); return; }
    bad.sort((a, b) => b.routes - a.routes);
    detail.replaceChildren(
      el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Invalid prefixes' }, el('table', { class: 'checks live' },
        el('caption', { class: 'sr-only', text: 'Prefixes whose origin is invalid according to the ROAs, with the reason' }),
        el('thead', {}, el('tr', {}, ...['Prefix', 'Origin', 'Why'].map((t) => el('th', { scope: 'col', text: t })), el('th', { scope: 'col', class: 'num', text: 'Routes' }))),
        el('tbody', {}, ...bad.slice(0, 30).map((b) => el('tr', {},
          el('td', { class: 'mono', text: b.prefix }), el('td', {}, asChip('AS' + b.origin)), el('td', { text: whyInvalid(b) }), el('td', { class: 'num', text: fmt.format(b.routes) })))))),
      ...(bad.length > 30 ? [el('p', { class: 'hint', text: `${fmt.format(bad.length - 30)} more invalid, not listed.` })] : []));
  };
  const worker = async () => {
    while (next < pairs.length) {
      const p = pairs[next++];
      try {
        const v = await fetchValidity(p.origin, p.prefix);
        if (v.state in counts && v.state !== 'error') counts[v.state]++; else counts.error++;
        if (v.state === 'invalid') bad.push(Object.assign({}, p, v));
      } catch { counts.error++; }
      done++;
      if (done % 10 === 0 || done === pairs.length) paint();
    }
  };
  paint();
  Promise.all(Array.from({ length: Math.min(ROV_PARALLEL, pairs.length) }, worker));
  return el('div', {}, progress, tiles, detail);
}

async function renderLiveRoutes(text) {
  const out = $('liveresult');
  const q = parseLiveQuery(text);
  if (!q) { out.replaceChildren(el('p', { class: 'error', text: 'Enter a prefix such as 193.0.0.0/21 or an AS number such as AS3333.' })); return; }
  if (!aspas.length) { out.replaceChildren(el('p', { class: 'error', text: 'The ASPA data is still loading; try again in a moment.' })); return; }
  out.replaceChildren(el('p', { class: 'hint', text: `Fetching the routes for ${q.label} from RIPEstat…` }));
  let data;
  try { data = await fetchRoutes(q.resource); } catch (err) {
    out.replaceChildren(el('p', { class: 'error', text: `Could not get the routes for ${q.label} (${err.message}).` }));
    return;
  }
  const routes = data.bgp_state || [];
  if (!routes.length) { out.replaceChildren(el('p', { text: `The RIPE RIS collectors see no route for ${q.label}${q.kind === 'as' ? ' originated by it' : ''} right now.` })); return; }
  const { rows, skipped } = checkRoutes(routes);
  const pairs = routePairs(routes);
  const count = (k) => rows.filter((r) => r.result === k);
  const routesOf = (list) => list.reduce((n, r) => n + r.routes, 0);
  const tiles = ['Valid', 'Unknown', 'Invalid'].map((k) => el('div', { class: 'tile card v-' + k.toLowerCase() },
    el('div', { class: 'label', text: k }),
    el('div', { class: 'value', text: fmt.format(routesOf(count(k))) }),
    el('div', { class: 'note', text: `route${routesOf(count(k)) === 1 ? '' : 's'} · ${fmt.format(count(k).length)} distinct path${count(k).length === 1 ? '' : 's'}` })));
  const ts = data.timestamp ? ` as of ${fmtDate(data.timestamp.endsWith('Z') ? data.timestamp : data.timestamp + 'Z')}` : '';
  const kids = [
    el('p', { class: 'src', text: `${fmt.format(routes.length)} routes${q.kind === 'as' ? ` originated by ${q.label}` : ` for ${q.label}`}, seen by the RIPE RIS collectors${ts}, ${fmt.format(rows.length)} distinct AS path${rows.length === 1 ? '' : 's'}${skipped ? `; ${fmt.format(skipped)} with an AS_SET left out` : ''}.` }),
    ...(pairs.length ? [el('h3', { class: 'subhead', text: 'Origin validation (ROAs)' }), rovPanel(pairs)] : []),
    el('h3', { class: 'subhead', text: 'AS paths (ASPA)' }),
    el('div', { class: 'tiles live-tiles' }, ...tiles),
  ];
  const tbody = el('tbody');
  const draw = (n) => {
    tbody.replaceChildren(...rows.slice(0, n).map((r) => {
      const text = r.shown.join(' ');
      const btn = el('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false', text: 'details' });
      const tr = el('tr', {},
        el('td', {}, el('span', { class: 'badge v-' + r.result.toLowerCase(), text: r.result })),
        el('td', { class: 'mono pathcell' }, r.shown.map((x) => 'AS' + x).join(' ')),
        el('td', { class: 'num', text: fmt.format(r.routes) }),
        el('td', {}, r.why ? r.why + ' · ' : '', btn));
      // the hop-by-hop check opens under the row that was clicked, where the reader is looking
      let open = null;
      btn.addEventListener('click', () => {
        if (open) { open.remove(); open = null; btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'details'; return; }
        open = el('tr', { class: 'detailrow' }, el('td', { colspan: '4' }, ...pathCheckNodes(text, 'down'),
          el('p', { class: 'hint' }, el('a', {
            href: `#path=${encodeURIComponent(text)}&from=down`,
            text: 'Open this path in the AS path check',
            onclick: (e) => { if (location.hash === e.currentTarget.getAttribute('href')) { e.preventDefault(); lookupFromHash(); } },
          }), ' (a link you can share).')));
        tr.after(open);
        // bring the details into view only if the row was near the bottom of the screen
        open.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'hide details';
      });
      return tr;
    }));
    if (rows.length > n) {
      tbody.append(el('tr', {}, el('td', { colspan: '4' }, el('button', { type: 'button', class: 'linkish', text: `Show all ${fmt.format(rows.length)} paths`, onclick: () => draw(rows.length) }))));
    }
  };
  draw(40);
  kids.push(el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Distinct AS paths of the routes' }, el('table', { class: 'checks live' },
    el('caption', { class: 'sr-only', text: 'Distinct AS paths of the routes, invalid first, with the verdict of the upstream ASPA verification' }),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Verdict' }), el('th', { scope: 'col', text: 'AS path, as a router shows it' }),
      el('th', { scope: 'col', class: 'num', text: 'Routes' }), el('th', { scope: 'col', text: 'Why' }))),
    tbody)));
  const origins = new Map();
  for (const r of rows) if (r.shown.length > 1) origins.set(r.shown[r.shown.length - 1], (origins.get(r.shown[r.shown.length - 1]) || 0) + r.routes);
  const total = [...origins.values()].reduce((a, b) => a + b, 0);
  for (const [origin, n] of [...origins].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    if (n < total * 0.1) continue;
    const panel = neighbourPanel(origin, rows);
    if (panel) kids.push(panel);
  }
  kids.push(el('p', { class: 'hint', text: 'The verification is the downstream procedure, because the networks that feed a route collector mostly send their full table, as a provider would; a feeder that sends only its customers\' routes passes it too. Paths with an AS_SET are skipped. ASPAs are the validated ones listed on this page; the ROAs are the ones this validator has validated.' }));
  out.replaceChildren(...kids);
}


/* ---------- lookup ---------- */
function renderLookup(as) {
  const out = $('result');
  if (!as) { out.replaceChildren(); lookupAs = null; return; }
  const n = asNum(as);
  const own = byCustomer.get(as);
  const customers = byProvider.get(as) || [];

  const head = el('div', { class: 'res-head' },
    el('h3', { text: as }),
    el('span', { class: 'links' },
      el('a', { href: `https://bgp.tools/as/${n}`, rel: 'noopener', target: '_blank' }, 'bgp.tools', el('span', { class: 'sr-only', text: ' (opens in a new tab)' })), ' · ',
      el('a', { href: `https://stat.ripe.net/app/launchpad/AS${n}`, rel: 'noopener', target: '_blank' }, 'RIPEstat', el('span', { class: 'sr-only', text: ' (opens in a new tab)' }))));

  const left = el('div', {}, el('h4', { text: 'Its own ASPA' }));
  if (own) {
    const isZero = own.providers.length === 1 && own.providers[0] === 'AS0';
    left.append(el('p', {
      text: isZero
        ? `${as} declares that it has no upstream providers (AS0), as transit-free networks do.`
        : `${as} authorizes ${own.providers.length} provider${own.providers.length === 1 ? '' : 's'}:`,
    }));
    if (!isZero) left.append(chipList(own.providers, 40));
    for (const s of own.source) {
      left.append(el('p', { class: 'src' },
        `${rirName(s.tal)} · valid ${fmtDay(s.validity && s.validity.notBefore)} → ${fmtDay(s.validity && s.validity.notAfter)}`,
        el('br'), el('span', { class: 'uri', text: s.uri })));
    }
  } else {
    left.append(el('p', { text: `${as} has not published an ASPA, so its upstream relationships cannot be verified.` }));
  }

  const right = el('div', {}, el('h4', { text: 'Named as a provider' }));
  if (customers.length) {
    right.append(el('p', { text: `${fmt.format(customers.length)} ASPA${customers.length === 1 ? ' lists' : 's list'} ${as} as a provider:` }),
      chipList(customers, 60));
  } else {
    right.append(el('p', { text: `No ASPA names ${as} as a provider.` }));
  }

  out.replaceChildren(head, el('div', { class: 'res-grid' }, left, right), el('div', { class: 'res-hist', id: 'as-history' }), el('div', { class: 'res-hist', id: 'as-quality' }), shareBlock(as));
  document.title = `${as} · ASPA Explorer`;
  const canon = document.querySelector('link[rel="canonical"]');
  if (canon) canon.setAttribute('href', `${location.origin}/as/${as}`);
  lookupAs = as;
  renderAsHistory(as);
  renderAsQuality(as);
}

/* ---------- share: page, badge, feed, API ---------- */
function copyField(label, value) {
  const input = el('input', { type: 'text', readonly: '', value, 'aria-label': label, class: 'copy-field', spellcheck: 'false' });
  input.addEventListener('focus', () => input.select());
  const btn = el('button', { type: 'button', class: 'linkish', text: 'Copy', 'aria-label': `Copy ${label}` });
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); btn.textContent = 'Copied'; } catch { input.select(); btn.textContent = 'Press Ctrl+C'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
  return el('div', { class: 'copy-row' }, el('span', { class: 'copy-label', text: label }), input, btn);
}

// "Get notified": an e-mail address (confirmed by a link) or a webhook (confirmed by a challenge).
function notifyForm(as) {
  const kind = el('select', { id: 'nf-kind', 'aria-label': 'How to be notified' },
    el('option', { value: 'email', text: 'E-mail' }), el('option', { value: 'webhook', text: 'Webhook' }));
  const target = el('input', { id: 'nf-target', type: 'text', inputmode: 'email', spellcheck: 'false', autocomplete: 'email', placeholder: 'you@example.org', 'aria-label': 'E-mail address or webhook address', required: '' });
  // a field that people do not see and bots fill
  const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'hp', 'aria-hidden': 'true' });
  const msg = el('div', { class: 'hint', 'aria-live': 'polite' });
  const btn = el('button', { type: 'submit', text: 'Subscribe' });
  kind.addEventListener('change', () => {
    const hook = kind.value === 'webhook';
    target.placeholder = hook ? 'https://example.org/hooks/aspa' : 'you@example.org';
    target.inputMode = hook ? 'url' : 'email';
    target.autocomplete = hook ? 'off' : 'email';
  });
  const form = el('form', { class: 'notify', autocomplete: 'off' }, kind, target, trap, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    msg.replaceChildren(el('span', { text: 'Sending…' }));
    try {
      const r = await fetch('/api/v1/subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind.value, target: target.value.trim(), asn: as, website: trap.value }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      if (body.secret) {
        msg.replaceChildren(el('p', { text: 'Subscribed. Keep this secret: it is shown only now, and signs each delivery in the X-ASPA-Signature header.' }), copyField('Secret', body.secret));
      } else {
        msg.replaceChildren(el('p', { text: body.message || 'Check your mail.' }));
      }
      target.value = '';
    } catch (err) {
      msg.replaceChildren(el('p', { class: 'error', text: err.message }));
    } finally { btn.disabled = false; }
  });
  return el('details', { class: 'embed' },
    el('summary', { text: 'Get notified by e-mail or webhook' }),
    el('p', { class: 'hint', text: `A message when the ASPA of ${as} changes, or when another ASPA adds or drops ${as} as a provider. An e-mail address has to be confirmed through a link; a webhook has to repeat a challenge. Nothing else is kept or used.` }),
    form, msg,
    el('p', { class: 'hint' }, 'How it works, what is kept and how to stop: ', el('a', { href: '/guide.html#notify', text: 'the guide' }), '.'));
}

function shareBlock(as) {
  const base = location.origin;
  const page = `${base}/as/${as}`, badge = `${base}/badge/${as}.svg`;
  return el('div', { class: 'res-hist', id: 'as-share' },
    el('h4', { text: 'Share and follow' }),
    el('p', { class: 'links' },
      el('a', { href: `/as/${as}` }, 'Page of this AS'), ' · ',
      el('a', { href: `/feed/${as}.atom` }, 'Atom feed of its changes'), ' · ',
      el('a', { href: `/api/v1/as/${asNum(as)}` }, 'JSON'), ' · ',
      el('a', { href: '/api.html' }, 'API')),
    notifyForm(as),
    el('details', { class: 'embed' },
      el('summary', { text: 'Add the badge to your site' }),
      el('p', {}, el('img', { src: badge, alt: `ASPA badge of ${as}`, height: '20', class: 'badge-img' })),
      copyField('Markdown', `[![ASPA of ${as}](${badge})](${page})`),
      copyField('HTML', `<a href="${page}"><img src="${badge}" alt="ASPA of ${as}"></a>`),
      copyField('Image address', badge)));
}

// Bring a box into view when a link elsewhere on the page fills it: only when it is not already near
// the top of the screen, so a click inside the box does not make the page jump.
function revealBox(id) {
  const node = $(id) && ($(id).closest('section') || $(id));
  if (!node) return;
  const r = node.getBoundingClientRect();
  if (r.top >= 0 && r.top < window.innerHeight * 0.5) return;
  node.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// The address of an AS page (/as/AS3333 or /as/3333): the same page, with the AS looked up on load.
const pathAs = () => {
  const m = /^\/as\/((?:AS)?\d{1,10})\/?$/i.exec(location.pathname);
  return m ? normalizeAsn(m[1]) : null;
};

function lookupFromHash() {
  const hash = location.hash.slice(1);
  // a new lookup on an AS page goes back to the plain address, so the address always matches what is shown
  if (hash && location.pathname !== '/' && pathAs()) window.history.replaceState(null, '', '/' + location.hash);   // `history` is the daily series here
  const dataTab = { overview: 'tab-overview', changes: 'tab-changes', quality: 'tab-quality', all: 'tab-all' }[hash];
  if (dataTab) { showTab(dataTab); revealBox('data'); return; }
  if (hash.startsWith('path=')) {
    showTab('tab-path');
    const q = new URLSearchParams(hash);
    const direction = q.get('from') === 'up' ? 'up' : 'down';
    $('aspath').value = q.get('path') || '';
    $('from').value = direction;
    renderPathCheck($('aspath').value, direction);
    revealBox('tools');
    return;
  }
  if (hash.startsWith('routes=')) {
    showTab('tab-routes');
    const res = decodeURIComponent(hash.slice(7));
    $('liveq').value = res;
    renderLiveRoutes(res);
    revealBox('tools');
    return;
  }
  const as = hash ? normalizeAsn(decodeURIComponent(hash)) : pathAs();
  if (!as) return;
  showTab('tab-lookup');
  $('asn').value = as;
  if (aspas.length) {
    renderLookup(as);
    revealBox('tools');
  }
}

/* ---------- tabs: the tools, and the data sections ---------- */
function selectTab(tab, { focus = false } = {}) {
  for (const t of tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = $(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = !on;
  }
  if (focus) tab.focus();
}
const showTab = (id) => { const t = $(id); if (t && t.getAttribute('aria-selected') !== 'true') selectTab(t); };

function setupTabs() {
  for (const list of document.querySelectorAll('[role="tablist"]')) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => selectTab(t));
      t.addEventListener('keydown', (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        selectTab(tabs[(to + tabs.length) % tabs.length], { focus: true });
      });
    });
  }
}

/* ---------- table ---------- */
function applyFilter() {
  const q = $('filter').value.trim();
  const rir = $('rir').value;
  const as = q ? normalizeAsn(q) : null;
  filtered = aspas.filter((a) => (!rir || a.tal === rir) &&
    (!q || (as ? a.customer === as || a.providers.includes(as) : false)));
  shown = 0;
  $('rows').replaceChildren();
  $('count').textContent = q && !as ? 'Enter an AS number, e.g. AS680'
    : `${fmt.format(filtered.length)} ASPA${filtered.length === 1 ? '' : 's'}`;
  showMore();
}

function showMore() {
  const frag = document.createDocumentFragment();
  for (const a of filtered.slice(shown, shown + PAGE)) {
    frag.append(el('tr', {},
      el('td', {}, el('a', { class: 'chip', href: '#' + a.customer, text: a.customer })),
      el('td', {}, chipList(a.providers, 8)),
      el('td', { class: 'rir', text: rirName(a.tal) })));
  }
  $('rows').append(frag);
  shown = Math.min(filtered.length, shown + PAGE);
  const more = $('more');
  more.hidden = shown >= filtered.length;
  more.textContent = `Show ${fmt.format(Math.min(PAGE, filtered.length - shown))} more`;
}

/* ---------- load ---------- */
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function load() {
  document.body.classList.add('loading');
  try {
    const [data, status] = await Promise.all([getJson(DATA_ASPAS), getJson(DATA_STATUS).catch(() => null)]);
    aspas = (data.aspas || []).map((a) => ({
      customer: a.customer,
      providers: [...a.providers].sort((x, y) => asNum(x) - asNum(y)),
      source: a.source || [],
      tal: (a.source && a.source[0] && a.source[0].tal) || a.ta || '?',
    })).sort((x, y) => asNum(x.customer) - asNum(y.customer));
    byCustomer = new Map(aspas.map((a) => [a.customer, a]));
    aspaSets = new Map(aspas.map((a) => [a.customer, new Set(a.providers)]));
    byProvider = new Map();
    for (const a of aspas) {
      for (const p of a.providers) {
        if (p === 'AS0') continue;
        if (!byProvider.has(p)) byProvider.set(p, []);
        byProvider.get(p).push(a.customer);
      }
    }
    const tals = [...new Set(aspas.map((a) => a.tal))].sort((x, y) => rirName(x).localeCompare(rirName(y)));
    $('rir').replaceChildren(el('option', { value: '', text: 'All RIRs' }),
      ...tals.map((t) => el('option', { value: t, text: rirName(t) })));
    renderOverview(status);
    addCoverageTile();
    await loadVisibility();
    computeQuality();
    renderQuality();
    applyFilter();
    lookupFromHash();
  } catch (err) {
    $('meta').textContent = '';
    $('result').replaceChildren(el('p', { class: 'error',
      text: `Could not load the ASPA data (${err.message}). The validator may be restarting; try again in a minute.` }));
  } finally {
    document.body.classList.remove('loading');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('lookup').addEventListener('submit', (e) => {
    e.preventDefault();
    const as = normalizeAsn($('asn').value);
    if (!as) {
      $('result').replaceChildren(el('p', { class: 'error', text: 'Enter an AS number such as AS680 or 680.' }));
      return;
    }
    if (location.hash === '#' + as) lookupFromHash();
    else location.hash = as;
  });
  $('pathform').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new URLSearchParams({ path: $('aspath').value.trim(), from: $('from').value });
    const hash = '#' + q.toString();
    if (location.hash === hash) lookupFromHash();
    else location.hash = hash;
  });
  $('liveform').addEventListener('submit', (e) => {
    e.preventDefault();
    const hash = '#routes=' + encodeURIComponent($('liveq').value.trim());
    if (location.hash === hash) lookupFromHash();
    else location.hash = hash;
  });
  window.addEventListener('hashchange', lookupFromHash);
  $('filter').addEventListener('input', applyFilter);
  $('rir').addEventListener('change', applyFilter);
  $('more').addEventListener('click', showMore);
  setupTabs();
  setupHistoryControls();
  load();
  loadHistory();
  loadEvents();
});
