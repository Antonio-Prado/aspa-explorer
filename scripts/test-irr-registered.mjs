// Unit tests for scripts/irr-registered.mjs (no dependencies). Run with: node scripts/test-irr-registered.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonPrefix, canonOrigin, subjectOf, pickSnapshot, listSnapshots, irrChecker, lessSpecifics, SNAPSHOT_MAX_AGE } from './irr-registered.mjs';
import { analyse, relationSets } from './build-incidents.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

await test('prefixes: canonical form, leading zeros and case and host bits do not matter, garbage is null', () => {
  assert.equal(canonPrefix('064.006.160.000/19'), '64.6.160.0/19');
  assert.equal(canonPrefix('192.0.2.77/24'), '192.0.2.0/24');
  assert.equal(canonPrefix('0.0.0.0/0'), '0.0.0.0/0');
  assert.equal(canonPrefix('2001:DB8:0:0::/32'), '2001:db8::/32');
  assert.equal(canonPrefix('2001:db8:1:2::1/48'), '2001:db8:1::/48');
  assert.equal(canonPrefix('2a0c:9a40:8570::/48'), '2a0c:9a40:8570::/48');
  assert.equal(canonPrefix('256.0.0.0/8'), null);
  assert.equal(canonPrefix('10.0.0.0/33'), null);
  assert.equal(canonPrefix('2001:db8::/129'), null);
  assert.equal(canonPrefix('nonsense'), null);
  assert.equal(canonPrefix(undefined), null);
});

await test('origins: AS64500, as64500 and 64500 are the same; anything else is null', () => {
  assert.equal(canonOrigin('AS64500'), 64500);
  assert.equal(canonOrigin('as64500'), 64500);
  assert.equal(canonOrigin(64500), 64500);
  assert.equal(canonOrigin('AS-SET'), null);
  assert.equal(canonOrigin('AS4294967296'), null);
});

const inc = (type, details, start = '2026-11-25 10:00:00') => ({ incident_type: type, actor_key: 'x', start, end: start, end_reason: 'timeout', details, messages: [] });
const PRH = (prefix, origin, start) => inc('PRH', { anomaly: 'Invalid_Origin (Prefix Hijack)', prefix, actual_origin: origin }, start);
const DEG = (prefix, origin, start) => inc('DEG', { anomaly: 'Cross-Origin Deaggregation', sub_prefix: prefix, sub_origin: origin }, start);

await test('what is checked: the origin of a hijack and of a more specific of another AS; leaks and the rest are not', () => {
  const s = subjectOf(PRH('192.0.2.0/24', 64500));
  assert.equal(s.key, '192.0.2.0/24 64500');
  assert.equal(s.covering[0], '192.0.2.0/23 64500');
  assert.equal(s.covering.at(-1), '192.0.0.0/8 64500');
  assert.equal(subjectOf(DEG('2001:DB8::/48', 64501)).key, '2001:db8::/48 64501');
  assert.equal(subjectOf(inc('DEG', { anomaly: 'Excessive deaggregation', sub_prefix: '192.0.2.0/24', sub_origin: 1 })), null);
  assert.equal(subjectOf(inc('RLK', { prefix: '192.0.2.0/24', by: 1 })), null);
  assert.equal(subjectOf(PRH('bad', 64500)), null);
});

await test('less specific prefixes: longest first, down to /8 and /16', () => {
  assert.deepEqual(lessSpecifics('192.0.2.0/24').slice(0, 3), ['192.0.2.0/23', '192.0.0.0/22', '192.0.0.0/21']);
  assert.equal(lessSpecifics('192.0.2.0/24').length, 16);
  assert.deepEqual(lessSpecifics('10.0.0.0/8'), []);
  assert.equal(lessSpecifics('2001:db8:1::/48')[0], '2001:db8::/47');
  assert.equal(lessSpecifics('2001:db8:1::/48').at(-1), '2001::/16');
});

