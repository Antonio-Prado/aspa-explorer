// Unit tests for scripts/build-trends.mjs and the helpers of site/trends.js (no dependencies). Run with: node scripts/test-trends.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { checkpoints, trends, registryOf } from './build-trends.mjs';

const { seriesFor, niceMax } = createRequire(import.meta.url)('../site/trends.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('checkpoints: the last day of each month, and today at the end', () => {
  assert.deepEqual(checkpoints('2026-08-15', '2026-10-18'), ['2026-08-31', '2026-09-30', '2026-10-18']);
  assert.deepEqual(checkpoints('2026-10-01', '2026-10-18'), ['2026-10-18']);
  assert.deepEqual(checkpoints('2025-12-20', '2026-01-05'), ['2025-12-31', '2026-01-05']);
  assert.equal(checkpoints('2024-01-10', '2024-03-02')[1], '2024-02-29');
});

const where = registryOf({ asns: { 1: 'ITr', 2: 'ITr', 3: 'USa', 4: 'ZZr' } });

test('the registry gives country and RIR, and null for an AS that is not there', () => {
  assert.deepEqual(where(3), { cc: 'US', rir: 'arin' });
  assert.equal(where(99), null);
});

test('the counts per RIR and country follow the events, month by month', () => {
  const events = [
    ['2026-08-02', 'AS1', ['AS10']], ['2026-08-20', 'AS3', ['AS10']],
    ['2026-09-05', 'AS2', ['AS10']], ['2026-09-06', 'AS3', null],
    ['2026-10-10', 'AS99', ['AS10']],
  ];
  const t = trends(events, where, '2026-10-18');
  assert.deepEqual(t.points, ['2026-08-31', '2026-09-30', '2026-10-18']);
  assert.deepEqual(t.total, [2, 2, 3]);
  assert.deepEqual(t.country.IT, [1, 2, 2]);
  assert.deepEqual(t.country.US, [1, 0, 0]);
  assert.deepEqual(t.country.ZZ, [0, 0, 1]);          // an AS that is not in the registry
  assert.deepEqual(t.rir.ripe, [1, 2, 2]);
  assert.deepEqual(t.rir.unknown, [0, 0, 1]);
});

test('an ASPA that is removed and comes back is counted once, and no events give a flat zero', () => {
  const t = trends([['2026-09-01', 'AS1', ['AS10']], ['2026-09-02', 'AS1', null], ['2026-09-03', 'AS1', ['AS11']]], where, '2026-09-30');
  assert.deepEqual(t.total, [1]);
  assert.deepEqual(trends([], where, '2026-10-18').total, [0]);
});

test('the series of a chart: all, a RIR or a country, and the top of its axis', () => {
  const doc = { points: ['a', 'b'], total: [1, 5], rir: { ripe: [1, 4] }, country: { IT: [0, 2] } };
  assert.deepEqual(seriesFor(doc, 'all'), [1, 5]);
  assert.deepEqual(seriesFor(doc, 'rir:ripe'), [1, 4]);
  assert.deepEqual(seriesFor(doc, 'rir:afrinic'), [0, 0]);
  assert.deepEqual(seriesFor(doc, 'cc:IT'), [0, 2]);
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 7);
  assert.equal(niceMax(10), 10);
  assert.equal(niceMax(1234), 1500);
  assert.equal(niceMax(3229), 3500);
});

console.log(`${passed} tests passed`);
