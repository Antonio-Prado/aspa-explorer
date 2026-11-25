// Whether the network that received an incident's routes would have let them through with a prefix filter built from the
// AS-SET of the network that sent them, as many networks build the filter of a customer or of a peer: the route objects whose
// origin is in the expanded set, with their more specifics (as scripts/irr-registered.mjs does for one origin).
//   - the sender and the receiver: for a prefix hijack (PRH) and a more specific announced by another network (DEG-MA), the
//     origin and the AS after it in the paths of the incident; for a route leak (RLK), the AS that leaked and the one it sent to;
//   - the set: the one that the aut-num of the sender exports to the receiver, else the one it gives in PeeringDB (irr_as_set),
//     else none, and then the filter has only the sender's own route objects;
//   - only the first filter after the sender is looked at, not the ones of the networks further on.
// Verdicts: `passes` (every prefix of the incident is admitted), `partly` (some), `stopped` (none, and the set was expanded
// completely), `unknown` (none, but the set has members that the five databases do not hold: the rest could admit them), and
// `not_covered` (no snapshot of the IRR archive before the incident). Each verdict also says where the set came from and
// whether the set is wide (it admits WIDE_SHARE or more of all the route objects of the snapshot).
//
// The objects come from the daily archive of the IRR databases (the folder of a day of tools/irr-archive/fetch-irr.sh:
// the as-set and aut-num objects of the RIPE NCC and APNIC split files, arin.db, afrinic.db, lacnic.db, and index.tsv.gz),
// and PeeringDB from its daily copy at CAIDA. What a snapshot holds is reduced once to a table kept in the cache folder;
// the verdict of each incident is kept there too, by snapshot, so that a run works only on the incidents it has not seen.
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, rename, mkdir, stat, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { autNums } from './build-counterpart.mjs';
import { canonPrefix, canonOrigin, lessSpecifics, pickSnapshot } from './irr-registered.mjs';

const { rules } = createRequire(import.meta.url)('../site/irr.js');
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
export const WIDE_SHARE = 0.5;
export const MAX_PREFIXES = 50;           // the prefixes of an incident that are looked at (a leak can carry thousands)
export const SET_FILES = ['ripe.db.as-set.gz', 'apnic.db.as-set.gz', 'arin.db.gz', 'afrinic.db.gz', 'lacnic.db.gz'];
export const AUTNUM_FILES = ['ripe.db.aut-num.gz', 'apnic.db.aut-num.gz', 'arin.db.gz', 'afrinic.db.gz', 'lacnic.db.gz'];
export const PEERINGDB_DUMP = (day) => `https://publicdata.caida.org/datasets/peeringdb/${day.slice(0, 4)}/${day.slice(5, 7)}/peeringdb_2_dump_${day.replaceAll('-', '_')}.json`;
export const VERDICTS = ['passes', 'partly', 'stopped', 'unknown'];
export const PEERINGDB_BACK = 2;          // days before the snapshot whose PeeringDB copy may stand in for it
const VIA = { a: 'aut-num', p: 'peeringdb', n: 'none' };

