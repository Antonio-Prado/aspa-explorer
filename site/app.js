'use strict';

// Data comes from Routinator via the same-origin proxy configured in nginx.
const DATA_ASPAS = '/data/aspas.json';
const DATA_STATUS = '/data/status.json';
// Daily history of the ASPA counts: the `history` branch of the public project, through the GitLab API (CORS open).
const DATA_VISIBILITY = '/api/v1/archive/visibility.json';
const DATA_EVENTS = '/api/v1/archive/events.json';
const RIR_NAMES = { afrinic: 'AFRINIC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', ripe: 'RIPE NCC' };

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

let aspas = [];            // [{customer, providers, source}] sorted by customer number
let byCustomer = new Map(); // 'AS123' -> aspa
let byProvider = new Map(); // 'AS123' -> ['AS456', ...] customers naming it
let aspaSets = new Map();   // 'AS123' -> Set of its providers, for the path checker
let ixpSet = new Set();      // the exchange-point ASes (CAIDA), to say when one is in a path
let dataStatus = null;      // the validator's status (when it last updated), for the stamp of a shared result

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
  if (as === 'AS0') return el('span', { class: 'chip zero', text: 'AS0 · no transit providers' });
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
    tile('AS0 ASPAs', fmt.format(zero), 'no transit providers'),
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
  if (e.kind === 'new') return `new ASPA: ${e.providers.length === 1 && e.providers[0] === 'AS0' ? 'no transit providers (AS0)' : list(e.providers, '')}`;
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
  // The archive is brought up to date every hour: what the validated list shows now can be newer.
  const fresh = (what) => el('p', { class: 'hint', text: `${what} is in the validated list now, but it is newer than the archive, which is updated every hour: it will appear here soon.` });
  const liveOwn = byCustomer.has(as), liveNamed = byProvider.has(as);
  if (!own.length && !named && !liveOwn && !liveNamed) out.push(el('p', { text: `No ASPA of ${as} or naming ${as} as a provider has been seen since ${fmtDayLong(changesFirstDay)}.` }));
  else {
    if (own.length) out.push(el('p', { text: `The ASPA of ${as}, since ${fmtDayLong(changesFirstDay)}:` }), el('ul', { class: 'timeline' }, ...lines));
    else if (liveOwn) out.push(fresh(`The ASPA of ${as}`));
    else out.push(el('p', { text: `${as} has never published an ASPA since ${fmtDayLong(changesFirstDay)}.` }));
    if (named) out.push(el('p', { text: `First named as a provider in an ASPA on ${since(named)}.` }));
    else if (liveNamed) out.push(fresh(`The ASPA that names ${as} as a provider`));
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

// An exchange-point AS in a path that is not Valid: say what it may mean (RFC 7947 asks a route server not to be in the path).
const ixpIn = (path) => path.filter((as) => ixpSet.has(Number(as.slice(2))));
function ixpNote(v) {
  const found = v.result === 'Valid' ? [] : ixpIn(v.path);
  if (!found.length) return [];
  const names = found.join(', ');
  return [el('p', { class: 'hint ixp-note' },
    el('strong', { text: `${names} ${found.length === 1 ? 'is' : 'are'} in the list of exchange-point ASes` }), ' (from the CAIDA data). ',
    'A route server of an exchange point should not put its own AS number in the AS path: ',
    el('a', { href: 'https://www.rfc-editor.org/rfc/rfc7947#section-2.2.2.1', target: '_blank', rel: 'noopener' }, 'RFC 7947, section 2.2.2.1', el('span', { class: 'sr-only', text: ' (opens in a new tab)' })),
    ' says it SHOULD NOT prepend it, a recommendation kept only for compatibility with old route server clients, so that the members see the path as if they peered directly. Where it does, the ASPA verification treats it as a provider of its members, who must list it in their ASPAs (see the examples page): a member that has not gets its paths judged Invalid without any leak anywhere. The same AS number can also belong to a real network that peers and sells transit (NetIX is both): then the valley may be real. Check who it is, and where the route was learned, before blaming anybody.')];
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
  return `Even in the best case the up-ramp (at most ${v.maxUp} of ${v.N} ASes, from the origin ${first}) and the down-ramp (at most ${v.maxDown}, from the neighbour ${last}) do not meet: part of the path is a valley, which is how a route leak, a forged path segment or a gap in the ASPAs looks.`;
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
    ...ixpNote(v),
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

// "ASPA data: 3,229 ASPAs, validator updated 2026-10-18 12:00 UTC": which data a shared result was computed with
function dataStamp() {
  const done = dataStatus && dataStatus.lastUpdateDone;
  return `ASPA data: ${fmt.format(aspas.length)} ASPAs${done ? `, validator updated ${new Date(done).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}.`;
}

// The report of one path check, for AspaShare
function pathReport(text, direction) {
  const parsed = AspaVerify.parsePath(text);
  const v = AspaVerify.verify(aspaSets, parsed.path, direction);
  const missing = [...new Set(v.path.filter((as) => !aspaSets.has(as)))];
  const cls = { 'Provider+': 'provider', 'Not Provider+': 'not-provider', 'No Attestation': 'none' };
  const sections = [{ heading: 'Verdict', text: `${v.result}. ${pathVerdict(v, missing)} Path from the origin to the neighbour: ${v.path.join(' → ')}. The route comes from ${direction === 'down' ? 'a provider (downstream check)' : 'a customer or a peer (upstream check)'}. ${dataStamp()}` }];
  if (v.N > 1) {
    const down = direction === 'down';
    const rows = [];
    for (let i = 1; i < v.N; i++) {
      const hop = (c, p, o) => [o === 'No Attestation' ? `${c} has no ASPA` : `${c} ${o === 'Provider+' ? 'lists' : 'does not list'} ${p}`, cls[o]];
      const row = [`${v.path[i - 1]} → ${v.path[i]}`, hop(v.path[i - 1], v.path[i], v.up[i])];
      if (down) row.push(hop(v.path[i], v.path[i - 1], v.down[i + 1]));
      rows.push(row);
    }
    sections.push({ heading: 'Hop by hop', table: { columns: down ? ['Hop', 'Uphill check', 'Downhill check'] : ['Hop', 'Uphill check'], rows } });
  }
  return { kind: 'path', title: `AS path ${parsed.path.slice().reverse().join(' ')}: ${v.result}`, source: `/#${new URLSearchParams({ path: text.trim(), from: direction })}`, sections };
}

function renderPathCheck(text, direction) {
  const nodes = pathCheckNodes(text, direction);
  if (typeof AspaRecent !== 'undefined' && !AspaVerify.parsePath(text).error && aspas.length) {
    const parsed = AspaVerify.parsePath(text);
    const id = parsed.path.slice().reverse().map((a) => a.slice(2)).join(' ');
    const result = AspaVerify.verify(aspaSets, parsed.path, direction).result;
    const list = AspaRecent.store.load();
    const before = AspaRecent.find(list, { kind: 'path', id, direction });
    AspaRecent.store.save(AspaRecent.record(list, { kind: 'path', id, direction, t: Date.now(), result }));
    renderRecent();
    if (before) { const d = AspaRecent.diffPath(before, result); nodes.unshift(el('p', { class: `hint recent-note${d.changed ? ' changed' : ''}` }, `You checked this path ${AspaRecent.ago(before.t)}: ${d.text}.`)); }
  }
  if (!AspaVerify.parsePath(text).error && aspas.length) nodes.push(AspaShare.button(() => pathReport(text, direction)));
  $('pathresult').replaceChildren(...nodes);
}

/* ---------- many paths at once ---------- */
function bulkReport(r, direction, text) {
  const n = r.rows.length, c = r.counts;
  const head = `${fmt.format(n)} AS paths checked as routes that come from ${direction === 'down' ? 'a provider (downstream check)' : 'a customer or a peer (upstream check)'}: ${c.Valid} valid, ${c.Unknown} unknown, ${c.Invalid} invalid${c.Error ? `, ${c.Error} not understood` : ''}. ${dataStamp()}`;
  const shown = r.rows.slice(0, 500);
  const klass = { Valid: 'valid', Unknown: 'unknown', Invalid: 'invalid', Error: 'invalid' };
  return {
    kind: 'bulk', title: `${fmt.format(n)} AS paths: ${c.Valid} valid, ${c.Unknown} unknown, ${c.Invalid} invalid`,
    sections: [{ heading: 'Summary', text: head + (n > shown.length ? ` The table has the first ${shown.length}.` : '') },
      { heading: 'Paths', table: { columns: ['Line', 'Prefix', 'Path', 'Verdict', 'Why'], rows: shown.map((x) => [String(x.line), x.prefix, x.path || x.input, [x.result, klass[x.result]], x.note]) } }],
  };
}

function runBulk() {
  const out = $('bulkresult');
  if (!aspas.length) { out.replaceChildren(el('p', { class: 'error', text: 'The ASPA data is still loading; try again in a moment.' })); return; }
  const direction = $('bulkfrom').value;
  const text = $('bulktext').value;
  const r = AspaBulk.checkMany(aspaSets, text, direction, AspaVerify);
  if (!r.rows.length) { out.replaceChildren(el('p', { class: 'error', text: 'Nothing to check: write one AS path on each line, for example 3356 1299 680.' })); return; }
  const c = r.counts;
  const summary = el('p', { class: 'verdict' }, el('strong', { text: `${fmt.format(r.rows.length)} paths` }),
    ` ${c.Valid} valid · ${c.Unknown} unknown · ${c.Invalid} invalid${c.Error ? ` · ${c.Error} not understood` : ''}.${r.truncated ? ` Only the first ${fmt.format(AspaBulk.MAX_LINES)} lines were checked.` : ''}`);
  const klass = { Valid: 'v-valid', Unknown: 'v-unknown', Invalid: 'v-invalid', Error: 'v-invalid' };
  const body = el('tbody');
  const PAGE = 200;
  let shown = 0;
  const more = el('button', { type: 'button', class: 'linkish' });
  const draw = () => {
    for (const x of r.rows.slice(shown, shown + PAGE)) {
      body.append(el('tr', {}, el('td', { class: 'num', text: String(x.line) }), el('td', { class: 'mono', text: x.prefix }), el('td', { class: 'mono', text: x.path || x.input }),
        el('td', {}, el('span', { class: `badge ${klass[x.result]}`, text: x.result })), el('td', { text: x.note })));
    }
    shown = Math.min(r.rows.length, shown + PAGE);
    more.hidden = shown >= r.rows.length;
    more.textContent = `Show ${fmt.format(Math.min(PAGE, r.rows.length - shown))} more`;
  };
  more.addEventListener('click', draw);
  draw();
  const stamp = new Date().toISOString().slice(0, 10);
  const files = el('p', { class: 'links' },
    el('button', { type: 'button', class: 'linkish', text: 'Download CSV', onclick: () => AspaShare.download(`aspa-paths-${stamp}.csv`, AspaBulk.toCsv(r.rows), 'text/csv') }), ' · ',
    el('button', { type: 'button', class: 'linkish', text: 'Download JSON', onclick: () => AspaShare.download(`aspa-paths-${stamp}.json`, JSON.stringify({ generated: new Date().toISOString(), direction, data: dataStamp(), counts: r.counts, rows: r.rows }, null, 1) + '\n', 'application/json') }));
  out.replaceChildren(summary, el('div', { class: 'table-wrap card', tabindex: '0', role: 'group', 'aria-label': 'Verdict of each path' }, el('table', { class: 'checks' },
    el('caption', { class: 'sr-only', text: 'Verdict of each AS path' }),
    el('thead', {}, el('tr', {}, ['Line', 'Prefix', 'Path', 'Verdict', 'Why'].map((t) => el('th', { scope: 'col', text: t })))), body)),
  el('p', {}, more), files, AspaShare.button(() => bulkReport(r, direction, text)));
}

/* ---------- routes seen in BGP ---------- */
// The routes that the RIPE RIS collectors see for a prefix, or originated by an AS (RIPEstat, bgp-state),
// each distinct AS path checked with the downstream procedure: most of the networks that feed a collector
// send it their full table, as a provider does to a customer, and a full table includes the routes they
// learned from their own providers, which the upstream procedure would wrongly call leaks.
const LIVE_API = 'https://stat.ripe.net/data/bgp-state/data.json?resource=';
const LIVE_MAX_BYTES = 12 * 1024 * 1024;
const LG_API = 'https://stat.ripe.net/data/looking-glass/data.json?resource=';
const LG_MAX = 24;       // prefixes read from the looking glass at one press: one request each
const STALE_MS = 60 * 60 * 1000; // a snapshot older than this gets a notice
const GRAPH_ROW = 9; // as many nodes as a row of the graph draws (MAX_ROW in graph.js)
const PREFIX_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+:[0-9a-f:]*\/\d{1,3})$/i;

function parseLiveQuery(text) {
  const t = String(text).trim();
  // a single address, alone or as a /32 (IPv4) or /128 (IPv6): RIPEstat answers with the routes of the most specific prefix that covers it
  const host = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/32)?$/.exec(t) || /^([0-9a-f]*:[0-9a-f:]*)(?:\/128)?$/i.exec(t);
  if (host && (host[1].includes(':') || host[1].split('.').every((x) => Number(x) <= 255))) return { resource: host[1].toLowerCase(), label: t.toLowerCase(), kind: 'prefix', host: host[1].toLowerCase() };
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

// The routes of the snapshot against what the RIPE RIS looking glass holds right now, prefix by prefix. The snapshot of
// RIPEstat (bgp-state) can be hours old; the looking glass answers for one prefix at a time, so the shortest prefixes
// are read (LG_MAX of them), four at once, and only on a press of the button.
function lookingGlassPanel(q, routes, notice) {
  const snapshot = AspaLive.snapshotOrigins(routes);
  const len = (pf) => Number(pf.split('/')[1]);
  const all = [...snapshot.keys()].sort((a, b) => len(a) - len(b) || (a < b ? -1 : 1));
  const used = all.slice(0, LG_MAX);
  const out = el('div', { 'aria-live': 'polite' });
  const button = el('button', { type: 'button', text: `Compare with the looking glass (${fmt.format(used.length)} prefix${used.length === 1 ? '' : 'es'})` });
  // a default route has dozens of origins: the busiest few, and how many more
  const MANY = 6;
  const more = (n) => (n > MANY ? ` and ${fmt.format(n - MANY)} more` : '');
  const names = (m) => ([...m].sort((a, b) => b[1] - a[1]).slice(0, MANY).map(([o, n]) => `AS${o} (${fmt.format(n)})`).join(', ') + more(m.size)) || 'none';
  const list = (origins) => origins.slice(0, MANY).map((o) => `AS${o}`).join(', ') + more(origins.length);
  button.addEventListener('click', async () => {
    button.disabled = true;
    const now = new Map();
    let failed = 0, when = '';
    const queue = [...used];
    out.replaceChildren(el('p', { class: 'hint' }, el('span', { class: 'busy', text: 'Reading the looking glass' })));
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let pf = queue.shift(); pf; pf = queue.shift()) {
        try {
          const d = await getJson(LG_API + encodeURIComponent(pf));
          if (d.status !== 'ok') throw new Error('RIPEstat returned an error');
          now.set(pf, AspaLive.lookingGlassOrigins(d.data, pf));
          when = when || d.data.latest_time || d.data.query_time || '';
        } catch { failed++; }
      }
    }));
    button.disabled = false;
    if (!now.size) { out.replaceChildren(el('p', { class: 'error', text: 'The looking glass could not be read. Try again in a moment.' })); return; }
    const rows = AspaLive.compare(snapshot, now);
    const changed = rows.filter((r) => r.changed);
    const gone = AspaLive.withdrawn(rows);
    const stamp = when ? ` as of ${fmtDate(when.endsWith('Z') ? when : when + 'Z')}` : '';
    const lines = [el('p', { class: changed.length ? 'src lgdiff' : 'src', text: changed.length
      ? `${fmt.format(changed.length)} of ${fmt.format(rows.length)} prefixes differ from the snapshot in the looking glass${stamp}.`
      : `All ${fmt.format(rows.length)} prefixes are announced by the same origins in the looking glass${stamp} as in the snapshot.` })];
    if (gone.routes) {
      const shown = gone.items.slice(0, 5).map((i) => `${i.prefix} (${list(i.origins)})`).join(', ') + (gone.items.length > 5 ? ` and ${fmt.format(gone.items.length - 5)} more` : '');
      const text = `${fmt.format(gone.routes)} route${gone.routes === 1 ? '' : 's'} of the snapshot ${gone.routes === 1 ? 'is' : 'are'} gone from the looking glass: ${shown}. ${gone.routes === 1 ? 'It was' : 'They were'} withdrawn after the snapshot, so the verdicts below still count ${gone.routes === 1 ? 'it' : 'them'}.`;
      lines.push(el('p', { class: 'stale', text }));
      if (notice) notice.textContent = `These routes are a snapshot ${notice.dataset.age} old, and the looking glass shows that ${fmt.format(gone.routes)} of them ${gone.routes === 1 ? 'has' : 'have'} been withdrawn since: they are still in the verdicts below.`;
    }
    if (changed.length) {
      lines.push(el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Prefixes that differ between the snapshot and the looking glass' }, el('table', { class: 'checks live lg' },
        el('caption', { class: 'sr-only', text: 'Prefixes whose origins in the looking glass differ from the snapshot' }),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Prefix' }), el('th', { scope: 'col', text: 'Snapshot (routes)' }), el('th', { scope: 'col', text: 'Looking glass (peers)' }), el('th', { scope: 'col', text: 'Change' }))),
        el('tbody', {}, ...changed.map((r) => el('tr', {},
          el('td', { class: 'mono', text: r.prefix }),
          el('td', { class: 'mono pathcell', text: names(r.before) }),
          el('td', { class: 'mono pathcell', text: names(r.after) }),
          el('td', { text: [r.gone.length && `no longer announced by ${list(r.gone)}`, r.added.length && `now also by ${list(r.added)}`].filter(Boolean).join('; ') })))))));
    }
    const notes = [];
    if (failed) notes.push(`${fmt.format(failed)} prefix${failed === 1 ? '' : 'es'} could not be read.`);
    if (all.length > used.length) notes.push(`Only the ${fmt.format(used.length)} shortest of ${fmt.format(all.length)} prefixes were compared. Check a single prefix to see the others.`);
    notes.push('The looking glass lists what the peers of the collectors hold now; a prefix that is gone from it may still be announced where the collectors do not see it.');
    lines.push(el('p', { class: 'hint', text: notes.join(' ') }));
    out.replaceChildren(...lines);
  });
  return el('div', { class: 'lgpanel' }, el('p', { class: 'hint', text: 'The snapshot above is what RIPEstat last read from the collectors. The looking glass of the RIPE RIS holds the present state of the same routes.' }), button, out);
}

