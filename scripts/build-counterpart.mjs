// The other side of the ASPAs. An ASPA is written by the customer alone: for every pair (customer, provider) that an ASPA declares, what the
// provider itself says about that customer in its aut-num object, whether CAIDA infers the same relationship from the routes, and the exchange
// points where both are, which is where a peer that an ASPA calls a provider usually comes from.
// Written as one JSON file (served as /api/v1/counterpart.json), once a day.
//
//   node scripts/build-counterpart.mjs OUT_FILE [RELATIONS_FILE]
//
// Sources: the ASPAs of the validator (ASPA_DATA, default http://127.0.0.1:8080/data/aspas.json); the daily copies of the routing registries
// (IRR_SOURCES below: the five RIRs, JPIRR, NTTCOM and TC; RADb and LEVEL3 are left out, they hold many objects that nobody keeps up to
// date); the CAIDA relationships as the adoption job wrote them (RELATIONS_FILE, default relations.json next to OUT_FILE); PeeringDB for the
// exchange points (www.peeringdb.com/api, two requests, or its daily copy at CAIDA). A source that does not answer is left out and named in `missing`: the file is still
// written, unless no registry at all could be read.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';
import dns from 'node:dns';

const { roles, codeOf } = createRequire(import.meta.url)('../site/irr.js');
if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
// The host of the site has no IPv6: a registry with an AAAA record was at times tried there first and given up as timed out.
dns.setDefaultResultOrder('ipv4first');
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

// In order of preference: where two registries hold an object of the same AS, the first one with a policy is used.
export const IRR_SOURCES = [
  ['RIPE', 'https://ftp.ripe.net/ripe/dbase/split/ripe.db.aut-num.gz'],
  ['ARIN', 'https://ftp.arin.net/pub/rr/arin.db.gz'],
  ['APNIC', 'https://ftp.apnic.net/apnic/whois/apnic.db.aut-num.gz'],
  ['AFRINIC', 'https://ftp.afrinic.net/pub/dbase/afrinic.db.gz'],
  ['LACNIC', 'https://irr.lacnic.net/lacnic.db.gz'],
  ['JPIRR', 'https://ftp.nic.ad.jp/jpirr/jpirr.db.gz'],
  ['NTTCOM', 'https://rr.ntt.net/nttcomRR/nttcom.db.gz'],
  ['TC', 'https://ftp.bgp.net.br/tc.db.gz'],
];
const PEERINGDB = 'https://www.peeringdb.com/api';
const PEERINGDB_DUMPS = 'https://publicdata.caida.org/datasets/peeringdb';

// The aut-num objects of a registry dump, read line by line: each as {as, attrs: [{name, value}]}, the attributes as the page reads them from
// the RIPE database (a value on several lines joined in one, the comment after # dropped except in the remarks, which tell the sections).
// `wanted` (a Set of numbers) keeps only those ASes; `lines` is any async iterable of lines.
export async function* autNums(lines, wanted) {
  let attrs = null, keep = false, as = null, last = null;
  const flush = function* () { if (attrs && keep && as !== null) yield { as, attrs }; };
  for await (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line === '') { yield* flush(); attrs = null; keep = false; as = null; last = null; continue; }
    if (line[0] === '#' || line[0] === '%') continue;
    if (attrs === null) {
      const m = /^aut-num:\s*AS(\d+)\s*(#.*)?$/i.exec(line);
      attrs = [];                                  // an object of any class: its lines are skipped unless it is a wanted aut-num
      if (m) { as = Number(m[1]); keep = !wanted || wanted.has(as); }
      continue;
    }
    if (!keep) continue;
    if (/^[ \t+]/.test(line)) {                    // the same attribute goes on
      if (last) last.value = `${last.value} ${clean(last.name, line.slice(1))}`.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i < 1) continue;
    const name = line.slice(0, i).toLowerCase();
    last = { name, value: clean(name, line.slice(i + 1)) };
    attrs.push(last);
  }
  yield* flush();
}
const clean = (name, value) => (name === 'remarks' ? value : value.replace(/#.*$/, '')).trim();

async function linesOf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const modified = r.headers.get('last-modified');
  const gz = Readable.fromWeb(r.body).pipe(createGunzip());
  return { lines: createInterface({ input: gz, crlfDelay: Infinity }), modified: modified ? new Date(modified).toISOString().slice(0, 10) : null };
}

// What each provider says, from the objects of the registries in order of preference: Map provider -> {source (index), modified, state, roles}.
// state: 0 an object without a policy, 1 a policy that names no customer one by one, 2 a policy that names customers.
export function pick(found, as, source, attrs) {
  const r = roles(attrs, null);
  const state = !r.rules ? 0 : r.customer.length ? 2 : 1;
  const had = found.get(as);
  if (had && (had.state > 0 || state === 0)) return;          // the first registry with a policy stays
  const modified = (attrs.find((a) => a.name === 'last-modified') || attrs.find((a) => a.name === 'changed') || {}).value || null;
  found.set(as, { source, modified: modified ? (/\d{4}-?\d{2}-?\d{2}/.exec(modified) || [null])[0] : null, state, roles: r.rules ? r : null });
}

// The pairs of the ASPAs against the objects, CAIDA and the exchange points. `aspas`: [{customer: 'AS1', providers: ['AS2']}], `found`: as
// pick fills it, `caida`: {customer: [providers]} or null, `ixOf`: Map AS -> Set of exchange ids, or null.
// A pair is [code, caida, shared]: the letter of codeOf or null; 1, 0 or null (CAIDA knows no provider of the customer, or there is no file);
// the ids of the exchange points where both are, kept only where neither the object nor CAIDA confirms the pair (at most six).
export function pairs(aspas, found, caida, ixOf) {
  const out = {}, used = new Set();
  let total = 0, confirmed = 0;
  for (const a of aspas) {
    const c = Number(a.customer.slice(2)), row = {};
    for (const p of a.providers.map((x) => Number(x.slice(2))).filter((x) => x !== 0)) {
      const f = found.get(p);
      const code = f && f.roles ? codeOf(f.roles, c) : null;
      const list = caida ? caida[c] : null;
      const inCaida = list ? (list.includes(p) ? 1 : 0) : null;
      const ok = code === 'c' || inCaida === 1;
      const pair = [code, inCaida];
      if (!ok && ixOf && ixOf.has(c) && ixOf.has(p)) {
        const shared = [...ixOf.get(c)].filter((id) => ixOf.get(p).has(id)).sort((x, y) => x - y).slice(0, 6);
        if (shared.length) { pair.push(shared); shared.forEach((id) => used.add(id)); }
      }
      row[p] = pair; total++; if (ok) confirmed++;
    }
    if (Object.keys(row).length) out[c] = row;
  }
  return { pairs: out, used, total, confirmed };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// The two tables of PeeringDB that say who is at which exchange point: from its API, one request after the other (it refuses a client that asks
// too fast: a refused request is asked once more after a minute), and if it still does not answer from the daily copy that CAIDA publishes,
// the one of yesterday or of the two days before.
async function peeringdb() {
  const api = async () => {
    const ix = await getJson(`${PEERINGDB}/ix?fields=id,name`);
    const nl = await getJson(`${PEERINGDB}/netixlan?fields=asn,ix_id`);
    return { from: 'PeeringDB', ix: ix.data, netixlan: nl.data };
  };
  try { return await api(); } catch (err) { console.error(`PeeringDB: ${err.message}, asking again in a minute`); }
  await new Promise((ok) => { setTimeout(ok, 65000); });
  try { return await api(); } catch (err) { console.error(`PeeringDB: ${err.message}, trying the copy of CAIDA`); }
  let last;
  for (let back = 1; back <= 3; back++) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10), [y, m, day] = d.split('-');
    try {
      const dump = await getJson(`${PEERINGDB_DUMPS}/${y}/${m}/peeringdb_2_dump_${y}_${m}_${day}.json`);
      return { from: `PeeringDB, the copy of ${d} at CAIDA`, ix: dump.ix.data.map((x) => ({ id: x.id, name: x.name })), netixlan: dump.netixlan.data.map((x) => ({ asn: x.asn, ix_id: x.ix_id })) };
    } catch (err) { last = err; }
  }
  throw last;
}

