// Unit tests for the pure helpers of site/status-checks.js (no dependencies). Run with: node scripts/test-status.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { byAge, byDay, dotState, makeChecks, MIN, HOUR, DAY } = createRequire(import.meta.url)('../site/status-checks.js');

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

await (async () => {
  // the validator check: fresh data from the validator of the site is OK; the same data from the spare validator is a warning
  const now = Date.parse('2026-11-15T12:00:00Z');
  const status = { lastUpdateDone: '2026-11-15T11:55:00Z', version: 'routinator/0.16.0' };
  const run = (body) => makeChecks(async () => body).find((c) => c.id === 'validator').run(now);
  const own = await run(status);
  assert.equal(own.state, 'ok');
  assert.equal(own.extra, 'routinator 0.16.0');
  const spare = await run({ ...status, __answered_by: 'rpki.as59715.net' });
  assert.equal(spare.state, 'late');
  assert.match(spare.extra, /from the spare validator \(rpki\.as59715\.net\): the validator of the site does not answer/);
  assert.equal((await run({ lastUpdateDone: '2026-11-15T05:00:00Z', version: 'x', __answered_by: 'y' })).state, 'down', 'old data is down whoever answers');
  passed++; console.log('ok   the validator check says when the spare validator answered');
})();

console.log(`${passed} tests passed`);
