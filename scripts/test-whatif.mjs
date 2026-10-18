// Unit tests for site/whatif.js (no dependencies). Run with: node scripts/test-whatif.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { parseProviders, compare } = createRequire(import.meta.url)('../site/whatif.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const set = (...a) => new Set(a);

test('the list of providers is read, sorted and de-duplicated', () => {
  assert.deepEqual(parseProviders('AS3356, 1299 as174 1299').providers, ['AS174', 'AS1299', 'AS3356']);
  assert.deepEqual(parseProviders('0').providers, ['AS0']);
  assert.match(parseProviders('0 1299').error, /AS0/);
  assert.match(parseProviders('12x').error, /not an AS number/);
  assert.match(parseProviders('99999999999').error, /not an AS number/);
  assert.deepEqual(parseProviders('  ').providers, []);
});

// AS9 is the origin, AS5 and AS6 are neighbours; AS1 is above them (a Tier-1: its ASPA is AS0, no provider). Paths are origin first.
const aspas = new Map([['AS9', set('AS5')], ['AS5', set('AS1')], ['AS6', set('AS1')], ['AS1', set('AS0')]]);
const rows = [
  { path: ['AS9', 'AS5', 'AS1'], routes: 10 },   // through a provider that is listed
  { path: ['AS9', 'AS6', 'AS1'], routes: 4 },    // through one that is not listed
];

test('now: the listed provider passes, the other one is a valley', () => {
  const r = compare(aspas, rows, 'AS9', ['AS5']);
  assert.deepEqual(r.before, { Valid: 10, Unknown: 0, Invalid: 4 });
  assert.deepEqual(r.after, r.before);
  assert.equal(r.changed.length, 0);
});

test('listing the second provider makes its routes valid', () => {
  const r = compare(aspas, rows, 'AS9', ['AS5', 'AS6']);
  assert.deepEqual(r.after, { Valid: 14, Unknown: 0, Invalid: 0 });
  assert.deepEqual(r.changed, [{ path: ['AS9', 'AS6', 'AS1'], routes: 4, from: 'Invalid', to: 'Valid' }]);
});

test('dropping a provider makes its routes invalid, and AS0 makes all of them invalid', () => {
  assert.deepEqual(compare(aspas, rows, 'AS9', ['AS6']).after, { Valid: 4, Unknown: 0, Invalid: 10 });
  assert.deepEqual(compare(aspas, rows, 'AS9', ['AS0']).after, { Valid: 0, Unknown: 0, Invalid: 14 });
});

test('an origin with no ASPA is unknown, and gets valid with one', () => {
  const none = new Map([['AS5', set('AS1')]]);
  const r = compare(none, [{ path: ['AS9', 'AS5', 'AS1'], routes: 3 }], 'AS9', ['AS5']);
  assert.deepEqual(r.before, { Valid: 0, Unknown: 3, Invalid: 0 });
  assert.deepEqual(r.after, { Valid: 3, Unknown: 0, Invalid: 0 });
  assert.equal(r.changed[0].from, 'Unknown');
});

test('the published ASPAs are not changed, and the biggest change comes first', () => {
  const r = compare(aspas, [...rows, { path: ['AS9', 'AS6', 'AS7', 'AS1'], routes: 20 }], 'AS9', ['AS5', 'AS6']);
  assert.deepEqual([...aspas.get('AS9')], ['AS5']);
  assert.ok(r.changed.length >= 1);
  assert.ok(r.changed.every((c, i, a) => i === 0 || a[i - 1].routes >= c.routes));
});

console.log(`${passed} tests passed`);
