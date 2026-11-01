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

test('each file must have its own shape before it is published', () => {
  assert.ok(valid('[["2026-10-01","AS1",["AS2","AS0"]],["2026-10-02","AS1",null]]', 'events'));
  for (const t of ['[["2026-10-01","AS../x",["AS2"]]]', '[["2026-10-01","AS1",["<b>"]]]', '[["yesterday","AS1",null]]', '[{"date":"2026-10-01"}]'])
    assert.equal(valid(t, 'events'), false, t);
  assert.ok(valid('[{"date":"2026-10-22","aspas":1}]', 'history'));
  assert.equal(valid('[{"aspas":1}]', 'history'), false);
  assert.ok(valid('{"date":"2026-10-18","seen":1,"unseen":["AS79"]}', 'visibility'));
  assert.ok(valid('["AS79","AS204"]', 'visibility'));
  assert.equal(valid('{"date":"2026-10-18","unseen":["../x"]}', 'visibility'), false);
  assert.ok(valid('[{"date":"2026-10-22"}]'));                                  // without a name only the generic check, as before
});

console.log(`${passed} tests passed`);
