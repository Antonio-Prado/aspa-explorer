// Route leaks (valleys) in the routes of the RIPE RIS collectors, today: every route of three collectors is
// checked with the downstream ASPA verification, and the paths that the ASPAs prove to contain a valley are
// grouped by the place of the valley. Written as one JSON file (served as /api/v1/leaks.json).
//
//   node scripts/build-leaks.mjs OUT_FILE [CACHE_DIR] [--day=YYYYMMDD]
//
// With --day the table dumps of that day (the ones of 00:00 UTC) and the ASPAs as they were that day (replayed from the
// history of changes) are used, and only the by-AS file of that day and the line of the history are written: this is how
// the history of the leaks is filled in backwards.
//
// Inputs (environment, with defaults for the production host):
//   ASPA_DATA        URL or file of Routinator's jsonext     http://127.0.0.1:8080/data/aspas.json
//   LEAKS_COLLECTORS comma separated collectors              ten of RIPE RIS and eight of RouteViews (COLLECTORS below)
//   LEAKS_EVENTS     URL or file of the history of changes   the events.json of the history branch (only with --day)
//   LEAKS_ADOPTION   file with the Tier-1 clique and the IXP ASes (adoption.json), next to OUT_FILE
//
// Next to OUT_FILE it also writes leaks-by-as.json (the places of valley that involve each AS, for the page of an AS
// and for the notifier), leaks-history.json (one line of totals a day, for the chart) and leaks-days/YYYYMMDD.json
// (the by-AS file of each of the last 60 days, to compare two days).
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rename, stat, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import net from 'node:net';
import { readRib, openDump } from './mrt.mjs';

const { verify } = createRequire(import.meta.url)('../site/verify.js');
if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
// RIPE RIS: Amsterdam, London, Amsterdam, Geneva, Milan, New York, Frankfurt, Sao Paulo, Johannesburg, Singapore.
// RouteViews (University of Oregon, other peers than RIS): Oregon, route-views3 and 4, Singapore, Johannesburg, Sao Paulo, Sydney, Equinix.
export const COLLECTORS = 'rrc00,rrc01,rrc03,rrc04,rrc10,rrc11,rrc12,rrc15,rrc19,rrc23,route-views2,route-views3,route-views4,route-views.sg,route-views.napafrica,route-views2.saopaulo,route-views.sydney,route-views.eqix';
export const isRis = (collector) => /^rrc\d+$/.test(collector);
// The table dump of a collector: the latest one, or the one of 00:00 UTC of a day (YYYYMMDD).
// For RouteViews the latest one has to be found in the listing of the month (pickLatestRib).
const RV = 'https://archive.routeviews.org';
const rvBase = (collector) => (collector === 'route-views2' ? 'bgpdata' : `${collector}/bgpdata`);
export const rvListing = (collector, month) => `${RV}/${rvBase(collector)}/${month}/RIBS/`;
export const dumpUrl = (collector, day) => {
  if (isRis(collector)) {
    return day ? `https://data.ris.ripe.net/${collector}/${day.slice(0, 4)}.${day.slice(4, 6)}/bview.${day}.0000.gz` : `https://data.ris.ripe.net/${collector}/latest-bview.gz`;
  }
  if (!day) throw new Error('the latest RouteViews dump has to be looked up: use latestDumpUrl');
  return `${RV}/${rvBase(collector)}/${day.slice(0, 4)}.${day.slice(4, 6)}/RIBS/rib.${day}.0000.bz2`;
};
// The newest rib file named in the listing of a month (an HTML page), or null.
export const pickLatestRib = (html) => {
  const names = [...String(html).matchAll(/rib\.(\d{8})\.(\d{4})\.bz2/g)].map((m) => m[0]);
  return names.length ? names.sort().at(-1) : null;
};
export async function latestDumpUrl(collector, now = new Date()) {
  if (isRis(collector)) return dumpUrl(collector);
  for (let back = 0; back < 2; back++) {            // this month, and the last one when this one has just begun
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const month = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const r = await fetch(rvListing(collector, month), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    const name = r.ok ? pickLatestRib(await r.text()) : null;
    if (name) return `${rvListing(collector, month)}${name}`;
  }
  throw new Error(`no RIB file found for ${collector}`);
}
const EVENTS = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/events.json/raw?ref=history';
const History = createRequire(import.meta.url)('../site/history.js');
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

// What the CAIDA relationships say about two ASes: relOf(c, n) is 'provider' when n is a provider of c,
// 'customer' when it is a customer, 'peer' or 'unknown'. Built from the as-rel2 file, one line per link:
// "provider|customer|-1|..." and "peer|peer|0|...".
export function relations(text) {
  const customers = new Map(), peers = new Map();
  const add = (m, a, b) => { const s = m.get(a); if (s) s.add(b); else m.set(a, new Set([b])); };
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('|');
    const a = Number(f[0]), c = Number(f[1]);
    if (f[2] === '-1') add(customers, a, c);
    else if (f[2] === '0') { add(peers, a, c); add(peers, c, a); }
  }
  return (c, n) => {
    if (customers.has(n) && customers.get(n).has(c)) return 'provider';
    if (customers.has(c) && customers.get(c).has(n)) return 'customer';
    if (peers.has(c) && peers.get(c).has(n)) return 'peer';
    return 'unknown';
  };
}

