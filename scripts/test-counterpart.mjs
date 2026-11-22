// Unit tests for scripts/build-counterpart.mjs (no network). Run with: node scripts/test-counterpart.mjs
import assert from 'node:assert/strict';
import { autNums, pick, pairs, IRR_SOURCES } from './build-counterpart.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };
async function* linesOf(text) { for (const l of text.split('\n')) yield l; }
const all = async (it) => { const out = []; for await (const x of it) out.push(x); return out; };

const DUMP = `# a registry dump
% comments of both kinds

as-set:         AS-EXAMPLE
members:        AS1, AS2

aut-num:        AS41327
as-name:        FIBERTELECOM-AS
remarks:        Upstreams # the hash stays in a remark
import:         from AS1299 accept ANY   # a comment goes
export:         to AS1299
                announce AS41327:AS-CUSTOMERS
remarks:        Customers
import:         from AS15605 accept AS15605:AS-CONNESI
export:         to AS15605 announce ANY
mp-import:      afi ipv6.unicast from AS24492
+               accept AS-WICAM
mp-export:      afi ipv6.unicast to AS24492 announce AS41327:AS-CUSTOMERS
last-modified:  2026-10-27T08:00:00Z
source:         RIPE

aut-num:        AS64500
as-name:        NOT-WANTED
import:         from AS1 accept ANY

route:          192.0.2.0/24
origin:         AS41327

aut-num:        AS174
as-name:        COGENT
changed:        noc@example.net 20240102
source:         ARIN`;

await test('the aut-num objects of a dump: only the wanted ones, attributes joined and cleaned', async () => {
  const objs = await all(autNums(linesOf(DUMP), new Set([41327, 174])));
  assert.deepEqual(objs.map((o) => o.as), [41327, 174]);                       // the last object has no empty line after it
  const a = objs[0].attrs;
  assert.deepEqual(a.find((x) => x.name === 'import'), { name: 'import', value: 'from AS1299 accept ANY' });
  assert.equal(a.find((x) => x.name === 'export').value, 'to AS1299 announce AS41327:AS-CUSTOMERS');     // a value on two lines
  assert.equal(a.find((x) => x.name === 'mp-import').value, 'afi ipv6.unicast from AS24492 accept AS-WICAM');   // and with a plus
  assert.equal(a.find((x) => x.name === 'remarks').value, 'Upstreams # the hash stays in a remark');
  assert.equal((await all(autNums(linesOf(DUMP), null))).length, 3);            // without a list, every aut-num
});

await test('the first registry with a policy is the one that counts', async () => {
  const objs = await all(autNums(linesOf(DUMP), new Set([41327, 174])));
  const found = new Map();
  pick(found, 174, 0, objs[1].attrs);                                           // no policy in the first registry
  assert.deepEqual([found.get(174).state, found.get(174).modified, found.get(174).roles], [0, '20240102', null]);
  pick(found, 174, 1, [{ name: 'import', value: 'from AS1 accept ANY' }, { name: 'export', value: 'to AS1 announce AS-X' }]);
  assert.deepEqual([found.get(174).source, found.get(174).state], [1, 1]);     // a policy later on replaces it: it names no customer
  pick(found, 174, 2, [{ name: 'export', value: 'to AS9 announce ANY' }]);
  assert.equal(found.get(174).source, 1);                                       // and then stays
  pick(found, 41327, 0, objs[0].attrs);
  assert.deepEqual([found.get(41327).state, found.get(41327).modified], [2, '2026-10-27']);
});

await test('the pairs of the ASPAs against the objects, CAIDA and the exchange points', async () => {
  const objs = await all(autNums(linesOf(DUMP), new Set([41327, 174])));
  const found = new Map();
  pick(found, 41327, 0, objs[0].attrs); pick(found, 174, 0, objs[1].attrs);
  const aspas = [
    { customer: 'AS24492', providers: ['AS174', 'AS41327', 'AS9002'] },
    { customer: 'AS15605', providers: ['AS41327'] },
    { customer: 'AS64496', providers: ['AS0'] },
  ];
  const caida = { 24492: [174, 3491], 15605: [6461] };
  const ixOf = new Map([[24492, new Set([5, 26, 9])], [41327, new Set([26, 5, 7])], [9002, new Set([1])]]);
  const r = pairs(aspas, found, caida, ixOf);
  assert.deepEqual(r.pairs, { 24492: { 174: [null, 1], 41327: ['p', 0, [5, 26]], 9002: [null, 0] }, 15605: { 41327: ['c', 0] } });   // AS0 names nobody
  assert.deepEqual([r.total, r.confirmed, [...r.used]], [4, 2, [5, 26]]);
  const bare = pairs(aspas, found, null, null);
  assert.deepEqual(bare.pairs[24492][41327], ['p', null]);                     // without CAIDA and PeeringDB the object alone
});

await test('RADb is not among the registries', () => {
  assert.ok(IRR_SOURCES.length >= 6);
  assert.ok(!IRR_SOURCES.some(([name, url]) => /radb|level3/i.test(name + url)));
});

console.log(`${passed} tests passed`);
