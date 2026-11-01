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

const DAY = /^\d{4}-\d{2}-\d{2}$/, AS = /^AS\d{1,10}$/;
// The shape of each file, as log-snapshot.mjs writes it: the builders and the pages use these values as AS numbers, dates and names of files.
const SHAPES = {
  events: (v) => Array.isArray(v) && v.every((e) => Array.isArray(e) && DAY.test(e[0]) && AS.test(e[1]) && (e[2] === null || (Array.isArray(e[2]) && e[2].every((p) => AS.test(p))))),
  history: (v) => Array.isArray(v) && v.every((r) => r && typeof r === 'object' && DAY.test(r.date)),
  visibility: (v) => (Array.isArray(v) ? v : v && Array.isArray(v.unseen) ? v.unseen : null)?.every((a) => AS.test(a)) === true,
};

// text -> text of a JSON that is worth publishing: it parses, a list or an object that is not empty, and (for a file named) of the shape of that file
export function valid(text, name = null) {
  let v;
  try { v = JSON.parse(text); } catch { return false; }
  const some = Array.isArray(v) ? v.length > 0 : v !== null && typeof v === 'object' && Object.keys(v).length > 0;
  return some && (!name || !SHAPES[name] || SHAPES[name](v));
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
      if (!valid(raw, name)) throw new Error('not a JSON of the expected shape, not published');
      const text = JSON.stringify(JSON.parse(raw));          // what is written is the parsed JSON, not the text of the network
      const file = join(dir, `${name}.json`);
      let old = null;
      try { old = await readFile(file, 'utf8'); } catch { /* the first run */ }
      if (old === text) { console.log(`${name}: unchanged`); continue; }
      // copying the published history is the purpose of this script: the text is a JSON that was parsed and checked above
      await writeFile(`${file}.tmp`, text); // lgtm [js/http-to-file-access]
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
