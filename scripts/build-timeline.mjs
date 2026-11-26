// Builds and keeps up to date the timeline of the ASPAs (scripts/aspa-timeline.mjs): the changes of the history branch with
// the time each one was first seen. The archive period comes from events.json and the times of the files of the RIPE NCC
// archive (scripts/data/archive-times.json); the rest from the commits of the hourly job, read from a clone or from the
// GitLab API, the newer ones added at each run.
//
//   node scripts/build-timeline.mjs OUT_FILE --git=DIR        commits of the branch `history` of a clone (git log origin/history)
//   node scripts/build-timeline.mjs OUT_FILE [--api=URL]      commits from the GitLab API (default the public project)
//   options: --times=FILE (default scripts/data/archive-times.json), --max=N (at most N new commits in a run)
//
// The file is replaced only when the whole document passes validate(): on any error the run ends with a status of 1 and the
// file of before stays, so that what reads it keeps its last good output.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { VERSION, ARCHIVE_TO, FETCH_MARGIN, asOf, archiveSteps, archiveTime, commitStep, validate, Timeline } from './aspa-timeline.mjs';

const run = promisify(execFile);
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
export const API = 'https://gitlab.dei.unipd.it/api/v4/projects/5246';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const archiveText = (events) => JSON.stringify(events.filter((e) => e[0] <= ARCHIVE_TO));
// The commits say the time of their data since this day (look.json, written by log-snapshot.mjs): the ones before are not asked.
export const LOOKS_FROM = Date.UTC(2026, 10, 26) / 1000;
// The time of the data of a commit, from its look.json ({data: ISO time}): epoch seconds, or null when it does not say it.
export const dataTime = (look) => { const t = look && typeof look.data === 'string' ? Date.parse(look.data) / 1000 : NaN; return Number.isFinite(t) ? t : null; };

// The commits of the history branch after `after` (epoch), oldest first: {sha, parent, time, events(): the parsed events.json
// or null, look(): the parsed look.json or null}. `parent` is the commit before it on the branch: extend() checks that none is skipped.
export async function gitCommits(dir, after) {
  const git = async (...a) => (await run('git', ['-C', dir, ...a], { maxBuffer: 1 << 28 })).stdout;
  const lines = (await git('log', '--reverse', '--first-parent', '--format=%H %ct %P', 'origin/history')).trim().split('\n');
  return lines.map((l) => l.split(' ')).map(([sha, ct, parent]) => ({ sha, time: Number(ct), parent: parent || null })).filter((c) => c.time > after)
    .map((c) => {
      const show = async (name) => { try { return JSON.parse(await git('show', `${c.sha}:${name}`)); } catch (err) { if (/exists on disk, but not in|does not exist in/.test(err.stderr || '')) return null; throw err; } };
      return { ...c, events: () => show('events.json'), look: () => show('look.json') };
    });
}
// From the GitLab API: the list comes newest first, a page at a time, and is read until a commit that is not after `after`
// (the `since` parameter is not used: with it the server gave back a part of the commits only).
export async function apiCommits(base, after, get = getJson) {
  const out = [];
  pages: for (let page = 1; page < 500; page++) {
    const list = await get(`${base}/repository/commits?ref_name=history&per_page=100&page=${page}`);
    if (!Array.isArray(list)) throw new Error('the list of commits is not a list');
    for (const c of list) {
      const time = Date.parse(c.committed_date) / 1000;
      if (!/^[0-9a-f]{40}$/.test(c.id) || !Number.isFinite(time)) throw new Error('a commit without a hash or a date');
      if (time <= after) break pages;
      out.push({ sha: c.id, time, parent: (c.parent_ids || [])[0] || null });
    }
    if (list.length < 100) break;
  }
  return out.reverse().map((c) => ({ ...c, events: async () => get(`${base}/repository/files/events.json/raw?ref=${c.sha}`, true), look: async () => get(`${base}/repository/files/look.json/raw?ref=${c.sha}`, true) }));
}
async function getJson(url, missingIsNull = false) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (missingIsNull && r.status === 404) return null;
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return await r.json();
    } catch (err) { if (i >= 4) throw err; await new Promise((res) => setTimeout(res, 5000 * i)); }
  }
}