// The first AS after the ramp that climbs from the origin has a relation with the AS before it: a provider
// of it means that the ASPA of that AS seems to miss a provider (a gap); a peer or a customer means that the AS
// passed on up a route that it should not have (a leak); no information is left unclear.
const KIND = { provider: 'gap', peer: 'leak', customer: 'leak', unknown: 'unclear' };

// ASPA lookup with numbers: Map customer -> Set of providers
export function aspaMap(aspas) {
  const m = new Map();
  for (const a of aspas) {
    const c = Number(a.customer.slice(2));
    const s = m.get(c) || new Set();
    for (const p of a.providers) s.add(Number(p.slice(2)));
    m.set(c, s);
  }
  return m;
}

export class Leaks {
  constructor(aspas, ixp = new Set(), relOf = () => 'unknown') {
    this.aspas = aspas; this.ixp = ixp; this.relOf = relOf;
    this.total = { routes: 0, valid: 0, unknown: 0, invalid: 0 };
    this.groups = new Map();
    this.feederSet = new Set();                                       // the networks that feed the collectors, whichever collector
  }

  // path: AS numbers, collector side first; feeder: the AS of the peer; collector: its name
  add(feeder, collector, rawPath) {
    const p = [];
    for (let i = rawPath.length - 1; i >= 0; i--) {                 // origin first, prepending and IXP ASes dropped
      const a = rawPath[i];
      if (this.ixp.has(a)) continue;
      if (p[p.length - 1] !== a) p.push(a);
    }
    this.total.routes++;
    this.feederSet.add(feeder);
    if (p.length < 2) { this.total.valid++; return; }
    // cheap filter: a valley needs a hop that an ASPA attests as not a provider
    let suspect = false;
    for (let i = 1; i < p.length && !suspect; i++) {
      const x = this.aspas.get(p[i - 1]), y = this.aspas.get(p[i]);
      if ((x && !x.has(p[i])) || (y && !y.has(p[i - 1]))) suspect = true;
    }
    if (!suspect) { this.total.valid++; return; }
    const v = verify(this.aspas, p, 'down');
    if (v.result === 'Valid') { this.total.valid++; return; }
    if (v.result === 'Unknown') { this.total.unknown++; return; }
    this.total.invalid++;
    const from = v.path[v.maxUp - 1], to = v.path[v.N - v.maxDown];
    const between = v.path.slice(v.maxUp, v.N - v.maxDown);
    const key = `${from}|${between[0]}|${to}`;           // the first AS after the ramp decides the kind: it is part of the place
    let g = this.groups.get(key);
    if (!g) {
      const caida = this.relOf(from, between[0]);
      g = { from, to, between, caida, kind: KIND[caida], routes: 0, feeders: new Set(), origins: new Set(), example: p.slice().reverse() };
      this.groups.set(key, g);
    }
    g.routes++; g.feeders.add(feeder); g.origins.add(p[0]);
  }