// For a single address: the prefix that the routes belong to, the most specific one that is announced.
function hostNote(address, routes) {
  const prefixes = [...new Set(routes.map((r) => String(r.target_prefix).toLowerCase()))];
  const text = prefixes.length === 1
    ? `${address} is not announced alone: the most specific prefix that covers it is ${prefixes[0]}, and these are its routes.`
    : `${address} is covered by ${prefixes.length} prefixes, ${prefixes.slice(0, 4).join(', ')}${prefixes.length > 4 ? ' and more' : ''}: these are the routes of the most specific ones.`;
  return el('p', { class: 'hint', text });
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
    const ixps = v.result === 'Valid' ? [] : ixpIn(v.path);
    if (ixps.length) why += `${why ? ' · ' : ''}${ixps.join(', ')} ${ixps.length === 1 ? 'is an' : 'are'} exchange-point AS${ixps.length === 1 ? '' : 'es'}`;
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
    const g = groups.get(key) || { from, to, between: v.path.slice(v.maxUp, v.N - v.maxDown), paths: 0, routes: 0, feeders: new Set(), example: r.shown, v };
    g.paths++; g.routes += r.routes; for (const f of r.feeders) g.feeders.add(f);
    groups.set(key, g);
  }
  if (!groups.size) return null;
  const list = [...groups.values()].sort((x, y) => y.feeders.size - x.feeders.size || y.routes - x.routes);
  const head = el('tr', {}, ...['Valley between', 'ASes in the valley', 'Paths', 'Routes', 'Feeders', 'Example'].map((t, i) => el('th', { scope: 'col', class: i >= 2 && i <= 4 ? 'num' : undefined, text: t })));
  const trs = list.slice(0, 10).flatMap((g) => {
    const why = el('button', { type: 'button', class: 'linkish', text: 'why?', 'aria-expanded': 'false' });
    const row = el('tr', {},
      el('td', {}, asChip(g.from), ' ', asChip(g.to)),
      el('td', {}, ...(g.between.length ? g.between.flatMap((x, i) => (i ? [' ', asChip(x)] : [asChip(x)])) : ['–'])),
      el('td', { class: 'num', text: fmt.format(g.paths) }), el('td', { class: 'num', text: fmt.format(g.routes) }), el('td', { class: 'num', text: fmt.format(g.feeders.size) }),
      el('td', {}, el('a', { href: `#path=${encodeURIComponent(g.example.join(' '))}&from=down`, text: 'open the path' }), ' · ', why));
    let detail = null;
    why.addEventListener('click', () => {
      if (detail) { detail.hidden = !detail.hidden; why.setAttribute('aria-expanded', String(!detail.hidden)); return; }
      const body = el('div', { 'aria-live': 'polite' }, el('span', { class: 'busy', text: 'Asking the RIPE database and RIPEstat' }));
      detail = el('tr', { class: 'detailrow' }, el('td', { colspan: '6' }, body));
      row.after(detail);
      why.setAttribute('aria-expanded', 'true');
      valleyWhy(g, body).catch(() => body.replaceChildren(el('p', { text: 'The registries could not be read just now. Try again later.' })));
    });
    return [row];
  });
  return el('div', {},
    el('h3', { class: 'subhead', text: 'Valleys seen now' }),
    el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Valleys seen now' }, el('table', { class: 'checks live nb' },
      el('caption', { class: 'sr-only', text: 'Paths that the ASPAs show to contain a valley, grouped by the place of the valley, with the paths, routes and feeders that see it' }),
      el('thead', {}, head), el('tbody', {}, ...trs))),
    el('p', { class: 'hint', text: `${fmt.format(list.length)} place${list.length === 1 ? '' : 's'} of valley${list.length > 10 ? ', the ten seen by most feeders are listed' : ''}. A valley is a route that came down from a provider or a peer and went up again. It can be a route leak, a forged path or, more often, a gap in the ASPAs: look at the neighbours below before drawing a conclusion about the ASes in the valley: an ASPA that does not list one of its real providers makes valid routes look like valleys, and many of these places can be just that. The ASPAs prove a valley only where they are published, so paths of unknown verdict may hide others.` }));
}

// Why one place of valley, as a reading of the evidence (site/valley.js), asked when the button is pressed: the IRR objects of the ASes at the hops that
// the ASPAs refuse, CAIDA (relations.json) and the paths that RIPEstat sees before the customer of each of those hops.
async function valleyWhy(g, box) {
  const v = g.v, bs = AspaValley.breakers(v);
  const ases = [...new Set(bs.flatMap((b) => [b.customer, b.provider]))].map((x) => Number(x.slice(2)));
  const customers = [...new Set(bs.map((b) => Number(b.customer.slice(2))))];
  const [rel, irrs, nbs] = await Promise.all([
    getRelations(),
    Promise.all(ases.map((n) => fetchIrr(n).catch(() => undefined))),
    Promise.all(customers.map((n) => getJson(`https://stat.ripe.net/data/asn-neighbours/data.json?resource=AS${n}`).then((d) => d.data.neighbours).catch(() => null))),
  ]);
  const irr = new Map();
  ases.forEach((n, i) => { if (irrs[i] === undefined) return; const roles = irrs[i] ? AspaIrr.roles(irrs[i].attrs, ixpSet.size ? ixpSet : null) : null; irr.set(n, roles && roles.rules ? roles : null); });
  const observed = new Map();
  customers.forEach((n, i) => { if (nbs[i]) observed.set(n, nbs[i]); });
  const ctx = { irr, caida: rel && rel.providers ? rel.providers : null, observed };
  const r = AspaValley.explain(v, aspaSets, ctx, ixpSet);
  const w = AspaValley.words(r);
  const kids = [el('p', { class: `verdict ${r.kind === 'gap' ? 'v-valid' : 'v-unknown'}` }, el('strong', { class: 'plain-lead', text: w.lead }), ' ', w.body)];
  if (w.ask.length) kids.push(el('p', { text: `Ask ${[...new Set(w.ask.map((x) => x.as))].join(' and ')} whether ${w.ask.length === 1 ? `${w.ask[0].add} belongs` : 'these belong'} in the ASPA.` }));
  const last = v.path[v.N - 1];
  if (last === g.to) {
    const rrcs = [...new Set([...g.feeders].map((f) => String(f).split('-')[0]).filter((x) => /^\d+$/.test(x)).map((x) => `rrc${x}`))];
    kids.push(el('p', { class: 'hint', text: `${last} is the AS that reports this path${rrcs.length ? ` to ${rrcs.join(', ')}` : ''}: it is the first AS of the path as BGP shows it. The collector only listens, so nothing here says that ${last} passed the route on to a provider or a peer.` }));
  }
  const rows = AspaValley.hops(v, aspaSets, ctx).map((h) => el('tr', {},
    el('th', { scope: 'row', class: 'nowrap' }, asChip(h.a), ' → ', asChip(h.b)),
    el('td', {}, ...h.aspa.flatMap((t, i) => (i ? [el('br'), t] : [t]))),
    el('td', {}, ...(h.irr.length ? h.irr.flatMap((t, i) => (i ? [el('br'), t] : [t])) : ['not asked'])),
    el('td', { text: h.caida || 'not available' })));
  kids.push(el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'What the ASPAs, the IRR objects and CAIDA say about each hop of the example path' }, el('table', { class: 'checks live nb' },
    el('caption', { class: 'sr-only', text: 'The hops of the example path, from the origin, and what each source says about them' }),
    el('thead', {}, el('tr', {}, ['Hop, from the origin', 'ASPA', 'IRR object', 'CAIDA'].map((t) => el('th', { scope: 'col', text: t })))), el('tbody', {}, ...rows))));
  kids.push(el('p', { class: 'hint', text: 'A reading, not a verdict. The IRR objects say what their owners declared, when they last edited them. CAIDA and RIPEstat infer from the routes what nobody declared. Any of them can be out of date, and a registry object can be wrong, so where they disagree with an ASPA, ask the owner which one is right. The IRR is asked only for the ASes at the hops that the ASPAs refuse.' }));
  box.replaceChildren(...kids);
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
    el('p', { class: 'hint', text: `A route trombones when it starts and ends in the same country and goes far away on the way: its delay is that of a packet that crosses an ocean. BGP cannot tell it; a traceroute from probes in ${home} can. The probes start in ${home} because ${as} is registered there, which is an approximation, and sometimes a bold one: an AS can work elsewhere, or in several countries, and the address that is measured may not be in ${home}. If it is not, a long delay is the distance and not a trombone: choose the country of the probes below.` }),
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