async function main() {
  const outFile = process.argv[2];
  if (!outFile) { console.error('usage: build-counterpart.mjs OUT_FILE [RELATIONS_FILE]'); process.exit(2); }
  const relFile = process.argv[3] || join(outFile, '..', 'relations.json');
  const data = await getJson(process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json');
  if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('the ASPA data is empty: not publishing');
  const wanted = new Set(data.aspas.flatMap((a) => a.providers.map((p) => Number(p.slice(2)))).filter((p) => p !== 0));

  const found = new Map(), sources = [], missing = [];
  for (const [name, url] of IRR_SOURCES) {
    // a registry that does not answer is asked twice more: what a broken download left behind is picked again, with the same result,
    // or thrown away if the last request fails too
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { lines, modified } = await linesOf(url);
        const idx = sources.length;
        let n = 0;
        for await (const o of autNums(lines, wanted)) { pick(found, o.as, idx, o.attrs); n++; }
        sources.push({ name, date: modified, objects: n });
        break;
      } catch (err) {
        console.error(`${name}: ${err.message}${attempt < 3 ? ', asking again' : ''}`);
        if (attempt < 3) { await new Promise((ok) => { setTimeout(ok, 15000); }); continue; }
        missing.push(name);
        for (const [as, f] of found) if (f.source === sources.length) found.delete(as);     // what the broken copy left: its place goes to the next registry
      }
    }
  }
  if (!sources.length) throw new Error('no routing registry could be read: not publishing');

  let rel = null;
  try { rel = JSON.parse(await readFile(relFile, 'utf8')); } catch { missing.push('CAIDA'); }

  let ixOf = null, ixNames = {}, pdb = null;
  try {
    const t = await peeringdb();
    ixOf = new Map();
    for (const x of t.netixlan) { if (!ixOf.has(x.asn)) ixOf.set(x.asn, new Set()); ixOf.get(x.asn).add(x.ix_id); }
    for (const x of t.ix) ixNames[x.id] = x.name;
    pdb = { from: t.from, networks: ixOf.size, exchanges: t.ix.length };
  } catch (err) { missing.push('PeeringDB'); console.error(`PeeringDB: ${err.message}`); }

  const res = pairs(data.aspas, found, rel && rel.providers ? rel.providers : null, ixOf);
  const providers = {};
  for (const [as, f] of found) providers[as] = [f.source, f.modified, f.state];
  const generated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const doc = {
    generated,
    sources: sources.map((s) => s.name),
    registries: sources,
    caida: rel ? rel.source : null,
    peeringdb: pdb,
    missing,
    providers,
    pairs: res.pairs,
    ix: Object.fromEntries([...res.used].sort((a, b) => a - b).map((id) => [id, ixNames[id] || `exchange ${id}`])),
  };
  await writeFile(`${outFile}.tmp`, JSON.stringify(doc) + '\n');
  await rename(`${outFile}.tmp`, outFile);
  console.log(`${generated}: ${res.total} pairs of ${Object.keys(res.pairs).length} ASPAs, ${res.confirmed} confirmed by the object of the provider or by CAIDA; ${found.size} of ${wanted.size} providers have an object (${sources.map((s) => `${s.name} ${s.objects}`).join(', ')})${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
