// Valleys (possible route leaks, or gaps in ASPAs) in the routes of the RIPE RIS and RouteViews collectors, today: every route of 30 collectors is
// checked with the downstream ASPA verification, and the paths that the ASPAs prove to contain a valley are
// grouped by the place of the valley. Written as one JSON file (served as /api/v1/leaks.json).
//
//   node scripts/build-leaks.mjs OUT_FILE [CACHE_DIR] [--day=YYYYMMDD]
//
// With --day the table dumps of that day (the ones of 00:00 UTC) and the ASPAs as they were at its start (the last state
// of the day before, replayed from the history of changes) are used, and only the by-AS file of that day, the line of the
// history and the whole document of the day (leaks-full/YYYYMMDD.json, for the study of a period) are written: this is
// how the history of the leaks is filled in backwards.
//
// Inputs (environment, with defaults for the production host):
//   ASPA_DATA        URL or file of Routinator's jsonext     http://127.0.0.1:8080/data/aspas.json
//   LEAKS_COLLECTORS comma separated collectors              sixteen of RIPE RIS and fourteen of RouteViews (COLLECTORS below)
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
// RIPE RIS (16): Amsterdam, London, Amsterdam, Geneva, Vienna, Tokyo, Stockholm, Milan, New York, Frankfurt, Palo Alto, Sao Paulo, Miami, Johannesburg, Paris, Singapore.
// RouteViews (14; University of Oregon, other peers than RIS): Oregon, route-views3 and 4, London, Palo Alto, Tokyo, New York, Perth, Atlanta, Singapore, Johannesburg, Sao Paulo, Sydney, Equinix.
export const COLLECTORS = 'rrc00,rrc01,rrc03,rrc04,rrc05,rrc06,rrc07,rrc10,rrc11,rrc12,rrc14,rrc15,rrc16,rrc19,rrc21,rrc23,route-views2,route-views3,route-views4,route-views.linx,route-views.isc,route-views.wide,route-views.ny,route-views.perth,route-views.telxatl,route-views.sg,route-views.napafrica,route-views2.saopaulo,route-views.sydney,route-views.eqix';
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
// The dumps of 00:00 UTC of a day to try in turn: for RouteViews also the one named after the minute before
// (rib.YYYYMMDD.2359 of the day before), as route-views.eqix wrote it on 6 September 2026.
export const previousDay = (day) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6) - 1)).toISOString().slice(0, 10).replaceAll('-', '');
export const dayDumpUrls = (collector, day) => {
  if (isRis(collector)) return [dumpUrl(collector, day)];
  const p = previousDay(day);
  return [dumpUrl(collector, day), `${RV}/${rvBase(collector)}/${p.slice(0, 4)}.${p.slice(4, 6)}/RIBS/rib.${p}.2359.bz2`];
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
export const EVENTS = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/events.json/raw?ref=history';
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

// The verdict of the downstream procedure for a path (origin first, no prepending): 0 valid, 1 unknown, 2 invalid. The same
// as verify(aspas, path, 'down').result, without building the lists of the hops, for the millions of routes of a day.
export function classify(aspas, p) {
  const N = p.length;
  if (N <= 1) return 0;
  const sets = new Array(N);
  for (let i = 0; i < N; i++) sets[i] = aspas.get(p[i]);
  let maxUp = N, minUp = N;
  for (let i = 1; i <= N - 1; i++) {                               // hop(A(i), A(i+1)): the ASPA of p[i-1] lists p[i]?
    const s = sets[i - 1];
    if (s && s.has(p[i])) continue;
    if (minUp === N) minUp = i;
    if (s) { maxUp = i; break; }
  }
  let maxDown = N, minDown = N;
  for (let j = N; j >= 2; j--) {                                   // hop(A(j), A(j-1)): the ASPA of p[j-1] lists p[j-2]?
    const s = sets[j - 1];
    if (s && s.has(p[j - 2])) continue;
    if (minDown === N) minDown = N - j + 1;
    if (s) { maxDown = N - j + 1; break; }
  }
  if (maxUp + maxDown < N) return 2;
  return minUp + minDown < N ? 1 : 0;
}

// The address space a route covers: addresses for IPv4 (/32 equivalents), /48s for IPv6.
export const spanOf = (plen, v6) => Math.pow(2, (v6 ? 48 : 32) - plen);
// The shortest prefixes that count for the address space: nothing is announced below a /8 in IPv4 or a /16 in IPv6 but default routes and tests.
export const MIN_V4 = 8, MIN_V6 = 16;
const VERDICT = ['valid', 'unknown', 'invalid'];
const HOP_BUCKETS = 9;                                             // paths of 1 to 8 ASes, and 9 or more

export class Leaks {
  constructor(aspas, ixp = new Set(), relOf = () => 'unknown') {
    this.aspas = aspas; this.ixp = ixp; this.relOf = relOf;
    this.total = { routes: 0, valid: 0, unknown: 0, invalid: 0 };
    this.groups = new Map();
    this.feederSet = new Set();                                       // the networks that feed the collectors, whichever collector
    this.byCollector = new Map();                                     // collector -> {routes, invalid, feeders}
    this.lastCollector = null; this.cur = null;
    // by address family: the routes by verdict, the address span by verdict, the origins, the length of the paths; and by length of path
    const fam = () => ({ routes: [0, 0, 0], span: [0, 0, 0], origins: new Set(), lenSum: 0, lenSpan: 0, spanSum: 0, n: 0, short: 0, byLen: Array.from({ length: HOP_BUCKETS }, () => ({ routes: [0, 0, 0], span: [0, 0, 0] })) });
    this.fam = { v4: fam(), v6: fam() };
  }

  // path: AS numbers, collector side first; feeder: the AS of the peer; collector: its name
  add(feeder, collector, rawPath, plen, v6) {
    const p = [];
    for (let i = rawPath.length - 1; i >= 0; i--) {                 // origin first, prepending and IXP ASes dropped
      const a = rawPath[i];
      if (this.ixp.has(a)) continue;
      if (p[p.length - 1] !== a) p.push(a);
    }
    this.total.routes++;
    this.feederSet.add(feeder);
    if (collector !== this.lastCollector) {
      this.lastCollector = collector;
      this.cur = this.byCollector.get(collector) || { routes: 0, invalid: 0, feeders: new Set() };
      this.byCollector.set(collector, this.cur);
    }
    this.cur.routes++; this.cur.feeders.add(feeder);
    const k = classify(this.aspas, p);
    this.total[VERDICT[k]]++;
    if (plen !== undefined) {
      const f = this.fam[v6 ? 'v6' : 'v4'], b = f.byLen[Math.min(Math.max(p.length, 1), HOP_BUCKETS) - 1];
      f.routes[k]++; f.origins.add(p[0]); f.lenSum += p.length; f.n++; b.routes[k]++;
      if (plen >= (v6 ? MIN_V6 : MIN_V4)) {               // a default route or another prefix that short would weigh more than the rest of the table together
        const span = spanOf(plen, v6);
        f.span[k] += span; f.lenSpan += p.length * span; f.spanSum += span; b.span[k] += span;
      } else f.short++;
    }
    if (k !== 2) return;
    const v = verify(this.aspas, p, 'down');
    this.cur.invalid++;
    const from = v.path[v.maxUp - 1], to = v.path[v.N - v.maxDown];
    const between = v.path.slice(v.maxUp, v.N - v.maxDown);
    const key = `${from}|${between[0]}|${to}`;           // the first AS after the ramp decides the kind: it is part of the place
    let g = this.groups.get(key);
    if (!g) {
      const caida = this.relOf(from, between[0]);
      g = { from, to, between, caida, kind: KIND[caida], routes: 0, feeders: new Set(), origins: new Set(), sources: new Set(), example: p.slice().reverse() };
      this.groups.set(key, g);
    }
    g.routes++; g.feeders.add(feeder); g.origins.add(p[0]); g.sources.add(collector);
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
    // each collector: how much it reads, how many places of valley it sees and how many only it sees
    const per = {};
    for (const [c, e] of this.byCollector) per[c] = { source: isRis(c) ? 'RIS' : 'RouteViews', routes: e.routes, invalid: e.invalid, feeders: e.feeders.size, places: 0, only: 0 };
    // the same places, seen by RIS, by RouteViews or by both (all of them, and the ones seen by at least MIN_FEEDERS feeders)
    const blank = () => ({ both: 0, ris: 0, rv: 0 });
    const cmp = { all: { ...blank(), kinds: { leak: blank(), gap: blank(), unclear: blank() } }, strong: { ...blank(), kinds: { leak: blank(), gap: blank(), unclear: blank() } } };
    const risFeeders = new Set(), rvFeeders = new Set();
    for (const [c, e] of this.byCollector) for (const f of e.feeders) (isRis(c) ? risFeeders : rvFeeders).add(f);
    for (const g of this.groups.values()) {
      let ris = false, rv = false;
      for (const c of g.sources) { per[c].places++; if (isRis(c)) ris = true; else rv = true; }
      if (g.sources.size === 1) per[[...g.sources][0]].only++;
      const k = ris && rv ? 'both' : ris ? 'ris' : 'rv';
      for (const [name, on] of [['all', true], ['strong', g.feeders.size >= MIN_FEEDERS]]) {
        if (!on) continue;
        cmp[name][k]++; cmp[name].kinds[g.kind][k]++;
      }
    }
    cmp.feeders = { ris: risFeeders.size, rv: rvFeeders.size, both: [...risFeeders].filter((f) => rvFeeders.has(f)).length };
    const famDoc = (f, unit) => ({
      unit, routes: f.n, short_prefixes: f.short, valid: f.routes[0], unknown: f.routes[1], invalid: f.routes[2], origins: f.origins.size,
      span: { valid: Math.round(f.span[0]), unknown: Math.round(f.span[1]), invalid: Math.round(f.span[2]) },
      avg_path: f.n ? Math.round((f.lenSum / f.n) * 1000) / 1000 : 0, avg_path_weighted: f.spanSum ? Math.round((f.lenSpan / f.spanSum) * 1000) / 1000 : 0,
      by_length: f.byLen.map((b, i) => ({ length: i + 1, routes: b.routes.reduce((x, y) => x + y, 0), valid: b.routes[0], unknown: b.routes[1], invalid: b.routes[2], span_valid: Math.round(b.span[0]), span_unknown: Math.round(b.span[1]), span_invalid: Math.round(b.span[2]) })),
    });
    return {
      families: { v4: famDoc(this.fam.v4, 'addresses'), v6: famDoc(this.fam.v6, '/48s') },
      per_collector: per, comparison: cmp,
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
  if (doc.families) {                                  // the share of the address space whose routes are valid, by family
    const share = (f) => { const t = f.span.valid + f.span.unknown + f.span.invalid; return t ? Math.round((f.span.valid / t) * 10000) / 100 : 0; };
    row.v4_valid_span = share(doc.families.v4); row.v6_valid_span = share(doc.families.v6);
  }
  return rows.filter((r) => r.date !== date).concat(row).sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function fresh(path, maxAgeMs) {
  try { return Date.now() - (await stat(path)).mtimeMs < maxAgeMs; } catch { return false; }
}

// Runs fn again, after a pause that grows with the attempt, when it fails: the archives of RouteViews and RIS now and
// then cut a long download ("terminated") and one cut must not lose the run of the day. The last error is thrown.
export async function withRetry(fn, tries = 4, pauseMs = 5000, log = (m) => console.error(m)) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      if (i >= tries) throw err;
      log(`attempt ${i} failed (${err.message}), trying again`);
      await new Promise((r) => setTimeout(r, pauseMs * i));
    }
  }
}

async function downloadDay(collector, day, path) {
  const urls = dayDumpUrls(collector, day);
  for (const [i, url] of urls.entries()) {
    try { return await download(url, path); } catch (err) {
      if (i === urls.length - 1 || !/HTTP 404/.test(err.message)) throw err;
      console.error(`${url}: not there, trying ${urls[i + 1]}`);
    }
  }
}

async function download(url, path) {
  const tmp = `${path}.tmp`;
  await withRetry(async () => {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
  });
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
    aspas = [...History.replayBefore(events, dayIso)].map(([customer, providers]) => ({ customer, providers }));
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
    if (dayIso || !(await fresh(file, 4 * 3600e3))) await (dayIso ? downloadDay(c, dayFlag, file) : download(await withRetry(() => latestDumpUrl(c)), file));
    const t0 = Date.now();
    const stats = await readRib(openDump(file), (peerAs, path, n, plen, v6) => leaks.add(peerAs, c, Array.from(path.subarray(0, n)), plen, v6));
    used.push({ collector: c, routes: stats.entries, built: new Date((await stat(file)).mtimeMs).toISOString().replace(/\.\d+Z$/, 'Z') });
    console.error(`${c}: ${stats.entries} routes in ${Math.round((Date.now() - t0) / 1000)} s`);
    if (dayIso) await unlink(file);                  // a day of the past is read once
  }
  const generated = dayIso ? `${dayIso}T00:00:00Z` : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const res = leaks.result();
  for (const u of used) Object.assign(u, res.per_collector[u.collector]);
  delete res.per_collector;
  const doc = { generated, aspas: aspas.length, collectors: used, relationships: rel.source, ...res };
  const write = async (file, value) => { const tmp = `${file}.tmp`; await writeFile(tmp, JSON.stringify(value) + '\n'); await rename(tmp, file); };
  const dir = join(outFile, '..'), day = generated.slice(0, 10);
  const perAs = { generated, min_feeders: MIN_FEEDERS, as: byAs(leaks.list) };
  if (!dayIso) {
    await write(outFile, doc);
    await write(join(dir, 'leaks-by-as.json'), perAs);
  }
  if (dayIso) {
    await mkdir(join(dir, 'leaks-full'), { recursive: true });
    await write(join(dir, 'leaks-full', `${day.replaceAll('-', '')}.json`), doc);
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
