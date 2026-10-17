'use strict';

// Data comes from Routinator via the same-origin proxy configured in nginx.
const DATA_ASPAS = '/data/aspas.json';
const DATA_STATUS = '/data/status.json';
// Daily history of the ASPA counts: the `history` branch of the public project, through the GitLab API (CORS open).
const DATA_VISIBILITY = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/visibility.json/raw?ref=history';
const DATA_EVENTS = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/events.json/raw?ref=history';
const RIR_NAMES = { afrinic: 'AFRINIC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', ripe: 'RIPE NCC' };

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

let aspas = [];            // [{customer, providers, source}] sorted by customer number
let byCustomer = new Map(); // 'AS123' -> aspa
let byProvider = new Map(); // 'AS123' -> ['AS456', ...] customers naming it
let aspaSets = new Map();   // 'AS123' -> Set of its providers, for the path checker

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {                      // a list of nodes is a list of children, not a string
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

// The ASes of a path (numbers, collector side first) as links to their own pages, separated by spaces.
function pathLinks(numbers) {
  const nodes = [];
  numbers.forEach((n, i) => { if (i) nodes.push(' '); nodes.push(el('a', { class: 'aslink', href: `#AS${n}`, text: `AS${n}` })); });
  return nodes;
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





/* ---------- overview: the tiles (the charts are on the statistics page) ---------- */
const fmtDayLong = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function renderOverview(status) {
  const providerCount = byProvider.size;
  const zero = aspas.filter((a) => a.providers.length === 1 && a.providers[0] === 'AS0').length;
  const sizes = aspas.map((a) => a.providers.length).sort((x, y) => x - y);
  const median = sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : 0;

  const tile = (label, value, note) => el('div', { class: 'tile card' },
    el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), note && el('div', { class: 'note', text: note }));
  $('tiles').replaceChildren(
    tile('ASPAs', fmt.format(aspas.length), 'with a valid ASPA'),
    tile('Provider ASes', fmt.format(providerCount), 'named as a provider'),
    tile('Median providers', String(median), `largest set: ${fmt.format(sizes[sizes.length - 1] || 0)}`),
    tile('No-provider ASPAs', fmt.format(zero), 'customer declares AS0'),
  );

  const done = status && status.lastUpdateDone;
  $('meta').textContent = `${fmt.format(aspas.length)} ASPAs · last validation ${fmtDate(done)}` +
    (status && status.version ? ` · ${status.version.replace('/', ' ')}` : '');
}

// The coverage tile: the share of the networks seen in BGP that have an ASPA, from the daily adoption numbers.
async function addCoverageTile() {
  try {
    const d = await getJson('/api/v1/adoption.json');
    if (!d || !d.seen || !$('tiles').children.length) return;
    const old = $('tile-coverage');
    if (old) old.remove();
    $('tiles').append(el('div', { class: 'tile card', id: 'tile-coverage' },
      el('div', { class: 'label', text: 'Coverage' }),
      el('div', { class: 'value', text: `${d.pct.toFixed(d.pct < 10 ? 2 : 1)}%` }),
      el('div', { class: 'note', text: `of ${fmt.format(d.seen)} ASes in BGP` })));
  } catch { /* the tile is simply not shown */ }
}

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
      ul.replaceChildren(...g.list.slice(0, n).map((f) => el('li', {}, asChip(f.customer), ' ', el('span', { text: f.detail }), g.kind === 'mutual' ? el('span', {}, ' · ', el('a', { href: `#routes=${f.customer}`, text: 'who is the provider?' })) : null)));
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
      el('span', { text: `${AspaQuality.KINDS[f.kind].title}: ${as} ${f.detail}` }),
      f.kind === 'mutual' ? el('span', {}, ' · check now: ', ...f.providers.slice(0, 3).flatMap((p) => [el('a', { href: `#routes=${p}`, text: p }), ' ']), el('a', { href: `#routes=${as}`, text: as })) : null))));
  }
  out.push(el('p', {}, el('a', { href: `#routes=${as}`, text: `Check the routes ${as} originates` }), ' against the ASPAs, and compare its neighbours with its providers.'));
  box.replaceChildren(...out);
}


/* ---------- changes: recent days and the history of one AS ---------- */
// events.json (see history.js) classified into new / changed / removed; null until it has loaded
let changes = null;
let eventsRaw = [];
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
  if (!changes) { box.replaceChildren(el('h4', { text: 'History' }), el('p', { class: 'hint' }, el('span', { class: 'busy', text: 'Loading the history' }))); return; }
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
    eventsRaw = events;
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
const GRAPH_ROW = 9; // as many nodes as a row of the graph draws (MAX_ROW in graph.js)
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

