// Unit tests for scripts/build-incidents.mjs (no dependencies). Run with: node scripts/test-incidents.mjs
import assert from 'node:assert/strict';
import { relationSets, parseIncidents, pathsOf, verdictOf, orders, analyse, analyser, subtypeOf, leakers, leakTracker, readIncidents, LEVELS, FP_MIN_NEIGHBOURS, PERSISTENT_MIN_HOURS, writeLines } from './build-incidents.mjs';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

// 1 and 3 are providers of 2, 4 of 1, 1 of 100; 5 and 3 are peers
const CAIDA = '# source\n1|2|-1|bgp\n3|2|-1|bgp\n4|1|-1|bgp\n1|100|-1|bgp\n5|3|0|bgp\n';
const { providers: IDEAL, degree: DEGREE } = relationSets(CAIDA);
const NO_ASPAS = new Map();
const inc = (type, extra) => ({ incident_type: type, actor_key: `${type}_x`, start: '2026-10-22 10:00:00', end: '2026-10-22 10:05:00', end_reason: 'timeout', total_updates: 1, ...extra });
const ann = (path) => ({ type: 'A', compressed_path: path });
const LEAK = inc('RLK', { details: { path: [3, 2, 1, 100] }, messages: [ann([3, 2, 1, 100])] });   // 2 passes a route of its provider 1 to its provider 3
const FINE = inc('PRH', { details: {}, messages: [ann([4, 1, 100])] });                          // valley-free

await test('the relationships: providers of every AS (empty for an AS with none), customers of each provider', () => {
  assert.deepEqual([...IDEAL.get(2)].sort(), [1, 3]);
  assert.deepEqual([...IDEAL.get(4)], []);
  assert.ok(IDEAL.has(5) && IDEAL.get(5).size === 0, 'a peer is not a provider');
  assert.equal(DEGREE.get(1), 2);
  assert.equal(DEGREE.get(5), undefined);
});

await test('incident files: one object for each line, a cut or foreign line is skipped', () => {
  const list = parseIncidents(`${JSON.stringify(LEAK)}\n\nnot json\n{"x":1}\n{"incident_type":"VOL"`);
  assert.equal(list.length, 1);
});

await test('the paths of an incident: origin first, no prepending, no duplicates, no AS-set, at least two ASes', () => {
  assert.deepEqual(pathsOf(inc('RLK', { details: { path: [3, 2, 1, 100] }, messages: [ann([3, 2, 1, 100]), ann([3, 2, 2, 1, 100])] })), [[100, 1, 2, 3]]);
  assert.deepEqual(pathsOf(inc('PRH', { messages: [ann([7]), ann(['1', 2]), { type: 'W', compressed_path: null }] })), []);
  assert.deepEqual(pathsOf(inc('VOL', { messages: [{ type: 'W', compressed_path: null }] })), []);
});

await test('complete ASPAs: a valley is Invalid and a valley-free path is Valid; with no ASPA at all it is Unknown', () => {
  assert.equal(verdictOf(IDEAL, pathsOf(LEAK)), 2);
  assert.equal(verdictOf(IDEAL, pathsOf(FINE)), 0);
  assert.equal(verdictOf(NO_ASPAS, pathsOf(LEAK)), 1);
  assert.equal(verdictOf(IDEAL, []), null);
});

await test('the ASPA of the AS that goes up alone does not prove the valley downstream: Unknown', () => {
  assert.equal(verdictOf(new Map([[2, new Set([1])]]), pathsOf(LEAK)), 1);
});

await test('the worst verdict of the paths is the one of the incident', () => {
  const both = inc('PRH', { messages: [ann([4, 1, 100]), ann([3, 2, 1, 100])] });
  assert.equal(verdictOf(IDEAL, pathsOf(both)), 2);
});

await test('the orders: the same every time; the largest networks (most customers) first', () => {
  const a = orders(IDEAL, DEGREE), b = orders(IDEAL, DEGREE);
  assert.deepEqual([...a.random], [...b.random]);
  assert.equal(a.n, IDEAL.size);
  assert.equal(a.largest.get(1), 0);                      // AS1 has two customers
  assert.equal(new Set(a.random.values()).size, a.n);
});

