// Classifies the places of valley written by dump-places.mjs (and the Invalid RLK incidents of the detector) into five exclusive
// classes, first that applies wins (1 > 4 > 3 > 2 > 5):
//   1 confirmed by a fix: within WINDOW days of the first sighting every sampled path stops being Invalid because an ASPA in it
//     changed; 1a the missing provider was added at a failing end (a false positive confirmed by the operator), 1b an ASPA of the
//     path was withdrawn, 1c another change;
//   4 structural: the failing pair is a sibling (same CAIDA organisation) or the AS let through is a DDoS scrubbing network (hand list);
//   3 probable leak, for the incidents of the detector only: no evidence of transit at any failing end (CAIDA, IRR of either
//     side) and not a persistent valley. A table dump of 00:00 cannot tell a short leak from a gap fixed the next day, so the
//     places of the dumps never get this class;
//   2 probable false positive: evidence of transit at a failing end, and persistent or seen by several feeders;
//   5 the rest.
// The evidence stays in columns next to the class. IRR objects are today's (the registries keep no history); IXP ASes are
// dropped from the paths; the scrubbing list is by hand. Data files are read from FP_DATA (default ./data next to this file).
//
//   node classify.mjs OUT_DIR
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { aspaMap, classify, relations } from '../../scripts/build-leaks.mjs';
import { autNums, IRR_SOURCES } from '../../scripts/build-counterpart.mjs';

const require = createRequire(import.meta.url);
const History = require('../../site/history.js');
const { roles, codeOf } = require('../../site/irr.js');
const DATA = (process.env.FP_DATA || new URL('./data/', import.meta.url).pathname);
export const WINDOW = 30;
// DDoS scrubbing networks that sit in the path of their clients (hand list, partial: weak evidence)
export const SCRUB = new Set([13335, 32787, 19551, 34309, 3223, 396998, 57724, 199524, 59796, 200449, 19905]);
const SHORT_DAYS = 2;      // a place seen on at most this many days of the period counts as short-lived
const MANY_FEEDERS = 3;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ASPA state at the start of each day, computed once per day
function statesFor(events) {
  const memo = new Map();
  return (iso) => {
    if (!memo.has(iso)) {
      const st = History.replayBefore(events, iso);
      memo.set(iso, { raw: st, map: aspaMap([...st].map(([customer, providers]) => ({ customer, providers }))) });
    }
    return memo.get(iso);
  };
}

function caidaFor() {
  const cache = new Map();
  return (iso) => {
    const files = ['20260901', '20261001', '20261101'].filter((s) => s <= iso.replaceAll('-', '').slice(0, 6) + '01');
    const serial = files.at(-1) || '20260901';
    if (!cache.has(serial)) {
      const f = existsSync(join(DATA, `as-rel2-${serial}.bz2`)) ? join(DATA, `as-rel2-${serial}.bz2`) : null;
      const text = execFileSync('bunzip2', ['-c', f], { maxBuffer: 1 << 30 }).toString();
      cache.set(serial, relations(text));
    }
    return cache.get(serial);
  };
}

async function orgs() {
  const org = new Map();
  const rl = createInterface({ input: createReadStream(join(DATA, '20261001.as-org2info.txt.gz')).pipe(createGunzip()), crlfDelay: Infinity });
  let fmt = null;
  for await (const line of rl) {
    if (line.startsWith('# format:')) { fmt = line.includes('aut|') ? 'aut' : 'org'; continue; }
    if (line[0] === '#' || fmt !== 'aut') continue;
    const f = line.split('|');
    org.set(Number(f[0]), f[3]);
  }
  return org;
}