  result(limit = 40) {
    const list = [...this.groups.values()].map((g) => ({
      from: 'AS' + g.from, to: 'AS' + g.to, between: g.between.map((a) => 'AS' + a), caida: g.caida, kind: g.kind,
      routes: g.routes, feeders: g.feeders.size, origins: g.origins.size,
      example: g.example.map((a) => 'AS' + a),
    })).sort((a, b) => b.feeders - a.feeders || b.routes - a.routes);
    const sum = (rows, keyOf, extra) => {
      const m = new Map();
      for (const g of rows) {
        const k = keyOf(g);
        const e = m.get(k) || { ...extra(g), places: 0, routes: 0, feeders: 0, origins: 0 };
        e.places++; e.routes += g.routes; e.feeders = Math.max(e.feeders, g.feeders); e.origins += g.origins;
        m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.feeders - a.feeders || b.routes - a.routes).slice(0, 30);
    };
    this.list = list;
    return {
      total: { ...this.total, feeders: this.feederSet.size }, places: list.length,
      kinds: { gap: list.filter((g) => g.kind === 'gap').length, leak: list.filter((g) => g.kind === 'leak').length, unclear: list.filter((g) => g.kind === 'unclear').length },
      // the most seen places of each kind, so that no kind crowds the others out
      groups: ['leak', 'gap', 'unclear'].flatMap((k) => list.filter((g) => g.kind === k).slice(0, k === 'unclear' ? 20 : limit)).sort((a, b) => b.feeders - a.feeders || b.routes - a.routes),
      // the ASes that passed on up what they should not have, and the ASPAs that seem to miss a provider
      leakers: sum(list.filter((g) => g.kind === 'leak'), (g) => g.between[0], (g) => ({ asn: g.between[0] })),
      gaps: sum(list.filter((g) => g.kind === 'gap'), (g) => `${g.from}|${g.between[0]}`, (g) => ({ customer: g.from, missing: g.between[0] })),
    };
  }
}

export const MIN_FEEDERS = 3;     // places seen by fewer feeders are left out of the by-AS file: a feeder can leak by itself
const PER_AS = 10;
const KEEP_DAYS = 60;

// The places of valley that involve each AS, from the full list of places of Leaks.result(): an AS inside the valley
// ("valley": it passed up what it should not have, or a path was forged through it) and, for a gap, the customer whose ASPA
// seems to miss a provider ("gap"). At most PER_AS places for an AS, the most seen first.
export function byAs(list, minFeeders = MIN_FEEDERS, perAs = PER_AS) {
  const out = {};
  const put = (asn, role, g) => {
    const l = out[asn] || (out[asn] = []);
    l.push({ role, kind: g.kind, from: g.from, to: g.to, between: g.between, feeders: g.feeders, routes: g.routes });
  };
  for (const g of list) {
    if (g.feeders < minFeeders || g.kind === 'unclear') continue;
    for (const a of new Set(g.between)) put(a, 'valley', g);
    if (g.kind === 'gap') put(g.from, 'gap', g);
  }
  for (const asn of Object.keys(out)) out[asn] = out[asn].sort((a, b) => b.feeders - a.feeders || b.routes - a.routes).slice(0, perAs);
  return out;
}

// The history file with the totals of the day added (a day already there is replaced).
export function addHistory(rows, date, doc) {
  const t = doc.total;
  const row = { date, routes: t.routes, invalid: t.invalid, unknown: t.unknown, feeders: t.feeders, places: doc.places, leak: doc.kinds.leak, gap: doc.kinds.gap, unclear: doc.kinds.unclear };
  return rows.filter((r) => r.date !== date).concat(row).sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function fresh(path, maxAgeMs) {
  try { return Date.now() - (await stat(path)).mtimeMs < maxAgeMs; } catch { return false; }
}

async function download(url, path) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const tmp = `${path}.tmp`;
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
  await rename(tmp, path);
}

// The newest CAIDA relationships file in the cache (the adoption job keeps it there), read with bunzip2.
async function caidaRelations(cache) {
  const { readdir } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const files = (await readdir(cache)).filter((f) => /^as-rel2-\d{8}\.bz2$/.test(f)).sort();
  if (!files.length) return { relOf: () => 'unknown', source: null };
  const text = (await promisify(execFile)('bunzip2', ['-c', join(cache, files[files.length - 1])], { maxBuffer: 1 << 30 })).stdout;
  return { relOf: relations(text), source: `CAIDA AS Relationships, serial-2, ${files[files.length - 1].slice(8, 16)}` };
}