await test('analyse: counts by type, real and complete ASPAs, the curve of adoption, no path for VOL', () => {
  const real = new Map([[1, new Set([4])], [3, new Set()]]);   // today AS1 lists 4 only and AS3 has an AS0 ASPA: the ramps do not meet
  const detail = [];
  const res = analyse([LEAK, FINE, inc('VOL', { messages: [{ type: 'W', compressed_path: null }] })], () => real, IDEAL, DEGREE, detail);
  assert.equal(res.total.incidents, 3);
  assert.equal(res.total.with_path, 2);
  assert.deepEqual(res.by_type.RLK.ideal, [0, 0, 1]);
  assert.deepEqual(res.by_type.RLK.real, [0, 0, 1]);
  assert.deepEqual(res.by_type.PRH.real, [0, 1, 0]);          // 100 and 4 have no ASPA: the path is not proved either way
  assert.deepEqual(res.by_type.PRH.ideal, [1, 0, 0]);
  assert.equal(res.by_type.VOL.with_path, 0);
  assert.deepEqual(res.period, { from: '2026-10-22 10:00:00', to: '2026-10-22 10:05:00' });   // the time of the first incident and of the last, UTC
  for (const o of ['random', 'largest']) {
    const c = res.adoption[o].RLK;
    assert.equal(c.length, LEVELS.length);
    assert.equal(c[0], 0);                                // nobody publishes: nothing is Invalid
    assert.equal(c[c.length - 1], 1);                     // everybody publishes: the valley is Invalid
    assert.deepEqual(res.adoption[o].total, c);           // the other path is never Invalid
  }
  assert.equal(detail.length, 3);
  assert.deepEqual(detail.map((d) => d.real), ['invalid', 'unknown', undefined]);
  assert.deepEqual(detail.map((d) => d.complete), ['invalid', 'valid', undefined]);
});