// The LANs of the exchange points and their sites, to check where each probe is (traceroute.js, placeCheck): five tables asked
// of PeeringDB from the browser at the first measurement, while the probes run (the data are not copied to this site), and kept
// in this browser for a day, because PeeringDB limits how often an address can ask for them. Without them (null) the probes are
// not checked, and the result says so.
const PEERINGDB = 'https://www.peeringdb.com/api';
const PEERINGDB_TABLES = { ixpfx: 'ixlan_id,prefix', ixlan: 'id,ix_id', ix: 'id,name,city,country,status', ixfac: 'ix_id,fac_id', fac: 'id,latitude,longitude,status' };
const IXPS_STORE = 'aspa-ixps', IXPS_KEEP_MS = 24 * 3600 * 1000;
let ixpIndexAsked = null;
const ixpIndexOnce = () => (ixpIndexAsked ||= (async () => {
  try {
    const kept = JSON.parse(localStorage.getItem(IXPS_STORE) || 'null');
    if (kept && Array.isArray(kept.ixps) && Date.now() - kept.at < IXPS_KEEP_MS) return AspaTraceroute.ixpIndex(kept.ixps);
  } catch { /* no storage: ask again */ }
  const tables = await Promise.all(Object.entries(PEERINGDB_TABLES).map(([name, fields]) => getJson(`${PEERINGDB}/${name}?depth=0&fields=${fields}`).then((d) => [name, d.data])));
  const ixps = AspaTraceroute.ixpsFrom(Object.fromEntries(tables));
  try { localStorage.setItem(IXPS_STORE, JSON.stringify({ at: Date.now(), ixps })); } catch { /* full or blocked */ }
  return AspaTraceroute.ixpIndex(ixps);
})().catch(() => { ixpIndexAsked = null; return null; }));

// Where a probe is: the hops on the LANs of exchange points (placeCheck), and the reference points measured for it, the anchors of
// RIPE Atlas and, for a probe of RIPE Atlas, the instances of the root servers (soiCheck). The proof of the exchange points comes first.
function placeOf(s, idx, refs) {
  const ixp = AspaTraceroute.placeCheck(s, idx);
  const soi = AspaTraceroute.soiCheck(s.probe.latitude, s.probe.longitude, refs || []);
  return { checked: ixp.checked + soi.checked, misplaced: ixp.misplaced ? { kind: 'ixp', ...ixp.misplaced } : soi.misplaced };
}

// A summary of each result of a Globalping measurement, with the check of the place of its probe; refsOf(summary): the anchors
// that the probe pinged, if it did.
const summariesOf = (m, idx, refsOf = () => []) => m.results.map((x) => {
  const s = AspaTraceroute.summarise(x, (ip) => ipAsnCache.get(ip) || null);
  s.place = placeOf(s, idx, refsOf(s));
  return s;
});

// The same for the results of a traceroute of RIPE Atlas (runAtlas).
const atlasSummariesOf = (a, results, idx) => (results || []).filter((x) => a.meta.has(x.prb_id)).map((x) => {
  const s = AspaTraceroute.summariseAtlas(x, a.meta.get(x.prb_id), (ip) => ipAsnCache.get(ip) || null);
  s.place = placeOf(s, idx, a.refsOf(x.prb_id));
  return s;
});

// The name of a probe in the tables: a probe of RIPE Atlas has a number and a network; Globalping gives a city and a network.
const probeTitle = (p) => (p.platform === 'atlas' ? `RIPE Atlas ${p.id}${p.asn ? ` · AS${p.asn}` : ''}` : `${p.city || 'A probe'}${p.network ? ` · ${p.network}` : ''}`);

// What the check of the places says, for the result: how many probes could be checked, which are elsewhere. `anchors`: whether the
// probes pinged the anchors; the probes of RIPE Atlas are also checked with the root servers.
function placeNote(summaries, idx, anchors) {
  const atlas = summaries.some((s) => s.probe.platform === 'atlas');
  const refs = [idx && 'the exchange points that a path crosses, whose sites are known (PeeringDB)', anchors && 'the anchors of RIPE Atlas that the probes ping', atlas && 'for the probes of RIPE Atlas, the instances of the root servers that answer them, in the built-in measurements of RIPE Atlas'].filter(Boolean);
  if (!refs.length) return 'The place of the probes could not be checked: PeeringDB did not give the list of the exchange points (it limits how often an address can ask for it; the page keeps the list for a day once it has it).';
  const how = `against points whose place is known: ${refs.length > 1 ? `${refs.slice(0, -1).join('; ')}; and ${refs[refs.length - 1]}` : refs[0]}. A round trip to one of them shorter than light in fibre allows from the place of the probe means that the probe is elsewhere`;
  const checked = summaries.filter((s) => s.place.checked).length, out = summaries.filter((s) => s.place.misplaced).length;
  const noIxp = idx ? '' : ' PeeringDB did not give the list of the exchange points this time.';
  if (!checked) return `The place of the probes is checked ${how}; none of them could be used for these probes.${noIxp}`;
  return `The place of the probes is checked ${how}. ${checked} of the ${summaries.length} probes could be checked${out ? `, and ${out} ${out === 1 ? 'is' : 'are'} not where ${out === 1 ? 'it is' : 'they are'} said to be: left out of the reading, marked in the table` : ', and all are where they are said to be'}.${noIxp}`;
}

// The sentence for a probe that is not where it is said to be, with the figures that prove it.
function misplacedText(r) {
  const m = r.place.misplaced, ms = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  const who = r.probe.platform === 'atlas' ? `RIPE Atlas ${r.probe.id} is not where its host places it` : `This probe is not where Globalping places it${r.probe.city ? ` (${r.probe.city})` : ''}`;
  const left = 'so it is left out of the reading.';
  if (m.kind === 'anchor') {
    return `${who}: it reaches the anchor of RIPE Atlas ${m.anchor}${m.city ? ` in ${m.city}` : ''}, ${m.km} km from that place, in ${ms(m.rtt)}, while light in fibre needs at least ${ms(m.atLeast)} to go there and back. The probe is within about ${m.within} km of that anchor, ${left}`;
  }
  if (m.kind === 'root') {
    return `${who}: the ${m.letter.toUpperCase()} root server answers it from its instance ${m.hostname} (${m.code}), ${m.km} km from that place, in ${ms(m.rtt)}, while light in fibre needs at least ${ms(m.atLeast)} to go there and back. The probe is within about ${m.within} km of that instance (the margin is wider than for an anchor, because the place of an instance is read from the code of its city), ${left}`;
  }
  return `${who}: hop ${m.hop}, ${m.ip}, is on the LAN of ${m.ixp}${m.city ? ` in ${m.city}` : ''}, whose nearest site is ${m.km} km from that place, and it answers in ${ms(m.rtt)}, while light in fibre needs at least ${ms(m.atLeast)} to go there and back. The probe is within about ${m.within} km of a site of that exchange, ${left}`;
}

// A measurement of Globalping, to its end. `reuse`: the id of an earlier measurement, to run this one on the very same probes.
async function runGlobalping(spec, onStatus) {
  const r = await fetch(GLOBALPING, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(spec) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? 'the limit of measurements per hour of your address has been reached, try later' : (body.error && body.error.message) || `Globalping answered HTTP ${r.status}`);
  onStatus(`measuring from ${body.probesCount || 'a few'} probes`);
  for (let i = 0; i < 45; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const m = await getJson(`${GLOBALPING}/${encodeURIComponent(body.id)}`);
    if (m.status !== 'in-progress') return m;
  }
  throw new Error('the probes did not finish in time');
}
const runTraceroute = (address, country, onStatus, reuse = null) =>
  runGlobalping({ type: 'traceroute', target: address, locations: reuse || [{ country, limit: PROBES }], measurementOptions: { protocol: 'ICMP' } }, onStatus);

// The places of the Globalping probes of a traceroute against the anchors of RIPE Atlas: pings from the same probes to anchors chosen
// by the service of this site for the country (up to three in it and four in the world; nothing is measured on RIPE Atlas for this).
// Globalping gives no id of a probe, so a probe is told by its network and its place; two probes that look alike are not checked.
const GP_ANCHORS_HOME = 3, GP_ANCHORS_WORLD = 4;
async function globalpingAnchors(m, country, onStatus) {
  const { anchors } = await getJson(`${ATLAS_SERVICE}/anchors?country=${encodeURIComponent(country)}`);
  const chosen = [...anchors.filter((a) => a.country === country).slice(0, GP_ANCHORS_HOME), ...anchors.filter((a) => a.country !== country).slice(0, GP_ANCHORS_WORLD)];
  const key = (p) => `${p.asn}|${p.network}|${p.city}|${p.latitude}|${p.longitude}`;
  const twins = new Set(), seen = new Set();
  for (const x of m.results) { const k = key(x.probe); if (seen.has(k)) twins.add(k); seen.add(k); }
  let done = 0;
  onStatus(`pinging ${chosen.length} anchors of RIPE Atlas`);
  const pings = await Promise.all(chosen.map((a) => runGlobalping({ type: 'ping', target: a.ip, locations: m.id, measurementOptions: { packets: 3 } }, () => {})
    .then((p) => { onStatus(`pinging the anchors of RIPE Atlas, ${++done} of ${chosen.length}`); return { anchor: a, results: p.results }; })
    .catch(() => ({ anchor: a, results: [] }))));
  const byProbe = new Map();
  for (const { anchor, results } of pings) {
    for (const x of results) {
      const k = key(x.probe), rtt = x.result && x.result.stats && x.result.stats.min;
      if (twins.has(k) || typeof rtt !== 'number') continue;
      if (!byProbe.has(k)) byProbe.set(k, []);
      byProbe.get(k).push({ anchor, rtt });
    }
  }
  return (s) => AspaTraceroute.anchorRefs(byProbe.get(key(s.probe)) || []);
}

// RIPE Atlas: the measurements are created by the service of this site (atlas/main.mjs), which holds the key of its account; the page
// reads their results, public, from RIPE Atlas, and the answers that the root servers give to the same probes (every probe of RIPE
// Atlas asks each of them for hostname.bind every four minutes, in the built-in measurements).
const ATLAS = 'https://atlas.ripe.net/api/v2';
const ATLAS_SERVICE = '/api/v1/atlas';
const ROOT_MEASUREMENTS = { a: 10309, b: 10310, c: 10311, e: 10313, f: 10304, h: 10315, j: 10316, k: 10301, l: 10308, m: 10306 };
let rootSitesAsked = null;
const rootSitesOnce = () => (rootSitesAsked ||= getJson('/data/root-sites.json').then((d) => d.sites).catch(() => { rootSitesAsked = null; return null; }));

// The results of a one-off measurement of RIPE Atlas, once each of `expected` probes has one, or once nothing new has come for two
// readings after the first minute and a half (a probe that goes offline never answers), or when the time is up.
async function atlasResults(id, expected, onStatus) {
  let results = [], still = 0;
  for (let i = 0; i < 24; i++) {
    await new Promise((res) => setTimeout(res, 10000));
    const before = results.length;
    results = await getJson(`${ATLAS}/measurements/${encodeURIComponent(id)}/results/`).catch(() => results);
    onStatus(`${results.length} of ${expected} probes have answered`);
    still = results.length > before ? 0 : still + 1;
    if (results.length >= expected || (i >= 8 && results.length && still >= 2)) break;
  }
  return results;
}

