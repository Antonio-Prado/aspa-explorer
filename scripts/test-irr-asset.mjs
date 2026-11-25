// Unit tests for scripts/irr-asset.mjs (no dependencies, no network). Run with: node scripts/test-irr-asset.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { setName, isSetName, setsOfFilter, asSets, buildTable, expander, subjectOf, verdictOf, decode, assetChecker, keyOf, MAX_PREFIXES } from './irr-asset.mjs';
import { listSnapshots } from './irr-registered.mjs';
import { analyse, relationSets } from './build-incidents.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };
const linesOf = (text) => createInterface({ input: Readable.from([text]), crlfDelay: Infinity });

await test('set names: the source and the case do not matter, AS-ANY and AS numbers are not sets', () => {
  assert.equal(setName('RIPE::AS-Foo'), 'AS-FOO');
  assert.equal(setName('as-foo@example'), 'AS-FOO');
  assert.equal(setName('as123:as-cust'), 'AS123:AS-CUST');
  assert.ok(isSetName('AS-FOO') && isSetName('AS123:AS-CUST'));
  assert.ok(!isSetName('AS123') && !isSetName('AS-ANY') && !isSetName('ANY'));
  assert.deepEqual(setsOfFilter('AS-FOO AND NOT AS-BAR'), ['AS-FOO', 'AS-BAR']);
  assert.deepEqual(setsOfFilter('ANY'), []);
  assert.deepEqual(setsOfFilter('{192.0.2.0/24}'), []);
});

await test('as-set objects: members on several lines and mp-members, comments dropped, other objects skipped', async () => {
  const db = 'aut-num: AS1\nmembers: AS9\n\nas-set: AS-A # c\nmembers: AS1, AS2\n  AS-B\nmp-members: AS3\nsource: RIPE\n\nas-set: AS-B\nmembers: AS4 # four\n';
  const got = [];
  for await (const s of asSets(linesOf(db))) got.push(s);
  assert.deepEqual(got, [['AS-A', ['AS1', 'AS2', 'AS-B', 'AS3']], ['AS-B', ['AS4']]]);
});

await test('expansion: nested sets, loops, members held elsewhere make it open', () => {
  const table = { sets: { 'AS-A': ['AS1', 'AS-B', 'AS-LOOP'], 'AS-B': ['AS3', 'AS2', 'AS-A'], 'AS-LOOP': ['AS-LOOP', 'AS5'], 'AS-C': ['AS7', 'AS-ELSEWHERE'] } };
  const expand = expander(table);
  assert.deepEqual([...expand('AS-A').ases], [1, 2, 3, 5]);
  assert.equal(expand('AS-A').open, false);
  assert.deepEqual([...expand('AS-C').ases], [7]);
  assert.equal(expand('AS-C').open, true);
  assert.equal(expand('AS-NOWHERE').open, true);
});

const msg = (path, prefix) => ({ type: 'A', prefix, compressed_path: path });
const PRH = (prefixes, origin, paths, start = '2026-11-25 10:00:00') => ({ incident_type: 'PRH', actor_key: `PRH_${origin}`, start, end: start, end_reason: 'timeout', prefixes, details: { prefix: prefixes[0], actual_origin: origin }, messages: paths.map((p) => msg(p, prefixes[0])) });
const RLK = (prefixes, from, by, to, start = '2026-11-25 10:00:00') => ({ incident_type: 'RLK', actor_key: `RLK_${from}_${by}_${to}`, start, end: start, end_reason: 'timeout', prefixes, details: { from, by, to, path: [to, by, from] }, messages: [] });

await test('sender and receiver: the origin and the AS after it for a hijack, the leaker and the AS it sent to for a leak', () => {
  const s = subjectOf(PRH(['192.0.2.0/24'], 64500, [[1, 2, 64501, 64500], [3, 64501, 64500], [4, 64502, 64500], [5, 6]]));
  assert.equal(s.sender, 64500);
  assert.equal(s.receiver, 64501);        // two paths of three that reach the origin
  const l = subjectOf(RLK(['198.51.100.0/24', '198.51.100.0/24'], 10, 20, 30));
  assert.deepEqual([l.sender, l.receiver, l.prefixes], [20, 30, ['198.51.100.0/24']]);
  assert.equal(subjectOf(PRH(['192.0.2.0/24'], 64500, [])), null);     // no path: no receiver
  assert.equal(subjectOf({ incident_type: 'VOL', details: {} }), null);
  assert.equal(subjectOf(RLK(Array.from({ length: 80 }, (_, i) => `10.${i}.0.0/16`), 1, 2, 3)).prefixes.length, MAX_PREFIXES);
  assert.notEqual(keyOf(RLK([], 1, 2, 3)), keyOf(RLK([], 1, 2, 3, '2026-11-25 10:00:01')));
});