const SAMPLE_PREFIXES = 24;
// An AS whose answer is too large: read the routes of a sample of its prefixes (the shortest ones, IPv4 and IPv6 alike)
// and say so. The result has `sample: {used, total}`.
async function fetchRoutesSampled(resource) {
  try { return await fetchRoutes(resource); } catch (err) {
    if (!/AS\d+$/i.test(resource) || !/too large/.test(err.message)) throw err;
  }
  const list = await getJson(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=${encodeURIComponent(resource)}`);
  const all = (list.data.prefixes || []).map((x) => x.prefix);
  const len = (pf) => Number(pf.split('/')[1]);
  const pick = [...all.filter((x) => !x.includes(':')).sort((a, b) => len(a) - len(b)).slice(0, SAMPLE_PREFIXES * 2 / 3),
    ...all.filter((x) => x.includes(':')).sort((a, b) => len(a) - len(b)).slice(0, SAMPLE_PREFIXES / 3)];
  const routes = [];
  let stamp = null;
  const queue = [...pick];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let pf = queue.shift(); pf; pf = queue.shift()) {
      try { const d = await fetchRoutes(pf); stamp = stamp || d.timestamp || null; routes.push(...(d.bgp_state || []).filter((r) => Array.isArray(r.path) && r.path[r.path.length - 1] === asNum(resource))); } catch { /* one prefix less */ }
    }
  }));
  return { bgp_state: routes, timestamp: stamp, sample: { used: pick.length, total: all.length } };
}

// Distinct AS paths of the routes, each with its verdict and the number of routes that have it.
function checkRoutes(routes) {
  const byPath = new Map();
  let skipped = 0;
  for (const rt of routes) {
    if (!Array.isArray(rt.path) || !rt.path.length || !rt.path.every((n) => Number.isInteger(n))) { skipped++; continue; }
    const key = rt.path.join(' ');
    const e = byPath.get(key) || { bgp: rt.path, routes: 0, prefixes: new Set(), feeders: new Set() };
    e.routes++; e.prefixes.add(rt.target_prefix); e.feeders.add(rt.source_id);
    byPath.set(key, e);
  }
  const rows = [...byPath.values()].map((e) => {
    const path = e.bgp.map((n) => 'AS' + n).reverse();            // origin first, as the procedure wants it
    const v = AspaVerify.verify(aspaSets, path, 'down');
    const missing = [...new Set(v.path.filter((as) => !aspaSets.has(as)))];
    let why = '';
    if (v.result === 'Invalid') why = `a valley between ${v.path[v.maxUp - 1]} and ${v.path[v.N - v.maxDown]}`;
    else if (v.result === 'Unknown') why = `no ASPA from ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}`;
    return { v, result: v.result, why, shown: compressBgp(e.bgp), routes: e.routes, prefixes: e.prefixes.size, feeders: e.feeders };
  });
  const order = { Invalid: 0, Unknown: 1, Valid: 2 };
  rows.sort((a, b) => order[a.result] - order[b.result] || b.routes - a.routes);
  return { rows, skipped };
}
const compressBgp = (p) => p.filter((n, i) => i === 0 || n !== p[i - 1]);


// The route leaks seen now: the paths that the ASPAs prove to have a valley (a route that came down from a
// provider or a peer and went up again), grouped by the place of the valley.
function leakPanel(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.result !== 'Invalid') continue;
    const v = r.v;
    const from = v.path[v.maxUp - 1], to = v.path[v.N - v.maxDown];
    const key = `${from}|${to}`;
    const g = groups.get(key) || { from, to, between: v.path.slice(v.maxUp, v.N - v.maxDown), paths: 0, routes: 0, feeders: new Set(), example: r.shown };
    g.paths++; g.routes += r.routes; for (const f of r.feeders) g.feeders.add(f);
    groups.set(key, g);
  }
  if (!groups.size) return null;
  const list = [...groups.values()].sort((x, y) => y.feeders.size - x.feeders.size || y.routes - x.routes);
  const head = el('tr', {}, ...['Valley between', 'ASes in the valley', 'Paths', 'Routes', 'Feeders', 'Example'].map((t, i) => el('th', { scope: 'col', class: i >= 2 && i <= 4 ? 'num' : undefined, text: t })));
  const trs = list.slice(0, 10).map((g) => el('tr', {},
    el('td', {}, asChip(g.from), ' ', asChip(g.to)),
    el('td', {}, ...(g.between.length ? g.between.flatMap((x, i) => (i ? [' ', asChip(x)] : [asChip(x)])) : ['–'])),
    el('td', { class: 'num', text: fmt.format(g.paths) }), el('td', { class: 'num', text: fmt.format(g.routes) }), el('td', { class: 'num', text: fmt.format(g.feeders.size) }),
    el('td', {}, el('a', { href: `#path=${encodeURIComponent(g.example.join(' '))}&from=down`, text: 'open the path' }))));
  return el('div', {},
    el('h3', { class: 'subhead', text: 'Route leaks (valleys) seen now' }),
    el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Route leaks seen now' }, el('table', { class: 'checks live nb' },
      el('caption', { class: 'sr-only', text: 'Paths that the ASPAs show to contain a valley, grouped by the place of the valley, with the paths, routes and feeders that see it' }),
      el('thead', {}, head), el('tbody', {}, ...trs))),
    el('p', { class: 'hint', text: `${fmt.format(list.length)} place${list.length === 1 ? '' : 's'} of valley${list.length > 10 ? ', the ten seen by most feeders are listed' : ''}. A valley is a route that came down from a provider or a peer and went up again: a route leak, or a forged path. The ASes in the valley are the ones to look at first. Before blaming them, look at the neighbours below: an ASPA that does not list one of its real providers makes valid routes look like valleys, and many of these places can be just that. The ASPAs prove a valley only where they are published, so paths of unknown verdict may hide others.` }));
}

// The registry of the ASes (country and region), from the daily numbers: a function AS number -> {cc, rir} or null.
let registryFn;
async function getRegistry() {
  if (registryFn !== undefined) return registryFn;
  try {
    const d = await getJson('/api/v1/asn-registry.json');
    const m = d.asns || {};
    registryFn = (n) => { const v = m[n]; return v ? { cc: v.slice(0, 2), rir: v[2] } : null; };
  } catch { return null; }
  return registryFn;
}

const regionName = { r: 'RIPE NCC', a: 'ARIN', p: 'APNIC', l: 'LACNIC', f: 'AFRINIC' };
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* the code is shown */ }
const countryName = (cc) => { try { return (regionNames && regionNames.of(cc)) || cc; } catch { return cc; } };

// Tromboning of the origin: it is measured, from probes in its country (measureBlock). The routes only give the address to aim at,
// and the country where the AS is registered only chooses where the probes are.
function trombonePanel(origin, country, routes) {
  if (!country) return null;
  const as = 'AS' + origin, home = countryName(country);
  const measure = measureBlock(origin, { country }, routes);
  if (!measure) return null;
  return el('div', {}, el('h3', { class: 'subhead', text: `Tromboning of ${as}` }),
    el('p', { class: 'hint', text: `A route trombones when it starts and ends in the same country and goes far away on the way: its delay is that of a packet that crosses an ocean. BGP cannot tell it; a traceroute from probes in ${home}, the country of ${as}, can.` }),
    measure);
}


