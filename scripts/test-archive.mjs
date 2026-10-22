// Unit tests for scripts/fetch-archive.mjs (no dependencies). Run with: node scripts/test-archive.mjs
import assert from 'node:assert/strict';
import { valid, FILES } from './fetch-archive.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('a list or an object that is not empty is worth publishing', () => {
  assert.ok(valid('[{"date":"2026-10-22"}]'));
  assert.ok(valid('{"date":"2026-10-22","seen":1}'));
});
test('an error page, an empty answer, an empty list or object, null and a cut file are not', () => {
  for (const t of ['', '<html>502</html>', '[]', '{}', 'null', '[{"date":']) assert.equal(valid(t), false, t);
});
test('the three files of the history', () => assert.deepEqual(FILES, ['history', 'events', 'visibility']));

console.log(`${passed} tests passed`);
