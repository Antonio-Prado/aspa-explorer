// Route leaks (valleys) in the routes of the RIPE RIS collectors, today: every route of three collectors is
// checked with the downstream ASPA verification, and the paths that the ASPAs prove to contain a valley are
// grouped by the place of the valley. Written as one JSON file (served as /api/v1/leaks.json).
//
//   node scripts/build-leaks.mjs OUT_FILE [CACHE_DIR]
//
// Inputs (environment, with defaults for the production host):
//   ASPA_DATA        URL or file of Routinator's jsonext     http://127.0.0.1:8080/data/aspas.json
//   LEAKS_COLLECTORS comma separated RIS collectors          rrc00,rrc01,rrc03
//   LEAKS_ADOPTION   file with the Tier-1 clique and the IXP ASes (adoption.json), next to OUT_FILE
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import net from 'node:net';
import { readRib, openGz } from './mrt.mjs';

const { verify } = createRequire(import.meta.url)('../site/verify.js');
if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
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
    g.routes++; g.feeders.add(`${collector}:${feeder}`); g.origins.add(p[0]);
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
    return {
      total: this.total, places: list.length,
      kinds: { gap: list.filter((g) => g.kind === 'gap').length, leak: list.filter((g) => g.kind === 'leak').length, unclear: list.filter((g) => g.kind === 'unclear').length },
      // the most seen places of each kind, so that no kind crowds the others out
      groups: ['leak', 'gap', 'unclear'].flatMap((k) => list.filter((g) => g.kind === k).slice(0, k === 'unclear' ? 20 : limit)).sort((a, b) => b.feeders - a.feeders || b.routes - a.routes),
      // the ASes that passed on up what they should not have, and the ASPAs that seem to miss a provider
      leakers: sum(list.filter((g) => g.kind === 'leak'), (g) => g.between[0], (g) => ({ asn: g.between[0] })),
      gaps: sum(list.filter((g) => g.kind === 'gap'), (g) => `${g.from}|${g.between[0]}`, (g) => ({ customer: g.from, missing: g.between[0] })),
    };
  }
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
  const [outFile, cacheArg] = process.argv.slice(2);
  if (!outFile) { console.error('usage: build-leaks.mjs OUT_FILE [CACHE_DIR]'); process.exit(2); }
  const cache = cacheArg || join(outFile, '..', 'cache');
  await mkdir(cache, { recursive: true });
  const dataUrl = process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json';
  const data = /^https?:/.test(dataUrl)
    ? await (await fetch(dataUrl, { headers: { 'User-Agent': UA } })).json() : JSON.parse(await readFile(dataUrl, 'utf8'));
  if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('the ASPA data is empty: not publishing');
  let ixp = new Set();
  try { ixp = new Set(JSON.parse(await readFile(process.env.LEAKS_ADOPTION || join(outFile, '..', 'adoption.json'), 'utf8')).ixp || []); } catch { /* no list */ }
  const collectors = (process.env.LEAKS_COLLECTORS || 'rrc00,rrc01,rrc03').split(',').map((s) => s.trim()).filter(Boolean);
  const rel = await caidaRelations(cache);
  const leaks = new Leaks(aspaMap(data.aspas), ixp, rel.relOf);
  const used = [];
  for (const c of collectors) {
    const file = join(cache, `bview-${c}.gz`);
    if (!(await fresh(file, 4 * 3600e3))) await download(`https://data.ris.ripe.net/${c}/latest-bview.gz`, file);
    const t0 = Date.now();
    const stats = await readRib(openGz(file), (peerAs, path, n) => leaks.add(peerAs, c, Array.from(path.subarray(0, n))));
    used.push({ collector: c, routes: stats.entries, built: new Date((await stat(file)).mtimeMs).toISOString().replace(/\.\d+Z$/, 'Z') });
    console.error(`${c}: ${stats.entries} routes in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const doc = { generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), aspas: data.aspas.length, collectors: used, relationships: rel.source, ...leaks.result() };
  const tmp = `${outFile}.tmp`;
  await writeFile(tmp, JSON.stringify(doc) + '\n');
  await rename(tmp, outFile);
  console.log(`${doc.generated}: ${doc.total.routes} routes, ${doc.total.invalid} invalid, ${doc.places} places of valley`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
