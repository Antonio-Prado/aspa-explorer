// The links (pairs of adjacent ASes, prepending removed) of a table dump of a collector, one for each line, for the
// forged-link detector of the incidents (tools/data_scripts/extra_detectors.py, load_links): a link that is in the table at the
// start of the day is not forged, whether CAIDA knows it or not. The dump is the one that the valley job keeps in its cache.
//   node scripts/rib-links.mjs DUMP OUT
import { writeFile, rename } from 'node:fs/promises';
import { readRib, openDump } from './mrt.mjs';

const [dump, out] = process.argv.slice(2);
if (!dump || !out) { console.error('usage: rib-links.mjs DUMP OUT'); process.exit(2); }
const seen = new Set();
const counts = await readRib(openDump(dump), (peerAs, path, n) => {
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    if (a === prev) continue;
    if (prev >= 0) seen.add(prev < a ? `${prev} ${a}` : `${a} ${prev}`);
    prev = a;
  }
});
await writeFile(`${out}.tmp`, [...seen].join('\n') + '\n');
await rename(`${out}.tmp`, out);
console.log(`${seen.size} links from ${counts.entries} routes`);
