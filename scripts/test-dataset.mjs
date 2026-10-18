// Unit tests for the pure parts of scripts/build-dataset.mjs (no dependencies). Run with: node scripts/test-dataset.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FILES, manifestOf, readmeOf, addToIndex, checkFile, LICENSE, MAX_FILE_BYTES } from './build-dataset.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the manifest has the size and the SHA-256 of each file', () => {
  const m = manifestOf([{ name: 'a.json', about: 'x', data: Buffer.from('{"a":1}') }], '2026-11-01', '1.31.0');
  assert.equal(m.files[0].bytes, 7);
  assert.equal(m.files[0].sha256, createHash('sha256').update('{"a":1}').digest('hex'));
  assert.equal(m.license, LICENSE);
  assert.equal(m.date, '2026-11-01');
});

test('the README names every file of the snapshot and the license', () => {
  const m = manifestOf(FILES('https://example.org').map(([name, , about]) => ({ name, about, data: Buffer.from(name) })), '2026-11-01', '1.31.0');
  const text = readmeOf(m);
  for (const [name] of FILES('https://example.org')) assert.ok(text.includes(name), name);
  assert.ok(text.includes(LICENSE));
});

test('the files come from the site given, or from the history branch', () => {
  const list = FILES('https://example.org');
  assert.ok(list.filter(([n]) => ['aspas.csv', 'adoption.json', 'trends.json'].includes(n)).every(([, u]) => u.startsWith('https://example.org/api/v1/')));
  assert.ok(list.filter(([n]) => ['history.json', 'events.json'].includes(n)).every(([, u]) => u.includes('ref=history')));
  assert.equal(new Set(list.map(([n]) => n)).size, list.length);
});

test('the index keeps one entry for each snapshot, newest first', () => {
  let idx = [];
  idx = addToIndex(idx, { name: 'a', date: '2026-10-01' });
  idx = addToIndex(idx, { name: 'b', date: '2026-11-01' });
  idx = addToIndex(idx, { name: 'a', date: '2026-10-01', bytes: 5 });
  assert.deepEqual(idx.map((e) => e.name), ['b', 'a']);
  assert.equal(idx[1].bytes, 5);
});

test('a file goes into the archive only if it is what its name says', () => {
  assert.equal(checkFile('a.json', Buffer.from('{"a":1}')).length, 7);
  assert.equal(checkFile('a.csv', Buffer.from('customer,providers\nAS1,AS2\n')).length, 27);
  assert.throws(() => checkFile('a.json', Buffer.from('<html>502 Bad Gateway</html>')), /not valid JSON/);
  assert.throws(() => checkFile('a.json', Buffer.from('{"a":')), /not valid JSON/);
  assert.throws(() => checkFile('a.csv', Buffer.from('customer,providers\n')), /no data row/);
  assert.throws(() => checkFile('a.json', Buffer.alloc(0)), /empty/);
  assert.throws(() => checkFile('a.json', 'text'), /empty/);
  assert.ok(MAX_FILE_BYTES > 100 * 1024 * 1024);
});

console.log(`${passed} tests passed`);
