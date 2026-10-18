// Keeps the state of each part of the service over time (the chart of the status page): runs the same checks as the
// page (site/status-checks.js) against the public site and adds one sample to a JSON file, served as
// /api/v1/status-history.json. Meant for a cron job every 15 minutes; samples older than KEEP_DAYS are dropped. The tallies of each
// month (how many samples were OK, late or down, kept for good) go to status-months.json in the same directory.
//
//   node scripts/build-status.mjs OUT_FILE [BASE_URL]
//
// A sample is [seconds since the epoch, one letter per check]: o = OK, l = late, d = down, - = not checked
// (the list of checks in the file says which letter is which part). A moment without a sample (the job did not
// run) is a gap in the chart, not a green cell. `assumed` ({from, to}, seconds) marks samples that were not measured
// but taken as OK (the history before the job existed); the page says so.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { makeChecks } = createRequire(import.meta.url)('../site/status-checks.js');

export const INTERVAL = 900;
export const KEEP_DAYS = 90;
const LETTER = { ok: 'o', late: 'l', down: 'd' };
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

// The samples written for a list of checks, read again for another list: the letters follow the ids.
export function remap(doc, checks) {
  const same = doc.checks.length === checks.length && doc.checks.every((c, i) => c.id === checks[i].id);
  if (same) return doc.samples;
  const at = checks.map((c) => doc.checks.findIndex((o) => o.id === c.id));
  return doc.samples.map(([t, s]) => [t, at.map((i) => (i < 0 ? '-' : s[i])).join('')]);
}

// The document with one more sample; the one of the same slot (a second run within a minute) is replaced.
export function addSample(doc, t, letters, checks, now = t) {
  const old = doc && Array.isArray(doc.samples) && Array.isArray(doc.checks) ? remap(doc, checks) : [];
  const from = now - KEEP_DAYS * 86400;
  const samples = old.filter(([x]) => x >= from && Math.abs(x - t) >= 60).concat([[t, letters]]).sort((a, b) => a[0] - b[0]);
  const assumed = doc && doc.assumed ? { assumed: doc.assumed } : {};
  return { generated: new Date(now * 1000).toISOString(), interval: INTERVAL, ...assumed, checks: checks.map(({ id, name, expected }) => ({ id, name, expected })), samples };
}

// The tallies of each calendar month (UTC): how many samples found each part OK, late or down. The history keeps 90 days; the months
// are kept for good, one tally added for each new sample (a sample less than a minute after the last one replaces it and is not counted again).
// `doc` is the history (as addSample returns it), `prev` the months written before (or null: the first time, every sample of the history is counted).
export function addMonths(prev, doc, now = Math.floor(Date.now() / 1000)) {
  const months = prev && prev.months ? JSON.parse(JSON.stringify(prev.months)) : {};
  let last = prev && prev.last ? prev.last : 0;
  const slot = { o: 0, l: 1, d: 2 };
  for (const [t, letters] of doc.samples) {
    if (t - last < 60 && last) continue;
    const key = new Date(t * 1000).toISOString().slice(0, 7);
    const m = months[key] || (months[key] = { samples: 0, parts: {} });
    m.samples++;
    doc.checks.forEach((c, i) => {
      if (!(letters[i] in slot)) return;
      const part = m.parts[c.id] || (m.parts[c.id] = [0, 0, 0]);
      part[slot[letters[i]]]++;
    });
    last = Math.max(last, t);
  }
  return { generated: new Date(now * 1000).toISOString(), interval: doc.interval || INTERVAL, last, ...(doc.assumed ? { assumed: doc.assumed } : {}), checks: doc.checks.map(({ id, name }) => ({ id, name })), months };
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/build-status.mjs OUT_FILE [BASE_URL]'); process.exit(2); }
  const base = (process.argv[3] || 'https://aspa.ping6.it').replace(/\/$/, '');
  const get = async (url) => {
    const r = await fetch(url.startsWith('/') ? base + url : url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const checks = makeChecks(get);
  const nowMs = Date.now();
  const results = await Promise.all(checks.map(async (c) => {
    try { return (await c.run(nowMs)).state; } catch { return 'down'; }
  }));
  const letters = results.map((s) => LETTER[s] || 'd').join('');
  let doc = null;
  try { doc = JSON.parse(await readFile(out, 'utf8')); } catch { /* the first run */ }
  const t = Math.floor(nowMs / 1000);
  const next = addSample(doc, t, letters, checks);
  await writeFile(`${out}.tmp`, JSON.stringify(next));
  await rename(`${out}.tmp`, out);
  const monthsFile = join(dirname(out), 'status-months.json');
  let prev = null;
  try { prev = JSON.parse(await readFile(monthsFile, 'utf8')); } catch { /* the first run */ }
  await writeFile(`${monthsFile}.tmp`, JSON.stringify(addMonths(prev, next)));
  await rename(`${monthsFile}.tmp`, monthsFile);
  console.log(`${next.generated}: ${letters} (${next.samples.length} samples)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