await test('verdicts: the set exported to the receiver first, then PeeringDB, else the sender alone; wide sets', () => {
  const table = {
    sets: { 'AS-CUST': ['AS100', 'AS101'], 'AS-ALL': ['AS100', 'AS101', 'AS200', 'AS300'], 'AS-OPEN': ['AS101', 'AS-ELSEWHERE'] },
    exports: { 20: { 30: ['AS-CUST'] } },
    pdb: { 20: ['AS-ALL'], 21: ['AS-OPEN'] },
    origins: { 100: 1, 101: 1, 200: 5, 300: 3, 20: 1 },
    total: 11,
  };
  const originsOf = new Map([['192.0.2.0/24', new Set([100])], ['198.51.100.0/24', new Set([200])], ['203.0.112.0/20', new Set([300])]]);
  const run = (sender, receiver, prefixes) => decode(verdictOf({ sender, receiver, prefixes }, table, expander(table), originsOf));
  assert.deepEqual(run(20, 30, ['192.0.2.0/24']), { verdict: 'passes', via: 'aut-num', wide: false });
  assert.deepEqual(run(20, 30, ['192.0.2.0/24', '198.51.100.0/24']), { verdict: 'partly', via: 'aut-num', wide: false });
  assert.deepEqual(run(20, 30, ['198.51.100.0/24']), { verdict: 'stopped', via: 'aut-num', wide: false });
  // another receiver: PeeringDB's set, wide (10 of 11 route objects)
  assert.deepEqual(run(20, 31, ['198.51.100.0/24']), { verdict: 'passes', via: 'peeringdb', wide: true });
  // a more specific of a route object of the set passes
  assert.deepEqual(run(20, 31, ['203.0.113.0/24']), { verdict: 'passes', via: 'peeringdb', wide: true });
  // a set with members elsewhere: nothing admitted is unknown, not stopped
  assert.equal(run(21, 30, ['198.51.100.0/24']).verdict, 'unknown');
  // no set: the sender's own route objects
  assert.deepEqual(run(99, 30, ['198.51.100.0/24']), { verdict: 'stopped', via: 'none', wide: false });
});

await test('the checker on an archive: table and verdicts kept in the cache, incidents before the archive not covered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'irr-asset-'));
  try {
    const day = join(dir, 'irr', '2026', '11', '24');
    await mkdir(day, { recursive: true });
    await writeFile(join(day, 'index.tsv.gz'), gzipSync('# snapshot 2026-11-24T18:00:00Z canonical\n192.0.2.0/24\tAS100\tRIPE\n198.51.100.0/24\tAS200\tARIN\n203.0.113.0/24\tAS400\tARIN\n203.0.114.0/24\tAS400\tARIN\n'));
    await writeFile(join(day, 'ripe.db.as-set.gz'), gzipSync('as-set: AS20:AS-CUST\nmembers: AS100\nsource: RIPE\n'));
    await writeFile(join(day, 'ripe.db.aut-num.gz'), gzipSync('aut-num: AS20\nexport: to AS30 announce AS20:AS-CUST\nsource: RIPE\n'));
    for (const f of ['apnic.db.as-set.gz', 'apnic.db.aut-num.gz', 'arin.db.gz', 'afrinic.db.gz', 'lacnic.db.gz']) await writeFile(join(day, f), gzipSync(''));
    const snaps = await listSnapshots(join(dir, 'irr'));
    const cache = join(dir, 'cache');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'peeringdb-2026-11-24.json'), JSON.stringify({ net: { data: [{ asn: 21, irr_as_set: 'ARIN::AS-NOWHERE' }] } }));
    const a = assetChecker(snaps, cache);
    const leak = RLK(['192.0.2.0/24'], 10, 20, 30), leak2 = RLK(['198.51.100.0/24'], 10, 20, 30, '2026-11-25 11:00:00');
    const leak3 = RLK(['198.51.100.0/24'], 10, 21, 30), early = RLK(['192.0.2.0/24'], 10, 20, 30, '2026-11-20 10:00:00');
    for (const i of [leak, leak2, leak3, early]) await a.need(i);
    await a.load();
    assert.deepEqual(decode(a.verdict(leak)), { verdict: 'passes', via: 'aut-num', wide: false });
    assert.equal(decode(a.verdict(leak2)).verdict, 'stopped');
    assert.deepEqual(decode(a.verdict(leak3)), { verdict: 'unknown', via: 'peeringdb', wide: false });
    assert.equal(a.verdict(early), 'not_covered');
    assert.ok(existsSync(join(cache, 'table-2026-11-24.json')) && existsSync(join(cache, 'verdicts-2026-11-24.json')));
    // a second run reads the verdicts from the cache, with no need to load anything
    const b = assetChecker(snaps, cache);
    await b.need(leak);
    await b.load();
    assert.equal(decode(b.verdict(leak)).verdict, 'passes');
    // the counts of build-incidents
    const { providers, degree } = relationSets('');
    const res = analyse([leak, leak2, leak3, early], () => new Map(), providers, degree, null, null, a.verdict);
    assert.deepEqual(res.by_type.RLK.irr_set, { passes: 1, partly: 0, stopped: 1, unknown: 1, not_covered: 1, via: { 'aut-num': 2, peeringdb: 1, none: 0 }, wide: 0 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('a snapshot with a database missing, or with no PeeringDB copy, gives verdicts for the run but keeps nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'irr-asset-'));
  try {
    const day = join(dir, 'irr', '2026', '11', '24');
    await mkdir(day, { recursive: true });
    await writeFile(join(day, 'index.tsv.gz'), gzipSync('# snapshot 2026-11-24T18:00:00Z canonical\n192.0.2.0/24\tAS100\tRIPE\n'));
    await writeFile(join(day, 'ripe.db.as-set.gz'), gzipSync('as-set: AS-X\nmembers: AS100\n'));
    const cache = join(dir, 'cache');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'peeringdb-2026-11-24.json'), JSON.stringify({ net: { data: [{ asn: 20, irr_as_set: 'AS-X' }] } }));
    const a = assetChecker(await listSnapshots(join(dir, 'irr')), cache);
    const leak = RLK(['192.0.2.0/24'], 10, 20, 30);
    await a.need(leak);
    await a.load();
    assert.deepEqual(decode(a.verdict(leak)), { verdict: 'passes', via: 'peeringdb', wide: true });
    assert.ok(!existsSync(join(cache, 'table-2026-11-24.json')) && !existsSync(join(cache, 'verdicts-2026-11-24.json')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

console.log(`${passed} tests passed`);