async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const [outFile, cacheArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!outFile) { console.error('usage: build-leaks.mjs OUT_FILE [CACHE_DIR] [--day=YYYYMMDD]'); process.exit(2); }
  const dayFlag = (flags.find((f) => f.startsWith('--day=')) || '').slice(6);
  if (dayFlag && !/^\d{8}$/.test(dayFlag)) { console.error('--day takes YYYYMMDD'); process.exit(2); }
  const dayIso = dayFlag && `${dayFlag.slice(0, 4)}-${dayFlag.slice(4, 6)}-${dayFlag.slice(6)}`;
  const cache = cacheArg || join(outFile, '..', 'cache');
  await mkdir(cache, { recursive: true });
  const readJson = async (src) => (/^https?:/.test(src)
    ? await (await fetch(src, { headers: { 'User-Agent': UA } })).json() : JSON.parse(await readFile(src, 'utf8')));
  let aspas;
  if (dayIso) {
    const events = await readJson(process.env.LEAKS_EVENTS || EVENTS);
    aspas = [...History.replay(events, dayIso)].map(([customer, providers]) => ({ customer, providers }));
  } else {
    aspas = (await readJson(process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json')).aspas;
  }
  if (!Array.isArray(aspas) || !aspas.length) throw new Error('the ASPA data is empty: not publishing');
  let ixp = new Set();
  try { ixp = new Set(JSON.parse(await readFile(process.env.LEAKS_ADOPTION || join(outFile, '..', 'adoption.json'), 'utf8')).ixp || []); } catch { /* no list */ }
  const collectors = (process.env.LEAKS_COLLECTORS || COLLECTORS).split(',').map((s) => s.trim()).filter(Boolean);
  const rel = await caidaRelations(cache);
  const leaks = new Leaks(aspaMap(aspas), ixp, rel.relOf);
  const used = [];
  for (const c of collectors) {
    const ext = isRis(c) ? 'gz' : 'bz2';
    const file = join(cache, dayIso ? `dump-${c}-${dayFlag}.${ext}` : `dump-${c}.${ext}`);
    if (dayIso || !(await fresh(file, 4 * 3600e3))) await download(dayIso ? dumpUrl(c, dayFlag) : await latestDumpUrl(c), file);
    const t0 = Date.now();
    const stats = await readRib(openDump(file), (peerAs, path, n) => leaks.add(peerAs, c, Array.from(path.subarray(0, n))));
    used.push({ collector: c, routes: stats.entries, built: new Date((await stat(file)).mtimeMs).toISOString().replace(/\.\d+Z$/, 'Z') });
    console.error(`${c}: ${stats.entries} routes in ${Math.round((Date.now() - t0) / 1000)} s`);
    if (dayIso) await unlink(file);                  // a day of the past is read once
  }
  const generated = dayIso ? `${dayIso}T00:00:00Z` : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const doc = { generated, aspas: aspas.length, collectors: used, relationships: rel.source, ...leaks.result() };
  const write = async (file, value) => { const tmp = `${file}.tmp`; await writeFile(tmp, JSON.stringify(value) + '\n'); await rename(tmp, file); };
  const dir = join(outFile, '..'), day = generated.slice(0, 10);
  const perAs = { generated, min_feeders: MIN_FEEDERS, as: byAs(leaks.list) };
  if (!dayIso) {
    await write(outFile, doc);
    await write(join(dir, 'leaks-by-as.json'), perAs);
  }
  let rows = [];
  try { rows = JSON.parse(await readFile(join(dir, 'leaks-history.json'), 'utf8')); } catch { /* the first run */ }
  await write(join(dir, 'leaks-history.json'), addHistory(rows, day, doc));
  await mkdir(join(dir, 'leaks-days'), { recursive: true });
  await write(join(dir, 'leaks-days', `${day.replaceAll('-', '')}.json`), perAs);
  for (const f of (await readdir(join(dir, 'leaks-days'))).filter((x) => /^\d{8}\.json$/.test(x)).sort().slice(0, -KEEP_DAYS)) await unlink(join(dir, 'leaks-days', f));
  console.log(`${doc.generated}: ${doc.total.routes} routes, ${doc.total.invalid} invalid, ${doc.places} places of valley`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
