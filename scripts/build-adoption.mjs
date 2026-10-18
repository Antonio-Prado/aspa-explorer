// Who has an ASPA: the adoption by RIR, country and size of the network, and the largest transit
// networks with and without one. Written as one JSON file (served as /api/v1/adoption.json).
//
//   node scripts/build-adoption.mjs OUT_FILE [CACHE_DIR]
//
// Sources: the ASPAs of the validator (ASPA_DATA, default http://127.0.0.1:8080/data/aspas.json); the ASes
// that the RIPE RIS collectors see (RIPEstat); the delegation files of the five RIRs, which say in which
// country and registry each AS number was registered; and the CAIDA AS Relationships dataset, from which
// the size of a network is taken as its customer cone (the ASes it reaches through customers).
// Needs Node.js 18+ and bunzip2. The big files are kept in CACHE_DIR and fetched again when they are old.

import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import net from 'node:net';

// some of the servers answer slowly on one of IPv4 and IPv6: give each family a little longer
if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const run = promisify(execFile);
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

export const DELEGATED = {
  ripe: 'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest',
  apnic: 'https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest',
  arin: 'https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest',
  lacnic: 'https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest',
  afrinic: 'https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest',
};
export const TIERS = [
  { key: 'stub', label: 'Stub (no customers)', min: 1 },
  { key: 'small', label: 'Small (2 to 9 networks in its cone)', min: 2 },
  { key: 'medium', label: 'Medium (10 to 99)', min: 10 },
  { key: 'large', label: 'Large (100 to 999)', min: 100 },
  { key: 'huge', label: 'Very large (1,000 or more)', min: 1000 },
];
export const tierOf = (cone) => [...TIERS].reverse().find((t) => cone >= t.min).key;

// "registry|cc|asn|start|count|date|status|..." -> [{start, end, cc, rir}], sorted, for the AS numbers in use
export function parseDelegated(text, rir) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('|');
    if (f[2] !== 'asn' || !/^[a-z]{2}$/i.test(f[1]) || !['allocated', 'assigned'].includes(f[6])) continue;
    const start = Number(f[3]), count = Number(f[4]);
    if (Number.isInteger(start) && Number.isInteger(count) && count > 0) out.push({ start, end: start + count - 1, cc: f[1].toUpperCase(), rir });
  }
  return out.sort((a, b) => a.start - b.start);
}

// a lookup AS number -> {cc, rir} over sorted ranges
export function registry(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return (asn) => {
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = sorted[mid];
      if (asn < r.start) hi = mid - 1; else if (asn > r.end) lo = mid + 1; else return r;
    }
    return null;
  };
}

// CAIDA as-rel2: "provider|customer|-1|source" (peering lines, 0, and comments are skipped)
export function parseRelationships(text) {
  const customers = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('|');
    if (f[2] !== '-1') continue;
    const p = Number(f[0]), c = Number(f[1]);
    if (!Number.isInteger(p) || !Number.isInteger(c)) continue;
    (customers.get(p) || customers.set(p, []).get(p)).push(c);
  }
  return customers;
}

// The providers that CAIDA infers for each AS, as one compact object {AS: [providers]} (only the ASes that have any): the page sets them next
// to what the IRR object and the ASPA of an AS say. `customers` is what parseRelationships returns (provider -> customers).
export function providersOf(customers) {
  const out = {};
  for (const [p, list] of customers) for (const c of list) (out[c] || (out[c] = [])).push(p);
  for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
  return out;
}

// The country and the registry of every AS seen in BGP, in one small object: AS number -> "NLr" (the country
// and one letter for the registry: r RIPE NCC, a ARIN, p APNIC, l LACNIC, f AFRINIC). The page uses it to
// tell which networks a route goes through are registered in another country.
export const RIR_LETTER = { ripe: 'r', arin: 'a', apnic: 'p', lacnic: 'l', afrinic: 'f' };
export function registryDoc(seen, where) {
  const asns = {};
  for (const a of seen) {
    const w = where(a);
    if (w) asns[a] = w.cc + RIR_LETTER[w.rir];
  }
  return asns;
}

