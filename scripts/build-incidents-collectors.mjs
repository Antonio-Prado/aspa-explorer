// The list of the collectors whose incidents have a history (/api/v1/incidents-collectors.json): one line for each
// incidents-history*.json that scripts/build-incidents-history.mjs wrote, with the days it covers. The Incidents page reads it to
// offer the collectors; the one of the recorder (incidents-history.json, rrc00) comes first.
//   node scripts/build-incidents-collectors.mjs OUT_FILE GEN_DIR
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const NAME = /^incidents-history(?:-([a-z0-9]+))?\.json$/;

// docs: [{ file, doc }] with the name of each history file and what it holds; a file that is not a history is left out
export function collectorsIndex(docs, now = new Date()) {
  const collectors = [];
  for (const { file, doc } of docs) {
    const m = NAME.exec(file);
    if (!m || !doc || !Array.isArray(doc.days) || !doc.days.length || typeof doc.collector !== 'string' || !/^[a-z0-9]+$/.test(doc.collector)) continue;
    if (m[1] && m[1] !== doc.collector) continue;                      // a file under the name of another collector
    const days = doc.days.map((r) => r.day).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    collectors.push({
      id: doc.collector, main: !m[1], history: `/api/v1/${file}`, generated: doc.generated || null,
      days_covered: days.length, days_expected: doc.days_expected ?? null, first: days[0], last: days[days.length - 1],
      incidents: doc.periods && doc.periods.all && doc.periods.all.total ? doc.periods.all.total.incidents : null,
    });
  }
  const seen = new Set();
  const list = collectors.sort((a, b) => Number(b.main) - Number(a.main) || a.id.localeCompare(b.id)).filter((c) => !seen.has(c.id) && seen.add(c.id));
  return { generated: now.toISOString().replace(/\.\d+Z$/, 'Z'), collectors: list };
}

async function main() {
  const [out, dir] = process.argv.slice(2);
  if (!out || !dir) { console.error('usage: node scripts/build-incidents-collectors.mjs OUT_FILE GEN_DIR'); process.exit(2); }
  const docs = [];
  for (const file of (await readdir(dir)).filter((f) => NAME.test(f)).sort()) {
    try { docs.push({ file, doc: JSON.parse(await readFile(join(dir, file), 'utf8')) }); } catch (err) { console.error(`${file}: not read: ${err.message}`); }
  }
  const index = collectorsIndex(docs);
  if (!index.collectors.length) throw new Error('no history of incidents found: not publishing');
  await writeFile(`${out}.tmp`, JSON.stringify(index) + '\n');
  await rename(`${out}.tmp`, out);
  console.log(index.collectors.map((c) => `${c.id}: ${c.days_covered} days, ${c.first} to ${c.last}`).join('; '));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