// A test through RIPE Atlas: the service creates a traceroute for each family and pings to the anchors, from the same probes; the page
// waits for the traceroutes, then reads the pings and the answers of the root servers to those probes.
async function runAtlas(origin, country, targets, onStatus) {
  const r = await fetch(`${ATLAS_SERVICE}/measure`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ asn: origin, country, targets }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `the service of RIPE Atlas answered HTTP ${r.status}`);
  const n = body.probes.length, ids = body.probes.map((p) => p.id).join(',');
  onStatus(`measuring from ${n} probes`);
  const [tr4, tr6] = await Promise.all(['v4', 'v6'].map((f) => (body.traceroutes[f] ? atlasResults(body.traceroutes[f], n, (t) => onStatus(`${f === 'v4' ? 'IPv4' : 'IPv6'}: ${t}`)) : null)));
  onStatus('reading the pings to the anchors and the answers of the root servers');
  const [pings, sites, roots] = await Promise.all([
    Promise.all(body.pings.map((p) => getJson(`${ATLAS}/measurements/${p.id}/results/`).then((res) => ({ anchor: p.anchor, res })).catch(() => ({ anchor: p.anchor, res: [] })))),
    rootSitesOnce(),
    Promise.all(Object.entries(ROOT_MEASUREMENTS).map(([letter, id]) => getJson(`${ATLAS}/measurements/${id}/latest/?probe_ids=${ids}`).then((res) => ({ letter, res })).catch(() => ({ letter, res: [] })))),
  ]);
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const pingsOf = new Map(), rootsOf = new Map();
  for (const { anchor, res } of pings) for (const x of res) if (typeof x.min === 'number' && x.min >= 0) add(pingsOf, x.prb_id, { anchor, rtt: x.min });
  for (const { letter, res } of roots) {
    for (const x of res) {
      const a = x.result || {};
      const hostname = (a.answers || []).map((y) => (Array.isArray(y.RDATA) ? y.RDATA.join(' ') : y.RDATA)).find(Boolean);
      if (hostname && typeof a.rt === 'number') add(rootsOf, x.prb_id, { letter, hostname, rtt: a.rt });
    }
  }
  const meta = new Map(body.probes.map((p) => [p.id, { ...p, platform: 'atlas' }]));
  return { meta, tr4, tr6, refsOf: (id) => [...AspaTraceroute.anchorRefs(pingsOf.get(id)), ...AspaTraceroute.rootRefs(rootsOf.get(id), sites)] };
}

// The networks of the addresses of the hops of a set of traceroutes (Globalping results, or results of RIPE Atlas), four at a time.
async function mapHops(gpResults, atlasResults, onStatus) {
  const gp = (gpResults || []).flatMap((x) => (x.result.hops || []).map((h) => h.resolvedAddress));
  const at = (atlasResults || []).flatMap((x) => (Array.isArray(x.result) ? x.result : []).flatMap((h) => (h.result || []).map((y) => y.from)));
  const ips = [...new Set([...gp, ...at].filter((ip) => ip && !AspaTraceroute.isPrivate(ip)))];
  onStatus(`Mapping ${ips.length} addresses to their networks`);
  const queue = [...ips];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let ip = queue.shift(); ip; ip = queue.shift()) await asnOfIp(ip); }));
}

// The countries that can be chosen for the probes: the one where the AS is registered first, then these.
const PROBE_COUNTRIES = ['AR', 'AU', 'AT', 'BE', 'BR', 'BG', 'CA', 'CL', 'CN', 'CO', 'HR', 'CZ', 'DK', 'EG', 'EE', 'FI', 'FR', 'DE', 'GR', 'HK', 'HU', 'IS', 'IN', 'ID', 'IE', 'IL', 'IT', 'JP', 'KE', 'KR', 'LV', 'LT', 'LU', 'MY', 'MX', 'MA', 'NL', 'NZ', 'NG', 'NO', 'PK', 'PE', 'PH', 'PL', 'PT', 'RO', 'RU', 'SA', 'RS', 'SG', 'SK', 'SI', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TH', 'TR', 'UA', 'AE', 'GB', 'US', 'VN'];

// Both families, on the same probes: the measurement over IPv6 first (it picks probes that can use IPv6), then the one over IPv4 on the very same
// probes (Globalping takes the id of the first as the places of the second). Each family aims at an address of the origin's own prefixes.
// opts: { globalping, atlas, anchors } (the platforms, and whether the Globalping probes ping the anchors); a platform that fails
// leaves its error in `failed` and the other one is read all the same.
async function measurePair(t4, t6, country, status, origin, opts) {
  const idxAsked = ixpIndexOnce();
  const failed = [];
  const gp = opts.globalping ? (async () => {
    const m6 = await runTraceroute(t6.address, country, (t) => status('Globalping', `IPv6: ${t}`));
    const m4 = await runTraceroute(t4.address, country, (t) => status('Globalping', `IPv4: ${t}`), m6.id);
    const refsOf = opts.anchors ? await globalpingAnchors(m6, country, (t) => status('Globalping', t)).catch(() => () => []) : () => [];
    return { m4, m6, refsOf };
  })().catch((err) => { failed.push(`Globalping: ${err.message}`); return null; }) : null;
  const at = opts.atlas ? runAtlas(origin, country, { v4: t4.address, v6: t6.address }, (t) => status('RIPE Atlas', t))
    .catch((err) => { failed.push(`RIPE Atlas: ${err.message}`); return null; }) : null;
  const [g, a] = await Promise.all([gp, at]);
  await mapHops(g ? [...g.m4.results, ...g.m6.results] : [], a ? [...(a.tr4 || []), ...(a.tr6 || [])] : [], (t) => status('', t));
  const idx = await idxAsked;
  const s4 = [], s6 = [], rows = [];
  if (g) { const x4 = summariesOf(g.m4, idx, g.refsOf), x6 = summariesOf(g.m6, idx, g.refsOf); s4.push(...x4); s6.push(...x6); rows.push(...AspaTraceroute.pairProbes(x4, x6, origin)); }
  if (a) { const x4 = atlasSummariesOf(a, a.tr4, idx), x6 = atlasSummariesOf(a, a.tr6, idx); s4.push(...x4); s6.push(...x6); rows.push(...AspaTraceroute.pairProbes(x4, x6, origin)); }
  if (!g && !a) throw new Error(failed.join('; '));
  // a probe that is not where it is said to be, over either family, is left out of the reading and of the comparison
  for (const r of rows) r.misplaced = [r.v4, r.v6].map((s) => s && s.place.misplaced && s).find(Boolean) || null;
  return { rows, cmp: AspaTraceroute.comparePairs(rows.filter((r) => !r.misplaced)), place: placeNote([...s4, ...s6], idx, !!(a || (g && opts.anchors))), failed };
}

// The result of the comparison. What comes first is the one thing that this panel is for: is there a trombone, over IPv4 and over IPv6. Each family
// is read like a single measurement, on the probes that got into the AS (a traceroute that stops on a router on the way says nothing about the target);
// the comparison of the two families, and who answered and who did not, come after, as what goes with it.
function pairBlock(res, t4, t6, home, origin, atRegistered) {
  const { rows, cmp } = res;
  const ms = (v) => (v === null || v === undefined ? '–' : v < 1 ? '<1 ms' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
  const signed = (v) => (v === null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))} ms`);
  const as = 'AS' + origin;
  const band = (n) => (n >= AspaTraceroute.TROMBONE_MS ? 'trombone' : n > AspaTraceroute.LONG_DELAY_MS ? 'long' : 'ok');
  const side = (key) => AspaTraceroute.aggregate(rows.filter((r) => r[key] !== null && !r.misplaced).map((r) => ({ net: r[key], verdict: band(r[key]) })));
  const a4 = side('n4'), a6 = side('n6');
  const stopped = (key, n) => rows.filter((r) => r[key] && r[n] === null && r[key].net !== null).length;
  const word = { ok: 'no trombone', long: 'longer than it should be', trombone: 'trombone' };
  let headline, kind;
  if (!atRegistered && (a4 || a6)) {
    headline = `From ${home}: median ${a4 ? ms(a4.median) : 'no answer'} over IPv4, ${a6 ? ms(a6.median) : 'no answer'} over IPv6`;
    kind = 'none';
  } else if (!a4 && !a6) {
    headline = stopped('v6', 'n6') && !stopped('v4', 'n4') ? `Nothing to read: the traceroutes over IPv6 stop before ${as}` : stopped('v4', 'n4') && !stopped('v6', 'n6') ? `Nothing to read: the traceroutes over IPv4 stop before ${as}` : 'Nothing to read: no probe got into the AS';
    kind = 'none';
  } else {
    const rank = { ok: 0, long: 1, trombone: 2 };
    const v4 = a4 && a4.verdict, v6 = a6 && a6.verdict;
    const worst = [v4, v6].filter(Boolean).sort((x, y) => rank[y] - rank[x])[0];
    const fams = [v4 === worst && 'IPv4', v6 === worst && 'IPv6'].filter(Boolean);
    kind = worst;
    if (v4 && v6 && v4 === v6) headline = worst === 'ok' ? 'No trombone seen, over IPv4 or IPv6' : `${worst === 'trombone' ? 'Trombone' : 'Longer than it should be'}, over IPv4 and IPv6`;
    else if (v4 && v6 && worst !== 'ok' && (v4 === 'ok' || v6 === 'ok')) headline = `${worst === 'trombone' ? 'Trombone' : 'Longer than it should be'} over ${fams[0]} only`;
    else if (v4 && v6) headline = `IPv4: ${word[v4]}. IPv6: ${word[v6]}`;
    else headline = `Over ${v4 ? 'IPv4' : 'IPv6'}: ${word[worst]}; the other family could not be read`;
  }
  const family = (name, a, key) => {
    if (!a) return `${name}: no probe got into ${as}${stopped(key === 'n4' ? 'v4' : 'v6', key) ? ` (${stopped(key === 'n4' ? 'v4' : 'v6', key)} traceroutes stop earlier)` : ''}.`;
    const c = a.counts, parts = [];
    if (c.ok) parts.push(`${c.ok} normal`);
    if (c.long) parts.push(`${c.long} longer than it should be`);
    if (c.trombone) parts.push(`${c.trombone} ${c.trombone === 1 ? 'a trombone' : 'trombones'}`);
    return `${name}: median round trip ${ms(a.median)} (from ${ms(a.min)} to ${ms(a.max)}) on ${a.n} probes: ${parts.join(', ')}.`;
  };
  const c = cmp.counts;
  const lines = [family('IPv4', a4, 'n4'), family('IPv6', a6, 'n6')];
  if (!atRegistered) lines.push(`The bands of the reading (up to 50 ms normal, 100 ms or more a trombone) are for two points of one country: the probes are in ${home}, not where ${as} is registered, so these are the delays of a trip from there.`);
  const compare = !cmp.both ? 'No probe got into the AS over both families, so the two cannot be compared probe by probe.'
    : `IPv4 against IPv6, on the ${cmp.both} probes that got in over both: ${Math.abs(cmp.medianDelta) < 1 ? 'about the same time (the typical difference is under 1 ms)' : `IPv6 is ${ms(Math.abs(cmp.medianDelta))} ${cmp.medianDelta > 0 ? 'slower' : 'faster'}`}; IPv4 is faster on ${c.v4}, IPv6 on ${c.v6}, ${c.tie} are even. The networks on the way differ on ${cmp.differentNetworks} of the ${cmp.both}.`;
  const answered = `${cmp.probes} probes in ${home}${c['v4 only'] || c['v6 only'] ? `; ${c['v4 only']} answered only over IPv4 and ${c['v6 only']} only over IPv6` : ''}. A probe whose traceroute stops before ${as} (the last router that answers is not in it) is not read: its round trip is the one of a router on the way.`;
  const notes = [`IPv4 aims at ${t4.address} (in ${t4.prefix}) and IPv6 at ${t6.address} (in ${t6.prefix}), both of ${as}: two addresses of the same AS, not the same host. The probes are the same, and the delays are counted from the first public address. A difference of a few milliseconds is within what the probes and the queues add; the country of the probes is where ${as} is registered only when it says so above.`, res.place,
    ...res.failed.map((f) => `Not measured: ${f}.`)];
  const box = el('div', { class: `result r-${kind}`, role: 'group', 'aria-label': 'Result of the measurement over IPv4 and IPv6' },
    el('p', { class: 'headline', text: headline }), ...lines.map((x) => el('p', { text: x })),
    el('p', { class: 'hint', text: compare }), el('p', { class: 'hint', text: answered }), ...notes.map((x) => el('p', { class: 'hint', text: x })),
    ...rows.filter((r) => r.misplaced).map((r) => el('p', { class: 'hint', text: misplacedText(r.misplaced) })));
  const nets = (x) => (x && x.path.length ? x.path.map((a) => `AS${a}`).join(' → ') : '–');
  const winner = { v4: 'IPv4', v6: 'IPv6', tie: 'even', 'v4 only': 'IPv4 only', 'v6 only': 'IPv6 only', none: 'no answer' };
  // a round trip with its reading when it is not a normal one, so that a trombone stands out in the row
  const cell = (r, key, n) => (r[n] === null ? (r[key] && r[key].net !== null ? 'stops early' : '–') : atRegistered && band(r[n]) !== 'ok' ? `${ms(r[n])} · ${word[band(r[n])]}` : ms(r[n]));
  const probeName = (r) => `${probeTitle(r.probe)}${r.misplaced ? ' (not where it is said to be, left out)' : ''}`;
  const body = rows.map((r) => el('tr', {},
    el('th', { scope: 'row', class: 'probe', text: probeName(r) }),
    el('td', { class: 'mono pathcell', text: nets(r.v4) }), el('td', { class: 'num', text: cell(r, 'v4', 'n4') }),
    el('td', { class: 'mono pathcell', text: nets(r.v6) }), el('td', { class: 'num', text: cell(r, 'v6', 'n6') }),
    el('td', { class: 'num', text: signed(r.delta) }), el('td', { text: winner[r.winner] }),
    el('td', { text: r.sameNetworks === null ? '–' : r.sameNetworks ? 'same' : 'different' })));
  const table = el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'The probes of the measurement over IPv4 and IPv6' }, el('table', { class: 'checks live nb' },
    el('caption', { class: 'sr-only', text: 'Each probe, with the networks on the way and the net round trip over IPv4 and over IPv6, with its reading when it is not normal, the difference and the faster family' }),
    el('thead', {}, el('tr', {}, ['Probe', 'IPv4 networks', 'IPv4 net round trip', 'IPv6 networks', 'IPv6 net round trip', 'IPv6 − IPv4', 'Faster', 'Networks'].map((t, i) => el('th', { scope: 'col', class: i === 2 || i === 4 || i === 5 ? 'num' : undefined, text: t })))),
    el('tbody', {}, ...body)));
  const report = () => ({
    kind: 'tromboning', title: `${as} from ${home}: ${headline}`, source: `/#${as}`,
    sections: [{ heading: 'Tromboning', text: `${headline}. ${lines.join(' ')}` }, { heading: 'IPv4 against IPv6', text: `${compare} ${answered} ${notes.join(' ')}` },
      { heading: 'Probes', table: { columns: ['Probe', 'IPv4 networks', 'IPv4 ms', 'IPv6 networks', 'IPv6 ms', 'IPv6 − IPv4', 'Faster', 'Networks'],
        rows: rows.slice(0, 100).map((r) => [probeName(r), nets(r.v4), cell(r, 'v4', 'n4'), nets(r.v6), cell(r, 'v6', 'n6'), signed(r.delta), winner[r.winner], r.sameNetworks === null ? '–' : r.sameNetworks ? 'same' : 'different']) } }],
  });
  return el('div', {}, box, table, AspaShare.button(report));
}

