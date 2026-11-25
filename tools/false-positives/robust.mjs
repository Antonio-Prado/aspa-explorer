// The places that are Invalid whichever of the two daily states of the ASPAs around the dump is used. For a day of the RIPE
// NCC archive the dump of 00:00 UTC lies between two snapshots: the one of the day before (about 19 hours older) and the one
// of the day itself (about 5 hours newer). A place that is in the dump under both was Invalid at 00:00 unless its ASPAs changed
// twice in a day; one that is there under only one of them owes its being there to a change of that very day, and is left out.
//   node robust.mjs DIR_PREV DIR_SAME OUT_DIR     (places-YYYYMMDD.json of dump-places.mjs with the state before the day, and of the day)
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const [prevDir, sameDir, out] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const key = (g) => `${g.from}|${g.between.join('-')}|${g.to}`;
let kept = 0, onlyPrev = 0, onlySame = 0;
for (const f of (await readdir(sameDir)).filter((x) => /^places-\d{8}\.json$/.test(x)).sort()) {
  const same = JSON.parse(await readFile(join(sameDir, f), 'utf8'));
  let prev;
  try { prev = JSON.parse(await readFile(join(prevDir, f), 'utf8')); } catch { console.error(`${f}: not in ${prevDir}, left out`); continue; }
  const P = new Map(prev.places.map((g) => [key(g), g]));
  const places = same.places.filter((g) => P.has(key(g))).map((g) => ({ ...g, routes: Math.min(g.routes, P.get(key(g)).routes) }));
  const S = new Set(same.places.map(key));
  onlySame += same.places.length - places.length; onlyPrev += prev.places.filter((g) => !S.has(key(g))).length; kept += places.length;
  const invalid = places.reduce((s, g) => s + g.routes, 0);
  await writeFile(join(out, f), JSON.stringify({ ...same, total: { ...same.total, invalid, invalid_prev: prev.total.invalid, invalid_same: same.total.invalid }, places }));
}
console.log(`kept ${kept} place-days; left out ${onlyPrev} only under the state before the day, ${onlySame} only under the state of the day`);
