// The incidents of every day that is archived, from the first day of ASPA (12 October 2023) to yesterday: the same
// counts and verdicts as build-incidents.mjs, a day at a time, and the verdict of each incident in a file for each day.
// The incident files are the ones that run-incidents.sh keeps in archive/ (the recorder) and the ones that
// tools/backfill/backfill.py writes from the archive of RIPE RIS (the days before the recorder was started).
//   node scripts/build-incidents-history.mjs OUT_FILE --live=DIR --blocks=DIR[,DIR] --caida=DIR[,DIR] --days=DIR --detail=DIR
//        [--collector=rrc00] [--live-from=DAY] [--max-files=N]
//   --live     archive/ of the recorder: incidents_records_<epoch>.jsonl.xz, the state of incident.py is continuous
//   --live-from the first day that the files of the recorder cover in full (YYYY-MM-DD): its incidents that ended before
//              are left out, the backfill has those days
//   --blocks   working directories of the backfill: archive/ and days.jsonl (the block of each day). A block starts with an
//              empty state and ends by writing the incidents still open (incidents_open_<epoch>.jsonl.xz), so an incident
//              that began before the first day of its block is left out: the block before has it
//   --caida    directories with the CAIDA relationships (as-rel2-YYYYMMDD.bz2 or YYYYMMDD.as-rel2.txt.bz2): each day uses
//              the newest file that is not of a later month
//   --days     where the result of each file is kept (<file>.json, and <file>/<day>.jsonl.gz with its incidents of each
//              day): a file is read again only when it changes
//   --detail   where the verdict of each incident goes, a file for each day (<day>.jsonl.gz)
//   --max-files at most N files are read in a run (the others at the next one); the output has the days read so far
// A day is the UTC day an incident ended, not the day in the name of its file: a file of the recorder can hold more days
// (data read again, or read late), and the incidents that end around midnight are in the file of the day after. The
// leaking ASes (RLK-FP, RLK-PV) are judged within each day of each file. The ASPAs are the ones known when each incident
// began, from the timeline of the ASPAs (ASPA_TIMELINE, as build-incidents.mjs): before the first ASPA there is none.
import { readFile, writeFile, rename, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { relationSets, analyser, leakTracker, byTimeline, RULE, LEVELS } from './build-incidents.mjs';
import { loadTimeline, ARCHIVE_TO } from './aspa-timeline.mjs';
// the files that can hold an incident of the days of the job (two days of margin for the ones written late)
const JOB_FILES_FROM = new Date(Date.parse(`${ARCHIVE_TO}T00:00:00Z`) - 2 * 864e5).toISOString().slice(0, 10);

const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
export const FIRST_DAY = '2023-10-12';
const NAME = /^incidents_(records|open)_(\d+)\.jsonl\.xz$/;
const dayOf = (epoch) => new Date(epoch * 1000).toISOString().slice(0, 10);

// The incident files: [{ file, name, size, day, since }], `day` the UTC day in the name, `since` the first day of the block
// of a backfill file (null for the recorder). A backfill file whose day is not yet in days.jsonl waits for the next run.
export async function sources(live, blocks, liveFrom = null) {
  const out = [];
  const list = async (dir) => { try { return (await readdir(dir)).sort(); } catch { return []; } };
  for (const dir of live) {
    for (const f of await list(dir)) {
      const m = NAME.exec(f);
      if (m && m[1] === 'records') out.push({ file: join(dir, f), name: f, size: (await stat(join(dir, f))).size, day: dayOf(Number(m[2])), since: null, from: liveFrom });
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
      if (first.has(day)) out.push({ file: join(dir, 'archive', f), name: f, size: (await stat(join(dir, 'archive', f))).size, day, since: first.get(day) });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}
const keyOf = (x) => `${x.size}:${x.since || ''}${x.from ? `:from ${x.from}` : ''}`;
// The day of an incident: the UTC day it ended (or began, when it has no end); `fallback` when it has neither.
export const dayOfIncident = (inc, fallback) => {
  for (const t of [inc.end, inc.start]) if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return fallback;
};

// The incidents of some files, one at a time; `only`: as readIncidents of build-incidents.mjs.
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
      if (src.from && dayOfIncident(o, src.day) < src.from) continue;
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

// A result made before the rule of the timeline has no `soft` and `could`: none of its verdicts was looked at for that.
const zero3 = (b) => ({ ...b, soft: b.soft || [0, 0, 0], could: b.could || [0, 0, 0] });
export const withCounts = (r) => ({ ...r, total: zero3(r.total), by_type: Object.fromEntries(Object.entries(r.by_type).map(([k, b]) => [k, zero3(b)])), subtypes: Object.fromEntries(Object.entries(r.subtypes).map(([k, b]) => [k, zero3(b)])) });

// The sum of the results of analyser() of several days (every number is a count; `ases` is the one of the last day).
export function sum(results) {
  const add3 = (a, b) => a.map((v, i) => v + b[i]);
  const bucket = (a, b) => (a ? { incidents: a.incidents + b.incidents, with_path: a.with_path + b.with_path, real: add3(a.real, b.real), soft: add3(a.soft, b.soft), could: add3(a.could, b.could), ideal: add3(a.ideal, b.ideal) } : structuredClone(b));
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
  out.total ||= { incidents: 0, with_path: 0, real: [0, 0, 0], soft: [0, 0, 0], could: [0, 0, 0], ideal: [0, 0, 0] };
  return out;
}

// One file: the result of each day it has incidents of (Map day -> analyser().result()) and, with `partsDir`, the verdict
// of each incident in a gzipped file for each day (partsDir/<day>.jsonl.gz).
export async function buildFile(src, aspasOf, rel, partsDir = null) {
  const trackers = new Map();
  for await (const inc of readDay([src], LEAKS_ONLY)) {
    const d = dayOfIncident(inc, src.day);
    if (!trackers.has(d)) trackers.set(d, leakTracker());
    trackers.get(d).add(inc);
  }
  if (partsDir) { await rm(partsDir, { recursive: true, force: true }); await mkdir(partsDir, { recursive: true }); }
  const days = new Map();          // day -> { a: analyser, gz, out }
  let fail = null;
  const failed = new Promise((_, reject) => { fail = reject; });
  failed.catch(() => {});
  const open = (d) => {
    const x = { a: analyser(aspasOf, rel.providers, rel.degree, trackers.has(d) ? trackers.get(d).result() : leakTracker().result()) };
    if (partsDir) {
      x.gz = createGzip({ level: 6 });
      x.out = createWriteStream(join(partsDir, `${d}.jsonl.gz`));
      x.out.once('error', fail); x.gz.once('error', fail);
      x.gz.pipe(x.out);
    }
    days.set(d, x);
    return x;
  };
  const work = async () => {
    for await (const inc of readDay([src])) {
      const d = dayOfIncident(inc, src.day);
      const x = days.get(d) || open(d);
      const row = x.a.add(inc);
      if (x.gz && !x.gz.write(JSON.stringify(row) + '\n')) await once(x.gz, 'drain');
    }
    for (const x of days.values()) if (x.gz) { x.gz.end(); await once(x.out, 'finish'); }
  };
  try { await Promise.race([work(), failed]); } catch (err) {
    for (const x of days.values()) x.out?.destroy();
    if (partsDir) await rm(partsDir, { recursive: true, force: true });
    throw err;
  }
  return new Map([...days].map(([d, x]) => [d, x.a.result()]));
}

// The file of a day: the parts of the files that have incidents of it, one after the other (gzip members).
async function assemble(parts, file) {
  const out = createWriteStream(`${file}.tmp`);
  try {
    for (const p of parts) { const r = createReadStream(p); r.pipe(out, { end: false }); await once(r, 'end'); }
    out.end();
    await once(out, 'finish');
  } catch (err) { out.destroy(); await rm(`${file}.tmp`, { force: true }); throw err; }
  await rename(`${file}.tmp`, file);
}

// The line of a day for the chart: the counts, without the curves.
export const rowOf = (day, r) => ({
  day, incidents: r.total.incidents, with_path: r.total.with_path, real: r.total.real, soft: r.total.soft, could: r.total.could,
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
    console.error('usage: build-incidents-history.mjs OUT_FILE --live=DIR --blocks=DIR[,DIR] --caida=DIR[,DIR] --days=DIR --detail=DIR [--collector=rrc00] [--live-from=DAY] [--max-files=N]');
    process.exit(2);
  }
  const daysDir = flag('days'), detailDir = flag('detail'), max = Number(flag('max-files')) || Infinity;
  await mkdir(daysDir, { recursive: true });
  await mkdir(detailDir, { recursive: true });
  const liveFrom = /^\d{4}-\d{2}-\d{2}$/.test(flag('live-from')) ? flag('live-from') : null;
  const src = await sources(dirs('live'), dirs('blocks'), liveFrom);
  const caida = await caidaFiles(dirs('caida'));
  if (!caida.length) throw new Error('no CAIDA relationships file in --caida');

  // the ASPAs known when each incident began: the timeline (scripts/build-timeline.mjs keeps it); without a good one the run
  // ends here and what was published before stays
  const tl = await loadTimeline(process.env.ASPA_TIMELINE || join(outFile, '..', 'timeline.json'), Number(process.env.ASPA_TIMELINE_MAX_AGE) || undefined);
  const aspasOf = byTimeline(tl);

  const unbz = async (f) => (await promisify(execFile)('bunzip2', ['-c', f], { maxBuffer: 1 << 30 })).stdout;
  let rel = null;
  const perDay = new Map(), parts = new Map(), dirty = new Set(), used = new Set();      // day -> results, day -> part files
  let built = 0, waiting = 0, other = 0;
  for (const x of [...src].reverse()) {          // the newest first: a first run shows the recent days soon
    const key = keyOf(x), file = join(daysDir, `${x.name}.json`), partsDir = join(daysDir, x.name);
    let cached = null;
    try { cached = JSON.parse(await readFile(file, 'utf8')); } catch { /* not built yet */ }
    // a file is read again when it changed, when what is kept of it was made with another rule, when some of its incidents
    // ended after the horizon the timeline had then (whether their verdicts are firm was not known) and the timeline has moved
    // on, and when it was read with a timeline of another version and is of the days of the job (a version changes the times
    // of the commits of the job, not the ones of the archive: the files of before stay as they are)
    const otherTimeline = cached && cached.rule === RULE && x.day >= JOB_FILES_FROM && cached.tl !== tl.version;
    if (!cached || cached.key !== key || cached.rule !== RULE || otherTimeline || (cached.late && tl.horizon > cached.horizon)) {
      if (built >= max) { waiting++; if (!cached) continue; }
      else {
        const c = caidaFor(caida, x.day);
        if (!rel || rel.date !== c.date) rel = { date: c.date, ...relationSets(await unbz(c.file)) };
        aspasOf.late = 0;
        const days = await buildFile(x, aspasOf, rel, partsDir);
        for (const d of Object.keys((cached || {}).days || {})) dirty.add(d);
        cached = { key, rule: RULE, tl: tl.version, horizon: tl.horizon, late: aspasOf.late, caida: c.date, days: Object.fromEntries(days) };
        await write(file, JSON.stringify(cached) + '\n');
        for (const d of days.keys()) dirty.add(d);
        built++;
        console.log(`${x.name}: ${[...days.values()].reduce((n, r) => n + r.total.incidents, 0)} incidents in ${days.size} day${days.size === 1 ? '' : 's'} (CAIDA ${c.date})`);
      }
    }
    // a file that waits to be read again with the rule of now is counted, so that the document says how much of it is of the
    // rule before (the first runs after a change of rule: the newest files are read first)
    if (cached.rule !== RULE) other++;
    for (const [d, r0] of Object.entries(cached.days)) {
      if (d < FIRST_DAY) continue;
      const r = cached.rule === RULE ? r0 : withCounts(r0);
      if (!perDay.has(d)) { perDay.set(d, []); parts.set(d, []); }
      perDay.get(d).push(r);
      parts.get(d).push(join(partsDir, `${d}.jsonl.gz`));
    }
    used.add(cached.caida);
  }
  // the day that is going on is left out until it has ended: the recorder closes a file every hour, and a part of a day
  // would read as a day with fewer incidents
  const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const byDay = new Map([...perDay].filter(([d]) => d <= yesterday).map(([d, list]) => [d, list.length === 1 ? list[0] : sum(list)]));
  for (const d of byDay.keys()) {
    const out = join(detailDir, `${d}.jsonl.gz`);
    let there = true;
    try { await stat(out); } catch { there = false; }
    if (dirty.has(d) || !there) await assemble(parts.get(d).sort(), out);
  }
  if (!byDay.size) throw new Error('no day is built: not publishing');

  const all = [...byDay.keys()].sort();
  const expected = Math.round((Date.parse(yesterday) - Date.parse(FIRST_DAY)) / 86400e3) + 1;
  const months = [...used].sort();
  const doc = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    collector: flag('collector') || 'rrc00',
    first_day: FIRST_DAY,
    days_expected: expected,
    days_covered: all.length,
    aspas: 'timeline',
    rule: RULE,
    files_of_the_rule_before: other,
    timeline: { steps: tl.steps.length, horizon: new Date(tl.horizon * 1000).toISOString().replace(/\.\d+Z$/, 'Z') },
    relationships: `CAIDA AS Relationships, serial-2, the file of the month of each day (${months[0]} to ${months[months.length - 1]})`,
    detail: '/api/v1/incidents/{collector}/{day}.jsonl.gz',
    days: all.map((d) => rowOf(d, byDay.get(d))),
    periods: periods(byDay),
  };
  await write(outFile, JSON.stringify(doc) + '\n');
  console.log(`${doc.generated}: ${all.length} of ${expected} days, ${doc.periods.all.total.incidents} incidents, ${built} files read${waiting ? `, ${waiting} waiting` : ''}${other ? `, ${other} still of the rule before` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