function measureBlock(origin, tr, routes) {
  const target = AspaTraceroute.targetOf(routes, origin);
  if (!target || !target.address) return null;
  const t4 = AspaTraceroute.targetOf(routes, origin, 4), t6 = AspaTraceroute.targetOf(routes, origin, 6);
  const as = 'AS' + origin, registered = tr.country;
  const options = [registered, ...PROBE_COUNTRIES.filter((c) => c !== registered).sort((a, b) => countryName(a).localeCompare(countryName(b)))];
  const select = el('select', { id: `probe-country-${origin}`, 'aria-label': 'Country of the probes' },
    ...options.map((c, i) => el('option', { value: c, text: i === 0 ? `${countryName(c)}, where ${as} is registered` : countryName(c) })));
  const btn = el('button', { type: 'button', text: `Measure it now from probes in ${countryName(registered)}` });
  select.addEventListener('change', () => { btn.textContent = `Measure it now from probes in ${countryName(select.value)}`; });
  // the probes: of Globalping (asked from this browser), of RIPE Atlas (asked by the service of this site, with its account), or both
  const platform = el('select', { id: `probe-platform-${origin}`, 'aria-label': 'Platform of the probes' },
    el('option', { value: 'both', text: 'Globalping and RIPE Atlas' }), el('option', { value: 'globalping', text: 'Globalping' }), el('option', { value: 'atlas', text: 'RIPE Atlas' }));
  const anchors = el('input', { type: 'checkbox', id: `gp-anchors-${origin}` });
  const anchorsLabel = el('label', { class: 'chk', for: anchors.id }, anchors, ` Also check the place of the Globalping probes with pings to anchors of RIPE Atlas (${GP_ANCHORS_HOME + GP_ANCHORS_WORLD} pings from each probe, which count among the measurements of your address)`);
  const anchorsBox = el('p', {}, anchorsLabel);
  platform.addEventListener('change', () => { anchorsBox.hidden = platform.value === 'atlas'; });
  const status = el('p', { class: 'hint', 'aria-live': 'polite' });
  // what each platform is doing, on one line
  const doing = new Map();
  const say = (who, text) => {
    if (who) doing.delete('');                               // a platform has started: the line of the start goes
    doing.set(who, text);
    status.replaceChildren(el('span', { class: 'busy', text: [...doing].map(([w, t]) => (w ? `${w}: ${t}` : t)).join(' · ') }));
  };
  const out = el('div', {});
  // both families on the same probes: possible when the origin has a prefix of each in the routes
  const both = el('input', { type: 'checkbox', id: `pair-${origin}` });
  if (!(t4 && t6)) both.disabled = true;
  // the addresses to aim at, which can be changed: the first host of a prefix often does not answer, and then a traceroute stops before the AS
  const addr4 = el('input', { type: 'text', id: `addr4-${origin}`, class: 'copy-field', spellcheck: 'false', value: t4 ? t4.address : '', 'aria-label': 'IPv4 address to aim at' });
  const addr6 = el('input', { type: 'text', id: `addr6-${origin}`, class: 'copy-field', spellcheck: 'false', value: t6 ? t6.address : '', 'aria-label': 'IPv6 address to aim at' });
  const addrBox = el('div', { class: 'pair-addresses', hidden: '' },
    el('p', { class: 'hint', text: `Addresses to aim at, in the prefixes that ${as} announces. If a traceroute stops before ${as}, the address does not answer: put one that does (a name server or a web server of the AS, for instance).` }),
    el('p', { class: 'field' }, el('label', { for: addr4.id, class: 'inline', text: 'IPv4 ' }), addr4, ' ', el('label', { for: addr6.id, class: 'inline', text: 'IPv6 ' }), addr6));
  both.addEventListener('change', () => { addrBox.hidden = !both.checked; });
  const bothLabel = el('label', { class: 'chk', for: both.id }, both, ` Compare IPv4 and IPv6 on the same probes${t4 && t6 ? '' : ` (${as} has no ${t4 ? 'IPv6' : 'IPv4'} prefix in the routes)`}`);
  const lock = (on) => { btn.disabled = on; select.disabled = on; platform.disabled = on; anchors.disabled = on; both.disabled = on || !(t4 && t6); };
  btn.addEventListener('click', async () => {
    const country = select.value, home = countryName(country);
    const opts = { globalping: platform.value !== 'atlas', atlas: platform.value !== 'globalping', anchors: platform.value !== 'atlas' && anchors.checked };
    lock(true); out.replaceChildren(); doing.clear();
    say('', 'Starting the probes');
    try {
      if (both.checked) {
        // the addresses typed must be inside the prefixes of the AS, so that the two measurements are about the AS and nothing else
        const mine = AspaTraceroute.prefixesOf(routes, origin);
        const pick = (input, base, name) => {
          const v = input.value.trim();
          if (v === base.address) return base;
          const prefix = mine.find((p) => AspaTraceroute.contains(p, v));
          if (!prefix || AspaTraceroute.isPrivate(v)) throw new Error(`${v || 'the ' + name + ' address'} is not inside a prefix that ${as} announces`);
          return { prefix, address: v };
        };
        const u4 = pick(addr4, t4, 'IPv4'), u6 = pick(addr6, t6, 'IPv6');
        const res = await measurePair(u4, u6, country, say, origin, opts);
        status.textContent = `IPv4 and IPv6 towards ${as}, from ${res.rows.length} probe${res.rows.length === 1 ? '' : 's'} in ${home}.`;
        out.replaceChildren(pairBlock(res, u4, u6, home, origin, country === registered));
        lock(false);
        return;
      }
      const idxAsked = ixpIndexOnce();
      const failed = [];
      const fam = target.address.includes(':') ? 'v6' : 'v4';
      const gp = opts.globalping ? (async () => {
        const m = await runTraceroute(target.address, country, (t) => say('Globalping', t));
        const refsOf = opts.anchors ? await globalpingAnchors(m, country, (t) => say('Globalping', t)).catch(() => () => []) : () => [];
        return { m, refsOf };
      })().catch((err) => { failed.push(`Globalping: ${err.message}`); return null; }) : null;
      const at = opts.atlas ? runAtlas(origin, country, { [fam]: target.address }, (t) => say('RIPE Atlas', t)).catch((err) => { failed.push(`RIPE Atlas: ${err.message}`); return null; }) : null;
      const [g, a] = await Promise.all([gp, at]);
      if (!g && !a) throw new Error(failed.join('; '));
      await mapHops(g ? g.m.results : [], a ? a[fam === 'v4' ? 'tr4' : 'tr6'] : [], (t) => say('', t));
      const idx = await idxAsked;
      const results = [...(g ? summariesOf(g.m, idx, g.refsOf) : []), ...(a ? atlasSummariesOf(a, a[fam === 'v4' ? 'tr4' : 'tr6'], idx) : [])];
      status.textContent = `Traceroute towards ${target.address}, in ${target.prefix} of ${as}, from ${results.length} probe${results.length === 1 ? '' : 's'} in ${home}.`;
      // the probes that are not where they are said to be are left out of the reading, and shown in the table
      const all = AspaTraceroute.aggregate(results.filter((s) => !s.place.misplaced));
      const place = [placeNote(results, idx, !!(a || (g && opts.anchors))), ...failed.map((f) => `Not measured: ${f}.`)].join(' ');
      const sorted = [...results].sort((x, y) => (y.net === null ? -1 : y.net) - (x.net === null ? -1 : x.net));
      out.replaceChildren(all ? resultBox(all, results.length, home, country === registered, place)
        : el('div', { class: 'result r-none', role: 'group', 'aria-label': 'Result of the measurement' }, el('p', { class: 'headline', text: 'Nothing to read' }), el('p', { class: 'hint', text: place })),
        probeTable(sorted, all, target, country === registered));
    } catch (err) {
      status.textContent = `The measurement did not work: ${err.message}.`;
    }
    lock(false);
  });
  return el('div', { class: 'measure' },
    el('p', { class: 'field' }, el('label', { for: select.id, class: 'inline', text: 'Probes in ' }), select, ' ',
      el('label', { for: platform.id, class: 'inline', text: 'of ' }), platform, ' ', btn),
    el('p', {}, bothLabel), addrBox, anchorsBox,
    el('p', { class: 'hint' }, `It runs a traceroute towards ${target.address} (in ${target.prefix}) from probes in the country that you choose, and asks RIPEstat which network each hop belongs to. The probes of Globalping (globalping.io, up to ${PROBES}) are asked from this browser: Globalping sees your address, and the test uses ${PROBES} of the 250 measurements an hour that it allows to an address (${2 * PROBES} when it compares IPv4 and IPv6, and up to ${GP_ANCHORS_HOME + GP_ANCHORS_WORLD} more for each probe if you tick the check with the anchors). The probes of RIPE Atlas (up to 8, one for each network) are asked by this site, with its own account and within limits that it keeps for each address and for each day; their results are public on atlas.ripe.net, and this page reads them from there, so RIPE Atlas sees your address too. To check where each probe is, the page also asks PeeringDB, which sees your address as well, for the exchange points and their sites, once a day, and compares the round trips with points whose place is known. How the check works: `,
      el('a', { href: '/guide.html#probe-place', text: 'the guide' }), '.'),
    status, out);
}

