// The number of networks with an ASPA over time, for each RIR and each country: the events of the history branch
// replayed month by month (the state at the end of each month, and today), with the country and the registry of each AS
// from the daily adoption job. Written as one JSON file (served as /api/v1/trends.json).
//
//   node scripts/build-trends.mjs OUT_FILE [REGISTRY_FILE]
//
// Environment: TRENDS_EVENTS, the URL or file of events.json (default the one of the public project, history branch).
// The registry (asn-registry.json) lists only the ASes seen in BGP: a customer that is not in it counts as unknown.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const EVENTS = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files/events.json/raw?ref=history';
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
const RIR_OF = { r: 'ripe', a: 'arin', p: 'apnic', l: 'lacnic', f: 'afrinic' };

// The last day of each month from the one of the first event to the one of `today` (YYYY-MM-DD), the last point
// being today itself.
export function checkpoints(first, today) {
  const out = [];
  let [y, m] = first.slice(0, 7).split('-').map(Number);
  const last = today.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym >= last) break;
    out.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));      // day 0 of the next month = the last day of this one
    m++; if (m > 12) { m = 1; y++; }
  }
  out.push(today);
  return out;
}

// events: [[date, "AS123", providers | null]] sorted by date; where: AS number -> {cc, rir} or null;
// Returns { points, rir: {ripe: [counts]}, country: {IT: [counts]}, total: [counts] }.
export function trends(events, where, today) {
  if (!events.length) return { points: [today], rir: {}, country: {}, total: [0] };
  const points = checkpoints(events[0][0], today);
  const have = new Set();
  const rir = {}, country = {}, total = [];
  const place = (as) => where(Number(as.slice(2))) || { cc: 'ZZ', rir: 'unknown' };
  let i = 0;
  points.forEach((day, k) => {
    for (; i < events.length && events[i][0] <= day; i++) { const [, as, providers] = events[i]; if (providers) have.add(as); else have.delete(as); }
    const r = {}, c = {};
    for (const as of have) { const p = place(as); r[p.rir] = (r[p.rir] || 0) + 1; c[p.cc] = (c[p.cc] || 0) + 1; }
    total.push(have.size);
    for (const [key, n] of Object.entries(r)) (rir[key] ||= new Array(points.length).fill(0))[k] = n;
    for (const [key, n] of Object.entries(c)) (country[key] ||= new Array(points.length).fill(0))[k] = n;
  });
  return { points, rir, country, total };
}

// The registry file of the adoption job ({asns: {"3333": "NLr"}}) as a function AS number -> {cc, rir}.
export function registryOf(doc) {
  const m = (doc && doc.asns) || {};
  return (n) => { const v = m[n]; return v ? { cc: v.slice(0, 2), rir: RIR_OF[v[2]] || 'unknown' } : null; };
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/build-trends.mjs OUT_FILE [REGISTRY_FILE]'); process.exit(2); }
  const regFile = process.argv[3] || join(out, '..', 'asn-registry.json');
  const src = process.env.TRENDS_EVENTS || EVENTS;
  const events = /^https?:/.test(src) ? await (await fetch(src, { headers: { 'User-Agent': UA } })).json() : JSON.parse(await readFile(src, 'utf8'));
  if (!Array.isArray(events) || !events.length) throw new Error('the events are empty: not publishing');
  const where = registryOf(JSON.parse(await readFile(regFile, 'utf8')));
  const today = new Date().toISOString().slice(0, 10);
  const doc = { generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), source: 'events of the history branch, replayed; country and registry as in adoption.json', ...trends(events, where, today) };
  await writeFile(`${out}.tmp`, JSON.stringify(doc) + '\n');
  await rename(`${out}.tmp`, out);
  console.log(`${doc.generated}: ${doc.points.length} points, ${Object.keys(doc.country).length} countries, ${doc.total[doc.total.length - 1]} ASPAs`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