// Measure it: a traceroute from probes in the country of the origin towards an address of its prefixes, through Globalping,
// and each hop read with the AS that RIPEstat maps its address to (site/traceroute.js). Only when the visitor asks for it.
const GLOBALPING = 'https://api.globalping.io/v1/measurements';
const PROBES = 12;      // one probe is one of the 250 credits an hour that Globalping gives to an address
const ipAsnCache = new Map();
async function asnOfIp(ip) {
  if (ipAsnCache.has(ip)) return ipAsnCache.get(ip);
  let asn = null;
  try {
    const d = await getJson(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`);
    const first = d.data && d.data.asns && d.data.asns[0];
    asn = first ? Number(first) : null;
  } catch { /* the hop is shown without an AS */ }
  ipAsnCache.set(ip, asn);
  return asn;
}

async function runTraceroute(address, country, onStatus) {
  const r = await fetch(GLOBALPING, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ type: 'traceroute', target: address, locations: [{ country, limit: PROBES }], measurementOptions: { protocol: 'ICMP' } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? 'the limit of measurements per hour of your address has been reached, try later' : (body.error && body.error.message) || `Globalping answered HTTP ${r.status}`);
  onStatus(`Measuring from ${body.probesCount || 'a few'} probes`);
  for (let i = 0; i < 45; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const m = await getJson(`${GLOBALPING}/${encodeURIComponent(body.id)}`);
    if (m.status !== 'in-progress') return m;
  }
  throw new Error('the probes did not finish in time');
}

function measureBlock(origin, tr, routes) {
  const target = AspaTraceroute.targetOf(routes, origin);
  if (!target || !target.address) return null;
  const as = 'AS' + origin, home = countryName(tr.country);
  const btn = el('button', { type: 'button', text: `Measure it now from probes in ${home}` });
  const status = el('p', { class: 'hint', 'aria-live': 'polite' });
  const out = el('div', {});
  btn.addEventListener('click', async () => {
    btn.disabled = true; out.replaceChildren();
    status.replaceChildren(el('span', { class: 'busy', text: 'Starting the probes' }));
    try {
      const m = await runTraceroute(target.address, tr.country, (t) => status.replaceChildren(el('span', { class: 'busy', text: t })));
      const ips = [...new Set(m.results.flatMap((x) => (x.result.hops || []).map((h) => h.resolvedAddress)).filter((ip) => ip && !AspaTraceroute.isPrivate(ip)))];
      status.replaceChildren(el('span', { class: 'busy', text: `Mapping ${ips.length} addresses to their networks` }));
      const queue = [...ips];
      await Promise.all(Array.from({ length: 4 }, async () => { for (let ip = queue.shift(); ip; ip = queue.shift()) await asnOfIp(ip); }));
      const results = m.results.map((x) => AspaTraceroute.summarise(x, (ip) => ipAsnCache.get(ip) || null));
      status.textContent = `Traceroute towards ${target.address}, in ${target.prefix} of ${as}, from ${results.length} probe${results.length === 1 ? '' : 's'} in ${home}.`;
      const all = AspaTraceroute.aggregate(results);
      const sorted = [...results].sort((a, b) => (b.net === null ? -1 : b.net) - (a.net === null ? -1 : a.net));
      out.replaceChildren(...(all ? [el('p', { class: 'verdict-' + all.verdict, text: aggregateText(all, results.length, home) })] : []),
        probeTable(sorted, all, target));
    } catch (err) {
      status.textContent = `The measurement did not work: ${err.message}.`;
    }
    btn.disabled = false;
  });
  return el('div', { class: 'measure' }, btn,
    el('p', { class: 'hint', text: `It runs a traceroute towards ${target.address} (in ${target.prefix}) from up to ${PROBES} probes in ${home} (the country of the AS) through Globalping (globalping.io), and asks RIPEstat which network each hop belongs to. They both see your address and what is asked, and the test uses ${PROBES} of the 250 measurements an hour that Globalping allows to your address.` }),
    status, out);
}

// The probes together, in a sentence: the median round trip, the range and how many are normal, longer than they should be, or a trombone.
function aggregateText(a, total, home) {
  const ms = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  const parts = [];
  if (a.counts.ok) parts.push(`${a.counts.ok} normal`);
  if (a.counts.long) parts.push(`${a.counts.long} longer than it should be`);
  if (a.counts.trombone) parts.push(`${a.counts.trombone} ${a.counts.trombone === 1 ? 'a trombone' : 'trombones'}`);
  const verdict = { ok: 'Most of the probes reach it at a normal delay for a route inside the country.', long: 'The median is longer than it should be inside a country: many routes probably go abroad.', trombone: 'The median is a trombone: most routes cross an ocean or go round Europe twice.' }[a.verdict];
  return `${a.n} of ${total} probes in ${home} answered. Median round trip, from the first public address: ${ms(a.median)} (from ${ms(a.min)} to ${ms(a.max)}). ${parts.join(', ')}. ${verdict} A probe on a mobile network or far from the target weighs as much as the others, so look at the median and not at a single probe.`;
}

// One row for each probe, the slowest first, with the median at the top; the hops of a probe open under its row.
function probeTable(probes, all, target) {
  const ms = (v) => (v === null ? '–' : v < 1 ? '<1 ms' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
  const badge = { ok: ['v-valid', 'normal'], long: ['v-unknown', 'longer than it should be'], trombone: ['v-invalid', 'trombone'] };
  const rows = [];
  if (all) {
    rows.push(el('tr', { class: 'median' }, el('th', { scope: 'row', text: `Median of ${all.n} probes (from ${ms(all.min)} to ${ms(all.max)})` }), el('td', { text: '' }), el('td', { class: 'num', text: ms(all.median) }), el('td', { text: '' }),
      el('td', {}, el('span', { class: 'badge ' + badge[all.verdict][0], text: badge[all.verdict][1] })), el('td', { text: '' })));
  }
  for (const r of probes) {
    const more = el('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false', text: 'hops' });
    const v = r.verdict ? badge[r.verdict] : null;
    const tr = el('tr', {}, el('th', { scope: 'row', class: 'probe', text: `${r.probe.city || 'A probe'}${r.probe.network ? ` · ${r.probe.network}` : ''}` }),
      el('td', { class: 'mono pathcell', text: r.path.map((a) => `AS${a}`).join(' → ') || '–' }),
      el('td', { class: 'num', text: ms(r.net) }), el('td', { class: 'num', text: ms(r.lastRtt) }),
      el('td', {}, v ? el('span', { class: 'badge ' + v[0], text: v[1] }) : el('span', { class: 'muted', text: 'no answer' })),
      el('td', {}, more));
    let open = null;
    more.addEventListener('click', () => {
      if (open) { open.remove(); open = null; more.setAttribute('aria-expanded', 'false'); more.textContent = 'hops'; return; }
      open = el('tr', { class: 'detailrow' }, el('td', { colspan: '6' }, traceCard(r, target)));
      tr.after(open);
      more.setAttribute('aria-expanded', 'true'); more.textContent = 'hide';
    });
    rows.push(tr);
  }
  return el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'The probes of the measurement, the slowest first' }, el('table', { class: 'checks live nb' },
    el('caption', { class: 'sr-only', text: 'The probes of the measurement, with the networks on the way and the round trip from the first public address' }),
    el('thead', {}, el('tr', {}, ...['Probe', 'Networks on the way', 'Net round trip', 'Total round trip', 'Reading', 'Hops'].map((t, i) => el('th', { scope: 'col', class: i === 2 || i === 3 ? 'num' : undefined }, i === 5 ? el('span', { class: 'sr-only', text: t }) : t)))),
    el('tbody', {}, ...rows)));
}

function traceCard(r, target) {
  const rttText = (v) => (v === null ? '–' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
  const notes = [];
  if (r.path.length) notes.push(`Networks on the way: ${r.path.map((a) => `AS${a}`).join(' → ')}.`);
  if (r.status !== 'finished') notes.push('The probe could not run the measurement.');
  else if (r.reachedAddress !== target.address) notes.push(`The last answer comes from ${r.reachedAddress || 'no address'}, not from ${target.address}: the target does not answer, which is common, so the last network that answers is the last one that is seen.`);
  if (r.jump) notes.push(`The delay rises by ${Math.round(r.jump.by)} ms between hop ${r.jump.from} and hop ${r.jump.hop} and stays up to the end: from there the path is longer, or slower, by that much (queues, tunnels and slow answers add milliseconds too).`);
  if (r.access >= 10) notes.push(`The first public address is already ${rttText(r.access)} away: the access network of the probe (a mobile network or a tunnel, for instance) adds delay by itself, so the delays below say little about the route.`);
  if (r.verdict === 'trombone') notes.push(`Trombone: from the first public address to the end the round trip takes ${rttText(r.net)}. Between two points of one country, 100 ms or more is the delay of a packet that crosses an ocean, or goes round Europe twice (supposing that the target is in the country of the probe).`);
  else if (r.verdict === 'long') notes.push(`From the first public address to the end the round trip takes ${rttText(r.net)}, longer than it should be between two points of one country: the route probably goes abroad, but not far (supposing that the target is in the country of the probe).`);
  else if (r.lastRtt !== null) notes.push(`Round trip to the last hop: ${rttText(r.lastRtt)}, normal inside a country.`);
  const rows = r.hops.map((h) => el('tr', {}, el('td', { class: 'num', text: String(h.n) }),
    el('td', {}, h.ip ? el('span', { class: 'mono', text: h.ip }) : el('span', { class: 'muted', text: 'no answer' })),
    el('td', { text: h.asn ? `AS${h.asn}` : (h.ip ? (AspaTraceroute.isPrivate(h.ip) ? 'private' : '–') : '') }),
    el('td', { class: 'num', text: rttText(h.rtt) })));
  return el('div', { class: 'trace' },
    el('h4', { text: `${r.probe.city || 'A probe'}, ${countryName(r.probe.country)}${r.probe.asn ? ` · AS${r.probe.asn}${r.probe.network ? ` ${r.probe.network}` : ''}` : ''}` }),
    ...notes.map((t) => el('p', { class: 'hint', text: t })),
    el('details', { class: 'embed' }, el('summary', { text: `The ${r.hops.length} hops` }),
      el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': `Hops of the traceroute from ${r.probe.city || 'the probe'}` }, el('table', { class: 'checks live nb' },
        el('caption', { class: 'sr-only', text: 'Hops of the traceroute: address, network and shortest delay' }),
        el('thead', {}, el('tr', {}, ...['Hop', 'Address', 'Network', 'Delay'].map((t, i) => el('th', { scope: 'col', class: i === 0 || i === 3 ? 'num' : undefined, text: t })))),
        el('tbody', {}, ...rows)))));
}


// The neighbourhood of an AS as a graph (site/graph.js): the providers of its ASPA, the ASPAs that name it, and,
// on request, the neighbours that the routes show, with the evidence about each (site/evidence.js).
function graphBlock(as) {
  const box = el('div', { class: 'graph' });
  const status = el('span', { class: 'hint' });
  let observed = [];
  const own = byCustomer.get(as);
  const cap = el('p', { class: 'hint' });
  const draw = () => {
    const providers = own ? own.providers.filter((p) => p !== 'AS0') : [], customers = byProvider.get(as) || [];
    AspaGraph.draw(box, AspaGraph.layout({ as, providers, customers, observed }), (id) => '#' + id);
    const big = [providers.length > GRAPH_ROW && `${GRAPH_ROW} of its ${providers.length} providers`, customers.length > GRAPH_ROW && `${GRAPH_ROW} of the ${customers.length} ASes that name it as a provider`].filter(Boolean);
    cap.textContent = big.length ? `There are too many to draw them all: the graph shows ${big.join(' and ')}.` : '';
  };
  const btn = el('button', { type: 'button', class: 'linkish', text: 'Add the neighbours that the routes show' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; status.replaceChildren(el('span', { class: 'busy', text: ' Reading the routes' }));
    try {
      const data = await fetchRoutesSampled(as);
      const routes = data.bgp_state || [];
      const ctx = await getEvidenceCtx();
      const ev = AspaEvidence.analyse(routes, asNum(as), ctx || {});
      observed = [...ev].map(([n, e]) => ({ asn: 'AS' + n, label: e.label === 'provider' || e.label === 'weak' ? e.label : 'none', paths: e.paths })).sort((x, y) => y.paths - x.paths);
      draw();
      const listed = new Set([...(own ? own.providers : []), ...(byProvider.get(as) || [])]);
      const extra = observed.filter((o) => !listed.has(o.asn)).length;
      const part = data.sample ? ` (a sample: its routes are too many to read, so only those of ${data.sample.used} of its ${data.sample.total} prefixes)` : '';
      status.textContent = ` ${fmt.format(routes.length)} routes read${part}; ` + (extra
        ? `the ${extra > 6 ? 'six most seen of the ' + extra : extra} neighbours that the ASPAs do not list ${extra === 1 ? 'is' : 'are'} drawn on the right.`
        : 'every neighbour seen in the routes is already in the graph, so there is nothing to add.');
    } catch (err) { status.textContent = ` Could not read the routes (${err.message}).`; }
    btn.disabled = false;
  });
  const swatch = (cls, text) => el('li', {}, el('span', { class: `sw-graph ${cls}`, 'aria-hidden': 'true' }), ' ', text);
  const det = el('details', { class: 'embed', id: 'as-graph' },
    el('summary', { text: 'Show its neighbourhood as a graph' }), box,
    el('p', { class: 'hint' }, btn, status), cap,
    el('ul', { class: 'graph-legend' },
      swatch('n-provider', 'a provider listed in its ASPA (arrow from the customer)'), swatch('n-customer', 'an AS whose ASPA lists it as a provider'),
      swatch('n-mutual', 'two ASes that list each other'), swatch('n-seen-provider', 'seen in the routes, looks like a provider, not in its ASPA'),
      swatch('n-seen', 'seen in the routes, no evidence (a peer, a customer, or not enough routes)')));
  det.addEventListener('toggle', () => { if (det.open && !box.firstChild) draw(); });
  return det;
}

// Watch the updates of an AS live (site/live.js) and check each announcement with the ASPAs as it arrives.
function livePanel(origin) {
  const as = 'AS' + origin, MAX = 300, MAX_MS = 5 * 60e3, ROWS = 15;
  const counts = { Valid: 0, Unknown: 0, Invalid: 0 };
  let seen = 0, watcher = null, timer = null;
  const status = el('p', { class: 'src', 'aria-live': 'polite', text: 'Not started.' });
  const tally = el('p', { class: 'src' });
  const tbody = el('tbody');
  const mode = el('select', { id: 'live-mode', 'aria-label': 'Which updates' },
    el('option', { value: 'origin', text: `announced by ${as}` }), el('option', { value: 'through', text: `going through ${as}` }));
  const btn = el('button', { type: 'button', text: 'Start' });
  const stop = () => { if (watcher) watcher.stop(); watcher = null; clearTimeout(timer); btn.textContent = 'Start'; };
  const sayTally = () => { tally.textContent = `${fmt.format(seen)} announcement${seen === 1 ? '' : 's'} checked: ${counts.Valid} valid, ${counts.Unknown} unknown, ${counts.Invalid} invalid.`; };
  const onAnnouncement = (a) => {
    if (seen >= MAX) { stop(); status.textContent = `Stopped after ${MAX} announcements.`; return; }
    seen++;
    const v = AspaVerify.verify(aspaSets, [...a.path].reverse().map((n) => 'AS' + n), 'down');
    counts[v.result]++;
    const shown = compressBgp(a.path), text = shown.join(' ');
    const more = el('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false', text: 'details' });
    const row = el('tr', { class: 'live-row' },
      el('td', { text: new Date().toLocaleTimeString('en-GB') }),
      el('td', { class: 'mono' }, el('a', { class: 'aslink', href: `#AS${a.peer}`, text: 'AS' + a.peer })),
      el('td', { class: 'mono' }, el('a', { class: 'aslink', href: `#routes=${encodeURIComponent(a.prefix)}`, text: a.prefix })),
      el('td', { class: 'mono pathcell' }, ...pathLinks(shown)),
      el('td', {}, el('span', { class: 'badge v-' + v.result.toLowerCase(), text: v.result }), ' ', more));
    // the hop-by-hop check opens under the row that was clicked, as in the table of the routes
    more.addEventListener('click', () => {
      if (row._detail) { row._detail.remove(); row._detail = null; more.setAttribute('aria-expanded', 'false'); more.textContent = 'details'; return; }
      row._detail = el('tr', { class: 'detailrow' }, el('td', { colspan: '5' }, ...pathCheckNodes(text, 'down'),
        el('p', { class: 'hint' }, el('a', { href: `#path=${encodeURIComponent(text)}&from=down`, text: 'Open this path in the AS path check' }), ' (a link you can share).')));
      row.after(row._detail);
      more.setAttribute('aria-expanded', 'true'); more.textContent = 'hide details';
    });
    tbody.prepend(row);
    const rows = [...tbody.children].filter((r) => r.classList.contains('live-row'));
    for (const old of rows.slice(ROWS)) { if (old._detail) old._detail.remove(); old.remove(); }
    sayTally();
  };
  btn.addEventListener('click', () => {
    if (watcher) { stop(); return; }
    seen = 0; counts.Valid = counts.Unknown = counts.Invalid = 0; tbody.replaceChildren(); sayTally();
    watcher = AspaLive.watch(origin, mode.value, { announcement: onAnnouncement, status: (t) => { status.textContent = t; } });
    btn.textContent = 'Stop';
    timer = setTimeout(() => { stop(); status.textContent = 'Stopped after five minutes.'; }, MAX_MS);
  });
  return el('div', {},
    el('h3', { class: 'subhead', text: 'Watch the updates live' }),
    el('p', { class: 'hint', text: `Opens a connection from your browser to RIPE RIS Live (wss://ris-live.ripe.net), which hands out the BGP updates that the route collectors receive as they arrive, and checks every announcement with the ASPAs. It stops after five minutes or ${MAX} announcements. RIPE sees your address, as for any site you visit; nothing goes through this site.` }),
    el('p', { class: 'field' }, el('label', { for: 'live-mode', class: 'inline', text: 'Updates ' }), mode, btn),
    status, tally,
    el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'The last announcements and their verdicts' }, el('table', { class: 'checks live' },
      el('caption', { class: 'sr-only', text: `The last ${ROWS} announcements of RIS Live that involve ${as}, newest first, with the verdict of the ASPA verification` }),
      el('thead', {}, el('tr', {}, ...['Time', 'Feeder', 'Prefix', 'AS path, as a router shows it', 'Verdict'].map((t) => el('th', { scope: 'col', text: t })))), tbody)));
}

