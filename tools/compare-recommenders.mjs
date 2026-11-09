// Two ways of guessing the providers of an AS from the routes that the collectors see, judged against the ASPAs that the ASes
// themselves published: the heuristic of RAVEN's `aspa recommend` (github.com/nokia/bgp-routing-security-monitor,
// internal/aspa/recommender: every adjacent pair of an AS_PATH, the AS closer to the collector being the provider of the one
// closer to the origin, counted over the routes, with a minimum number of observations) and the evidence of this site
// (site/evidence.js: the neighbour of the origin is its provider when the route goes on from it to a Tier-1 network that is
// not the neighbour, seen by enough feeders and on enough of the paths). Both are run over the same table dumps, for the
// customers that have an ASPA, and each suggested provider is classed as declared in the ASPA, or, for the others, as what
// the CAIDA relationships say of it (provider, peer, customer, unknown).
//
//   node tools/compare-recommenders.mjs OUT.json DUMP...
//
// Environment: ASPA_DATA (Routinator's jsonext, default http://127.0.0.1:8080/data/aspas.json), ADOPTION (the adoption file, for the
// Tier-1 clique and the exchange-point ASes, default http://127.0.0.1:8080/api/v1/adoption.json), CAIDA (an as-rel2 file, .bz2 or plain;
// without it the suggestions that the ASPA does not declare are not classed).
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readRib, openDump } from '../scripts/mrt.mjs';

const { MIN_PATHS, STRONG_FEEDERS, STRONG_SHARE } = createRequire(import.meta.url)('../site/evidence.js');
const MIN_OBS = [1, 10, 100];

