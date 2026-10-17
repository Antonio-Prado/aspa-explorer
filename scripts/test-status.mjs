// Unit tests for the pure helpers of site/status-checks.js (no dependencies). Run with: node scripts/test-status.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { byAge, byDay, dotState, MIN, HOUR, DAY } = createRequire(import.meta.url)('../site/status-checks.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const res = (...states) => states.map((state) => ({ c: {}, r: { state } }));

test('the age of a piece of data against its two limits', () => {
  assert.equal(byAge(5 * MIN, 30 * MIN, 2 * HOUR), 'ok');
  assert.equal(byAge(30 * MIN, 30 * MIN, 2 * HOUR), 'ok');
  assert.equal(byAge(31 * MIN, 30 * MIN, 2 * HOUR), 'late');
  assert.equal(byAge(3 * HOUR, 30 * MIN, 2 * HOUR), 'down');
});

test('a daily file: the day is expected from 07:30 UTC', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(byDay('2026-10-17', at('2026-10-17T09:00:00Z')), 'ok');
  assert.equal(byDay('2026-10-16', at('2026-10-17T06:00:00Z')), 'ok');     // not yet due today
  assert.equal(byDay('2026-10-16', at('2026-10-17T09:00:00Z')), 'late');
  assert.equal(byDay('2026-10-15', at('2026-10-17T09:00:00Z')), 'down');
  assert.equal(byDay('2026-10-14', at('2026-10-17T06:00:00Z')), 'down');
});

test('the dot: green when all are green, red when all are red, orange otherwise', () => {
  assert.equal(dotState(res('ok', 'ok', 'ok')), 'ok');
  assert.equal(dotState(res('down', 'down', 'down')), 'down');
  assert.equal(dotState(res('ok', 'ok', 'down')), 'warn');
  assert.equal(dotState(res('ok', 'late', 'ok')), 'warn');
  assert.equal(dotState(res('late', 'down', 'down')), 'warn');
  assert.equal(dotState(res('late', 'late')), 'warn');
  assert.equal(dotState(res('down')), 'down');
  assert.equal(dotState([]), 'warn');
});

console.log(`${passed} tests passed`);