// What the evidence needs besides the routes: the Tier-1 clique and the exchange-point ASes, from the daily
// adoption numbers. null when they are not available (the evidence is then left out).
let evidenceCtx;
async function getEvidenceCtx() {
  if (evidenceCtx !== undefined) return evidenceCtx;
  try {
    const d = await getJson('/api/v1/adoption.json');
    evidenceCtx = d.clique && d.clique.length ? { clique: new Set(d.clique), ixp: new Set(d.ixp || []), source: (d.sources && d.sources.size) || 'CAIDA' } : null;
  } catch { return null; }
  return evidenceCtx;
}

// The AS right before the origin in each path, compared with the providers in the ASPA of the origin and,
// when the routes allow it, with the evidence of who its providers are (site/evidence.js).
function neighbourPanel(origin, rows, ev) {
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
  const evOf = (n) => (ev ? ev.get(Number(n.slice(2))) : null);
  const cols = ['Neighbour', 'Routes', `In the ASPA of ${as}`, ...(ev ? ['Evidence'] : []), 'Valid', 'Unknown', 'Invalid'];
  const numCol = (i) => i === 1 || i >= (ev ? 4 : 3);
  const head = el('tr', {}, ...cols.map((t, i) => el('th', { scope: 'col', class: numCol(i) ? 'num' : undefined, text: t })));
  const evCell = (n) => {
    const x = evOf(n);
    if (!x || x.label === 'few' || x.label === 'none') return el('td', { class: 'muted', text: '–', title: !x || x.label === 'few' ? 'too few paths to tell' : 'no route of this AS goes through it to a Tier-1: no evidence' });
    const title = `${fmt.format(x.viaT1)} of ${fmt.format(x.informative)} paths reach a Tier-1 through it, seen by ${fmt.format(x.feeders)} feeder${x.feeders === 1 ? '' : 's'}`;
    return el('td', {}, el('span', { class: 'badge ' + (x.label === 'provider' ? 'v-valid' : 'v-unknown'), text: x.label, title }));
  };
  const trs = list.slice(0, 15).map(([n, e]) => el('tr', {},
    el('td', {}, asChip(n)), el('td', { class: 'num', text: fmt.format(e.routes) }),
    el('td', {}, el('span', { class: 'badge nb-' + status(n).replace(' ', '-'), text: status(n) })),
    ...(ev ? [evCell(n)] : []),
    el('td', { class: 'num', text: fmt.format(e.Valid) }), el('td', { class: 'num', text: fmt.format(e.Unknown) }), el('td', { class: 'num', text: fmt.format(e.Invalid) })));
  const notes = [];
  if (!listed) notes.push(`${as} has no ASPA. These are the networks next to it in the routes; the ones that are its providers are the ones to list.`);
  else {
    if (unlisted.length) notes.push(`${fmt.format(unlisted.length)} neighbour${unlisted.length === 1 ? ' is' : 's are'} not in the ASPA of ${as}. That is expected for peers and customers, which an ASPA does not list; it is a gap only for a neighbour that is a provider of ${as}.`);
    const bad = unlisted.filter(([, e]) => e.Invalid > 0);
    if (bad.length) notes.push(`Invalid routes come through ${bad.slice(0, 6).map(([n, e]) => `${n} (${fmt.format(e.Invalid)})`).join(', ')}${bad.length > 6 ? ` and ${bad.length - 6} more` : ''}: look at those first.`);
  }
  if (ev) {
    const strong = list.filter(([n]) => (evOf(n) || {}).label === 'provider').map(([n]) => n);
    if (!listed && strong.length) notes.push(`Routes of ${as} go through ${strong.slice(0, 6).join(', ')}${strong.length > 6 ? ` and ${strong.length - 6} more` : ''} up to a Tier-1: they look like its providers, the ones to list in its ASPA.`);
    const missing = strong.filter((n) => listed && !listed.has(n));
    if (missing.length) notes.push(`${missing.join(', ')} ${missing.length === 1 ? 'seems' : 'seem'} to be ${missing.length === 1 ? 'a provider' : 'providers'} of ${as} that its ASPA does not list: where the ASPA is checked, the routes that go through ${missing.length === 1 ? 'it' : 'them'} do not pass.`);
  }
  if (notSeen.length) notes.push(`Listed but not seen next to ${as} in these routes: ${notSeen.slice(0, 8).join(', ')}${notSeen.length > 8 ? ` and ${notSeen.length - 8} more` : ''} (a backup provider, or one the collectors do not see).`);
  return el('div', {},
    el('h3', { class: 'subhead', text: `Neighbours of ${as} in these routes` }),
    el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': `Neighbours of ${as} in the routes` }, el('table', { class: 'checks live nb' },
      el('caption', { class: 'sr-only', text: `The AS before ${as} in the paths, how many routes go through it and whether the ASPA of ${as} lists it` }),
      el('thead', {}, head), el('tbody', {}, ...trs))),
    ...notes.map((t) => el('p', { class: 'hint', text: t })));
}