// The header of the CAIDA file names the Tier-1 clique ("# input clique: 174 209 ...") and the exchange-point
// ASes ("# IXP ASes: ..."): both are used by the page to read the routes seen in BGP.
export function parseCaidaHeader(text) {
  const list = (key) => {
    const line = text.split('\n').find((l) => l.startsWith(`# ${key}:`));
    return line ? line.split(':')[1].trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  };
  return { clique: list('input clique'), ixp: list('IXP ASes') };
}

// size of the customer cone (the AS itself included) of every AS that has customers
export function coneSizes(customers) {
  const sizes = new Map();
  for (const root of customers.keys()) {
    const seen = new Set([root]);
    const stack = [root];
    while (stack.length) {
      for (const c of customers.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); stack.push(c); }
    }
    sizes.set(root, seen.size);
  }
  return sizes;
}

const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : 0);

// seen: Set of AS numbers in BGP; aspa: Map AS number -> number of providers; where: AS -> {cc, rir} | null;
// cones: Map AS -> cone size (1 when missing)
export function aggregate({ seen, aspa, where, cones, topN = 100 }) {
  const group = (keyOf) => {
    const m = new Map();
    for (const asn of seen) {
      const k = keyOf(asn);
      const e = m.get(k) || { seen: 0, aspa: 0 };
      e.seen++;
      if (aspa.has(asn)) e.aspa++;
      m.set(k, e);
    }
    return m;
  };
  const rows = (m, name) => [...m].map(([k, e]) => ({ [name]: k, seen: e.seen, aspa: e.aspa, pct: pct(e.aspa, e.seen) }));
  const cone = (asn) => cones.get(asn) || 1;
  const by_rir = rows(group((a) => (where(a) || {}).rir || 'unknown'), 'rir').sort((a, b) => b.seen - a.seen);
  const by_country = rows(group((a) => (where(a) || {}).cc || 'ZZ'), 'cc').sort((a, b) => b.seen - a.seen || (a.cc < b.cc ? -1 : 1));
  const tiers = group((a) => tierOf(cone(a)));
  const by_size = TIERS.map((t) => ({ tier: t.key, label: t.label, seen: (tiers.get(t.key) || {}).seen || 0, aspa: (tiers.get(t.key) || {}).aspa || 0, pct: pct((tiers.get(t.key) || {}).aspa || 0, (tiers.get(t.key) || {}).seen || 0) }));
  const top_transit = [...seen].map((asn) => ({ asn: `AS${asn}`, cone: cone(asn), cc: (where(asn) || {}).cc || null, rir: (where(asn) || {}).rir || null, aspa: aspa.has(asn), providers: aspa.has(asn) ? aspa.get(asn) : null }))
    .sort((a, b) => b.cone - a.cone || (Number(a.asn.slice(2)) - Number(b.asn.slice(2)))).slice(0, topN);
  const withAspa = [...seen].filter((a) => aspa.has(a)).length;
  return {
    seen: seen.size, aspa: withAspa, pct: pct(withAspa, seen.size),
    aspa_not_seen: [...aspa.keys()].filter((a) => !seen.has(a)).length,
    by_rir, by_country, by_size, top_transit,
    top_transit_with_aspa: top_transit.filter((t) => t.aspa).length,
  };
}

// ---------- fetching, with a cache for the big files ----------
async function fresh(path, maxAgeMs) {
  try { return Date.now() - (await stat(path)).mtimeMs < maxAgeMs; } catch { return false; }
}

const MAX_DOWNLOAD = 600 * 1024 * 1024;     // the biggest file is the CAIDA relationships, a few tens of MB

async function download(url, path) {
  if (new URL(url).protocol !== 'https:') throw new Error(`${url}: only https addresses are fetched`);
  let r;
  for (let attempt = 1; ; attempt++) {
    try { r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) }); break; }
    catch (err) { if (attempt === 3) throw new Error(`${url}: ${(err.cause && err.cause.code) || err.message}`); }
  }
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const body = Buffer.from(await r.arrayBuffer());
  if (!body.length || body.length > MAX_DOWNLOAD) throw new Error(`${url}: the answer is empty or larger than ${MAX_DOWNLOAD / 1048576} MB`);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, path);
}