// What the IRR says about each wanted AS: roles of its aut-num, first registry with a policy (today's copies: the registries keep no history)
async function irrRoles(wanted, ixp) {
  const cacheFile = join(DATA, 'irr-roles.json');
  let have = {};
  try { have = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* none */ }
  const missing = new Set([...wanted].filter((a) => !(a in have)));
  if (missing.size) {
    const found = new Map();
    let failed = 0;
    for (const [name, url] of IRR_SOURCES) {
      try {
        // a copy of the archive of 24 November when there is one (LACNIC does not answer from this Mac)
        const local = join(DATA, 'irr', url.split('/').at(-1));
        let input;
        if (existsSync(local)) input = createReadStream(local);
        else {
          const r = await fetch(url, { headers: { 'User-Agent': 'aspa-explorer' }, signal: AbortSignal.timeout(900000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          input = Readable.fromWeb(r.body);
        }
        const lines = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
        let n = 0;
        for await (const { as, attrs } of autNums(lines, missing)) {
          const ro = roles(attrs, ixp);
          if (found.has(as) && found.get(as).rules) continue;
          found.set(as, { src: name, rules: ro.rules, transit: ro.transit, probable: ro.probable, customer: ro.customer, peer: ro.peer, ixp: ro.ixp, via: ro.via, candidate: ro.candidate });
          n++;
        }
        console.error(`IRR ${name}: ${n} objects`);
      } catch (e) { console.error(`IRR ${name}: ${e.message}`); failed++; }
    }
    // an AS with no object is remembered as such only when every registry was read
    for (const a of missing) if (found.has(a) || !failed) have[a] = found.get(a) || null;
    for (const a of missing) if (!(a in have)) have[a] = null;           // for this run only
    if (failed) { await writeFile(cacheFile, JSON.stringify(Object.fromEntries(Object.entries(have).filter(([a, v]) => v || found.has(+a))))); return have; }
    await writeFile(cacheFile, JSON.stringify(have));
  }
  return have;
}

// the evidence that p carries c upwards (p a transit provider of c)
function evidence(c, p, relOf, irr) {
  const caida = relOf(c, p);                                   // 'provider' when p is a provider of c
  const rc = irr[c], rp = irr[p];
  const fromC = rc && rc.rules ? codeOf(rc, p) : null;          // what c's object says about p
  const fromP = rp && rp.rules ? codeOf(rp, c) : null;          // what p's object says about c
  const irrTransit = fromC === 't' || fromC === 'b' || fromP === 'c';
  return { c, p, caida, irr_c: fromC, irr_p: fromP, transit: caida === 'provider' || irrTransit, irr_transit: irrTransit };
}

// the failing ends of a place: the AS where the up ramp stops lacks the first AS between, the one where the down ramp stops lacks the last
const endsOf = (from, between, to) => [{ end: 'up', c: from, p: between[0] }, { end: 'down', c: to, p: between.at(-1) }];

// Day on which all the paths stop being Invalid, and what changed
function fixOf(paths, firstIso, state, ends) {
  for (let k = 1; k <= WINDOW; k++) {
    const iso = addDays(firstIso, k);
    const s = state(iso);
    if (paths.every((p) => classify(s.map, p) !== 2)) {
      const prev = state(addDays(iso, -1)).raw, cur = s.raw;
      const added = ends.filter((e) => (cur.get(`AS${e.c}`) || []).includes(`AS${e.p}`) && !(prev.get(`AS${e.c}`) || []).includes(`AS${e.p}`));
      const withdrawn = [...new Set(paths.flat())].filter((a) => prev.has(`AS${a}`) && !cur.has(`AS${a}`));
      const sub = added.length ? '1a' : withdrawn.length ? '1b' : '1c';
      return { day: iso, after: k, sub, added: added.map((e) => `${e.end}:AS${e.c}+AS${e.p}`), withdrawn: withdrawn.map((a) => `AS${a}`) };
    }
  }
  return null;
}

async function main() {
  const out = process.argv[2] || 'out';
  const events = JSON.parse(await readFile(join(DATA, 'events.json'), 'utf8'));
  const lastEvent = events.at(-1)[0];
  const ixp = new Set(JSON.parse(await readFile(join(DATA, 'adoption.json'), 'utf8')).ixp || []);
  const state = statesFor(events), caida = caidaFor(), org = await orgs();
  // the day each customer's ASPA first appeared (age of the ASPA at the first sighting of a place)
  const born = new Map();
  for (const [d, c, prov] of events) if (prov && !born.has(c)) born.set(c, d);
  const ageOf = (asn, iso) => { const b = born.get(`AS${asn}`); return b ? Math.round((Date.parse(iso) - Date.parse(b)) / 864e5) : null; };
  const files = (await readdir(out)).filter((f) => /^places-\d{8}\.json$/.test(f)).sort();
  const days = [];
  const agg = new Map();
  for (const f of files) {
    const doc = JSON.parse(await readFile(join(out, f), 'utf8'));
    days.push({ day: doc.day, total: doc.total, places: doc.places.length });
    for (const g of doc.places) {
      const key = `${g.from}|${g.between.join('-')}|${g.to}`;
      let a = agg.get(key);
      if (!a) agg.set(key, a = { key, from: g.from, between: g.between, to: g.to, first: doc.day, last: doc.day, days: 0, routes: 0, maxRoutes: 0, feeders: new Set(), maxFeeders: 0, paths: new Map() });
      a.last = doc.day; a.days++; a.routes += g.routes; a.maxRoutes = Math.max(a.maxRoutes, g.routes);
      g.feeders.forEach((x) => a.feeders.add(x)); a.maxFeeders = Math.max(a.maxFeeders, g.feeders.length);
      if (doc.day === a.first) for (const p of g.paths) if (a.paths.size < 8) a.paths.set(p.path.join(' '), p.path);
    }
  }
  const period = { from: days[0].day, to: days.at(-1).day, days: days.length };
  // incidents of the detector (RLK only: their actor names the three ASes)
  const incidents = [];
  const rl = createInterface({ input: createReadStream(join(DATA, 'incidents-invalid.jsonl.gz')).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    const o = JSON.parse(line);
    if (o.type !== 'RLK') continue;
    const m = /^RLK_(\d+)_(\d+)_(\d+)$/.exec(o.actor);
    if (!m) continue;
    incidents.push({ subtype: o.subtype, from: +m[1], by: +m[2], to: +m[3], start: o.start, end: o.end, paths: o.paths, irr: o.irr });
  }
  const wanted = new Set();
  for (const a of agg.values()) for (const e of endsOf(a.from, a.between, a.to)) { wanted.add(e.c); wanted.add(e.p); }
  for (const i of incidents) { wanted.add(i.from); wanted.add(i.by); wanted.add(i.to); }
  const irr = await irrRoles(wanted, ixp);

  const rows = [];
  for (const a of agg.values()) {
    const relOf = caida(a.first);
    const ends = endsOf(a.from, a.between, a.to);
    const ev = ends.map((e) => ({ end: e.end, ...evidence(e.c, e.p, relOf, irr) }));
    const full = addDays(a.first, WINDOW) <= lastEvent;
    const fix = fixOf([...a.paths.values()], a.first, state, ends);
    const sibling = ends.some((e) => org.get(e.c) && org.get(e.c) === org.get(e.p));
    const scrub = a.between.some((x) => SCRUB.has(x));
    const transit = ev.some((e) => e.transit);
    const censored = a.first === period.from || a.last === period.to;   // its life is cut by the period
    const short = a.days <= SHORT_DAYS && !censored;
    // a table dump at 00:00 cannot tell a short leak from a gap fixed the next day (most short places were fixed by the
    // operator): no "probable leak" class here, the short ones without evidence stay undetermined
    let cls;
    if (fix) cls = fix.sub;
    else if (sibling || scrub) cls = '4';
    else if (transit && (a.days > SHORT_DAYS || a.maxFeeders >= MANY_FEEDERS)) cls = '2';
    else cls = '5';
    // the failing ASPA is the one of a feeder of the collector (the down end is the feeder itself)
    const atFeeder = a.feeders.has(a.to) && !(state(a.first).map.get(a.to) || new Set()).has(a.between.at(-1));
    rows.push({ key: a.key, from: a.from, between: a.between, to: a.to, first: a.first, last: a.last, days: a.days, censored, routes: a.routes, max_routes: a.maxRoutes,
      feeders: a.feeders.size, max_feeders: a.maxFeeders, evidence: ev, sibling, scrub, full_window: full, fix, cls,
      would2: transit && (a.days > SHORT_DAYS || a.maxFeeders >= MANY_FEEDERS), would3: !transit && short,
      at_feeder: atFeeder, single_feeder: a.feeders.size === 1, age_up: ageOf(a.from, a.first), age_down: ageOf(a.to, a.first) });
  }

  // incidents: is the triple fixed afterwards, and the evidence on the two sides of the leaker
  const incRows = [];
  for (const i of incidents) {
    const iso = i.start.slice(0, 10);
    const relOf = caida(iso);
    const ends = [{ end: 'up', c: i.from, p: i.by }, { end: 'down', c: i.to, p: i.by }];
    // the three ASes alone have to be Invalid on the day, or the Invalid of the whole path comes from elsewhere and cannot be followed
    const alone = classify(state(iso).map, [i.from, i.by, i.to]) === 2;
    if (!alone) { incRows.push({ ...i, day: iso, alone: false, cls: 'n/a' }); continue; }
    const fix = fixOf([[i.from, i.by, i.to]], iso, state, ends);
    const ev = ends.map((e) => ({ end: e.end, ...evidence(e.c, e.p, relOf, irr) }));
    const sibling = ends.some((e) => org.get(e.c) && org.get(e.c) === org.get(e.p));
    const dur = (Date.parse(i.end.replace(' ', 'T') + 'Z') - Date.parse(i.start.replace(' ', 'T') + 'Z')) / 1000;
    const full = addDays(iso, WINDOW) <= lastEvent;
    let cls;
    if (fix) cls = fix.sub; else if (sibling || SCRUB.has(i.by)) cls = '4';
    else if (!ev.some((e) => e.transit) && i.subtype !== 'RLK-PV') cls = '3';
    else if (ev.some((e) => e.transit)) cls = '2'; else cls = '5';
    incRows.push({ ...i, day: iso, alone: true, duration_s: dur, evidence: ev, sibling, fix, full_window: full, cls });
  }
  await writeFile(join(out, 'classified-places.json'), JSON.stringify({ period, window: WINDOW, last_event: lastEvent, days, rows }));
  await writeFile(join(out, 'classified-incidents.json'), JSON.stringify({ window: WINDOW, last_event: lastEvent, rows: incRows }));
  console.log(`${rows.length} places, ${incRows.length} RLK incidents classified`);
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