await test('the snapshot of an incident: the newest taken before it began, and not older than the limit', () => {
  const snaps = [{ time: 1000, file: 'a' }, { time: 5000, file: 'b' }];
  assert.equal(pickSnapshot(snaps, 999), null, 'before the first snapshot');
  assert.equal(pickSnapshot(snaps, 1000).file, 'a');
  assert.equal(pickSnapshot(snaps, 4999).file, 'a');
  assert.equal(pickSnapshot(snaps, 6000).file, 'b');
  assert.equal(pickSnapshot(snaps, 5000 + SNAPSHOT_MAX_AGE + 1), null, 'a gap in the archive');
  assert.equal(pickSnapshot(snaps, null), null);
});

// an archive of two days: on the 24th the hijacker had no route object, on the 25th it had one
const dir = await mkdtemp(join(tmpdir(), 'irr-'));
const day = async (path, snapshot, lines) => {
  await mkdir(join(dir, path), { recursive: true });
  await writeFile(join(dir, path, 'index.tsv.gz'), gzipSync(`# snapshot ${snapshot}\n${lines.join('\n')}\n`));
};
await day('2026/11/24', '2026-11-24T20:15:00Z', ['192.000.002.000/24\tAS64500\tARIN', '2001:DB8::/48\tAS64501\tRIPE']);
await day('2026/11/25', '2026-11-25T20:15:00Z', ['192.0.2.0/24\tAS64500\tARIN', '198.51.100.0/24\tAS64666\tAPNIC', '203.0.112.0/22\tAS64777\tAPNIC']);
await mkdir(join(dir, '2026/11/26'), { recursive: true });   // a day whose index is not there (yet): left out

await test('the archive: one snapshot a day with its time, a day without an index is left out, a missing archive is empty', async () => {
  const s = await listSnapshots(dir);
  assert.deepEqual(s.map((x) => x.day), ['2026-11-24', '2026-11-25']);
  assert.equal(s[0].time, Date.parse('2026-11-24T20:15:00Z') / 1000);
  assert.deepEqual(await listSnapshots(join(dir, 'nowhere')), []);
});

await test('verdicts: registered, unregistered on the day before the object appeared, not covered before the archive', async () => {
  const c = irrChecker(await listSnapshots(dir));
  const list = [
    PRH('192.0.2.0/24', 64500, '2026-11-25 08:00:00'),     // snapshot of the 24th: has it
    PRH('198.51.100.0/24', 64666, '2026-11-25 08:00:00'),  // snapshot of the 24th: has none (it came on the 25th)
    PRH('198.51.100.0/24', 64666, '2026-11-26 08:00:00'),  // snapshot of the 25th: has it
    DEG('2001:db8::/48', 64501, '2026-11-25 08:00:00'),    // IPv6, written otherwise in the index
    DEG('2001:db8::/48', 64999, '2026-11-25 08:00:00'),    // another origin: none
    PRH('192.0.2.0/24', 64500, '2026-11-24 08:00:00'),     // before the first snapshot
    PRH('192.0.2.0/24', 64500, '2026-11-28 08:00:00'),     // the newest snapshot is too old
    inc('RLK', { by: 1 }),
    DEG('203.0.113.0/24', 64777, '2026-11-26 08:00:00'),   // a /22 of the same origin covers it
    DEG('203.0.113.0/24', 64778, '2026-11-26 08:00:00'),   // the /22 is of another origin
  ];
  for (const i of list) c.need(i);
  await c.load();
  assert.deepEqual(list.map(c.verdict), ['registered', 'unregistered', 'registered', 'registered', 'unregistered', 'not_covered', 'not_covered', null,
    'less_specific', 'unregistered']);
});