// A starting point for the ASPA of the origin, from its declared providers and the evidence of the routes (site/evidence.js).
function suggestPanel(origin, ev, listed) {
  const as = 'AS' + origin;
  const s = AspaEvidence.suggest(listed ? [...listed] : null, ev);
  const names = (l) => l.join(', ');
  const kids = [el('h3', { class: 'subhead', text: `A starting point for the ASPA of ${as}` })];
  if (!s.list.length && !s.check.length) {
    kids.push(el('p', { class: 'hint', text: s.zero ? `${as} declares that it has no provider (AS0) and the routes show none with strong evidence: nothing to propose.` : `The routes do not give strong evidence of a provider of ${as}: nothing to propose.` }));
    return el('div', {}, ...kids);
  }
  const bits = [];
  if (s.keep.length) bits.push(`Already in its ASPA and seen in the routes: ${names(s.keep)}.`);
  if (s.add.length) bits.push(`Seen as ${s.add.length === 1 ? 'a provider' : 'providers'} but not in its ASPA: ${names(s.add)}. Add ${s.add.length === 1 ? 'it' : 'them'} if ${s.add.length === 1 ? 'it is' : 'they are'} really your upstream.`);
  if (s.keepUnseen.length) bits.push(`In its ASPA but not seen: ${names(s.keepUnseen)}. Keep ${s.keepUnseen.length === 1 ? 'it' : 'them'} for a backup provider or one the collectors do not see.`);
  if (s.check.length) bits.push(`Weak evidence, to check by hand before adding: ${names(s.check)}.`);
  if (s.zero) bits.push(`${as} declares AS0 (no provider) today: an ASPA with AS0 and other providers is not valid, so replace it rather than extend it.`);
  kids.push(...bits.map((x) => el('p', { class: 'hint', text: x })));
  if (s.list.length) kids.push(copyField(`Providers of ${as}`, s.list.join(' ')),
    el('p', { class: 'hint' }, 'It is a proposal from what the collectors see, not a verdict. Check it with ', el('a', { href: '/examples.html#check', text: 'the checker' }), ' and publish it as ', el('a', { href: '/examples.html#publish', text: 'the examples page' }), ' explains.'));
  return el('div', {}, ...kids);
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
  out.replaceChildren(el('p', { class: 'hint' }, el('span', { class: 'busy', text: `Fetching the routes for ${q.label} from RIPEstat` })));
  let data;
  try { data = await fetchRoutesSampled(q.resource); } catch (err) {
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
    ...(data.sample ? [el('p', { class: 'hint', text: `${q.label} originates ${fmt.format(data.sample.total)} prefixes, too many to read at once: the view is limited to the routes of ${fmt.format(data.sample.used)} of them, the shortest ones. Check a single prefix to see the others.` })] : []),
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
        el('td', { class: 'mono pathcell' }, ...pathLinks(r.shown)),
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
  // the neighbours of the origin come before the long table of paths
  const origins = new Map();
  for (const r of rows) if (r.shown.length > 1) origins.set(r.shown[r.shown.length - 1], (origins.get(r.shown[r.shown.length - 1]) || 0) + r.routes);
  const total = [...origins.values()].reduce((a, b) => a + b, 0);
  const ctx = await getEvidenceCtx();
  const lookupAs = await getRegistry();
  const leaks = leakPanel(rows);
  if (leaks) kids.push(leaks);
  let usedEvidence = false;
  for (const [origin, n] of [...origins].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    if (n < total * 0.1) continue;
    const ev = ctx ? AspaEvidence.analyse(routes, origin, ctx) : null;
    const panel = neighbourPanel(origin, rows, ev);
    if (panel) { kids.push(panel); usedEvidence = usedEvidence || Boolean(ev); }
    if (panel && ev && q.kind === 'as') { const own = byCustomer.get('AS' + origin); kids.push(suggestPanel(origin, ev, own ? new Set(own.providers) : null)); }
    if (lookupAs) { const reg = lookupAs(origin), tp = trombonePanel(origin, reg && reg.cc, routes); if (tp) kids.push(tp); }
  }
  if (q.kind === 'as') kids.push(livePanel(asNum(q.label)));
  if (usedEvidence) kids.push(el('p', { class: 'hint', text: `Evidence: a neighbour counts as a provider of the origin when the route passes through it up to a Tier-1 network (the clique of ${ctx.source}). A peer, or a provider that is not asked to carry the route upwards, passes upwards only what it learned from its customers. Weak: seen by few feeders or on a small share of the paths. No evidence is not proof of a peer: the collectors see only part of the Internet, and paths of two ASes say nothing. The routes are the last RIB dump of the collectors, which can be up to eight hours old.` }));
  kids.push(el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Distinct AS paths of the routes' }, el('table', { class: 'checks live' },
    el('caption', { class: 'sr-only', text: 'Distinct AS paths of the routes, invalid first, with the verdict of the upstream ASPA verification' }),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Verdict' }), el('th', { scope: 'col', text: 'AS path, as a router shows it' }),
      el('th', { scope: 'col', class: 'num', text: 'Routes' }), el('th', { scope: 'col', text: 'Why' }))),
    tbody)));
  kids.push(el('p', { class: 'hint', text: 'The verification is the downstream procedure, because the networks that feed a route collector mostly send their full table, as a provider would; a feeder that sends only its customers\' routes passes it too. Paths with an AS_SET are skipped. ASPAs are the validated ones listed on this page; the ROAs are the ones this validator has validated.' }));
  out.replaceChildren(...kids);
}