// The result of the measurement, as a headline and what stands behind it: the median round trip, the range, how many probes are in each band,
// and what the measurement cannot tell.
// Probes in another country than the one of the AS: the delays are those of an international trip, and the bands of a trip inside a country
// do not apply, so the page gives the figures and no reading.
function otherCountryBox(a, total, home, place) {
  const ms = (v) => (v < 1 ? '<1 ms' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
  return el('div', { class: 'result r-none', role: 'group', 'aria-label': 'Result of the measurement' },
    el('p', { class: 'headline', text: `Median ${ms(a.median)} from ${home}` }),
    el('p', { text: `${a.n} of ${total} probes in ${home} answered. Median round trip, from the first public address: ${ms(a.median)} (from ${ms(a.min)} to ${ms(a.max)}).` }),
    el('p', { class: 'hint', text: `The bands of the reading (up to 50 ms normal, 100 ms or more a trombone) are for two points of one country, so there is no reading here: these are the delays of a trip from ${home} to the target. Choose the country of the target to read them.` }),
    ...(place ? [el('p', { class: 'hint', text: place })] : []));
}

// `place`: what the check of the places of the probes says (placeNote).
function resultBox(a, total, home, atRegistered, place) {
  const ms = (v) => (v < 1 ? '<1 ms' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
  const c = a.counts, out = c.long + c.trombone;
  if (!atRegistered) return otherCountryBox(a, total, home, place);
  let kind, headline;
  if (a.verdict === 'trombone') { kind = 'trombone'; headline = 'Trombone'; }
  else if (a.verdict === 'long') { kind = 'long'; headline = 'Longer than it should be'; }
  else if (c.trombone) { kind = 'long'; headline = 'No trombone on most paths'; }
  else if (c.long) { kind = 'ok'; headline = 'No trombone seen'; }
  else { kind = 'ok'; headline = 'No trombone seen'; }
  const parts = [];
  if (c.ok) parts.push(`${c.ok} normal`);
  if (c.long) parts.push(`${c.long} longer than it should be`);
  if (c.trombone) parts.push(`${c.trombone} ${c.trombone === 1 ? 'a trombone' : 'trombones'}`);
  const lines = [`${a.n} of ${total} probes in ${home} answered. Median round trip, from the first public address: ${ms(a.median)} (from ${ms(a.min)} to ${ms(a.max)}). ${parts.join(', ')}.`];
  if (a.verdict === 'trombone') lines.push('Most of the routes cross an ocean, or go round Europe twice: 100 ms or more is not a delay between two points of one country.');
  else if (a.verdict === 'long') lines.push('The median is longer than it should be inside a country (50 ms): many routes probably go abroad, but not as far as an ocean.');
  else if (c.trombone) lines.push(`${c.trombone === 1 ? 'One probe is' : `${c.trombone} probes are`} at 100 ms or more: look at ${c.trombone === 1 ? 'it' : 'them'} in the table, it can be the probe (a mobile network, for instance) or its route.`);
  else lines.push('No probe is at 100 ms or more, the delay of a packet that crosses an ocean.');
  const notes = [atRegistered ? `The probes are in ${home} because the AS is registered there, which says little about where it works: if the target is not in ${home}, the delays are those of a longer trip, not of a trombone. You can choose another country above.` : `The probes are in ${home}, the country that you chose: the delays are those of a trip from there to the target.`, 'What this does not tell: a short detour inside Europe (a few tens of milliseconds) cannot be told apart from a target that is far inside the country, and the probes are only a sample of where the traffic comes from.'];
  if (a.verdict === 'ok' && a.near / a.n < 0.25) notes.unshift(`Only ${a.near} of the ${a.n} probes get within 10 ms of the target: it is far from them, inside the country, or the last part of its network is long.`);
  if (place) notes.push(place);
  return el('div', { class: `result r-${kind}`, role: 'group', 'aria-label': 'Result of the measurement' },
    el('p', { class: 'headline', text: headline }), ...lines.map((x) => el('p', { text: x })), ...notes.map((x) => el('p', { class: 'hint', text: x })));
}

// One row for each probe, the slowest first, with the median at the top; the hops of a probe open under its row.
function probeTable(probes, all, target, atRegistered) {
  const ms = (v) => (v === null ? '–' : v < 1 ? '<1 ms' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
  const badge = { ok: ['v-valid', 'normal'], long: ['v-unknown', 'longer than it should be'], trombone: ['v-invalid', 'trombone'] };
  const rows = [];
  if (all) {
    rows.push(el('tr', { class: 'median' }, el('th', { scope: 'row', text: `Median of ${all.n} probes (from ${ms(all.min)} to ${ms(all.max)})` }), el('td', { text: '' }), el('td', { class: 'num', text: ms(all.median) }), el('td', { text: '' }),
      el('td', {}, atRegistered ? el('span', { class: 'badge ' + badge[all.verdict][0], text: badge[all.verdict][1] }) : el('span', { class: 'muted', text: '–' })), el('td', { text: '' })));
  }
  for (const r of probes) {
    const more = el('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false', text: 'hops' });
    const v = r.verdict ? badge[r.verdict] : null;
    const elsewhere = r.place && r.place.misplaced;
    const tr = el('tr', {}, el('th', { scope: 'row', class: 'probe', text: probeTitle(r.probe) }),
      el('td', { class: 'mono pathcell', text: r.path.map((a) => `AS${a}`).join(' → ') || '–' }),
      el('td', { class: 'num', text: ms(r.net) }), el('td', { class: 'num', text: ms(r.lastRtt) }),
      el('td', {}, elsewhere ? el('span', { class: 'badge v-unknown', text: 'not where it is said to be' })
        : v && atRegistered ? el('span', { class: 'badge ' + v[0], text: v[1] }) : el('span', { class: 'muted', text: v ? '–' : 'no answer' })),
      el('td', { class: 'nowrap' }, more));
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
  if (r.place && r.place.misplaced) notes.push(misplacedText(r));
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
    el('h4', { text: r.probe.platform === 'atlas' ? `RIPE Atlas probe ${r.probe.id}, ${countryName(r.probe.country)}${r.probe.asn ? ` · AS${r.probe.asn}` : ''}`
      : `${r.probe.city || 'A probe'}, ${countryName(r.probe.country)}${r.probe.asn ? ` · AS${r.probe.asn}${r.probe.network ? ` ${r.probe.network}` : ''}` : ''}` }),
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
      status.textContent = `${fmt.format(routes.length)} routes read${part}; ` + (extra
        ? `the ${extra > 6 ? 'six most seen of the ' + extra : extra} neighbours that the ASPAs do not list ${extra === 1 ? 'is' : 'are'} drawn on the right.`
        : 'every neighbour seen in the routes is already in the graph, so there is nothing to add.');
      btn.hidden = true;                                     // done: the graph has them, the button would do nothing more
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
  const cols = ['Neighbour', 'Routes', `In the ASPA of ${as}`, 'Evidence', 'Valid', 'Unknown'];
  const numCol = (i) => i === 1 || i >= 4;
  const head = el('tr', {}, ...cols.map((t, i) => el('th', { scope: 'col', class: numCol(i) ? 'num' : undefined, text: t })));
  const evTds = new Map();
  const evCell = (n) => {
    const x = evOf(n);
    if (!x || x.label === 'few' || x.label === 'none') return el('td', { class: 'muted', text: '–', title: !x || x.label === 'few' ? 'too few paths to tell' : 'no route of this AS goes through it to a Tier-1: no evidence' });
    const title = `${fmt.format(x.viaT1)} of ${fmt.format(x.informative)} paths reach a Tier-1 through it, seen by ${fmt.format(x.feeders)} feeder${x.feeders === 1 ? '' : 's'}`;
    return el('td', {}, el('span', { class: 'badge ' + (x.label === 'provider' ? 'v-valid' : 'v-unknown'), text: x.label, title }));
  };
  const trs = list.slice(0, 15).map(([n, e]) => el('tr', {},
    el('td', {}, asChip(n)), el('td', { class: 'num', text: fmt.format(e.routes) }),
    el('td', {}, el('span', { class: 'badge nb-' + status(n).replace(' ', '-'), text: status(n) })),
    evCell(n),
    el('td', { class: 'num', text: fmt.format(e.Valid) }), el('td', { class: 'num', text: fmt.format(e.Unknown) })));
  trs.forEach((tr, i) => evTds.set(list[i][0], tr.children[3]));
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
    registryButton(origin, list.slice(0, 15), listed, evOf, evTds),
    el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': `Neighbours of ${as} in the routes` }, el('table', { class: 'checks live nb' },
      el('caption', { class: 'sr-only', text: `The AS before ${as} in the paths, how many routes go through it and whether the ASPA of ${as} lists it` }),
      el('thead', {}, head), el('tbody', {}, ...trs))),
    ...notes.map((t) => el('p', { class: 'hint', text: t })));
}

// The Evidence column of the neighbours, read against the IRR object of the origin and CAIDA when the button is pressed (valley.js): which of the
// neighbours that the ASPA does not list look like providers that it misses, and which are declared as something else.
function registryButton(origin, shown, listed, evOf, tds) {
  const as = 'AS' + origin;
  const out = el('div', { 'aria-live': 'polite' });
  const btn = el('button', { type: 'button', class: 'linkish', text: `Read what the registry says about these neighbours` });
  btn.addEventListener('click', async () => {
    btn.disabled = true; out.replaceChildren(el('span', { class: 'busy', text: 'Asking the RIPE database' }));
    try {
      const [o, rel] = await Promise.all([fetchIrr(origin).catch(() => undefined), getRelations()]);
      const roles = o === undefined ? undefined : (o ? AspaIrr.roles(o.attrs, ixpSet.size ? ixpSet : null) : null);
      const r = roles && roles.rules ? roles : (roles === undefined ? undefined : null);
      const caida = rel && rel.providers ? (rel.providers[origin] || []) : null;
      const missing = [];
      for (const [n] of shown) {
        const x = evOf(n), rd = AspaValley.neighbourReading(Boolean(listed && listed.has(n)), Number(n.slice(2)), r, caida, x ? x.label : null);
        const cls = rd.kind === 'agrees' ? 'v-valid' : rd.kind.endsWith('missing') ? 'v-unknown' : null;
        const td = tds.get(n);
        if (!td || rd.kind === 'none') continue;
        td.className = '';
        td.replaceChildren(el('span', { class: 'badge' + (cls ? ' ' + cls : ''), text: rd.label }), ...(rd.sources.length || rd.against.length ? [el('span', { class: 'hint block', text: [...rd.sources, ...rd.against.map((t) => `against: ${t}`)].join('; ') })] : []));
        if (rd.kind.endsWith('missing')) missing.push([n, rd.kind]);
      }
      const noPolicy = r === undefined ? 'The RIPE database could not be read just now, so only CAIDA and the routes are used.' : r === null ? `The registry holds no policy for ${as}, so only CAIDA and the routes are used.` : `The IRR object of ${as} is the one in ${o.source}.`;
      const probable = missing.filter(([, k]) => k === 'probably-missing').map(([n]) => n), maybe = missing.filter(([, k]) => k === 'maybe-missing').map(([n]) => n);
      const lines = [];
      if (probable.length) lines.push(`${probable.join(', ')} ${probable.length === 1 ? 'looks' : 'look'} like ${probable.length === 1 ? 'a provider' : 'providers'} of ${as} that its ASPA does not list.`);
      if (maybe.length) lines.push(`Possibly missing, with less evidence: ${maybe.join(', ')}.`);
      if (!lines.length) lines.push(`Nothing read here says that a provider of ${as} is missing from its ASPA.`);
      out.replaceChildren(el('p', { class: 'hint', text: `${lines.join(' ')} ${noPolicy} A reading, not a verdict: an IRR object is what its owner declared, and CAIDA infers from the routes.` }));
    } catch { out.replaceChildren(el('p', { class: 'hint', text: 'The registry could not be read just now. Try again later.' })); btn.disabled = false; }
  });
  return el('p', {}, btn, ' ', out);
}

// A starting point for the ASPA of the origin, from its declared providers and the evidence of the routes (site/evidence.js).
function suggestPanel(origin, ev, listed) {
  const as = 'AS' + origin;
  const s = AspaEvidence.suggest(listed ? [...listed] : null, ev);
  const names = (l) => l.join(', ');
  const kids = [el('h3', { class: 'subhead', text: `A starting point for the ASPA of ${as}` })];
  if (!s.list.length && !s.check.length) {
    kids.push(el('p', { class: 'hint', text: s.zero ? `${as} declares that it has no transit provider (AS0) and the routes show none with strong evidence: nothing to propose.` : `The routes do not give strong evidence of a provider of ${as}: nothing to propose.` }));
    return el('div', {}, ...kids);
  }
  const bits = [];
  if (s.keep.length) bits.push(`Already in its ASPA and seen in the routes: ${names(s.keep)}.`);
  if (s.add.length) bits.push(`Seen as ${s.add.length === 1 ? 'a provider' : 'providers'} but not in its ASPA: ${names(s.add)}. Add ${s.add.length === 1 ? 'it' : 'them'} if ${s.add.length === 1 ? 'it is' : 'they are'} really your upstream.`);
  if (s.keepUnseen.length) bits.push(`In its ASPA but not seen: ${names(s.keepUnseen)}. Keep ${s.keepUnseen.length === 1 ? 'it' : 'them'} for a backup provider or one the collectors do not see.`);
  if (s.check.length) bits.push(`Weak evidence, to check by hand before adding: ${names(s.check)}.`);
  if (s.zero) bits.push(`${as} declares AS0 (no transit provider) today: an ASPA with AS0 and other providers is not valid, so replace it rather than extend it.`);
  kids.push(...bits.map((x) => el('p', { class: 'hint', text: x })));
  if (s.list.length) kids.push(copyField(`Providers of ${as}`, s.list.join(' ')),
    el('p', { class: 'hint' }, 'It is a proposal from what the collectors see, not a verdict. Check it with ', el('a', { href: '/examples.html#check', text: 'the checker' }), ' and publish it as ', el('a', { href: '/examples.html#publish', text: 'the examples page' }), ' explains.'));
  return el('div', {}, ...kids);
}

