// What the ASPAs say about the routing incidents that the project's detectors found (data_scripts, incident.py).
// For each incident (the files incidents_*.jsonl[.gz] written by incident.py) the AS paths it kept (the path of the valley, the
// paths of its messages) are checked with the downstream procedure, in three ways:
//   - with the ASPAs that were published on the day the incident began (replayed from the history of changes);
//   - with complete ASPAs: every AS publishes the providers that CAIDA infers for it (the best case, and not independent of CAIDA);
//   - with a part of the ASes publishing those complete ASPAs, from 0 to 100%, in a random order and the largest networks first.
// The result is an aggregate (no AS number; `period` is the time, in UTC, of the first incident and of the last), served as /api/v1/incidents.json; with --detail the verdict of each incident goes to a
// file that is not published.
//   node scripts/build-incidents.mjs OUT_FILE [FILE_OR_DIR ...] [--detail=FILE] [--caida=FILE] [--cache=DIR]
// Environment:
//   INCIDENTS_EVENTS   URL or file of the history of changes (the events.json of the history branch), default as build-leaks.mjs
//   ASPA_DATA          URL or file of today's ASPAs, used for a day that the history does not cover
import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classify, aspaMap, EVENTS } from './build-leaks.mjs';

const History = createRequire(import.meta.url)('../site/history.js');
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

export const TYPES = ['RLK', 'PRH', 'DEG', 'VOL', 'ATR', 'ASM'];
// A leaking AS that sends the leak to this many different neighbours in the period is taken as a full propagation (RLK-FP).
export const FP_MIN_NEIGHBOURS = 3;
export const LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const MAX_BYTES = 1 << 30;

// CAIDA as-rel2 text -> { providers: Map AS -> Set of its providers, degree: Map AS -> number of its customers }.
// Every AS of the file is a key of `providers`: an AS with no provider has an empty set, which is what an AS0 ASPA says.
export function relationSets(text) {
  const providers = new Map(), degree = new Map();
  const seen = (a) => { if (!providers.has(a)) providers.set(a, new Set()); };
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('|');
    const a = Number(f[0]), b = Number(f[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    seen(a); seen(b);
    if (f[2] === '-1') { providers.get(b).add(a); degree.set(a, (degree.get(a) || 0) + 1); }
  }
  return { providers, degree };
}

// The incidents of a file written by incident.py: one JSON object for each line, the lines that are not are skipped.
export function parseIncidents(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const o = parseLine(line);
    if (o) out.push(o);
  }
  return out;
}
function parseLine(line) {
  if (!line.trim()) return null;
  try { const o = JSON.parse(line); return o && typeof o === 'object' && o.incident_type ? o : null; } catch { return null; /* a cut line */ }
}

// What the analysis keeps of an incident: the fields it reads and the paths, not the prefixes and the messages (a day of
// incidents is hundreds of thousands of them, in a file of hundreds of megabytes).
export const slim = (o) => ({ incident_type: o.incident_type, actor_key: o.actor_key, start: o.start, end: o.end, end_reason: o.end_reason, details: o.details, paths: pathsOf(o) });

// The incidents of a file (plain or gzipped), read line by line, each reduced by `slim`.
export async function readIncidents(file) {
  const out = [];
  let input = createReadStream(file);
  if (file.endsWith('.gz')) input = input.pipe(createGunzip());
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const o = parseLine(line);
    if (o) out.push(slim(o));
  }
  return out;
}

