// Unit tests for site/traceroute.js (no dependencies). Run with: node scripts/test-traceroute.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { hostIn, targetOf, isPrivate, summarise } = createRequire(import.meta.url)('../site/traceroute.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('an address to aim at in a prefix', () => {
  assert.equal(hostIn('193.0.0.0/21'), '193.0.0.1');
  assert.equal(hostIn('193.0.4.77/24'), '193.0.4.1');
  assert.equal(hostIn('193.0.0.9/32'), '193.0.0.9');
  assert.equal(hostIn('10.0.0.0/31'), '10.0.0.0');
  assert.equal(hostIn('2001:67c:2e8::/48'), '2001:67c:2e8::1');
  for (const bad of ['', 'x', '1.2.3.4', '1.2.3.4/33', '300.1.1.1/24', '2001:db8::/129']) assert.equal(hostIn(bad), null, bad);
});

test('the target of an origin: its own prefixes, IPv4 first, the shortest', () => {
  const routes = [
    { path: [1, 2, 9], target_prefix: '193.0.4.0/24' }, { path: [3, 9], target_prefix: '193.0.0.0/21' },
    { path: [3, 8], target_prefix: '8.8.8.0/24' }, { path: [4, 9], target_prefix: '2001:db8::/32' },
  ];
  assert.deepEqual(targetOf(routes, 9), { prefix: '193.0.0.0/21', address: '193.0.0.1' });
  assert.equal(targetOf([{ path: [1, 9], target_prefix: '2001:db8::/32' }], 9).address, '2001:db8::1');
  assert.equal(targetOf(routes, 77), null);
});

test('a default route, a very short prefix or a private one is not a target', () => {
  assert.deepEqual(targetOf([{ path: [1, 9], target_prefix: '0.0.0.0/0' }, { path: [1, 9], target_prefix: '::/0' }, { path: [1, 9], target_prefix: '10.0.0.0/8' }, { path: [1, 9], target_prefix: '2.0.0.0/4' }], 9), null);
  assert.deepEqual(targetOf([{ path: [1, 9], target_prefix: '0.0.0.0/0' }, { path: [1, 9], target_prefix: '8.0.0.0/9' }, { path: [1, 9], target_prefix: '193.0.0.0/21' }], 9), { prefix: '193.0.0.0/21', address: '193.0.0.1' });
  assert.equal(targetOf([{ path: [1, 9], target_prefix: '2001:db8::/32' }, { path: [1, 9], target_prefix: '2001:db8:1::/48' }], 9).prefix, '2001:db8::/32');
});

test('addresses that map to no AS', () => {
  for (const ip of ['10.1.2.3', '192.168.0.1', '172.16.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '224.0.0.1', 'fd00::1', 'fe80::1', null]) assert.equal(isPrivate(ip), true, String(ip));
  for (const ip of ['193.0.0.1', '172.32.0.1', '8.8.8.8', '2001:67c:2e8::1']) assert.equal(isPrivate(ip), false, ip);
});

const hop = (ip, rtts, host) => ({ resolvedAddress: ip, resolvedHostname: host || ip, timings: rtts.map((rtt) => ({ rtt })) });
const probe = { city: 'Milan', country: 'IT', asn: 6517, network: 'LAKE' };
const asns = { '37.202.205.254': 213791, '154.14.77.113': 3257, '141.136.110.41': 3257, '80.249.208.68': 1200, '193.0.0.1': 3333 };

test('a path with a jump of the delay: the networks on the way and the long delay', () => {
  const r = summarise({ probe, result: { status: 'finished', hops: [
    hop('5.231.80.252', [0.3, 0.3], '_gateway'), hop('37.202.205.254', [0.4, 1.9]), hop('154.14.77.113', [1.0, 1.0]),
    hop('141.136.110.41', [12.3, 12.8]), { resolvedAddress: null, timings: [] }, hop('80.249.208.68', [15.9, 16.2]), hop('193.0.0.1', [16.5, 16.5]),
  ] } }, (ip) => asns[ip] || null);
  assert.deepEqual(r.path, [213791, 3257, 1200, 3333]);
  assert.deepEqual(r.jump, { from: 3, hop: 4, by: 11.3 });
  assert.equal(r.lastRtt, 16.5);
  assert.equal(r.longDelay, false);
  assert.equal(r.reachedAddress, '193.0.0.1');
  assert.equal(r.hops[0].asn, null);                     // a private address is left alone
});

test('a delay that comes from the access network, or that does not stay up, is not a jump', () => {
  // the probe sits behind private addresses and the delay is there before the first public address
  const tim = summarise({ probe, result: { status: 'finished', hops: [hop('172.17.17.1', [0.1]), hop('192.168.57.1', [1.1]), hop('172.17.152.32', [9.3]), hop('195.22.218.116', [30.1]), hop('93.94.88.1', [28.5])] } }, () => null);
  assert.equal(tim.jump, null);
  assert.equal(tim.access, 30.1);
  assert.equal(tim.longDelay, false);
  // one slow answer, then back to normal: not a distance
  const blip = summarise({ probe, result: { status: 'finished', hops: [hop('37.202.205.254', [1]), hop('154.14.77.113', [40]), hop('141.136.110.41', [2]), hop('193.0.0.1', [3])] } }, () => null);
  assert.equal(blip.jump, null);
});

test('a long round trip is flagged, and a path with no answer does not break', () => {
  const far = summarise({ probe, result: { status: 'finished', hops: [hop('37.202.205.254', [3]), hop('193.0.0.1', [40])] } }, (ip) => asns[ip] || null);
  assert.equal(far.longDelay, true);
  const none = summarise({ probe, result: { status: 'finished', hops: [{ resolvedAddress: null, timings: [] }] } }, () => null);
  assert.deepEqual([none.path, none.lastRtt, none.reachedAddress], [[], null, null]);
  assert.equal(summarise({ probe, result: { status: 'failed' } }, () => null).hops.length, 0);
});

console.log(`${passed} tests passed`);
