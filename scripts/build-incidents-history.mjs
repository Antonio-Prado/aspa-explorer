// The incidents of every day that is archived, from the first day of ASPA (12 October 2023) to yesterday: the same
// counts and verdicts as build-incidents.mjs, a day at a time, and the verdict of each incident in a file for each day.
// The incident files are the ones that run-incidents.sh keeps in archive/ (the recorder) and the ones that
// tools/backfill/backfill.py writes from the archive of RIPE RIS (the days before the recorder was started).
//   node scripts/build-incidents-history.mjs OUT_FILE --live=DIR --blocks=DIR[,DIR] --caida=DIR[,DIR] --days=DIR --detail=DIR
//        [--collector=rrc00] [--max-days=N]
//   --live     archive/ of the recorder: incidents_records_<epoch>.jsonl.xz, the state of incident.py is continuous
//   --blocks   working directories of the backfill: archive/ and days.jsonl (the block of each day). A block starts with an
//              empty state and ends by writing the incidents still open (incidents_open_<epoch>.jsonl.xz), so an incident
//              that began before the first day of its block is left out: the block before has it
//   --caida    directories with the CAIDA relationships (as-rel2-YYYYMMDD.bz2 or YYYYMMDD.as-rel2.txt.bz2): each day uses
//              the newest file that is not of a later month
//   --days     where the result of each day is kept (<day>.json): a day is read again only when its files change
//   --detail   where the verdict of each incident goes, a file for each day (<day>.jsonl.gz)
//   --max-days at most N days are read in a run (the others at the next one); the output has the days read so far
// A day is the UTC day in the name of the file: the day the incidents were written, which is the day they ended. The leaking
// ASes (RLK-FP, RLK-PV) are judged within each day. The ASPAs are the ones at the start of the day each incident began, from
// the history of changes (INCIDENTS_EVENTS, as build-incidents.mjs); a day before the history has no ASPA.
import { readFile, writeFile, rename, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { aspaMap, EVENTS } from './build-leaks.mjs';
import { relationSets, analyser, leakTracker, LEVELS } from './build-incidents.mjs';

const History = createRequire(import.meta.url)('../site/history.js');
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
export const FIRST_DAY = '2023-10-12';
const NAME = /^incidents_(records|open)_(\d+)\.jsonl\.xz$/;
const dayOf = (epoch) => new Date(epoch * 1000).toISOString().slice(0, 10);

// The files of each day: Map day -> [{ file, size, since }], `since` the first day of the block of a backfill file (null for
// the recorder). A backfill file whose day is not yet in days.jsonl waits for the next run.
export async function sources(live, blocks) {
  const days = new Map();
  const put = (day, x) => { if (day >= FIRST_DAY) { if (!days.has(day)) days.set(day, []); days.get(day).push(x); } };
  const list = async (dir) => { try { return (await readdir(dir)).sort(); } catch { return []; } };
  for (const dir of live) {
    for (const f of await list(dir)) {
      const m = NAME.exec(f);
      if (m && m[1] === 'records') put(dayOf(Number(m[2])), { file: join(dir, f), size: (await stat(join(dir, f))).size, since: null });
    }
  }
  for (const dir of blocks) {
    const first = new Map();
    let text = '';
    try { text = await readFile(join(dir, 'days.jsonl'), 'utf8'); } catch { /* no day done yet */ }
    for (const line of text.split('\n')) {
      try { const r = JSON.parse(line); if (r && !r.warmup && r.day && /^\d{4}-\d{2}-\d{2}_/.test(r.block || '')) first.set(r.day, r.block.slice(0, 10)); } catch { /* a cut line */ }
    }
    for (const f of await list(join(dir, 'archive'))) {
      const m = NAME.exec(f);
      if (!m) continue;
      const day = dayOf(Number(m[2]));
      if (first.has(day)) put(day, { file: join(dir, 'archive', f), size: (await stat(join(dir, 'archive', f))).size, since: first.get(day) });
    }
  }
  return days;
}
const keyOf = (list) => list.map((x) => `${x.file.split('/').pop()}:${x.size}:${x.since || ''}`).sort().join('|');

// The incidents of the files of a day, one at a time; `only`: as readIncidents of build-incidents.mjs.
export async function* readDay(list, only = null) {
  for (const src of list) {
    const xz = spawn('xz', ['-dc', src.file], { stdio: ['ignore', 'pipe', 'inherit'] });
    const ended = new Promise((resolve, reject) => { xz.once('error', reject); xz.once('close', (code) => (code ? reject(new Error(`xz: ${src.file}: exit ${code}`)) : resolve())); });
    ended.catch(() => {});
    for await (const line of createInterface({ input: xz.stdout, crlfDelay: Infinity })) {
      if (only && !only.test(line)) continue;
      let o = null;
      try { o = JSON.parse(line); } catch { /* a cut line */ }
      if (!o || typeof o !== 'object' || !o.incident_type) continue;
      if (src.since && typeof o.start === 'string' && o.start.slice(0, 10) < src.since) continue;
      yield o;
    }
    await ended;
  }
}
const LEAKS_ONLY = /"incident_type"\s*:\s*"RLK"/;

// The relationships for a day: the newest file that is not of a later month, or the oldest one there is.
export function caidaFor(files, day) {
  const month = day.slice(0, 7).replace('-', '');
  const ok = files.filter((f) => f.date.slice(0, 6) <= month);
  return ok.length ? ok[ok.length - 1] : files[0];
}
async function caidaFiles(dirs) {
  const out = [];
  for (const dir of dirs) {
    let names = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const f of names) {
      const m = /^as-rel2-(\d{8})\.bz2$/.exec(f) || /^(\d{8})\.as-rel2\.txt\.bz2$/.exec(f);
      if (m) out.push({ date: m[1], file: join(dir, f) });
    }
  }
  const seen = new Set();
  return out.sort((a, b) => a.date.localeCompare(b.date)).filter((f) => !seen.has(f.date) && seen.add(f.date));
}