export async function cached(url, path, maxAgeMs) {
  if (!(await fresh(path, maxAgeMs))) {
    try { await download(url, path); } catch (err) { if (!(await stat(path).catch(() => null))) throw err; console.error(`${err.message}; using the older copy`); }
  }
  return path;
}

async function latestCaida() {
  const base = 'https://publicdata.caida.org/datasets/as-relationships/serial-2/';
  const html = await (await fetch(base, { headers: { 'User-Agent': UA } })).text();
  const names = [...html.matchAll(/(\d{8})\.as-rel2\.txt\.bz2/g)].map((m) => m[1]).sort();
  if (!names.length) throw new Error('no CAIDA file found');
  return { date: names[names.length - 1], url: `${base}${names[names.length - 1]}.as-rel2.txt.bz2` };
}

async function main() {
  const [outFile, cacheArg] = process.argv.slice(2);
  if (!outFile) { console.error('usage: build-adoption.mjs OUT_FILE [CACHE_DIR]'); process.exit(2); }
  const cache = cacheArg || join(outFile, '..', 'cache');
  await mkdir(cache, { recursive: true });
  const dataUrl = process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json';
  const getJson = async (u) => { const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': UA } }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); };

  const data = await getJson(dataUrl);
  if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('the ASPA data is empty: not publishing');
  const aspa = new Map();
  for (const a of data.aspas) aspa.set(Number(a.customer.slice(2)), (aspa.get(Number(a.customer.slice(2))) || 0) + a.providers.filter((p) => p !== 'AS0').length);
  const seen = new Set((await getJson('https://stat.ripe.net/data/ris-asns/data.json?list_asns=true')).data.asns.map(Number));

  const ranges = [];
  for (const [rir, url] of Object.entries(DELEGATED)) ranges.push(...parseDelegated(await readFile(await cached(url, join(cache, `delegated-${rir}`), 20 * 3600e3), 'utf8'), rir));
  const caida = await latestCaida();
  const bz = await cached(caida.url, join(cache, `as-rel2-${caida.date}.bz2`), 30 * 86400e3);
  const relText = (await run('bunzip2', ['-c', bz], { maxBuffer: 512 * 1024 * 1024 })).stdout;
  const rel = parseRelationships(relText);
  const header = parseCaidaHeader(relText);
  const cones = coneSizes(rel);

  const out = aggregate({ seen, aspa, where: registry(ranges), cones });
  const doc = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    sources: { aspas: 'Routinator, rpki.ping6.it', bgp: 'RIPE RIS collectors, through RIPEstat (ris-asns)', registry: 'delegation files of the five RIRs', size: `CAIDA AS Relationships, serial-2, ${caida.date}` },
    clique: header.clique,
    ixp: header.ixp,
    ...out,
  };
  const tmp = `${outFile}.tmp`;
  await writeFile(tmp, JSON.stringify(doc) + '\n');
  await rename(tmp, outFile);
  const regFile = join(outFile, '..', 'asn-registry.json');
  await writeFile(`${regFile}.tmp`, JSON.stringify({ generated: doc.generated, asns: registryDoc(seen, registry(ranges)) }) + '\n');
  await rename(`${regFile}.tmp`, regFile);
  const relFile = join(outFile, '..', 'relations.json');
  await writeFile(`${relFile}.tmp`, JSON.stringify({ generated: doc.generated, source: `CAIDA AS Relationships, serial-2, ${caida.date}`, serial: caida.date, providers: providersOf(rel) }) + '\n');
  await rename(`${relFile}.tmp`, relFile);
  console.log(`${doc.generated}: ${doc.seen} ASes seen, ${doc.aspa} with an ASPA (${doc.pct}%), ${doc.by_country.length} countries, CAIDA ${caida.date}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
