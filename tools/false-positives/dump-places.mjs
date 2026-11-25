// Every place of valley of one day (all of them, not the top of the site's files): the routes of the table dumps of 00:00 UTC
// of the given collectors, checked with one of the two states of the ASPAs around that time (state.mjs): `before`, the one
// known at 00:00, or `day` (the default), the one after the changes that may or may not have been there at 00:00. Each Invalid
// path is grouped by its place (the AS where the up ramp stops, the ASes between, the AS where the down ramp stops).
// A day is dumped with both, and robust.mjs keeps the places that are Invalid with both.
//
//   node dump-places.mjs YYYYMMDD OUT_DIR collector[,collector...] [before|day]
//
// Writes OUT_DIR/places-YYYYMMDD.json: {day, aspas, collectors, total, places: [...]}.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { classify, aspaMap, dayDumpUrls, intact, isRis } from '../../scripts/build-leaks.mjs';
import { readRib, openDump } from '../../scripts/mrt.mjs';
import { stateFor, stateBefore } from './state.mjs';

const require = createRequire(import.meta.url);
const { verify } = require('../../site/verify.js');
const DATA = (process.env.FP_DATA || new URL('./data/', import.meta.url).pathname);
const UA = 'aspa-explorer';
const MAX_PATHS = 8;

// a long download is cut now and then ("terminated"): tried again a few times
async function download(urls, path) {
  for (let i = 1; ; i++) {
    try { return await download1(urls, path); } catch (err) {
      await unlink(`${path}.tmp`).catch(() => {});
      if (i >= 4 || /no dump for/.test(err.message)) throw err;
      console.error(`${path}: ${err.message}, trying again`);
      await new Promise((r) => setTimeout(r, 10000 * i));
    }
  }
}

async function download1(urls, path) {
  try { if ((await stat(path)).size > 0) return; } catch { /* not there */ }
  for (const url of urls) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(1200000) });
    if (r.status === 404) continue;
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(`${path}.tmp`));
    await intact(`${path}.tmp`, path);
    await rename(`${path}.tmp`, path);
    return;
  }
  throw new Error(`no dump for ${path}`);
}

async function main() {
  const [day, out, list, mode = 'day'] = process.argv.slice(2);
  if (!/^\d{8}$/.test(day || '') || !out || !list || !['before', 'day'].includes(mode)) { console.error('usage: dump-places.mjs YYYYMMDD OUT_DIR collectors [before|day]'); process.exit(2); }
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
  const state = (mode === 'before' ? stateBefore() : stateFor())(iso);
  const aspas = aspaMap([...state].map(([customer, providers]) => ({ customer, providers })));
  const ixp = new Set(JSON.parse(await readFile(join(DATA, 'adoption.json'), 'utf8')).ixp || []);
  const groups = new Map();
  const total = { routes: 0, valid: 0, unknown: 0, invalid: 0 };
  const VERDICT = ['valid', 'unknown', 'invalid'];
  const cache = join(out, 'dumps');
  await mkdir(cache, { recursive: true });
  const used = [];
  for (const c of list.split(',')) {
    const file = join(cache, `${c}-${day}.${isRis(c) ? 'gz' : 'bz2'}`);
    try { await download(dayDumpUrls(c, day), file); } catch (err) { console.error(`${day} ${c}: skipped, ${err.message}`); used.push({ collector: c, skipped: err.message }); continue; }
    const t0 = Date.now();
    const stats = await readRib(openDump(file), (feeder, path, n, plen, v6) => {
      const p = [];
      for (let i = n - 1; i >= 0; i--) { const a = path[i]; if (ixp.has(a)) continue; if (p[p.length - 1] !== a) p.push(a); }
      total.routes++;
      const k = classify(aspas, p);
      total[VERDICT[k]]++;
      if (k !== 2) return;
      const v = verify(aspas, p, 'down');
      const from = v.path[v.maxUp - 1], to = v.path[v.N - v.maxDown];
      const between = v.path.slice(v.maxUp, v.N - v.maxDown);
      const key = `${from}|${between.join('-')}|${to}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { from, between, to, routes: 0, v4: 0, v6: 0, feeders: new Set(), origins: new Set(), collectors: new Set(), paths: new Map() });
      g.routes++; g[v6 ? 'v6' : 'v4']++; g.feeders.add(feeder); g.origins.add(p[0]); g.collectors.add(c);
      const pk = p.join(' ');
      if (g.paths.size < MAX_PATHS || g.paths.has(pk)) g.paths.set(pk, (g.paths.get(pk) || 0) + 1);
    });
    used.push({ collector: c, routes: stats.entries });
    console.error(`${day} ${c}: ${stats.entries} routes in ${Math.round((Date.now() - t0) / 1000)} s, ${groups.size} places so far`);
    if (!process.env.KEEP_DUMPS) await unlink(file);
  }
  const places = [...groups.values()].map((g) => ({
    from: g.from, between: g.between, to: g.to, routes: g.routes, v4: g.v4, v6: g.v6,
    feeders: [...g.feeders].sort((a, b) => a - b), origins: g.origins.size, collectors: [...g.collectors],
    paths: [...g.paths].map(([p, n]) => ({ path: p.split(' ').map(Number), routes: n })),
  }));
  const doc = { day: iso, aspas: state.size, collectors: used, total, places };
  await writeFile(join(out, `places-${day}.json.tmp`), JSON.stringify(doc));
  await rename(join(out, `places-${day}.json.tmp`), join(out, `places-${day}.json`));
  console.log(`${iso}: ${total.routes} routes, ${total.invalid} invalid, ${places.length} places`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