// The sum of the results of analyser() of several days (every number is a count; `ases` is the one of the last day).
export function sum(results) {
  const add3 = (a, b) => a.map((v, i) => v + b[i]);
  const bucket = (a, b) => (a ? { incidents: a.incidents + b.incidents, with_path: a.with_path + b.with_path, real: add3(a.real, b.real), ideal: add3(a.ideal, b.ideal) } : structuredClone(b));
  const out = { period: { from: null, to: null }, total: null, by_type: {}, subtypes: {}, adoption: { levels: LEVELS, ases: 0, base: {}, random: {}, largest: {} } };
  for (const r of results) {
    if (r.period.from && (!out.period.from || r.period.from < out.period.from)) out.period.from = r.period.from;
    if (r.period.to && (!out.period.to || r.period.to > out.period.to)) out.period.to = r.period.to;
    out.total = bucket(out.total, r.total);
    for (const [k, b] of Object.entries(r.by_type)) out.by_type[k] = bucket(out.by_type[k], b);
    for (const [k, b] of Object.entries(r.subtypes)) out.subtypes[k] = bucket(out.subtypes[k], b);
    out.adoption.ases = r.adoption.ases;
    for (const [k, n] of Object.entries(r.adoption.base)) out.adoption.base[k] = (out.adoption.base[k] || 0) + n;
    for (const o of ['random', 'largest']) {
      for (const [k, list] of Object.entries(r.adoption[o])) out.adoption[o][k] = out.adoption[o][k] ? add3(out.adoption[o][k], list) : [...list];
    }
  }
  out.total ||= { incidents: 0, with_path: 0, real: [0, 0, 0], ideal: [0, 0, 0] };
  return out;
}

// One day: its result (as analyser().result()) and, with `detailFile`, the verdict of each incident, gzipped.
export async function buildDay(list, aspasOf, rel, detailFile = null) {
  const tracker = leakTracker();
  for await (const inc of readDay(list, LEAKS_ONLY)) tracker.add(inc);
  const a = analyser(aspasOf, rel.providers, rel.degree, tracker.result());
  let out = null, gz = null, failed = null;
  if (detailFile) {
    gz = createGzip({ level: 6 });
    out = createWriteStream(`${detailFile}.tmp`);
    failed = new Promise((_, reject) => { out.once('error', reject); gz.once('error', reject); });
    failed.catch(() => {});
    gz.pipe(out);
  }
  const work = async () => {
    for await (const inc of readDay(list)) {
      const row = a.add(inc);
      if (gz && !gz.write(JSON.stringify(row) + '\n')) await once(gz, 'drain');
    }
    if (gz) { gz.end(); await once(out, 'finish'); }
  };
  try { await (failed ? Promise.race([work(), failed]) : work()); } catch (err) {
    if (out) { out.destroy(); await rm(`${detailFile}.tmp`, { force: true }); }
    throw err;
  }
  if (detailFile) await rename(`${detailFile}.tmp`, detailFile);
  return a.result();
}

// The line of a day for the chart: the counts, without the curves.
export const rowOf = (day, r) => ({
  day, incidents: r.total.incidents, with_path: r.total.with_path, real: r.total.real,
  types: Object.fromEntries(Object.entries(r.by_type).map(([k, b]) => [k, b.incidents])),
});