async function getJson(src) {
  if (/^https?:/.test(src)) { const r = await fetch(src, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`); return r.json(); }
  return JSON.parse(await readFile(src, 'utf8'));
}

// the CAIDA relationships: Map "a|b" -> -1 (a is a provider of b) or 0 (peers)
async function caida(file) {
  if (!file) return null;
  const text = file.endsWith('.bz2') ? (await promisify(execFile)('bunzip2', ['-c', file], { maxBuffer: 1 << 30 })).stdout : await readFile(file, 'utf8');
  const m = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const [a, b, rel] = line.split('|');
    m.set(`${a}|${b}`, Number(rel));
  }
  return m;
}
const relation = (rel, p, c) => {
  if (!rel) return 'unknown';
  if (rel.get(`${p}|${c}`) === -1) return 'provider';
  if (rel.get(`${c}|${p}`) === -1) return 'customer';
  if (rel.has(`${p}|${c}`) || rel.has(`${c}|${p}`)) return 'peer';
  return 'unknown';
};

const inc = (map, c, p) => { let m = map.get(c); if (!m) { m = new Map(); map.set(c, m); } m.set(p, (m.get(p) || 0) + 1); };

async function main() {
  const [out, ...dumps] = process.argv.slice(2);
  if (!out || !dumps.length) { console.error('usage: node tools/compare-recommenders.mjs OUT.json DUMP...'); process.exit(2); }
  const data = await getJson(process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json');
  const adoption = await getJson(process.env.ADOPTION || 'http://127.0.0.1:8080/api/v1/adoption.json');
  const rel = await caida(process.env.CAIDA);
  const declared = new Map();                                            // customer -> Set of providers (AS0 left out)
  const zero = new Set();                                                // customers whose ASPA says AS0 only
  for (const a of data.aspas || []) {
    const c = Number(String(a.customer).slice(2));
    const ps = (a.providers || []).map((p) => Number(String(p).slice(2))).filter((p) => p !== 0);
    const s = declared.get(c) || new Set(); ps.forEach((p) => s.add(p)); declared.set(c, s);
    if (!ps.length && (a.providers || []).some((p) => String(p) === 'AS0')) zero.add(c);
  }
  const clique = new Set(adoption.clique || []), ixp = new Set(adoption.ixp || []);
  const ravenAll = new Map(), ravenOrigin = new Map(), ours = new Map();
  let routes = 0, selfPairs = 0;
  const cleaned = [];
  for (const file of dumps) {
    const t0 = Date.now();
    const stats = await readRib(openDump(file), (peerAs, path, n) => {
      routes++;
      // RAVEN: every adjacent pair, path[j-1] the provider of path[j]
      for (let j = n - 1; j > 0; j--) {
        const c = path[j], p = path[j - 1];
        if (c === 0 || p === 0 || !declared.has(c)) continue;
        if (c === p) selfPairs++;
        inc(ravenAll, c, p);
        if (j === n - 1) inc(ravenOrigin, c, p);
      }
      // this site: the neighbour of the origin, on the path without prepending and exchange points
      const origin = path[n - 1];
      if (!declared.has(origin)) return;
      cleaned.length = 0;
      for (let i = 0; i < n; i++) { const a = path[i]; if (ixp.has(a)) continue; if (cleaned[cleaned.length - 1] !== a) cleaned.push(a); }
      const L = cleaned.length;
      if (L < 2 || cleaned[L - 1] !== origin) return;
      const nb = cleaned[L - 2];
      let m = ours.get(origin); if (!m) { m = new Map(); ours.set(origin, m); }
      let e = m.get(nb); if (!e) { e = { paths: 0, informative: 0, viaT1: 0, feeders: new Set() }; m.set(nb, e); }
      e.paths++;
      if (L === 2) return;
      e.informative++;
      const left = cleaned[L - 3];
      if (clique.has(left) && left !== nb) { e.viaT1++; e.feeders.add(peerAs); }
    });
    console.error(`${file}: ${stats.entries} routes in ${Math.round((Date.now() - t0) / 1000)} s`);
  }

  // the judgement of one method's suggestions: suggest(c) -> Set of providers, over the customers with declared providers
  const judge = (name, suggest) => {
    const r = { method: name, customers: 0, with_suggestions: 0, suggestions: 0, declared_hits: 0, declared_total: 0, all_declared: 0, all_found: 0, exact: 0, by_relation: { provider: 0, peer: 0, customer: 0, unknown: 0 }, zero_only_with_suggestions: 0 };
    for (const [c, D] of declared) {
      const S = suggest(c);
      if (zero.has(c)) { if (S.size) r.zero_only_with_suggestions++; continue; }
      if (!D.size) continue;
      r.customers++; r.declared_total += D.size;
      if (!S.size) continue;
      r.with_suggestions++; r.suggestions += S.size;
      let hits = 0;
      for (const p of S) { if (D.has(p)) hits++; else r.by_relation[relation(rel, p, c)]++; }
      r.declared_hits += hits;
      if (hits === S.size) r.all_declared++;
      if (hits === D.size) r.all_found++;
      if (hits === S.size && hits === D.size) r.exact++;
    }
    r.precision = r.suggestions ? r.declared_hits / r.suggestions : null;
    r.recall = r.declared_total ? r.declared_hits / r.declared_total : null;
    return r;
  };
  const fromCounts = (map, min) => (c) => { const m = map.get(c); const s = new Set(); if (m) for (const [p, k] of m) if (k >= min && p !== c) s.add(p); return s; };
  const results = [];
  for (const min of MIN_OBS) results.push(judge(`RAVEN, every pair, at least ${min} observation${min === 1 ? '' : 's'}`, fromCounts(ravenAll, min)));
  for (const min of MIN_OBS) results.push(judge(`RAVEN, the neighbour of the origin only, at least ${min} observation${min === 1 ? '' : 's'}`, fromCounts(ravenOrigin, min)));
  const label = (e) => (e.informative < MIN_PATHS ? 'few' : e.feeders.size >= STRONG_FEEDERS && e.viaT1 / e.informative >= STRONG_SHARE ? 'provider' : e.viaT1 > 0 ? 'weak' : 'none');
  const oursBy = (want) => (c) => { const m = ours.get(c); const s = new Set(); if (m) for (const [p, e] of m) if (want.includes(label(e))) s.add(p); return s; };
  results.push(judge('this site, strong evidence', oursBy(['provider'])));
  results.push(judge('this site, strong or weak evidence', oursBy(['provider', 'weak'])));
  results.push(judge('this site, every neighbour of the origin seen', (c) => new Set((ours.get(c) || new Map()).keys())));

  const doc = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), dumps, routes, aspas: declared.size, aspa_zero_only: zero.size,
    customers_with_declared_providers: [...declared.values()].filter((s) => s.size).length, clique: [...clique].sort((a, b) => a - b), caida: process.env.CAIDA || null,
    raven_self_pairs: selfPairs, thresholds: { min_paths: MIN_PATHS, strong_feeders: STRONG_FEEDERS, strong_share: STRONG_SHARE }, results,
  };
  await writeFile(out, JSON.stringify(doc, null, 1));
  const pct = (x) => (x === null ? '–' : `${(100 * x).toFixed(1)}%`);
  console.log(`| Method | Customers with suggestions | Suggestions | Precision | Recall | ASPAs fully right | Non-declared: CAIDA provider / peer / customer / unknown |`);
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.method} | ${r.with_suggestions} of ${r.customers} | ${r.suggestions} | ${pct(r.precision)} | ${pct(r.recall)} | ${r.exact} | ${r.by_relation.provider} / ${r.by_relation.peer} / ${r.by_relation.customer} / ${r.by_relation.unknown} |`);
}

main().catch((err) => { console.error(err); process.exit(1); });