// The paths that an incident carries, origin first and without prepending, as the ASPA procedure wants them: the path of the
// valley (RLK) and the ones of the announcements it kept. incident.py has them neighbour first.
export function pathsOf(inc) {
  if (Array.isArray(inc.paths)) return inc.paths;
  const raw = [];
  if (inc.details && Array.isArray(inc.details.path)) raw.push(inc.details.path);
  for (const m of inc.messages || []) if (m && m.type === 'A' && Array.isArray(m.compressed_path)) raw.push(m.compressed_path);
  const seen = new Set(), out = [];
  for (const p of raw) {
    if (!p.every((a) => Number.isInteger(a) && a > 0)) continue;
    const q = [...p].reverse().filter((a, i, l) => i === 0 || a !== l[i - 1]);
    const key = q.join(' ');
    if (q.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

// 0 valid, 1 unknown, 2 invalid: the worst of the paths of the incident; null when it has none (volatility, mass withdrawals).
export function verdictOf(aspas, paths) {
  if (!paths.length) return null;
  let worst = 0;
  for (const p of paths) worst = Math.max(worst, classify(aspas, p));
  return worst;
}

// Two orders in which the ASes start to publish: the same for every run (a hash of the number), and the largest networks first
// (by the number of customers CAIDA gives them).
export function orders(ideal, degree) {
  const keys = [...ideal.keys()];
  const hash = (a) => Math.imul(a, 2654435761) >>> 0;
  const random = [...keys].sort((a, b) => hash(a) - hash(b) || a - b);
  const largest = [...keys].sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0) || a - b);
  const rank = (list) => new Map(list.map((a, i) => [a, i]));
  return { random: rank(random), largest: rank(largest), n: keys.length };
}

// The complete ASPAs of the first `level` percent of the ASes of an order.
const limited = (ideal, rank, cut) => ({ get: (as) => (rank.get(as) < cut ? ideal.get(as) : undefined) });

const empty = () => ({ incidents: 0, with_path: 0, real: [0, 0, 0], ideal: [0, 0, 0] });
// The type of the survey that an incident has, when the detector says (extra_detectors.py of the copy of the scripts):
// RLK-UL, RLK-LL (the leak type that incident.py records), RLK-FP (the same AS leaks to FP_MIN_NEIGHBOURS neighbours or more:
// it takes the place of UL and LL), PRH-AB, ASM-FI, ASM-PS, ASM-PE, ASM-EX, VOL-FO, VOL-DC, VOL-AC, DEG-MA (another origin than
// the aggregate), DEG-XS (excessive: careless, exploitative or malicious, the intent is not visible; a jump counts here), DEG-FF,
// ATR-EH and ATR-MA (a session ended by an UPDATE message error). `receivers`: Map leaking AS -> Set of the ASes that it leaked to.
export function subtypeOf(inc, receivers) {
  const d = inc.details || {};
  switch (inc.incident_type) {
    case 'RLK':
      if (receivers.get(d.by)?.size >= FP_MIN_NEIGHBOURS) return 'RLK-FP';
      return d.rlk_type === 'UL' || d.rlk_type === 'LL' ? `RLK-${d.rlk_type}` : null;
    case 'PRH': return d.prh_type === 'AB' ? 'PRH-AB' : null;
    case 'ASM': return ['FI', 'PS', 'PE', 'EX'].includes(d.asm_type) ? `ASM-${d.asm_type}` : null;
    case 'VOL': {
      const t = d.vol_type || (d.flap_count !== undefined ? 'FO' : null);
      return ['FO', 'DC', 'AC'].includes(t) ? `VOL-${t}` : null;
    }
    case 'DEG':
      if (d.deg_type === 'flood') return 'DEG-FF';
      if (d.deg_type === 'excessive' || d.deg_type === 'jump') return 'DEG-XS';
      return /^Cross-Origin/.test(d.anomaly || '') ? 'DEG-MA' : null;
    case 'ATR': return d.atr_type === 'EH' || d.atr_type === 'MA' ? `ATR-${d.atr_type}` : null;
    default: return null;
  }
}

const day = (start) => (/^\d{4}-\d{2}-\d{2}/.test(start || '') ? start.slice(0, 10) : null);
const stamp = (t) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t || '') ? t.slice(0, 19) : null);

// incidents: parsed; aspasOf(day): the ASPA lookup of a day (Map AS number -> Set of providers); ideal, degree: complete ASPAs
export function analyse(incidents, aspasOf, ideal, degree, detail = null) {
  const ord = orders(ideal, degree);
  const byType = {}, bySub = {}, adoption = { random: {}, largest: {} };
  const receivers = new Map();
  for (const inc of incidents) {
    const d = inc.details || {};
    if (inc.incident_type === 'RLK' && d.by !== undefined && d.to !== undefined) { if (!receivers.has(d.by)) receivers.set(d.by, new Set()); receivers.get(d.by).add(d.to); }
  }
  const bucket = (t) => (byType[t] ||= empty());
  const curve = (o, t) => (adoption[o][t] ||= new Array(LEVELS.length).fill(0));
  const total = empty();
  let from = null, to = null;
  for (const inc of incidents) {
    const t = TYPES.includes(inc.incident_type) ? inc.incident_type : 'other';
    const b = bucket(t);
    const sub = subtypeOf(inc, receivers);
    const sb = sub ? (bySub[sub] ||= empty()) : null;
    const all = sb ? [b, total, sb] : [b, total];
    for (const x of all) x.incidents++;
    const s = day(inc.start);
    const t0 = stamp(inc.start), t1 = stamp(inc.end) || t0;
    if (t0 && (!from || t0 < from)) from = t0;
    if (t1 && (!to || t1 > to)) to = t1;
    const paths = pathsOf(inc);
    if (!paths.length) { detail?.push({ type: t, subtype: sub, actor: inc.actor_key, start: inc.start, end: inc.end, end_reason: inc.end_reason, paths: 0 }); continue; }
    const real = verdictOf(aspasOf(s), paths), full = verdictOf(ideal, paths);
    for (const x of all) { x.with_path++; x.real[real]++; x.ideal[full]++; }
    for (const o of ['random', 'largest']) {
      LEVELS.forEach((level, i) => {
        if (verdictOf(limited(ideal, ord[o], Math.round((ord.n * level) / 100)), paths) === 2) { curve(o, t)[i]++; curve(o, 'total')[i]++; }
      });
    }
    detail?.push({ type: t, subtype: sub, actor: inc.actor_key, start: inc.start, end: inc.end, end_reason: inc.end_reason, paths: paths.length,
      real: ['valid', 'unknown', 'invalid'][real], complete: ['valid', 'unknown', 'invalid'][full] });
  }
  for (const o of ['random', 'largest']) for (const t of [...Object.keys(byType), 'total']) curve(o, t);
  return { period: { from, to }, total, by_type: byType, subtypes: bySub, adoption: { levels: LEVELS, ases: ord.n, ...adoption } };
}

