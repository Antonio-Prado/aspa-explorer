// Unit tests for the pure parts of site/live.js (no dependencies). Run with: node scripts/test-live.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { subscription, parseUpdate } = createRequire(import.meta.url)('../site/live.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the subscription: updates with announcements, for the origin or for any place in the path', () => {
  assert.deepEqual(subscription(3333, 'origin'), { type: 'ris_subscribe', data: { path: '3333$', type: 'UPDATE', require: 'announcements' } });
  assert.equal(subscription(3333, 'through').data.path, '3333');
});

test('the announcements of an update: one per prefix, with the path and the peer', () => {
  const a = parseUpdate({ peer_asn: 6939, host: 'rrc10.ripe.net', path: [6939, 3333, 12654], announcements: [{ next_hop: 'x', prefixes: ['193.0.0.0/21', '2001:67c:2e8::/48'] }, { next_hop: 'y', prefixes: ['10.0.0.0/8'] }] });
  assert.equal(a.length, 3);
  assert.deepEqual(a[0], { prefix: '193.0.0.0/21', path: [6939, 3333, 12654], peer: 6939, host: 'rrc10.ripe.net' });
});

test('a path with an AS_SET, an update without announcements and garbage give nothing', () => {
  assert.deepEqual(parseUpdate({ path: [1, [2, 3], 4], announcements: [{ prefixes: ['10.0.0.0/8'] }] }), []);
  assert.deepEqual(parseUpdate({ path: [1, 2], withdrawals: ['10.0.0.0/8'] }), []);
  assert.deepEqual(parseUpdate(null), []);
  assert.deepEqual(parseUpdate({ path: [], announcements: [{ prefixes: ['10.0.0.0/8'] }] }), []);
});

console.log(`${passed} tests passed`);
