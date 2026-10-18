// Keeps the state of each part of the service over time (the chart of the status page): runs the same checks as the
// page (site/status-checks.js) against the public site and adds one sample to a JSON file, served as
// /api/v1/status-history.json. Meant for a cron job every 15 minutes; samples older than KEEP_DAYS are dropped.
//
//   node scripts/build-status.mjs OUT_FILE [BASE_URL]
//
// A sample is [seconds since the epoch, one letter per check]: o = OK, l = late, d = down, - = not checked
// (the list of checks in the file says which letter is which part). A moment without a sample (the job did not
// run) is a gap in the chart, not a green cell. `assumed` ({from, to}, seconds) marks samples that were not measured
// but taken as OK (the history before the job existed); the page says so.
import { readFile, writeFile, rename } from 'node:fs/promises';
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
  console.log(`${next.generated}: ${letters} (${next.samples.length} samples)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