// Adds the commits to the document (a new one when doc is null: the first commit with events gives the archive period).
export async function extend(doc, commits, times, max = Infinity) {
  let state = doc ? new Timeline(doc).raw(doc.steps.length) : null;
  let added = 0;
  // each commit has to be the child of the one read before it: a commit that is skipped, or a branch written again, ends the run
  let last = doc && doc.head ? doc.head.sha : null;
  for (const c of commits) {
    if (added >= max) break;
    if (last && c.parent !== last) throw new Error(`${c.sha}: its parent is ${c.parent}, not ${last}, the commit read before it`);
    if (doc && doc.head && !(c.time > doc.head.time)) throw new Error(`${c.sha}: a commit at ${c.time} that is not after ${doc.head.time}, the time of the one before it`);
    last = c.sha;
    const events = await c.events();
    if (!events) continue;                                             // a commit from before the history had events
    if (!Array.isArray(events) || !events.length) throw new Error(`${c.sha}: events.json is empty or not a list`);
    const text = archiveText(events);
    if (!doc) {
      const a = archiveSteps(events, times);
      const last = archiveTime(ARCHIVE_TO, times[ARCHIVE_TO]);
      if (!last) throw new Error(`no archive time for ${ARCHIVE_TO}`);
      // until a commit of the job is read, the look before it is the archive of the last day
      doc = { version: VERSION, archive_to: ARCHIVE_TO, archive_sha256: sha256(text), look: last.first - FETCH_MARGIN, horizon: last.seen, head: null, steps: a.steps };
      state = a.state;
    }
    if (sha256(text) !== doc.archive_sha256) throw new Error(`${c.sha}: the events of the archive period are not the ones the timeline was built from`);
    added++;
    // a commit with no event after the archive period is the archive itself, written again: not a look of the job
    if (events[events.length - 1][0] <= ARCHIVE_TO) { doc.head = { sha: c.sha, time: c.time }; continue; }
    // the time until which this commit knew the ASPAs: from the time of its data when it says it (a failure to read it ends
    // the run: the same commits have to give the same timeline at every run)
    const look = c.time >= LOOKS_FROM && c.look ? await c.look() : null;
    // no look.json: a commit of before the looks, known until LOOK_MARGIN before it. A look.json with no time of its data
    // knows nothing more than the commit before it
    const known = look === null ? asOf(c.time) : (dataTime(look) === null ? -Infinity : asOf(c.time, dataTime(look)));
    const r = commitStep(state, events, c.time, doc.look);
    if (r.step) doc.steps.push(r.step);
    state = r.state;
    // never back: a commit whose data is older than the one before it (a validator that stands still, the spare one) adds nothing
    doc.look = Math.max(doc.look, known); doc.horizon = doc.look; doc.head = { sha: c.sha, time: c.time };
  }
  return { doc, added };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const out = args.find((a) => !a.startsWith('--'));
  if (!out) { console.error('usage: build-timeline.mjs OUT_FILE [--git=DIR | --api=URL] [--times=FILE] [--max=N]'); process.exit(2); }
  const times = JSON.parse(await readFile(flag('times') || join(dirname(fileURLToPath(import.meta.url)), 'data', 'archive-times.json'), 'utf8'));
  let doc = null;
  try { doc = JSON.parse(await readFile(out, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (doc && doc.version !== VERSION) throw new Error(`${out}: version ${doc.version}, this code writes ${VERSION}: build it again from the start`);
  const after = doc && doc.head ? doc.head.time : 0;
  const commits = flag('git') ? await gitCommits(flag('git'), after) : await apiCommits(flag('api') || API, after);
  const r = await extend(doc, commits, times, flag('max') ? Number(flag('max')) : Infinity);
  if (!r.doc) throw new Error('no commit with events: nothing to build');
  doc = r.doc;
  // the whole document against the events of its newest commit, before anything is written
  const head = commits.filter((c) => c.sha === doc.head.sha)[0];
  const events = head ? await head.events() : (flag('git') ? null : await getJson(`${flag('api') || API}/repository/files/events.json/raw?ref=${doc.head.sha}`));
  if (events) validate(doc, events, times);
  doc.built = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  await writeFile(`${out}.${process.pid}.tmp`, JSON.stringify(doc) + "\n");
  await rename(`${out}.${process.pid}.tmp`, out);
  console.log(`${doc.built}: ${doc.steps.length} steps, ${r.added} new commits, horizon ${new Date(doc.horizon * 1000).toISOString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
