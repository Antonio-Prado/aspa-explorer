// Unit tests for scripts/build-incidents.mjs (no dependencies). Run with: node scripts/test-incidents.mjs
import assert from 'node:assert/strict';
import { relationSets, parseIncidents, pathsOf, verdictOf, orders, analyse, LEVELS } from './build-incidents.mjs';

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
  assert.deepEqual(res.period, { from: '2026-10-22', to: '2026-10-22' });
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

await test('the aggregate has no AS number and no actor', () => {
  const res = analyse([LEAK], () => NO_ASPAS, IDEAL, DEGREE);
  const text = JSON.stringify(res);
  assert.ok(!/actor|RLK_x/.test(text));
  assert.ok(!/"(by|path|paths|prefixes)"/.test(text));
});

console.log(`${passed} tests passed`);
