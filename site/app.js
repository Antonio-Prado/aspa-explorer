'use strict';

// Data comes from Routinator via the same-origin proxy configured in nginx.
const DATA_ASPAS = '/data/aspas.json';
const DATA_STATUS = '/data/status.json';
const PAGE = 100;
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

function renderPathCheck(text, direction) {
  const out = $('pathresult');
  const parsed = AspaVerify.parsePath(text);
  if (parsed.error) { out.replaceChildren(el('p', { class: 'error', text: parsed.error })); return; }
  if (!aspas.length) {
    out.replaceChildren(el('p', { class: 'error', text: 'The ASPA data is still loading; try again in a moment.' }));
    return;
  }
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
  out.replaceChildren(...kids);
}

/* ---------- lookup ---------- */
function renderLookup(as) {
  const out = $('result');
  if (!as) { out.replaceChildren(); return; }
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

  out.replaceChildren(head, el('div', { class: 'res-grid' }, left, right));
}

function lookupFromHash() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('path=')) {
    const q = new URLSearchParams(hash);
    const direction = q.get('from') === 'up' ? 'up' : 'down';
    $('aspath').value = q.get('path') || '';
    $('from').value = direction;
    renderPathCheck($('aspath').value, direction);
    return;
  }
  const as = normalizeAsn(decodeURIComponent(location.hash.slice(1)));
  if (!as) return;
  $('asn').value = as;
  if (aspas.length) {
    renderLookup(as);
    $('result').scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
  window.addEventListener('hashchange', lookupFromHash);
  $('filter').addEventListener('input', applyFilter);
  $('rir').addEventListener('change', applyFilter);
  $('more').addEventListener('click', showMore);
  load();
});