// "RIPE::AS-FOO", "AS-FOO@RIPE", "as123:as-foo" -> "AS123:AS-FOO" (the source is dropped: a name is looked for in every database)
export const setName = (s) => {
  let n = String(s).trim().toUpperCase();
  if (n.includes('::')) n = n.split('::').pop();
  if (n.includes('@')) n = n.split('@')[0];
  return n;
};
export const isSetName = (n) => /(^|:)AS-[A-Z0-9_.-]+$/.test(n) && !/^AS-ANY$/.test(n);
const isAsName = (n) => /^AS\d+$/.test(n);
const memberList = (v) => v.replace(/#.*/, '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).map(setName);

function gzLines(file) {
  const src = createReadStream(file), gz = createGunzip();
  src.on('error', (err) => gz.destroy(err));
  return createInterface({ input: src.pipe(gz), crlfDelay: Infinity });
}

// The as-set objects of a database: [name, members] pairs (members and mp-members; mbrs-by-ref is not followed).
export async function* asSets(lines) {
  let cur = null, cont = false;
  for await (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line === '') { if (cur) yield cur; cur = null; cont = false; continue; }
    if (line[0] === '#' || line[0] === '%') continue;
    if (/^[ \t+]/.test(line)) { if (cur && cont) cur[1].push(...memberList(line)); continue; }
    const i = line.indexOf(':');
    if (i < 1) { cont = false; continue; }
    const k = line.slice(0, i).toLowerCase(), v = line.slice(i + 1);
    if (k === 'as-set') { if (cur) yield cur; cur = [setName(v.replace(/#.*/, '')), []]; cont = false; continue; }
    cont = Boolean(cur) && (k === 'members' || k === 'mp-members');
    if (cont) cur[1].push(...memberList(v));
  }
  if (cur) yield cur;
}

// The names of sets in an export filter ("AS-FOO", "AS-FOO AND NOT AS-BAR", "{...}" ...): only the plain ones are taken.
export const setsOfFilter = (filter) => String(filter || '').toUpperCase().split(/[\s(),{}]+/).map(setName).filter(isSetName);

// The table of a snapshot: {sets: {name: [members]}, exports: {sender: {receiver: [names]}}, pdb: {asn: [names]}, origins: {asn: count}, total}.
// Only the exports that name a set are kept.
export async function buildTable(dir, pdbFile) {
  const sets = {}, missing = [];
  for (const f of SET_FILES) {
    try { for await (const [name, members] of asSets(gzLines(join(dir, f)))) if (!(name in sets)) sets[name] = members; } catch (err) { missing.push(f); if (err.code !== 'ENOENT') console.error(`${f}: ${err.message}`); }
  }
  const exports = {}, seen = new Set();
  for (const f of AUTNUM_FILES) {
    try {
      for await (const { as, attrs } of autNums(gzLines(join(dir, f)), null)) {
        if (seen.has(as)) continue;
        seen.add(as);
        for (const r of rules(attrs)) {
          if (r.dir !== 'export' || r.via || r.as === null) continue;
          const names = setsOfFilter(r.filter);
          if (names.length) ((exports[as] ||= {})[r.as] ||= []).push(...names.filter((n) => !(exports[as][r.as] || []).includes(n)));
        }
      }
    } catch (err) { if (!missing.includes(f)) missing.push(f); if (err.code !== 'ENOENT') console.error(`${f}: ${err.message}`); }
  }
  const pdb = {};
  if (pdbFile) {
    try {
      for (const n of JSON.parse(await readFile(pdbFile, 'utf8')).net.data) {
        const names = String(n.irr_as_set || '').split(/[\s,]+/).filter(Boolean).map(setName).filter(isSetName);
        if (names.length && Number.isInteger(n.asn)) pdb[n.asn] = names;
      }
    } catch (err) { console.error(`PeeringDB: ${err.message}`); missing.push('peeringdb'); }
  } else missing.push('peeringdb');
  const origins = {};
  let total = 0;
  for await (const line of gzLines(join(dir, 'index.tsv.gz'))) {
    if (line[0] === '#') continue;
    const o = canonOrigin(line.split('\t')[1]);
    if (o === null) continue;
    origins[o] = (origins[o] || 0) + 1; total++;
  }
  return { sets, exports, pdb: pdbFile && !missing.includes('peeringdb') ? pdb : null, origins, total, missing };
}

// Expansion of the sets of a table, each one kept as a sorted Int32Array (a few bytes an AS, also for a set of the whole table).
export function expander(table) {
  const memo = new Map();       // name -> {ases: Int32Array, open: boolean}
  const expand = (name, stack = new Set()) => {
    if (memo.has(name)) return memo.get(name);
    const members = table.sets[name];
    if (!members) return { ases: new Int32Array(0), open: true };
    if (stack.has(name)) return { ases: new Int32Array(0), open: false };
    stack.add(name);
    const acc = new Set();
    let open = false;
    for (const m of members) {
      if (isAsName(m)) acc.add(Number(m.slice(2)));
      else if (isSetName(m)) { const e = expand(m, stack); for (const a of e.ases) acc.add(a); if (e.open) open = true; }
    }
    stack.delete(name);
    const res = { ases: Int32Array.from(acc).sort(), open };
    memo.set(name, res);
    return res;
  };
  return expand;
}
const has = (arr, x) => { let lo = 0, hi = arr.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] === x) return true; if (arr[m] < x) lo = m + 1; else hi = m - 1; } return false; };

// The sender, the receiver and the prefixes of an incident, for the types that are checked; null for the others.
export function subjectOf(inc) {
  const d = inc.details || {};
  let sender = null, receiver = null;
  if (inc.incident_type === 'RLK') { sender = canonOrigin(d.by); receiver = canonOrigin(d.to); }
  else if (inc.incident_type === 'PRH' || (inc.incident_type === 'DEG' && /^Cross-Origin/.test(d.anomaly || ''))) {
    sender = canonOrigin(inc.incident_type === 'PRH' ? d.actual_origin : d.sub_origin);
    const next = new Map();               // the AS after the origin in the paths (the first one before it, collector side first)
    for (const m of inc.messages || []) {
      const p = m && m.type === 'A' && Array.isArray(m.compressed_path) ? m.compressed_path : null;
      if (!p || p.length < 2 || p[p.length - 1] !== sender) continue;
      next.set(p[p.length - 2], (next.get(p[p.length - 2]) || 0) + 1);
    }
    receiver = [...next].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  } else return null;
  if (sender === null || receiver === null) return null;
  const prefixes = [...new Set((inc.prefixes || []).map(canonPrefix).filter(Boolean))].slice(0, MAX_PREFIXES);
  if (!prefixes.length) return null;
  return { sender, receiver, prefixes, key: keyOf(inc) };
}
// The key of an incident in the cache: a 32-bit hash of its actor and start (a month of leaks is millions of incidents; a collision
// gives an incident the verdict of another, a few in millions)
export const keyOf = (inc) => {
  const s = `${inc.actor_key || ''}|${inc.start || ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};

// The verdict of one subject with a table, its expander and the origins of each prefix needed ({prefix: Set of origins}).
// A verdict is a short code: the verdict letter (CODE), the source of the set (a aut-num, p PeeringDB, n none) and w when the set is wide.
const LETTER = { passes: 'P', partly: 'S', stopped: 'X', unknown: 'U' };
export const CODE = Object.fromEntries(Object.entries(LETTER).map(([k, v]) => [v, k]));
export function verdictOf(subject, table, expand, originsOf, wideMemo = new Map()) {
  const { sender, receiver } = subject;
  let names = (table.exports[sender] || {})[receiver] || [], via = 'a';
  if (!names.length) { names = (table.pdb && table.pdb[sender]) || []; via = names.length ? 'p' : 'n'; }
  const lists = [], open = [];
  for (const n of names) { const e = expand(n); lists.push(e.ases); open.push(e.open); }
  const inFilter = (o) => o === sender || lists.some((l) => has(l, o));
  let admitted = 0;
  for (const p of subject.prefixes) {
    let ok = false;
    for (const q of [p, ...lessSpecifics(p)]) { const os = originsOf.get(q); if (os) for (const o of os) if (inFilter(o)) { ok = true; break; } if (ok) break; }
    if (ok) admitted++;
  }
  const verdict = admitted === subject.prefixes.length ? 'passes' : admitted ? 'partly' : open.some(Boolean) ? 'unknown' : 'stopped';
  // wide: the route objects the filter admits, over all of them (the same sets give the same answer: kept in wideMemo)
  const wk = `${sender}|${names.join(',')}`;
  let wide = wideMemo.get(wk);
  if (wide === undefined) {
    let routes = 0;
    if (names.length) {
      const all = new Set([sender]);
      for (const l of lists) for (const a of l) all.add(a);
      for (const a of all) routes += table.origins[a] || 0;
    }
    wide = Boolean(table.total) && routes / table.total >= WIDE_SHARE;
    wideMemo.set(wk, wide);
  }
  return LETTER[verdict] + via + (wide ? 'w' : '');
}
// code -> {verdict, via, wide}
export const decode = (code) => (code ? { verdict: CODE[code[0]], via: VIA[code[1]], wide: code[2] === 'w' } : null);

async function fetchTo(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(`${file}.tmp`));
  await rename(`${file}.tmp`, file);
}

// The checker of a run, as irrChecker: need(inc) during the first reading, load() once, then verdict(inc): a code (decode) or
// 'not_covered', or null for an incident that is not checked.
export function assetChecker(snapshots, cacheDir) {
  const byFile = new Map(snapshots.map((s) => [s.file, s]));
  const known = new Map();      // snapshot file -> Map key -> code
  const needs = new Map();      // snapshot file -> Map key -> subject
  const at = (inc) => pickSnapshot(snapshots, Date.parse(`${String(inc.start || '').slice(0, 19).replace(' ', 'T')}Z`) / 1000 || null);
  const cacheFile = (snap) => join(cacheDir, `verdicts-${snap.day}.json`);
  const cached = async (snap) => {
    if (known.has(snap.file)) return known.get(snap.file);
    let m = new Map();
    try { const c = JSON.parse(await readFile(cacheFile(snap), 'utf8')); if (c.snapshot === snap.time) m = new Map(Object.entries(c.verdicts)); } catch { /* none yet */ }
    known.set(snap.file, m);
    return m;
  };
  const need = async (inc) => {
    const s = subjectOf(inc);
    if (!s) return;
    const snap = at(inc);
    if (!snap) return;
    const m = await cached(snap);
    if (m.has(s.key)) return;
    if (!needs.has(snap.file)) needs.set(snap.file, new Map());
    needs.get(snap.file).set(s.key, s);
  };
  // The table of a snapshot. It is kept only when nothing was missing: a database file of the day, or PeeringDB (the copy of the
  // day at CAIDA, else of one of the PEERINGDB_BACK days before, which is published a day late), so that a bad night is built
  // again by the next run instead of being kept for good. `complete` says whether it was kept.
  const tableOf = async (snap) => {
    const file = join(cacheDir, `table-${snap.day}.json`);
    try { const t = JSON.parse(await readFile(file, 'utf8')); if (t.snapshot === snap.time) return { table: t, complete: true }; } catch { /* to build */ }
    let pdbFile = null, pdbDay = null;
    for (let back = 0; back <= PEERINGDB_BACK && !pdbFile; back++) {
      const d = new Date(Date.parse(`${snap.day}T00:00:00Z`) - back * 864e5).toISOString().slice(0, 10);
      const f = join(cacheDir, `peeringdb-${d}.json`);
      try { await stat(f); pdbFile = f; pdbDay = d; } catch {
        try { await fetchTo(PEERINGDB_DUMP(d), f); pdbFile = f; pdbDay = d; } catch (err) { console.error(`PeeringDB of ${d}: ${err.message}`); }
      }
    }
    const t = await buildTable(dirname(snap.file), pdbFile);
    t.snapshot = snap.time; t.peeringdb_day = pdbDay;
    const complete = !t.missing.length;
    if (complete) {
      await writeFile(`${file}.tmp`, JSON.stringify(t));
      await rename(`${file}.tmp`, file);
    } else console.error(`IRR set table of ${snap.day} not kept, missing: ${t.missing.join(', ')}`);
    if (pdbFile) await unlink(pdbFile).catch(() => {});      // the table keeps what is needed of it
    return { table: t, complete };
  };
  const load = async () => {
    if (!needs.size) return;
    await mkdir(cacheDir, { recursive: true });
    for (const [file, subjects] of needs) {
      const snap = byFile.get(file);
      const { table, complete } = await tableOf(snap);
      const wanted = new Set();
      for (const s of subjects.values()) for (const p of s.prefixes) { wanted.add(p); for (const q of lessSpecifics(p)) wanted.add(q); }
      const originsOf = new Map();
      for await (const line of gzLines(file)) {
        if (line[0] === '#') continue;
        const tab = line.indexOf('\t');
        const p = snap.canonical ? line.slice(0, tab) : canonPrefix(line.slice(0, tab));
        if (!p || !wanted.has(p)) continue;
        const o = canonOrigin(line.split('\t')[1]);
        if (o === null) continue;
        if (!originsOf.has(p)) originsOf.set(p, new Set());
        originsOf.get(p).add(o);
      }
      const expand = expander(table), wideMemo = new Map();
      const m = await cached(snap);
      for (const s of subjects.values()) m.set(s.key, verdictOf(s, table, expand, originsOf, wideMemo));
      if (!complete) continue;                // verdicts of an incomplete table are used by this run only
      await writeFile(`${cacheFile(snap)}.tmp`, JSON.stringify({ snapshot: snap.time, verdicts: Object.fromEntries(m) }));
      await rename(`${cacheFile(snap)}.tmp`, cacheFile(snap));
    }
    needs.clear();
  };
  const verdict = (inc) => {
    const s = subjectOf(inc);
    if (!s) return null;
    const snap = at(inc);
    if (!snap) return 'not_covered';
    return (known.get(snap.file) || new Map()).get(s.key) || 'not_covered';
  };
  return { need, load, verdict };
}
