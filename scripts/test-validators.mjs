// Unit tests for scripts/build-validators.mjs (no dependencies). Run with: node scripts/test-validators.mjs
import assert from 'node:assert/strict';
import { extractArray, normalise, compare } from './build-validators.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the array after a key, in the tail of a big file', () => {
  const tail = ', {"x": 1}],\n"aspas": [\n { "customer_asid": 10, "expires": 5, "providers": [ 1, 2 ] },\n { "customer_asid": 11, "providers": [ 3 ] }\n],\n"signedprefixlists": [\n]\n}';
  assert.deepEqual(extractArray(tail, 'aspas').map((a) => a.customer_asid), [10, 11]);
  assert.equal(extractArray('{"roas": []}', 'aspas'), null);
  assert.equal(extractArray('"aspas": [ {"customer_asid": 1, "providers": [2', 'aspas'), null);   // cut short
});

test('both formats give the same map, and several objects of a customer are merged', () => {
  const a = normalise([{ customer_asid: 10, providers: [2, 1] }, { customer_asid: 11, providers: [0] }]);
  const b = normalise([{ customer: 'AS10', providers: ['AS1', 'AS2'] }, { customer: 'AS11', providers: ['AS0'] }, { customer: 'AS10', providers: ['AS2', 'AS3'] }]);
  assert.deepEqual(a.get(10), [1, 2]);
  assert.deepEqual(b.get(10), [1, 2, 3]);
  assert.deepEqual(b.get(11), [0]);
});

test('three validators: identical ASPAs, ones that only some have, and different providers', () => {
  const r = compare({
    r: new Map([[1, [10]], [2, [20]], [3, [30]], [4, [40]]]),
    c: new Map([[1, [10]], [2, [20, 21]], [3, [30]]]),
    f: new Map([[1, [10]], [2, [20]], [3, [30]], [5, [50]]]),
  });
  assert.equal(r.customers, 5);
  assert.equal(r.identical, 2);                                   // AS1 and AS3
  assert.deepEqual(r.differences.map((d) => d.customer), ['AS2', 'AS4', 'AS5']);
  assert.deepEqual(r.differences[0].providers, { r: ['AS20'], c: ['AS20', 'AS21'], f: ['AS20'] });
  assert.equal(r.differences[1].providers.c, null);
  assert.equal(r.differences[0].as0, false);
  const z = compare({ r: new Map([[7, [0, 9]], [8, [0]]]), c: new Map([[7, [9]], [8, [0]]]) });
  assert.deepEqual(z.differences.map((d) => [d.customer, d.as0]), [['AS7', true]]);   // AS0 with another provider; AS0 alone is fine
  const rc = r.pairs.find((p) => p.a === 'r' && p.b === 'c');
  assert.deepEqual([rc.both, rc.only_a, rc.only_b, rc.differ], [3, 1, 0, 1]);
});

console.log(`${passed} tests passed`);
