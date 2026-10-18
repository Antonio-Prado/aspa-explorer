// Unit tests for site/traceroute.js (no dependencies). Run with: node scripts/test-traceroute.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { hostIn, targetOf, parseIp, contains, prefixesOf, isPrivate, summarise, aggregate, pairProbes, comparePairs } = createRequire(import.meta.url)('../site/traceroute.js');
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
  assert.equal(r.verdict, 'ok');
  assert.equal(r.reachedAddress, '193.0.0.1');
  assert.equal(r.hops[0].asn, null);                     // a private address is left alone
});

test('a delay that comes from the access network, or that does not stay up, is not a jump', () => {
  // the probe sits behind private addresses and the delay is there before the first public address
  const tim = summarise({ probe, result: { status: 'finished', hops: [hop('172.17.17.1', [0.1]), hop('192.168.57.1', [1.1]), hop('172.17.152.32', [9.3]), hop('195.22.218.116', [30.1]), hop('93.94.88.1', [28.5])] } }, () => null);
  assert.equal(tim.jump, null);
  assert.equal(tim.access, 30.1);
  assert.equal(tim.verdict, 'ok');
  // one slow answer, then back to normal: not a distance
  const blip = summarise({ probe, result: { status: 'finished', hops: [hop('37.202.205.254', [1]), hop('154.14.77.113', [40]), hop('141.136.110.41', [2]), hop('193.0.0.1', [3])] } }, () => null);
  assert.equal(blip.jump, null);
});

test('a long round trip is flagged, and a path with no answer does not break', () => {
  const far = summarise({ probe, result: { status: 'finished', hops: [hop('37.202.205.254', [3]), hop('193.0.0.1', [60])] } }, (ip) => asns[ip] || null);
  assert.equal(far.verdict, 'long');
  const ocean = summarise({ probe, result: { status: 'finished', hops: [hop('37.202.205.254', [3]), hop('193.0.0.1', [140])] } }, (ip) => asns[ip] || null);
  assert.equal(ocean.verdict, 'trombone');
  assert.equal(ocean.net, 137);
  const none = summarise({ probe, result: { status: 'finished', hops: [{ resolvedAddress: null, timings: [] }] } }, () => null);
  assert.deepEqual([none.path, none.lastRtt, none.reachedAddress], [[], null, null]);
  assert.equal(none.verdict, null);
  assert.equal(summarise({ probe, result: { status: 'failed' } }, () => null).hops.length, 0);
});

test('the probes together: median, range and the number in each fascia', () => {
  const s = (net, verdict) => ({ net, verdict });
  const a = aggregate([s(22, 'ok'), s(23, 'ok'), s(38, 'ok'), s(45, 'long'), s(77, 'long'), s(155, 'trombone'), { net: null, verdict: null }]);
  assert.deepEqual([a.n, a.median, a.min, a.max, a.verdict], [6, 41.5, 22, 155, 'ok']);       // 41.5 ms is inside the 50 ms of a country
  assert.deepEqual(a.counts, { ok: 3, long: 2, trombone: 1 });
  assert.equal(a.near, 0);
  assert.equal(aggregate([s(2, 'ok'), s(5, 'ok'), s(30, 'ok')]).near, 2);
  assert.equal(aggregate([s(120, 'trombone'), s(130, 'trombone'), s(20, 'ok')]).verdict, 'trombone');
  assert.equal(aggregate([s(60, 'long'), s(70, 'long'), s(20, 'ok')]).verdict, 'long');
  assert.equal(aggregate([s(5, 'ok')]).median, 5);
  assert.equal(aggregate([]), null);
  assert.equal(aggregate([{ net: null, verdict: null }]), null);
});

test('the target of an origin can be asked for one family', () => {
  const routes = [{ path: [1, 9], target_prefix: '193.0.0.0/21' }, { path: [1, 9], target_prefix: '2001:67c:2e8::/48' }, { path: [1, 9], target_prefix: '2001:db8::/32' }];
  assert.deepEqual(targetOf(routes, 9, 4), { prefix: '193.0.0.0/21', address: '193.0.0.1' });
  assert.deepEqual(targetOf(routes, 9, 6), { prefix: '2001:db8::/32', address: '2001:db8::1' });         // the shortest of a usual length
  assert.equal(targetOf([{ path: [1, 9], target_prefix: '193.0.0.0/21' }], 9, 6), null);
  assert.equal(targetOf([{ path: [1, 9], target_prefix: '2001:db8::/32' }], 9, 4), null);
  assert.equal(targetOf(routes, 9).prefix, '193.0.0.0/21');                                             // without a family: IPv4 first, as before
});

