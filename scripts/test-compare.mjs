// Unit tests for the comparison of two days in site/history.js (no dependencies). Run with: node scripts/test-compare.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { compareAs, comparePlaces } = createRequire(import.meta.url)('../site/history.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

const events = [
  ['2026-01-01', 'AS10', ['AS1', 'AS2']],
  ['2026-01-01', 'AS20', ['AS10']],
  ['2026-02-01', 'AS10', ['AS2', 'AS3']],
  ['2026-02-01', 'AS30', ['AS10']],
  ['2026-03-01', 'AS20', null],
];

test('an AS: its own providers and the ASPAs that name it, between two days', () => {
  const c = compareAs(events, 'AS10', '2026-01-15', '2026-03-15');
  assert.deepEqual(c.own, { before: ['AS1', 'AS2'], after: ['AS2', 'AS3'], added: ['AS3'], dropped: ['AS1'] });
  assert.deepEqual(c.named, { before: 1, after: 1, added: ['AS30'], dropped: ['AS20'] });
});

test('an AS with no ASPA before, or none at all', () => {
  const c = compareAs(events, 'AS30', '2026-01-15', '2026-03-15');
  assert.deepEqual(c.own, { before: null, after: ['AS10'], added: ['AS10'], dropped: [] });
  const none = compareAs(events, 'AS99', '2026-01-15', '2026-03-15');
  assert.deepEqual(none.own, { before: null, after: null, added: [], dropped: [] });
  assert.deepEqual(none.named, { before: 0, after: 0, added: [], dropped: [] });
});

test('the end of a day counts: a change on the day itself is in the state of that day', () => {
  assert.deepEqual(compareAs(events, 'AS10', '2026-01-01', '2026-02-01').own.after, ['AS2', 'AS3']);
  assert.deepEqual(compareAs(events, 'AS10', '2025-12-31', '2026-01-01').own.before, null);
});

test('places of valley: new, gone and kept', () => {
  const p = (from, between) => ({ role: 'valley', kind: 'leak', from, to: 'AS9', between, feeders: 5, routes: 5 });
  const before = { AS2: [p('AS1', ['AS2']), p('AS4', ['AS2'])] };
  const after = { AS2: [p('AS4', ['AS2']), p('AS5', ['AS2', 'AS6'])] };
  const c = comparePlaces(before, after, 'AS2');
  assert.deepEqual(c.added.map((x) => x.from), ['AS5']);
  assert.deepEqual(c.gone.map((x) => x.from), ['AS1']);
  assert.equal(c.kept, 1);
  assert.deepEqual(comparePlaces(null, {}, 'AS2'), { added: [], gone: [], kept: 0 });
});

console.log(`${passed} tests passed`);
