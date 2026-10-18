// Unit tests of the check of many paths (site/bulk.js). No dependencies. Run with: node scripts/test-bulk.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const AspaVerify = require('../site/verify.js');
const { splitLine, checkMany, toCsv, csvCell, MAX_LINES } = require('../site/bulk.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

// AS680 has AS1299 as its provider, AS1299 has AS3356, AS64500 has an ASPA with AS0 (no providers)
const aspas = new Map([['AS680', new Set(['AS1299'])], ['AS1299', new Set(['AS3356'])], ['AS64500', new Set(['AS0'])]]);

test('a line: a prefix in front of the path is split off, anything else is the path', () => {
  assert.deepEqual(splitLine('193.0.0.0/21 3333 1299 680'), { prefix: '193.0.0.0/21', text: '3333 1299 680' });
  assert.deepEqual(splitLine('2001:db8::/32 3333 680'), { prefix: '2001:db8::/32', text: '3333 680' });
  assert.deepEqual(splitLine('  3356 1299 680 '), { prefix: '', text: '3356 1299 680' });
  assert.deepEqual(splitLine('3356'), { prefix: '', text: '3356' });
});

test('verdicts, in the order of the lines, with the reasons', () => {
  const lines = ['3356 1299 680', '# a comment', '', '1299 99 3356 680', '9999 680'];
  const r = checkMany(aspas, lines.join('\n') + '\n', 'down', AspaVerify);
  const want = (l) => AspaVerify.verify(aspas, AspaVerify.parsePath(l).path, 'down').result;
  assert.deepEqual(r.rows.map((x) => [x.line, x.result]), [[1, 'Valid'], [4, 'Invalid'], [5, want(lines[4])]]);   // the verdicts are the ones of the single check
  assert.equal(r.counts.Valid + r.counts.Unknown + r.counts.Invalid, 3);
  assert.equal(r.skipped, 3);               // the comment, the empty line and the end of the last line
  assert.match(r.rows[1].note, /valley/);
  assert.equal(r.rows[0].path, '3356 1299 680');
  assert.ok(r.rows.every((x) => x.note.length > 0));
});

test('the upstream check names the hop that is not attested', () => {
  const r = checkMany(aspas, '1299 3356 680', 'up', AspaVerify);
  assert.equal(r.rows[0].result, 'Invalid');
  assert.equal(r.rows[0].note, 'AS680 does not list AS3356'.replace('AS3356', 'AS3356'));
});

test('lines that are not paths are counted as errors and do not stop the others', () => {
  const r = checkMany(aspas, '3356 1299 680\nhello world\n3356 {1299,680}\n3356 680', 'down', AspaVerify);
  assert.deepEqual(r.rows.map((x) => x.result), ['Valid', 'Error', 'Error', 'Valid']);
  assert.equal(r.counts.Error, 2);
  assert.match(r.rows[1].note, /not an AS number: hello/);
  assert.match(r.rows[2].note, /AS_SET/);
});

test('there is a limit on the lines', () => {
  const text = Array.from({ length: MAX_LINES + 10 }, () => '3356 1299 680').join('\n');
  const r = checkMany(aspas, text, 'down', AspaVerify);
  assert.equal(r.rows.length, MAX_LINES);
  assert.equal(r.truncated, true);
});

test('CSV: quoted when needed, a formula made harmless', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('-2'), "'-2");
  const csv = toCsv(checkMany(aspas, '193.0.0.0/21 3356 1299 680', 'down', AspaVerify).rows);
  assert.equal(csv.split('\n')[0], 'line,prefix,path,verdict,note');
  assert.match(csv.split('\n')[1], /^1,193\.0\.0\.0\/21,3356 1299 680,Valid,/);
});

console.log(`${passed} tests passed`);