// a summary as summarise() makes it, with only what the pairing reads
const sum = (asn, city, network, net, path) => ({ probe: { asn, city, network }, net, path });
test('probes seen over IPv4 and IPv6 are paired, with the difference and the winner', () => {
  const s4 = [sum(100, 'Rome', 'A', 20, [100, 200, 9]), sum(101, 'Milan', 'B', 30, [101, 200, 9]), sum(102, 'Turin', 'C', 40, [102, 9]), sum(104, 'Bari', 'E', 10, [104, 9])];
  const s6 = [sum(101, 'Milan', 'B', 25, [101, 200, 9]), sum(100, 'Rome', 'A', 20.4, [100, 300, 9]), sum(102, 'Turin', 'C', null, []), sum(103, 'Pisa', 'D', 15, [103, 9])];
  const rows = pairProbes(s4, s6, 9);
  assert.deepEqual(rows.map((r) => [r.probe.city, r.winner]), [['Milan', 'v6'], ['Rome', 'tie'], ['Turin', 'v4 only'], ['Pisa', 'v6 only'], ['Bari', 'v4 only']]);
  assert.equal(rows[0].delta, -5);
  assert.equal(rows[0].sameNetworks, true);
  assert.equal(rows[1].sameNetworks, false);                // 200 over IPv4, 300 over IPv6
  assert.equal(rows[2].delta, null);
  const c = comparePairs(rows);
  assert.equal(c.probes, 5);
  assert.equal(c.both, 2);
  assert.equal(c.median4, 25);
  assert.equal(c.median6, 22.7);
  assert.equal(c.medianDelta, -2.3);
  assert.equal(c.differentNetworks, 1);
  assert.deepEqual(c.counts, { v4: 0, v6: 1, tie: 1, 'v4 only': 2, 'v6 only': 1, none: 0 });
});

test('two probes of the same network and city are told apart by their order', () => {
  const rows = pairProbes([sum(1, 'X', 'N', 10, []), sum(1, 'X', 'N', 50, [])], [sum(1, 'X', 'N', 12, []), sum(1, 'X', 'N', 40, [])]);   // no origin given: every answer counts
  assert.deepEqual(rows.map((r) => r.delta), [2, -10]);
  assert.equal(comparePairs([]).median4, null);
});

test('a traceroute that stops before the origin is not compared', () => {
  const rows = pairProbes([sum(1, 'X', 'N', 30, [1, 200, 9])], [sum(1, 'X', 'N', 0.4, [1, 200])], 9);
  assert.equal(rows[0].winner, 'v4 only');
  assert.equal(rows[0].delta, null);
  assert.equal(rows[0].n6, null);
  assert.equal(rows[0].sameNetworks, null);
  const c = comparePairs(rows);
  assert.equal(c.both, 0);
  assert.equal(c.median4, null);
});

test('addresses and prefixes: an address is inside a prefix or it is not', () => {
  assert.equal(parseIp('193.0.0.1').family, 4);
  assert.equal(parseIp('2001:760::53').family, 6);
  assert.equal(parseIp('::1').n, 1n);
  assert.equal(parseIp('2001:db8:0:0:0:0:0:1').n, parseIp('2001:db8::1').n);
  for (const bad of ['', 'x', '1.2.3', '256.1.1.1', '1::2::3', '1:2:3:4:5:6:7:8:9', ':::', '2001:db8::g', 'fe80::1%eth0']) assert.equal(parseIp(bad), null, bad);
  assert.equal(contains('193.0.0.0/21', '193.0.7.255'), true);
  assert.equal(contains('193.0.0.0/21', '193.0.8.0'), false);
  assert.equal(contains('193.0.0.0/21', '2001:760::1'), false);
  assert.equal(contains('2001:760::/32', '2001:760::53'), true);
  assert.equal(contains('2001:760::/32', '2001:761::1'), false);
  assert.equal(contains('2001:760::/32', '193.0.0.1'), false);
  assert.equal(contains('10.0.0.0/33', '10.0.0.1'), false);
  assert.equal(contains('0.0.0.0/0', '8.8.8.8'), true);
  assert.deepEqual(prefixesOf([{ path: [1, 9], target_prefix: '193.0.0.0/21' }, { path: [1, 8], target_prefix: '8.0.0.0/8' }, { path: [2, 9], target_prefix: '2001:DB8::/32' }], 9).sort(), ['193.0.0.0/21', '2001:db8::/32']);
});

console.log(`${passed} tests passed`);