await test('subtypes: UL and LL as the detector recorded them, FP when one AS leaks to enough neighbours, ASM-FI and ASM-PS', () => {
  const at = (m) => `2026-10-22 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  const rlk = (by, to, rlk_type, minute = 0) => inc('RLK', { start: at(minute), details: { by, to, rlk_type, path: [to, by, 1, 100] }, messages: [ann([to, by, 1, 100])] });
  const list = [rlk(2, 3, 'UL'), rlk(7, 3, 'UL'), rlk(7, 5, 'LL')];
  for (let to = 10; to < 10 + FP_MIN_NEIGHBOURS; to++) list.push(rlk(9, to, 'UL', to));            // within one hour: FP
  for (let to = 10; to < 10 + FP_MIN_NEIGHBOURS; to++) list.push(rlk(11, to, 'UL', to * 90));      // spread over a day: not FP
  for (let h = 0; h < PERSISTENT_MIN_HOURS; h++) list.push(rlk(12, 3, 'LL', h * 60 + 5));           // every hour: persistent
  list.push(inc('ASM', { details: { asm_type: 'FI', path: [4, 1, 666] }, messages: [ann([4, 1, 666])] }), inc('ASM', { details: { asm_type: 'PS' } }), inc('ASM', { details: {} }), rlk(8, 3, undefined));
  const res = analyse(list, () => NO_ASPAS, IDEAL, DEGREE);
  assert.equal(res.subtypes['RLK-UL'].incidents, 2 + FP_MIN_NEIGHBOURS);        // AS2 and AS7 leak to one or two neighbours, AS11 to many but slowly
  assert.equal(res.subtypes['RLK-LL'].incidents, 1);
  assert.equal(res.subtypes['RLK-FP'].incidents, FP_MIN_NEIGHBOURS);
  assert.equal(res.subtypes['RLK-PV'].incidents, PERSISTENT_MIN_HOURS);
  const lk = leakers(list);
  assert.equal(res.adoption.base.RLK, res.by_type.RLK.with_path - PERSISTENT_MIN_HOURS);   // the persistent valleys are not in the curves
  assert.equal(res.adoption.base.total, res.total.with_path - PERSISTENT_MIN_HOURS);
  assert.deepEqual([...lk.fp], [9]);
  assert.deepEqual([...lk.persistent], [12]);
  assert.equal(res.subtypes['ASM-FI'].incidents, 1);
  assert.equal(res.subtypes['ASM-FI'].with_path, 1);
  assert.equal(res.subtypes['ASM-PS'].incidents, 1);
  assert.equal(res.by_type.ASM.incidents, 3);                // the one with no type is only in its type
  assert.equal(res.by_type.RLK.incidents, list.filter((i) => i.incident_type === 'RLK').length);
  const none = { fp: new Set(), persistent: new Set() };
  assert.equal(subtypeOf(inc('VOL', {}), none), null);
  const sub = (type, details) => subtypeOf(inc(type, { details }), none);
  assert.equal(sub('PRH', { prh_type: 'AB' }), 'PRH-AB');
  assert.equal(sub('PRH', { anomaly: 'Invalid_Origin (Prefix Hijack)' }), null);
  assert.deepEqual(['PE', 'EX', 'FI', 'PS'].map((t) => sub('ASM', { asm_type: t })), ['ASM-PE', 'ASM-EX', 'ASM-FI', 'ASM-PS']);
  assert.deepEqual([{ vol_type: 'DC' }, { vol_type: 'AC' }, { vol_type: 'FO' }, { flap_count: 7 }, {}].map((d) => sub('VOL', d)), ['VOL-DC', 'VOL-AC', 'VOL-FO', 'VOL-FO', null]);
  assert.deepEqual([{ deg_type: 'flood' }, { deg_type: 'excessive' }, { deg_type: 'jump' }, { anomaly: 'Cross-Origin Deaggregation' }, { anomaly: 'x' }].map((d) => sub('DEG', d)), ['DEG-FF', 'DEG-XS', 'DEG-XS', 'DEG-MA', null]);
  assert.deepEqual([{ atr_type: 'EH' }, { atr_type: 'MA' }, {}].map((d) => sub('ATR', d)), ['ATR-EH', 'ATR-MA', null]);
});

await test('the aggregate has no AS number and no actor', () => {
  const res = analyse([LEAK], () => NO_ASPAS, IDEAL, DEGREE);
  const text = JSON.stringify(res);
  assert.ok(!/actor|RLK_x/.test(text));
  assert.ok(!/"(by|path|paths|prefixes)"/.test(text));
});

await test('the detail file: one line for each incident, written as it goes, no temporary file left; a file that cannot be written is an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'incidents-'));
  try {
    const file = join(dir, 'detail.jsonl');
    const items = Array.from({ length: 50000 }, (_, i) => ({ type: 'RLK', actor: `RLK_${i}`, pad: 'x'.repeat(40) }));
    await writeLines(file, items);
    const lines = (await readFile(file, 'utf8')).split('\n');
    assert.equal(lines.length, items.length + 1);
    assert.equal(lines.at(-1), '');
    assert.deepEqual(JSON.parse(lines[0]), items[0]);
    assert.deepEqual(JSON.parse(lines.at(-2)), items.at(-1));
    assert.deepEqual(await readdir(dir), ['detail.jsonl']);
    await writeLines(file, []);
    assert.equal(await readFile(file, 'utf8'), '');
    await assert.rejects(writeLines(join(dir, 'missing', 'detail.jsonl'), items.slice(0, 2)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('a generator that fails leaves the detail file of before and no temporary file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'incidents-'));
  try {
    const file = join(dir, 'detail.jsonl');
    await writeLines(file, [{ a: 1 }]);
    const broken = async function* () { yield { a: 2 }; throw new Error('no incident in the input'); };
    await assert.rejects(writeLines(file, broken()), /no incident/);
    assert.equal(await readFile(file, 'utf8'), '{"a":1}\n');
    assert.deepEqual(await readdir(dir), ['detail.jsonl']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('the files read an incident at a time, plain and gzipped, give the same aggregate and the same detail as the list in memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'incidents-'));
  try {
    const at = (h) => `2026-10-22 ${String(h).padStart(2, '0')}:05:00`;
    const rlk = (by, to, h) => inc('RLK', { start: at(h), details: { by, to, rlk_type: 'UL', path: [to, by, 1, 100] }, messages: [ann([to, by, 1, 100])] });
    const list = [LEAK, FINE, inc('VOL', { messages: [{ type: 'W', compressed_path: null }] })];
    for (let h = 0; h < PERSISTENT_MIN_HOURS; h++) list.push(rlk(12, 3, h));                       // persistent: known only after the last line
    for (let to = 10; to < 10 + FP_MIN_NEIGHBOURS; to++) list.push(rlk(9, to, 20));                // full propagation
    const lines = list.map((o) => JSON.stringify(o));
    const half = Math.floor(lines.length / 2);
    const files = [join(dir, 'incidents_1.jsonl'), join(dir, 'incidents_2.jsonl.gz')];
    await writeFile(files[0], `${lines.slice(0, half).join('\n')}\nnot json\n`);
    await writeFile(files[1], gzipSync(`${lines.slice(half).join('\n')}\n{"incident_type":"VOL"`));
    const tracker = leakTracker();
    let leaks = 0;
    for await (const o of readIncidents(files, /"incident_type"\s*:\s*"RLK"/)) { leaks++; tracker.add(o); }
    assert.equal(leaks, list.filter((o) => o.incident_type === 'RLK').length);                    // the other lines are not parsed
    const lk = tracker.result();
    assert.deepEqual([[...lk.fp], [...lk.persistent]], [[9], [12]]);
    const a = analyser(() => NO_ASPAS, IDEAL, DEGREE, lk), rows = [];
    for await (const o of readIncidents(files)) rows.push(a.add(o));
    const detail = [];
    assert.deepEqual(a.result(), analyse(list, () => NO_ASPAS, IDEAL, DEGREE, detail));
    assert.deepEqual(rows, detail);
    assert.equal(rows.length, list.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

console.log(`${passed} tests passed`);