// The periods of the page: everything, and each calendar year.
export function periods(byDay) {
  const days = [...byDay.keys()].sort();
  const make = (list) => ({ days: list.length, first: list[0], last: list[list.length - 1], ...sum(list.map((d) => byDay.get(d))) });
  const out = { all: make(days) };
  for (const y of [...new Set(days.map((d) => d.slice(0, 4)))]) out[y] = make(days.filter((d) => d.startsWith(y)));
  return out;
}

const readJson = async (src) => (/^https?:/.test(src)
  ? await (await fetch(src, { headers: { 'User-Agent': UA } })).json() : JSON.parse(await readFile(src, 'utf8')));
const write = async (file, text) => { const tmp = `${file}.tmp`; await writeFile(tmp, text); await rename(tmp, file); };

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => (argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
  const dirs = (n) => flag(n).split(',').filter(Boolean);
  const [outFile] = argv.filter((a) => !a.startsWith('--'));
  if (!outFile || !flag('days') || !flag('detail') || !(dirs('live').length + dirs('blocks').length)) {
    console.error('usage: build-incidents-history.mjs OUT_FILE --live=DIR --blocks=DIR[,DIR] --caida=DIR[,DIR] --days=DIR --detail=DIR [--collector=rrc00] [--max-days=N]');
    process.exit(2);
  }
  const daysDir = flag('days'), detailDir = flag('detail'), max = Number(flag('max-days')) || Infinity;
  await mkdir(daysDir, { recursive: true });
  await mkdir(detailDir, { recursive: true });
  const src = await sources(dirs('live'), dirs('blocks'));
  const caida = await caidaFiles(dirs('caida'));
  if (!caida.length) throw new Error('no CAIDA relationships file in --caida');

  const events = await readJson(process.env.INCIDENTS_EVENTS || EVENTS);
  if (!Array.isArray(events) || !events.length) throw new Error('the history of changes is empty: not building');
  const aspaDays = new Map();
  const aspasOf = (d) => {
    if (!aspaDays.has(d)) {
      if (aspaDays.size > 400) aspaDays.clear();
      aspaDays.set(d, d ? aspaMap([...History.replayBefore(events, d)].map(([customer, providers]) => ({ customer, providers }))) : new Map());
    }
    return aspaDays.get(d);
  };

  const unbz = async (f) => (await promisify(execFile)('bunzip2', ['-c', f], { maxBuffer: 1 << 30 })).stdout;
  let rel = null;
  const byDay = new Map(), used = new Set();
  let built = 0, waiting = 0;
  for (const day of [...src.keys()].sort().reverse()) {          // the newest first: a first run shows the recent days soon
    const list = src.get(day), key = keyOf(list), file = join(daysDir, `${day}.json`);
    let cached = null;
    try { cached = JSON.parse(await readFile(file, 'utf8')); } catch { /* not built yet */ }
    if (!cached || cached.key !== key) {
      if (built >= max) { waiting++; if (!cached) continue; }
      else {
        const c = caidaFor(caida, day);
        if (!rel || rel.date !== c.date) rel = { date: c.date, ...relationSets(await unbz(c.file)) };
        const result = await buildDay(list, aspasOf, rel, join(detailDir, `${day}.jsonl.gz`));
        cached = { key, caida: c.date, result };
        await write(file, JSON.stringify(cached) + '\n');
        built++;
        console.log(`${day}: ${result.total.incidents} incidents (CAIDA ${c.date})`);
      }
    }
    byDay.set(day, cached.result);
    used.add(cached.caida);
  }
  if (!byDay.size) throw new Error('no day is built: not publishing');

  const all = [...byDay.keys()].sort();
  const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const expected = Math.round((Date.parse(yesterday) - Date.parse(FIRST_DAY)) / 86400e3) + 1;
  const months = [...used].sort();
  const doc = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    collector: flag('collector') || 'rrc00',
    first_day: FIRST_DAY,
    days_expected: expected,
    days_covered: all.length,
    aspas: 'history',
    relationships: `CAIDA AS Relationships, serial-2, the file of the month of each day (${months[0]} to ${months[months.length - 1]})`,
    detail: '/api/v1/incidents/{collector}/{day}.jsonl.gz',
    days: all.map((d) => rowOf(d, byDay.get(d))),
    periods: periods(byDay),
  };
  await write(outFile, JSON.stringify(doc) + '\n');
  console.log(`${doc.generated}: ${all.length} of ${expected} days, ${doc.periods.all.total.incidents} incidents, ${built} days read${waiting ? `, ${waiting} waiting` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