// "What if": the routes of the origin with another list of providers in its ASPA (site/whatif.js).
function whatIfPanel(origin, rows, initial) {
  const as = 'AS' + origin;
  const input = el('input', { type: 'text', id: 'whatif-input', class: 'copy-field', value: initial.join(' '), spellcheck: 'false', 'aria-describedby': 'whatif-hint' });
  const out = el('div', { 'aria-live': 'polite' });
  const run = () => {
    const parsed = AspaWhatIf.parseProviders(input.value);
    if (parsed.error) { out.replaceChildren(el('p', { class: 'error', text: parsed.error })); return; }
    const r = AspaWhatIf.compare(aspaSets, rows.map((x) => ({ path: x.v.path, routes: x.routes })), as, parsed.providers);
    const tile = (k) => el('div', { class: 'tile card v-' + k.toLowerCase() },
      el('div', { class: 'label', text: k }),
      el('div', { class: 'value', text: r.before[k] === r.after[k] ? fmt.format(r.after[k]) : `${fmt.format(r.before[k])} → ${fmt.format(r.after[k])}` }),
      el('div', { class: 'note', text: r.before[k] === r.after[k] ? 'no change' : `${r.after[k] > r.before[k] ? '+' : '−'}${fmt.format(Math.abs(r.after[k] - r.before[k]))} routes` }));
    const kids = [el('div', { class: 'tiles live-tiles' }, tile('Valid'), tile('Unknown'), tile('Invalid'))];
    if (!r.changed.length) kids.push(el('p', { class: 'hint', text: 'No route changes its verdict with this list.' }));
    else {
      kids.push(el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'Paths whose verdict would change' }, el('table', { class: 'checks live' },
        el('caption', { class: 'sr-only', text: `Paths of the routes of ${as} whose verdict changes with the proposed ASPA, most routes first` }),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Now' }), el('th', { scope: 'col', text: 'With the list' }), el('th', { scope: 'col', text: 'AS path, as a router shows it' }), el('th', { scope: 'col', class: 'num', text: 'Routes' }))),
        el('tbody', {}, ...r.changed.slice(0, 10).map((c) => el('tr', {},
          el('td', {}, el('span', { class: 'badge v-' + c.from.toLowerCase(), text: c.from })),
          el('td', {}, el('span', { class: 'badge v-' + c.to.toLowerCase(), text: c.to })),
          el('td', { class: 'mono pathcell' }, ...pathLinks(compressBgp([...c.path].reverse().map(asNum)))),
          el('td', { class: 'num', text: fmt.format(c.routes) })))))));
      if (r.changed.length > 10) kids.push(el('p', { class: 'hint', text: `${fmt.format(r.changed.length - 10)} more paths change; the ones above carry the most routes.` }));
    }
    out.replaceChildren(...kids);
  };
  const form = el('form', { class: 'copy-row' }, el('label', { class: 'copy-label', for: 'whatif-input', text: `Providers of ${as}` }), input, el('button', { type: 'submit', text: 'Check' }));
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();
  return el('div', {},
    el('h3', { class: 'subhead', text: `What if the ASPA of ${as} listed...` }),
    el('p', { class: 'hint', id: 'whatif-hint', text: 'The routes above, checked again as if the ASPA of this AS had the providers below (AS0 alone: no transit provider). Every other ASPA stays as published. A route through a provider that is left out becomes Invalid for the networks that check ASPAs, so this is the test to run before you publish.' }),
    form, out);
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
  const lists = { valid: [], invalid: [], 'not-found': [] };      // the prefixes of each verdict, to say which they are
  let done = 0, next = 0;
  let open = null;                                                // the verdict whose prefixes are listed (the invalid ones, when there are)
  const progress = el('p', { class: 'src' });
  const tiles = el('div', { class: 'tiles live-tiles' });
  const detail = el('div', { id: 'rov-detail', 'aria-live': 'polite' });
  const NAMES = { valid: 'Valid', 'not-found': 'Not found', invalid: 'Invalid' };
  // a tile is a button once the check is over and there is something to list: it opens the list of its prefixes
  const tile = (cls, label, key, note, finished) => {
    const kids = [el('div', { class: 'label', text: label }), el('div', { class: 'value', text: fmt.format(counts[key]) }), el('div', { class: 'note', text: note })];
    if (!finished || !counts[key]) return el('div', { class: 'tile card ' + cls }, ...kids);
    kids.push(el('div', { class: 'more', text: open === key ? '▾ hide the prefixes' : '▸ which prefixes' }));
    return el('button', { type: 'button', class: 'tile card tile-btn ' + cls, 'aria-expanded': String(open === key), 'aria-controls': 'rov-detail',
      onclick: () => { open = open === key ? null : key; paint(); } }, ...kids);
  };
  const paint = () => {
    const finished = done === pairs.length;
    if (finished && open === null && !paint.chosen) { paint.chosen = true; if (lists.invalid.length) open = 'invalid'; }
    tiles.replaceChildren(tile('v-valid', 'Valid', 'valid', 'a ROA matches', finished), tile('v-unknown', 'Not found', 'not-found', 'no ROA covers it', finished), tile('v-invalid', 'Invalid', 'invalid', 'a ROA says otherwise', finished));
    progress.textContent = `${finished ? 'Checked' : `Checking… ${fmt.format(done)} of`} ${fmt.format(pairs.length)} prefix${pairs.length === 1 ? '' : 'es'} against the ROAs of the validator${all.length > pairs.length ? `; the ${fmt.format(all.length - pairs.length)} others are not checked` : ''}.`;
    if (!finished || !open || !lists[open].length) { detail.replaceChildren(); return; }
    const rows = [...lists[open]].sort((a, b) => b.routes - a.routes);
    const inv = open === 'invalid';
    detail.replaceChildren(
      el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': `${NAMES[open]} prefixes` }, el('table', { class: 'checks live' },
        el('caption', { class: 'sr-only', text: `Prefixes whose origin is ${NAMES[open].toLowerCase()} according to the ROAs${inv ? ', with the reason' : ''}` }),
        el('thead', {}, el('tr', {}, ...['Prefix', 'Origin', ...(inv ? ['Why'] : [])].map((t) => el('th', { scope: 'col', text: t })), el('th', { scope: 'col', class: 'num', text: 'Routes' }))),
        el('tbody', {}, ...rows.slice(0, 30).map((b) => el('tr', {},
          el('td', { class: 'mono', text: b.prefix }), el('td', {}, asChip('AS' + b.origin)), ...(inv ? [el('td', { text: whyInvalid(b) })] : []), el('td', { class: 'num', text: fmt.format(b.routes) })))))),
      ...(rows.length > 30 ? [el('p', { class: 'hint', text: `${fmt.format(rows.length - 30)} more ${NAMES[open].toLowerCase()}, not listed.` })] : []));
  };
  const worker = async () => {
    while (next < pairs.length) {
      const p = pairs[next++];
      try {
        const v = await fetchValidity(p.origin, p.prefix);
        if (v.state in counts && v.state !== 'error') { counts[v.state]++; lists[v.state].push(Object.assign({}, p, v)); } else counts.error++;
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
  if (!q) { out.replaceChildren(el('p', { class: 'error', text: 'Enter a prefix such as 193.0.0.0/21, an address such as 193.0.0.1 or an AS number such as AS3333.' })); return; }
  if (!aspas.length) { out.replaceChildren(el('p', { class: 'error', text: 'The ASPA data is still loading; try again in a moment.' })); return; }
  out.replaceChildren(el('p', { class: 'hint' }, el('span', { class: 'busy', text: `Fetching the routes for ${q.label} from RIPEstat` })));
  let data;
  try { data = await fetchRoutesSampled(q.resource); } catch (err) {
    out.replaceChildren(el('p', { class: 'error', text: `Could not get the routes for ${q.label} (${err.message}).` }));
    return;
  }
  const routes = data.bgp_state || [];
  if (!routes.length) { out.replaceChildren(el('p', { text: `The RIPE RIS collectors see no route for ${q.label}${q.kind === 'as' ? ' originated by it' : q.host ? ' or for a prefix that covers it' : ''} right now.` })); return; }
  const { rows, skipped } = checkRoutes(routes);
  const pairs = routePairs(routes);
  const count = (k) => rows.filter((r) => r.result === k);
  const routesOf = (list) => list.reduce((n, r) => n + r.routes, 0);
  const tiles = ['Valid', 'Unknown', 'Invalid'].map((k) => el('div', { class: 'tile card v-' + k.toLowerCase() },
    el('div', { class: 'label', text: k }),
    el('div', { class: 'value', text: fmt.format(routesOf(count(k))) }),
    el('div', { class: 'note', text: `route${routesOf(count(k)) === 1 ? '' : 's'} · ${fmt.format(count(k).length)} distinct path${count(k).length === 1 ? '' : 's'}` })));
  const ts = data.timestamp ? ` as of ${fmtDate(data.timestamp.endsWith('Z') ? data.timestamp : data.timestamp + 'Z')}` : '';
  const stampMs = data.timestamp ? Date.parse(data.timestamp.endsWith('Z') ? data.timestamp : data.timestamp + 'Z') : NaN;
  const age = Number.isNaN(stampMs) ? null : Date.now() - stampMs;
  const notice = age !== null && age > STALE_MS
    ? el('p', { class: 'stale', 'data-age': AspaLive.ageText(age), text: `These routes are a snapshot ${AspaLive.ageText(age)} old. A route announced or withdrawn since then is not in them, nor in the verdicts below.` })
    : null;
  const kids = [
    ...(data.sample ? [el('p', { class: 'hint', text: `${q.label} originates ${fmt.format(data.sample.total)} prefixes, too many to read at once: the view is limited to the routes of ${fmt.format(data.sample.used)} of them, the shortest ones. Check a single prefix to see the others.` })] : []),
    ...(q.host ? [hostNote(q.host, routes)] : []),
    el('p', { class: 'src', text: `${fmt.format(routes.length)} routes${q.kind === 'as' ? ` originated by ${q.label}` : ` for ${q.label}`}, seen by the RIPE RIS collectors${ts}${age === null ? '' : ` (${AspaLive.ageText(age)} ago)`}, ${fmt.format(rows.length)} distinct AS path${rows.length === 1 ? '' : 's'}${skipped ? `; ${fmt.format(skipped)} with an AS_SET left out` : ''}.` }),
    ...(notice ? [notice] : []),
    lookingGlassPanel(q, routes, notice),
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
    if (q.kind === 'as' && origin === asNum(q.label)) {
      const own = byCustomer.get('AS' + origin);
      const start = ev ? AspaEvidence.suggest(own ? [...own.providers] : null, ev).list : (own ? own.providers.filter((x) => x !== 'AS0') : []);
      kids.push(whatIfPanel(origin, rows, start));
    }
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

/* ---------- the checks of this browser, and what changed since ---------- */
// For an AS that was looked up before in this browser: what changed since then; then the entry is made again with what is there now.
function recentNote(as, providers, named) {
  if (typeof AspaRecent === 'undefined') return null;
  const list = AspaRecent.store.load();
  const before = AspaRecent.find(list, { kind: 'as', id: as });
  const now = { providers: providers.filter((p) => p !== 'AS0'), named };
  AspaRecent.store.save(AspaRecent.record(list, { kind: 'as', id: as, t: Date.now(), providers: now.providers, named }));
  renderRecent();
  if (!before) return null;
  const d = AspaRecent.diffAs(before, now);
  return el('p', { class: `hint recent-note${d.changed ? ' changed' : ''}` }, `You looked at ${as} ${AspaRecent.ago(before.t)}: `, d.text, '.');
}

// The list under the tools: the AS and the paths checked lately, each with what is different now. It is only in this browser.
function renderRecent() {
  const box = $('recent');
  if (!box || typeof AspaRecent === 'undefined') return;
  const list = AspaRecent.store.load();
  box.hidden = !list.length || !aspas.length;
  if (box.hidden) return;
  const items = list.map((e) => {
    if (e.kind === 'as') {
      const d = AspaRecent.diffAs(e, { providers: (byCustomer.get(e.id) ? byCustomer.get(e.id).providers : []).filter((p) => p !== 'AS0'), named: (byProvider.get(e.id) || []).length });
      return el('li', {}, el('a', { class: 'aslink', href: `#${e.id}`, text: e.id }), ` · ${AspaRecent.ago(e.t)} · `, el('span', { class: d.changed ? 'recent-changed' : 'muted', text: d.changed ? `since then: ${d.text}` : 'nothing has changed' }));
    }
    const parsed = AspaVerify.parsePath(e.id);
    const now = parsed.error ? null : AspaVerify.verify(aspaSets, parsed.path, e.direction).result;
    const d = now ? AspaRecent.diffPath(e, now) : { changed: false, text: '' };
    return el('li', {}, el('a', { href: `#${new URLSearchParams({ path: e.id, from: e.direction })}`, text: `path ${e.id}` }), ` (${e.direction === 'down' ? 'from a provider' : 'from a customer or a peer'}) · ${AspaRecent.ago(e.t)} · `, el('span', { class: d.changed ? 'recent-changed' : 'muted', text: d.changed ? `since then: ${d.text}` : (now ? `still ${now}` : '') }));
  });
  $('recent-list').replaceChildren(...items);
  $('recent-count').textContent = `(${list.length})`;
}

/* ---------- the routing registry (IRR) next to the ASPA ---------- */
// The aut-num of the AS, from the RIPE database and the mirrors that it serves (the registries of the other RIRs and RADB): asked only when the
// button is pressed, from the browser, with the number of the AS. Not every object has a policy: the ones in ARIN, for instance, have only the name.
const IRR_SOURCES = ['RIPE', 'ARIN-GRS', 'APNIC-GRS', 'AFRINIC-GRS', 'LACNIC-GRS', 'JPIRR-GRS', 'RADB-GRS'].map((s) => `source=${s}`).join('&');
let relationsDoc;
async function getRelations() {
  if (relationsDoc !== undefined) return relationsDoc;
  try { relationsDoc = await getJson('/api/v1/relations.json'); } catch { relationsDoc = null; }
  return relationsDoc;
}

async function fetchIrr(n) {
  const r = await fetch(`https://rest.db.ripe.net/search.json?query-string=AS${n}&type-filter=aut-num&flags=no-referenced&${IRR_SOURCES}`, { headers: { Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const objs = ((await r.json()).objects || {}).object || [];
  if (!objs.length) return null;
  const o = objs.find((x) => x.source.id === 'ripe') || objs[0];
  const attrs = o.attributes.attribute.map((a) => ({ name: a.name, value: a.value }));
  return { source: o.source.id.toUpperCase(), attrs, modified: (attrs.find((a) => a.name === 'last-modified') || {}).value };
}

function irrBlock(as) {
  const n = asNum(as), own = byCustomer.get(as);
  const out = el('div', { 'aria-live': 'polite' });
  const status = el('span', { class: 'hint' });
  const btn = el('button', { type: 'button', class: 'linkish', text: 'Compare its IRR object with the ASPA' });
  const chips = (list) => (list.length ? chipList(list.map((x) => 'AS' + x), 40) : el('span', { class: 'muted', text: 'none' }));
  const line = (label, list, note) => el('div', { class: 'irr-line' }, el('strong', { text: label }), ' ', chips(list), note ? el('p', { class: 'hint', text: note }) : null);
  const render = (o, rel) => {
    const roles = AspaIrr.roles(o.attrs, ixpSet.size ? ixpSet : null);
    const aspa = own ? own.providers.map((p) => Number(p.slice(2))) : [];
    const kids = [el('p', { class: 'hint' }, `The aut-num of ${as} in ${o.source}${o.modified ? `, last changed ${o.modified.slice(0, 10)}` : ''}: ${fmt.format(roles.rules)} import and export lines.`)];
    if (!roles.rules) {
      kids.push(el('p', { text: `The object says nothing about the neighbours of ${as}: it has no import or export lines (the registries of some RIRs keep only the name).` }));
      out.replaceChildren(...kids); return;
    }
    const c = AspaIrr.compare(aspa, roles);
    kids.push(line('Transit providers, as the object says', roles.transit));
    if (roles.probable.length) kids.push(line('Probable transit providers', roles.probable, 'The object accepts ANY from these and announces only a set of prefixes to them, which is what the policy of an upstream looks like, but it has no part called transit, upstream or provider to say so. An exchange-point route server would look the same: the exchange-point ASes of CAIDA are left out.'));
    if (roles.ixp.length) kids.push(line('Intermediaries (import-via), in practice route servers of exchange points', roles.ixp));
    kids.push(el('p', { class: 'hint', text: `${fmt.format(roles.customer.length)} customers are declared as well, and ${fmt.format(roles.peer.length)} neighbours with sets of prefixes only (peering, private links or services such as DDoS scrubbing: the object cannot tell them apart)${roles.candidate.length ? `, and ${roles.candidate.length} neighbour${roles.candidate.length === 1 ? ' is' : 's are'} accepted from ANY without saying what ${roles.candidate.length === 1 ? 'it is' : 'they are'}${roles.probable.length ? ' (probable transit providers, above)' : ''}` : ''}.` }));
    if (!c.comparable) {
      kids.push(el('p', { text: 'The object has no part called transit, upstream or provider with a neighbour accepted from ANY, and no neighbour that looks like a provider, so it cannot be compared with the ASPA.' }));
      if (roles.candidate.length) kids.push(line('Accepted from ANY, not said what they are', roles.candidate));
    } else {
      if (!own) kids.push(el('p', { text: `${as} publishes no ASPA. The transit providers above are the ones that it would list.` }));
      else {
        if (c.onlyIrr.length) kids.push(line('In the IRR as transit, not in the ASPA', c.onlyIrr, `The ASPA may miss a provider: routes that reach the collectors through it come out as valleys.${c.onlyIrrProbable.length ? ` ${c.onlyIrrProbable.map((x) => 'AS' + x).join(', ')} ${c.onlyIrrProbable.length === 1 ? 'is' : 'are'} only a probable transit provider in the object.` : ''}`));
        if (c.onlyAspa.length) kids.push(line('In the ASPA, not said to be transit in the IRR', c.onlyAspa, [c.onlyAspaIsPeerOrIxp.length && `${c.onlyAspaIsPeerOrIxp.map((x) => 'AS' + x).join(', ')} ${c.onlyAspaIsPeerOrIxp.length === 1 ? 'is' : 'are'} declared with sets of prefixes only or as an intermediary in the object, which does not make ${c.onlyAspaIsPeerOrIxp.length === 1 ? 'it' : 'them'} a peer for sure: it can be a private link or a service.`, c.onlyAspaIsCustomer.length && `${c.onlyAspaIsCustomer.map((x) => 'AS' + x).join(', ')} ${c.onlyAspaIsCustomer.length === 1 ? 'is' : 'are'} customers in the object.`, 'Either the object is not up to date or the ASPA lists more than it should.'].filter(Boolean).join(' ')));
        if (c.both.length) kids.push(line('In both', c.both));
        if (!c.onlyIrr.length && !c.onlyAspa.length) kids.push(el('p', { class: 'verdict v-valid' }, el('strong', { text: 'Consistent' }), ' The transit providers of the IRR object and the providers of the ASPA are the same.'));
      }
    }
    // the three sources side by side for the providers: the IRR object, what CAIDA infers from the routes, and the ASPA
    const caida = rel && rel.providers ? (rel.providers[n] || []) : null;
    const tw = AspaIrr.threeWay(aspa, roles, caida);
    if (tw.rows.length) {
      const yes = (v) => (v === null ? 'no data' : v ? 'provider' : 'no');
      const rowOf = (x) => el('tr', {}, el('th', { scope: 'row' }, asChip('AS' + x.as)), el('td', { text: x.irr === 'transit' ? 'transit provider' : x.irr === 'probable transit' ? 'probably a transit provider' : (x.irr || 'not named') }), el('td', { class: 'nowrap', text: yes(x.caida) }), el('td', { class: 'nowrap', text: yes(x.aspa) }), el('td', { text: x.reading }));
      const head = el('thead', {}, el('tr', {}, ['AS', 'IRR object', 'CAIDA', 'ASPA', 'Reading'].map((t) => el('th', { scope: 'col', text: t }))));
      const table = el('table', { class: 'checks live' }, el('caption', { class: 'sr-only', text: 'Each AS that the IRR object, CAIDA or the ASPA calls a provider, and what each source says' }), head, el('tbody', {}, tw.rows.map(rowOf)));
      kids.push(el('h5', { class: 'irr-h', text: 'The three sources side by side' }),
        el('section', { class: 'table-wrap card', tabindex: '0', 'aria-label': 'The providers of the AS according to the IRR object, CAIDA and the ASPA' }, table),
        el('p', { class: 'hint', text: `CAIDA: ${rel ? rel.source : 'its file is not available'}, inferred from the routes, not declared by anybody.` }));
      if (tw.aspaMissesWhatTheOthersSay.length) kids.push(el('p', { class: 'verdict v-unknown' }, el('strong', { text: 'The ASPA is the odd one out' }), ` for ${tw.aspaMissesWhatTheOthersSay.map((x) => 'AS' + x).join(', ')}: the IRR object and CAIDA both call ${tw.aspaMissesWhatTheOthersSay.length === 1 ? 'it a provider' : 'them providers'} and the ASPA does not list ${tw.aspaMissesWhatTheOthersSay.length === 1 ? 'it' : 'them'}.`));
    }
    kids.push(el('p', { class: 'hint', text: 'An IRR object says what its owner declared, when they last edited it; it is not a contract and it can be out of date; CAIDA infers from the routes. Where they do not agree with the ASPA, ask the owner which one is right.' }));
    out.replaceChildren(...kids);
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true; status.replaceChildren(el('span', { class: 'busy', text: ' Asking the RIPE database' }));
    try {
      const [o, rel] = await Promise.all([fetchIrr(n), getRelations()]);
      status.textContent = '';
      if (!o) out.replaceChildren(el('p', { text: `No aut-num object of ${as} was found in the RIPE database or in the registries that it mirrors.` })); else render(o, rel);
    } catch (err) { status.textContent = ` Could not read the registry (${err.message}).`; btn.disabled = false; return; }
    btn.hidden = true;
  });
  return el('div', { class: 'res-hist', id: 'as-irr' }, el('h4', { text: 'Routing registry (IRR)' }),
    el('p', { class: 'hint', text: `What the aut-num of ${as} declares about its providers, next to its ASPA. Pressing the button asks the RIPE database (rest.db.ripe.net), from your browser, for the object of this AS number; nothing is asked before.` }),
    el('p', {}, btn, status), out);
}

function renderLookup(as) {
  const out = $('result');
  if (!as) { out.replaceChildren(); lookupAs = null; return; }
  const n = asNum(as);
  const own = byCustomer.get(as);
  const customers = byProvider.get(as) || [];

  const head = el('div', { class: 'res-head' },
    el('h3', { text: as }),
    el('span', { class: 'links' },
      el('a', { href: `https://bgpthingy.xindi.eu/asn/${n}`, rel: 'noopener', target: '_blank' }, 'bgpthingy', el('span', { class: 'sr-only', text: ' (opens in a new tab)' })), ' · ',
      el('a', { href: `https://stat.ripe.net/app/launchpad/AS${n}`, rel: 'noopener', target: '_blank' }, 'RIPEstat', el('span', { class: 'sr-only', text: ' (opens in a new tab)' }))));

  const left = el('div', {}, el('h4', { text: 'Its own ASPA' }));
  if (own) {
    const isZero = own.providers.length === 1 && own.providers[0] === 'AS0';
    left.append(el('p', {
      text: isZero
        ? `${as} declares that it has no transit providers (AS0), as networks at the top of the hierarchy do. It can still have peers.`
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

  const seen = recentNote(as, own ? own.providers : [], customers.length);
  out.replaceChildren(head, ...(seen ? [seen] : []), el('div', { class: 'res-grid' }, left, right), el('div', { class: 'res-hist', id: 'as-history' }), el('div', { class: 'res-hist' }, el('h4', { text: 'Compare' }), compareBlock(as)), el('div', { class: 'res-hist', id: 'as-quality' }), irrBlock(as), graphHolder(as), shareBlock(as));
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
  const leaksLabel = el('label', { class: 'chk', for: 'nf-leaks' }, leaks, ` Also tell me, once a day, about new places of valley that involve ${as}`);
  // an alert when the AS is the origin of that many invalid announcements in ten minutes (the stream of RIPE RIS Live, watched by the server)
  const inv = el('input', { type: 'checkbox', id: 'nf-invalid' });
  const invAt = el('select', { id: 'nf-invalid-at', 'aria-label': 'Threshold of invalid announcements in ten minutes' }, ...[5, 10, 50, 100, 500, 1000].map((n) => el('option', { value: String(n), text: `${n} or more` })));
  invAt.value = '10';
  const invLabel = el('label', { class: 'chk', for: 'nf-invalid' }, inv, ` Also tell me when ${as} is the origin of `);
  const invRow = el('p', { class: 'chk-row' }, invLabel, invAt, ' invalid announcements in ten minutes (at most once every six hours)');
  const form = el('form', { class: 'notify', autocomplete: 'off' }, kind, target, trap, btn, leaksLabel, invRow);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    msg.replaceChildren(el('span', { class: 'busy', text: 'Sending' }));
    try {
      const r = await fetch('/api/v1/subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind.value, target: target.value.trim(), asn: as, leaks: leaks.checked, ...(inv.checked ? { invalid: Number(invAt.value) } : {}), website: trap.value }),
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
    el('p', { class: 'hint' }, `A message when the ASPA of ${as} changes, or when another ASPA adds or drops ${as} as a provider; if you tick the first box, also when a new place of valley involves it; the second one tells you when the routes that the RIPE RIS collectors see show many invalid announcements with this AS as the origin. An e-mail address has to be confirmed through a link; a webhook has to repeat a challenge. Nothing else is kept or used. `, el('a', { href: 'https://www.unipd.it/en/privacy', target: '_blank', rel: 'noopener' }, 'Privacy information', el('span', { class: 'sr-only', text: ' (opens in a new tab)' })), '.'),
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
    dataStatus = status;
    renderOverview(status);
    addCoverageTile();
    document.body.classList.remove('loading');
    await loadVisibility();
    computeQuality();
    renderQuality();
    try { const c = await getEvidenceCtx(); if (c) ixpSet = c.ixp; } catch { /* no list: no note */ }
    renderRecent();
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
  const clearRecent = $('recent-clear');
  if (clearRecent) clearRecent.addEventListener('click', () => { AspaRecent.store.clear(); renderRecent(); });
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
  $('bulkform').addEventListener('submit', (e) => { e.preventDefault(); runBulk(); });
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