await test('a snapshot that cannot be read (missing, not gzip): its incidents are not covered, never unregistered', async () => {
  await writeFile(join(dir, 'broken.tsv.gz'), 'not gzip at all');
  for (const name of ['missing.tsv.gz', 'broken.tsv.gz']) {
    const c = irrChecker([{ day: '2026-11-24', time: Date.parse('2026-11-24T20:15:00Z') / 1000, file: join(dir, name) }]);
    const i = PRH('198.51.100.0/24', 64666, '2026-11-25 08:00:00');
    c.need(i);
    const err = console.error; console.error = () => {};
    try { await c.load(); } finally { console.error = err; }
    assert.equal(c.verdict(i), 'not_covered', name);
  }
  await mkdir(join(dir, '2026/11/27'), { recursive: true });
  await writeFile(join(dir, '2026/11/27/index.tsv.gz'), 'not gzip at all');
  assert.deepEqual((await listSnapshots(dir)).map((x) => x.day), ['2026-11-24', '2026-11-25'], 'a broken index is left out of the list');
});

await test('the aggregate: irr counted for the checked types and subtypes only, and in the detail lines', async () => {
  const c = irrChecker(await listSnapshots(dir));
  const list = [PRH('192.0.2.0/24', 64500, '2026-11-25 08:00:00'), PRH('198.51.100.0/24', 64666, '2026-11-25 08:00:00'),
    PRH('192.0.2.0/24', 64500, '2026-11-20 08:00:00'), inc('RLK', { path: [1, 2, 3], by: 2 })];
  for (const i of list) c.need(i);
  await c.load();
  const { providers, degree } = relationSets('1|2|-1|bgp\n');
  const detail = [];
  const res = analyse(list, () => new Map(), providers, degree, detail, c.verdict);
  assert.deepEqual(res.by_type.PRH.irr, { registered: 1, less_specific: 0, unregistered: 1, not_covered: 1 });
  assert.deepEqual(res.total.irr, { registered: 1, less_specific: 0, unregistered: 1, not_covered: 1 });
  assert.equal(res.by_type.RLK.irr, undefined);
  assert.deepEqual(detail.map((r) => r.irr), ['registered', 'unregistered', 'not_covered', undefined]);
});

await test('a canonical index is read as it is, and the cache gives the verdicts again without reading it', async () => {
  const d2 = await mkdtemp(join(tmpdir(), 'irr-c-'));
  await mkdir(join(d2, 'a/2026/11/24'), { recursive: true });
  const index = join(d2, 'a/2026/11/24/index.tsv.gz');
  await writeFile(index, gzipSync('# snapshot 2026-11-24T20:15:00Z canonical\n192.0.2.0/24\tAS64500\tARIN\n203.0.112.0/22\tAS64777\tAPNIC\n'));
  const list = [PRH('192.0.2.0/24', 64500, '2026-11-25 08:00:00'), DEG('203.0.113.0/24', 64777, '2026-11-25 08:00:00'), PRH('198.51.100.0/24', 1, '2026-11-25 08:00:00')];
  const run = async () => {
    const snaps = await listSnapshots(join(d2, 'a'));
    const c = irrChecker(snaps.length ? snaps : [{ day: '2026-11-24', time: Date.parse('2026-11-24T20:15:00Z') / 1000, file: index, canonical: true }], join(d2, 'cache'));
    for (const i of list) c.need(i);
    await c.load();
    return list.map(c.verdict);
  };
  assert.equal((await listSnapshots(join(d2, 'a')))[0].canonical, true);
  assert.deepEqual(await run(), ['registered', 'less_specific', 'unregistered']);
  await rm(index);                                     // the cache alone answers now
  assert.deepEqual(await run(), ['registered', 'less_specific', 'unregistered']);
  list.push(PRH('192.0.2.0/24', 64999, '2026-11-25 08:00:00'));   // not in the cache, and the index is gone
  const err = console.error; console.error = () => {};
  try { assert.deepEqual(await run(), ['registered', 'less_specific', 'unregistered', 'not_covered']); } finally { console.error = err; }
  await rm(d2, { recursive: true, force: true });
});

await rm(dir, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