/* ---------- lookup ---------- */
// the graph sits in a block of its own, like the history and the quality

// Compare an AS on two days (site/history.js): its providers, the ASPAs that name it and, for the last 60 days, its places of valley.
const isoDay = (d) => d.toISOString().slice(0, 10);
async function dayPlaces(day) {
  try { return (await getJson(`/api/v1/leaks-by-as/${day.replaceAll('-', '')}.json`)).as || null; } catch { return null; }
}
function compareBlock(as) {
  const today = isoDay(new Date());
  const ago = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); const s = isoDay(d); return changesFirstDay && s < changesFirstDay ? changesFirstDay : s; };
  const from = el('input', { type: 'date', id: 'cmp-from', value: ago(30), max: today, min: changesFirstDay || undefined });
  const to = el('input', { type: 'date', id: 'cmp-to', value: today, max: today, min: changesFirstDay || undefined });
  const out = el('div', { 'aria-live': 'polite' });
  const btn = el('button', { type: 'submit', text: 'Compare' });
  const form = el('form', { class: 'opts' },
    el('label', {}, 'From ', from), el('label', {}, 'to ', to), btn);
  const list = (items) => (items.length ? chipList(items, 30) : el('span', { class: 'muted', text: 'none' }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!eventsRaw.length) { out.replaceChildren(el('p', { class: 'hint', text: 'The history is still loading; try again in a moment.' })); return; }
    let a = from.value, b = to.value;
    if (!a || !b) { out.replaceChildren(el('p', { class: 'error', text: 'Pick two days.' })); return; }
    if (a > b) [a, b] = [b, a];
    btn.disabled = true;
    const c = AspaHistory.compareAs(eventsRaw, as, a, b);
    const kids = [el('p', { class: 'hint', text: `The state at the end of each day, ${fmtDayLong(a)} and ${fmtDayLong(b)}.` })];
    const own = c.own;
    if (!own.before && !own.after) kids.push(el('p', { text: `${as} had no ASPA on either day.` }));
    else if (!own.before) kids.push(el('p', { text: `${as} had no ASPA on ${fmtDayLong(a)}; on ${fmtDayLong(b)} it lists ${own.after.length} provider${own.after.length === 1 ? '' : 's'}:` }), list(own.after));
    else if (!own.after) kids.push(el('p', { text: `The ASPA of ${as} was removed between the two days; it listed:` }), list(own.before));
    else if (!own.added.length && !own.dropped.length) kids.push(el('p', { text: `The ASPA of ${as} is the same on both days (${own.after.length} provider${own.after.length === 1 ? '' : 's'}).` }));
    else kids.push(el('p', { text: 'Its ASPA added:' }), list(own.added), el('p', { text: 'and dropped:' }), list(own.dropped));
    const n = c.named;
    if (!n.added.length && !n.dropped.length) kids.push(el('p', { text: `The ASPAs that name ${as} as a provider are the same (${fmt.format(n.after)}).` }));
    else kids.push(el('p', { text: `ASPAs that now name ${as} as a provider (${fmt.format(n.before)} before, ${fmt.format(n.after)} after):` }), list(n.added), el('p', { text: 'and that no longer do:' }), list(n.dropped));
    out.replaceChildren(...kids, el('p', { class: 'hint' }, el('span', { class: 'busy', text: 'Looking at the places of valley' })));
    const [pa, pb] = await Promise.all([dayPlaces(a), dayPlaces(b)]);
    const last = out.lastChild;
    if (!pa || !pb) last.textContent = 'Places of valley: the daily files are kept for the last 60 days, so there is nothing to compare for one of the two days.';
    else {
      const p = AspaHistory.comparePlaces(pa, pb, as);
      const row = (x) => el('li', {}, x.role === 'gap' ? `its ASPA seems to miss ${x.between[0]}` : `inside a valley between ${x.from} and ${x.to} (${x.between.join(' ')})`, ` · ${x.feeders} feeders`);
      last.replaceWith(el('div', {}, el('p', { text: `Places of valley that involve ${as}: ${p.added.length} new, ${p.gone.length} gone, ${p.kept} still there.` }),
        ...(p.added.length ? [el('p', { text: 'New:' }), el('ul', {}, ...p.added.slice(0, 5).map(row))] : []),
        ...(p.gone.length ? [el('p', { text: 'Gone:' }), el('ul', {}, ...p.gone.slice(0, 5).map(row))] : [])));
    }
    btn.disabled = false;
  });
  return el('details', { class: 'embed' }, el('summary', { text: 'Compare two dates' }),
    el('p', { class: 'hint', text: `What changed for ${as} between two days: its providers, the ASPAs that name it and, for the days that have a file, the places of valley that involve it.` }), form, out);
}

