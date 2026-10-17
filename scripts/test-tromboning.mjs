// Unit tests for site/tromboning.js (no dependencies). Run with: node scripts/test-tromboning.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { analyse } = createRequire(import.meta.url)('../site/tromboning.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const reg = { 1: ['IT', 'r'], 2: ['IT', 'r'], 5: ['IT', 'r'], 3: ['US', 'a'], 4: ['DE', 'r'], 6: ['FR', 'r'], 9: ['IT', 'r'], 100: ['NL', 'r'] };
const lookup = (a) => (reg[a] ? { cc: reg[a][0], rir: reg[a][1] } : null);
const r = (path, source) => ({ path, source_id: source });
const many = (path, n, p = 'f') => Array.from({ length: n }, (_, i) => r(path, `${p}${i}`));

test('a domestic path through another region and one through another country of the same region', () => {
  const a = analyse([r([1, 3, 9], 'a'), r([2, 4, 9], 'b'), r([5, 2, 9], 'c')], 9, lookup);
  assert.equal(a.country, 'IT');
  assert.equal(a.domestic, 3);
  assert.equal(a.feeders, 3);
  assert.equal(a.crossCountry, 2);
  assert.equal(a.crossRegion, 1);
  assert.equal(a.byAs.get(3).outsideRegion, true);
  assert.equal(a.byAs.get(4).outsideRegion, false);
  assert.deepEqual(a.examples, [[1, 3, 9]]);
  assert.equal(a.enough, true);
});

test('paths seen by a feeder of another country, or of two ASes, are not domestic', () => {
  const a = analyse([r([4, 3, 9], 'a'), r([1, 9], 'b'), r([6, 4, 9], 'c')], 9, lookup);
  assert.equal(a.domestic, 0);
  assert.equal(a.crossCountry, 0);
});

test('the origin itself and the feeder are not counted as crossing', () => {
  const a = analyse(many([1, 2, 9], 5), 9, lookup);
  assert.equal(a.domestic, 5);
  assert.equal(a.crossCountry, 0);
  assert.equal(a.byAs.size, 0);
});

test('exchange-point ASes and prepending are dropped', () => {
  const a = analyse([r([1, 100, 2, 2, 9], 'a')], 9, lookup, { ixp: new Set([100]) });
  assert.equal(a.crossCountry, 0);                // the Dutch IXP AS is left out
  const b = analyse([r([1, 100, 2, 9], 'a')], 9, lookup);
  assert.equal(b.crossCountry, 1);                // without the list it counts
});

test('feeders are counted by their AS: three are enough, one network seen many times is not', () => {
  const a = analyse([r([1, 3, 9], 'a'), r([2, 3, 9], 'b'), r([5, 3, 9], 'c')], 9, lookup);
  assert.equal(a.feeders, 3);
  assert.equal(a.enough, true);
  const b = analyse(many([1, 3, 9], 40), 9, lookup);
  assert.equal(b.domestic, 40);
  assert.equal(b.feeders, 1);
  assert.equal(b.enough, false);
});

test('an origin whose country is not known gives an empty result', () => {
  const a = analyse(many([1, 3, 777], 5), 777, lookup);
  assert.equal(a.country, null);
  assert.equal(a.domestic, 0);
});

console.log(`${passed} tests passed`);
