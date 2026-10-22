// Copies the three files of the history of the ASPAs (history.json, events.json, visibility.json) from the `history` branch of the GitLab
// project to a directory that nginx serves as /api/v1/archive/. The pages used to read them from GitLab in the browser of the visitor:
// when the GitLab of the Department is not reachable from the Internet they came out empty, and the status page said Down.
//   node scripts/fetch-archive.mjs [DIR]          (default /var/db/aspa-gen/archive; cron every 10 minutes)
// A file is replaced only by a valid JSON that differs from the one there; when GitLab does not answer, the old one stays.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const PROJECT = process.env.ARCHIVE_PROJECT || 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files';
const BRANCH = process.env.ARCHIVE_BRANCH || 'history';
export const FILES = ['history', 'events', 'visibility'];
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

// text -> text of a JSON that is worth publishing: it parses, and a list or an object that is not empty
export function valid(text) {
  let v;
  try { v = JSON.parse(text); } catch { return false; }
  return Array.isArray(v) ? v.length > 0 : v !== null && typeof v === 'object' && Object.keys(v).length > 0;
}

async function main() {
  const dir = process.argv[2] || '/var/db/aspa-gen/archive';
  await mkdir(dir, { recursive: true });
  let failed = 0;
  for (const name of FILES) {
    try {
      const r = await fetch(`${PROJECT}/${name}.json/raw?ref=${BRANCH}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw = await r.text();
      if (!valid(raw)) throw new Error('not a JSON that can be published');
      const text = JSON.stringify(JSON.parse(raw));          // what is written is the parsed JSON, not the text of the network
      const file = join(dir, `${name}.json`);
      let old = null;
      try { old = await readFile(file, 'utf8'); } catch { /* the first run */ }
      if (old === text) { console.log(`${name}: unchanged`); continue; }
      await writeFile(`${file}.tmp`, text);
      await rename(`${file}.tmp`, file);
      console.log(`${name}: ${text.length} bytes`);
    } catch (err) {
      failed++;
      console.error(`${name}: ${err.message}; the file that is there stays`);
    }
  }
  if (failed === FILES.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
