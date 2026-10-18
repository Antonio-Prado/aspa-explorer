// Unit tests for the pure part of site/recent.js (no dependencies). Run with: node scripts/test-recent.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { clean, find, record, diffAs, diffPath, ago, MAX } = createRequire(import.meta.url)('../site/recent.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const as = (id, providers, named = 0, t = 1) => ({ kind: 'as', id, t, providers, named });
const path = (id, direction, result, t = 1) => ({ kind: 'path', id, direction, t, result });

test('what is read back from the storage: only entries that look right', () => {
  const list = clean([as('AS680', ['AS1299'], 2), { kind: 'as', id: 'AS1', t: 1, providers: ['x'], named: 0 }, { kind: 'path', id: '3356 680', direction: 'sideways', t: 1, result: 'Valid' }, path('3356 680', 'up', 'Valid'), null, 'text', { kind: 'as', id: 'AS5', t: 'now', providers: [], named: 0 }, { kind: 'path', id: '<script>', direction: 'up', t: 1, result: 'Valid' }]);
  assert.deepEqual(list.map((e) => e.id), ['AS680', '3356 680']);
  assert.deepEqual(clean('not a list'), []);
  assert.deepEqual(clean(undefined), []);
  assert.equal(clean(Array.from({ length: 50 }, (_, i) => as(`AS${i + 1}`, []))).length, MAX);
});

test('recording: the newest first, the same thing once, a path per direction, no more than MAX', () => {
  let l = record([], as('AS680', ['AS1299']));
  l = record(l, path('3356 680', 'up', 'Valid'));
  l = record(l, path('3356 680', 'down', 'Invalid'));
  l = record(l, as('AS680', ['AS1299', 'AS3356'], 1, 5));
  assert.deepEqual(l.map((e) => [e.kind, e.id, e.direction || '']), [['as', 'AS680', ''], ['path', '3356 680', 'down'], ['path', '3356 680', 'up']]);
  assert.deepEqual(l[0].providers, ['AS1299', 'AS3356']);
  assert.equal(find(l, path('3356 680', 'up', 'x')).result, 'Valid');
  assert.equal(find(l, path('3356 680', 'sideways', 'x')), null);
  for (let i = 0; i < 40; i++) l = record(l, as(`AS${i + 100}`, []));
  assert.equal(l.length, MAX);
});

test('what changed for an AS', () => {
  assert.deepEqual(diffAs(as('AS1', ['AS2', 'AS3'], 4), { providers: ['AS2', 'AS3'], named: 4 }), { changed: false, text: 'nothing has changed' });
  assert.equal(diffAs(as('AS1', ['AS2', 'AS3'], 4), { providers: ['AS2', 'AS9'], named: 4 }).text, 'added AS9; dropped AS3');
  assert.equal(diffAs(as('AS1', [], 0), { providers: ['AS2'], named: 0 }).text, 'it has published an ASPA, with 1 provider');
  assert.equal(diffAs(as('AS1', ['AS2'], 0), { providers: [], named: 0 }).text, 'its ASPA is gone');
  assert.equal(diffAs(as('AS1', ['AS2'], 3), { providers: ['AS2'], named: 5 }).text, 'named as a provider by 2 more ASPAs (3 before, 5 now)');
  assert.equal(diffAs(as('AS1', ['AS2'], 3), { providers: ['AS2'], named: 2 }).text, 'named as a provider by 1 fewer ASPA (3 before, 2 now)');
  const many = Array.from({ length: 9 }, (_, i) => `AS${100 + i}`);
  assert.equal(diffAs(as('AS1', ['AS2'], 0), { providers: ['AS2', ...many], named: 0 }).text, 'added AS100, AS101, AS102, AS103, AS104, AS105 and 3 more');
});

test('what changed for a path, and how long ago', () => {
  assert.deepEqual(diffPath(path('1 2', 'up', 'Unknown'), 'Unknown'), { changed: false, text: 'still Unknown' });
  assert.deepEqual(diffPath(path('1 2', 'up', 'Unknown'), 'Valid'), { changed: true, text: 'it was Unknown, it is Valid now' });
  const now = Date.UTC(2026, 9, 18, 12);
  assert.equal(ago(now - 3600e3, now), 'today');
  assert.equal(ago(now - 30 * 3600e3, now), 'yesterday');
  assert.equal(ago(now - 5 * 86400e3, now), '5 days ago');
});

console.log(`${passed} tests passed`);