function graphHolder(as) { return el('div', { class: 'res-hist' }, el('h4', { text: 'Neighbourhood' }), graphBlock(as)); }

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

  out.replaceChildren(head, el('div', { class: 'res-grid' }, left, right), el('div', { class: 'res-hist', id: 'as-history' }), el('div', { class: 'res-hist' }, el('h4', { text: 'Compare' }), compareBlock(as)), el('div', { class: 'res-hist', id: 'as-quality' }), graphHolder(as), shareBlock(as));
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
  const leaks = el('input', { type: 'checkbox', id: 'nf-leaks' });
  const leaksLabel = el('label', { class: 'chk', for: 'nf-leaks' }, leaks, ` Also tell me, once a day, about new places of valley (possible route leaks) that involve ${as}`);
  const form = el('form', { class: 'notify', autocomplete: 'off' }, kind, target, trap, btn, leaksLabel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    msg.replaceChildren(el('span', { class: 'busy', text: 'Sending' }));
    try {
      const r = await fetch('/api/v1/subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind.value, target: target.value.trim(), asn: as, leaks: leaks.checked, website: trap.value }),
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
    el('p', { class: 'hint', text: `A message when the ASPA of ${as} changes, or when another ASPA adds or drops ${as} as a provider; if you tick the box, also when a new place of valley (a possible route leak) involves it. An e-mail address has to be confirmed through a link; a webhook has to repeat a challenge. Nothing else is kept or used.` }),
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
  // the table of all ASPAs became a download on the API page: old links to #all go there
  if (hash === 'all') { location.replace('/api.html#download'); return; }
  const dataTab = { overview: 'tab-overview', changes: 'tab-changes', quality: 'tab-quality' }[hash];
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
    renderOverview(status);
    addCoverageTile();
    await loadVisibility();
    computeQuality();
    renderQuality();
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
  setupTabs();
  load();
  loadEvents();
});