async function files(args) {
  const out = [];
  for (const a of args) {
    if ((await stat(a)).isDirectory()) {
      for (const f of (await readdir(a)).sort()) if (/^incidents_[^/]*\.jsonl(\.gz)?$/.test(f)) out.push(join(a, f));
    } else out.push(a);
  }
  return out;
}
const readJson = async (src) => (/^https?:/.test(src)
  ? await (await fetch(src, { headers: { 'User-Agent': UA } })).json() : JSON.parse(await readFile(src, 'utf8')));

async function caidaText(flag, cache) {
  const unbz = async (f) => (await promisify(execFile)('bunzip2', ['-c', f], { maxBuffer: MAX_BYTES })).stdout;
  if (flag) return { text: flag.endsWith('.bz2') ? await unbz(flag) : await readFile(flag, 'utf8'), source: `CAIDA AS Relationships, ${flag.split('/').pop()}` };
  const names = (await readdir(cache)).filter((f) => /^as-rel2-\d{8}\.bz2$/.test(f)).sort();
  if (!names.length) throw new Error('no CAIDA relationships file: give --caida=FILE or --cache=DIR');
  const last = names[names.length - 1];
  return { text: await unbz(join(cache, last)), source: `CAIDA AS Relationships, serial-2, ${last.slice(8, 16)}` };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => (argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
  const [outFile, ...inputs] = argv.filter((a) => !a.startsWith('--'));
  if (!outFile || !inputs.length) { console.error('usage: build-incidents.mjs OUT_FILE FILE_OR_DIR ... [--detail=FILE] [--caida=FILE] [--cache=DIR]'); process.exit(2); }
  const list = await files(inputs);
  const incidents = [];
  for (const f of list) for (const inc of await readIncidents(f)) incidents.push(inc);
  if (!incidents.length) throw new Error('no incident in the input: not publishing');

  const cache = flag('cache') || join(dirname(outFile), 'cache');
  const rel = await caidaText(flag('caida'), cache);
  const { providers: ideal, degree } = relationSets(rel.text);

  // the ASPAs of each day on which an incident began; a day that the history does not cover has today's
  let events = null;
  try { events = await readJson(process.env.INCIDENTS_EVENTS || EVENTS); } catch (err) { console.error(`history not available (${err.message}): today's ASPAs are used`); }
  const cacheDays = new Map();
  let today = null, fallbacks = 0;
  const aspasOf = (d) => {
    if (cacheDays.has(d)) return cacheDays.get(d);
    let m = events && d ? aspaMap([...History.replay(events, d)].map(([customer, providers]) => ({ customer, providers }))) : null;
    if (!m || !m.size) { m = today; fallbacks++; }
    cacheDays.set(d, m);
    return m;
  };
  const current = await readJson(process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json');
  today = aspaMap(current.aspas);

  const detail = flag('detail') ? [] : null;
  const res = analyse(incidents, aspasOf, ideal, degree, detail);
  const doc = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    files: list.length,
    aspas: events ? (fallbacks ? 'history, today for days it does not cover' : 'history') : 'today',
    relationships: rel.source,
    ...res,
  };
  const write = async (file, text) => { const tmp = `${file}.tmp`; await writeFile(tmp, text); await rename(tmp, file); };
  await write(outFile, JSON.stringify(doc) + '\n');
  if (detail) await write(flag('detail'), detail.map((d) => JSON.stringify(d)).join('\n') + '\n');
  console.log(`${doc.generated}: ${doc.total.incidents} incidents (${doc.total.with_path} with a path) from ${doc.period.from} to ${doc.period.to} UTC`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
