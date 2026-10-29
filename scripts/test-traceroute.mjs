// Unit tests for site/traceroute.js (no dependencies). Run with: node scripts/test-traceroute.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { hostIn, targetOf, parseIp, contains, prefixesOf, isPrivate, summarise, aggregate, pairProbes, comparePairs, distanceKm, lanPrefix, ixpsFrom, ixpIndex, ixpOf, placeCheck, FIBRE_KM_PER_MS,
  summariseAtlas, soiFloor, soiCheck, rootPlace, rootRefs, pickAnchors, anchorRefs } = createRequire(import.meta.url)('../site/traceroute.js');
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

// Where a probe is: the exchange points of a traceroute as reference points (Izhikevich and others, IMC 2026, with the DNS roots)
const IXPS = [
  { id: 31, name: 'DE-CIX Frankfurt', city: 'Frankfurt', country: 'DE', prefixes: ['80.81.192.0/21', '2001:7f8::/64'], sites: [[50.119, 8.735], [50.1, 8.63]] },
  { id: 54, name: 'MIX-IT', city: 'Milan', country: 'IT', prefixes: ['217.29.66.0/23'], sites: [[45.475, 9.105]] },
  { id: 99, name: 'A wide LAN', city: 'Frankfurt', country: 'DE', prefixes: ['80.81.0.0/16'], sites: [[48.137, 11.575]] },
];
const probeAt = (lat, lon, hops) => ({ probe: { city: 'Milan', country: 'IT', latitude: lat, longitude: lon }, hops: hops.map(([ip, rtt], i) => ({ n: i + 1, ip, rtt })) });

test('the prefixes of a LAN that can be used', () => {
  assert.equal(lanPrefix('80.81.192.0/21'), '80.81.192.0/21');
  assert.equal(lanPrefix('2001:7F8::/64'), '2001:7f8::/64');
  for (const bad of ['', null, '80.81.192.0', '10.0.0.0/8', '80.81.192.0/31', '2001:7f8::/16', '2001:7f8::/127', '300.1.1.0/24', 'x/24']) assert.equal(lanPrefix(bad), null, String(bad));
});

test('the exchanges of PeeringDB with a prefix and a site, the sites once each, in order of id', () => {
  const t = {
    ixpfx: [{ ixlan_id: 10, prefix: '80.81.192.0/21' }, { ixlan_id: 10, prefix: '2001:7f8::/64' }, { ixlan_id: 20, prefix: '217.29.66.0/23' },
      { ixlan_id: 30, prefix: '10.0.0.0/8' }, { ixlan_id: 99, prefix: '192.0.2.0/24' }],
    ixlan: [{ id: 10, ix_id: 31 }, { id: 20, ix_id: 54 }, { id: 30, ix_id: 77 }, { id: 40, ix_id: 88 }],
    ix: [{ id: 54, name: 'MIX-IT', city: 'Milan', country: 'IT', status: 'ok' }, { id: 31, name: 'DE-CIX Frankfurt', city: 'Frankfurt', country: 'DE', status: 'ok' },
      { id: 77, name: 'Bad prefix', city: 'X', country: 'XX', status: 'ok' }, { id: 88, name: 'No prefix', city: 'Y', country: 'YY', status: 'ok' }],
    ixfac: [{ ix_id: 31, fac_id: 1 }, { ix_id: 31, fac_id: 2 }, { ix_id: 31, fac_id: 3 }, { ix_id: 54, fac_id: 4 }, { ix_id: 54, fac_id: 5 }, { ix_id: 77, fac_id: 1 }],
    fac: [{ id: 1, latitude: 50.11925, longitude: 8.735199, status: 'ok' }, { id: 2, latitude: 50.1192, longitude: 8.7352, status: 'ok' },
      { id: 3, latitude: null, longitude: null, status: 'ok' }, { id: 4, latitude: 0, longitude: 0, status: 'ok' }, { id: 5, latitude: 45.47, longitude: 9.1, status: 'deleted' }],
  };
  assert.deepEqual(ixpsFrom(t), [
    { id: 31, name: 'DE-CIX Frankfurt', city: 'Frankfurt', country: 'DE', prefixes: ['2001:7f8::/64', '80.81.192.0/21'], sites: [[50.119, 8.735]] },
  ]);
  assert.deepEqual(ixpsFrom({}), []);
});

test('distances on the Earth', () => {
  assert.ok(Math.abs(distanceKm([41.9, 12.5], [45.46, 9.19]) - 477) < 5);        // Rome to Milan
  assert.ok(Math.abs(distanceKm([50.11, 8.68], [52.37, 4.9]) - 364) < 5);        // Frankfurt to Amsterdam
  assert.equal(distanceKm([45, 9], [45, 9]), 0);
  assert.ok(Math.abs(FIBRE_KM_PER_MS - 199.86) < 0.01);
});

test('the exchange of an address: the longest prefix, both families, nothing outside', () => {
  const idx = ixpIndex(IXPS);
  assert.equal(ixpOf(idx, '80.81.196.146').name, 'DE-CIX Frankfurt');           // in the /21 and in the /16: the /21
  assert.equal(ixpOf(idx, '80.81.10.1').name, 'A wide LAN');
  assert.equal(ixpOf(idx, '2001:7f8::a16f:0:1').name, 'DE-CIX Frankfurt');
  assert.equal(ixpOf(idx, '217.29.67.200').name, 'MIX-IT');
  assert.equal(ixpOf(idx, '193.0.0.1'), null);
  assert.equal(ixpOf(idx, 'not an address'), null);
  assert.deepEqual(ixpIndex(null), []);
});

test('a probe said to be in Milan that answers from Frankfurt in 1.5 ms is not in Milan', () => {
  const r = placeCheck(probeAt(45.464, 9.19, [['192.168.1.1', 0.4], ['195.0.0.1', 1], ['80.81.196.146', 1.5], ['193.0.0.1', 9]]), ixpIndex(IXPS));
  assert.equal(r.checked, 1);
  assert.equal(r.misplaced.ixp, 'DE-CIX Frankfurt');
  assert.equal(r.misplaced.hop, 3);
  assert.ok(r.misplaced.km > 500 && r.misplaced.km < 530);
  assert.ok(r.misplaced.atLeast > 4 && r.misplaced.atLeast < 4.5);              // 2 x (km - 100) at 200 km a millisecond
  assert.ok(r.misplaced.within > 240 && r.misplaced.within < 260);              // where it can be: 100 km + 1.5 ms / 2 of fibre
});

test('a round trip long enough for the distance, a nearby site of the exchange, no coordinates: nothing to say', () => {
  const idx = ixpIndex(IXPS);
  assert.equal(placeCheck(probeAt(45.464, 9.19, [['80.81.196.146', 6]]), idx).misplaced, null);               // 6 ms covers 520 km
  assert.equal(placeCheck(probeAt(45.464, 9.19, [['217.29.66.10', 0.3]]), idx).misplaced, null);              // MIX is in Milan
  assert.equal(placeCheck(probeAt(50.0, 8.7, [['80.81.196.146', 0.5]]), idx).misplaced, null);                // a probe in Frankfurt
  assert.deepEqual(placeCheck({ probe: { city: 'Milan' }, hops: [{ n: 1, ip: '80.81.196.146', rtt: 0.5 }] }, idx), { checked: 0, misplaced: null });
  assert.deepEqual(placeCheck(probeAt(45.464, 9.19, [['80.81.196.146', null], ['193.0.0.1', 0.5]]), idx), { checked: 0, misplaced: null });
});

test('a RIPE Atlas traceroute read like a Globalping one', () => {
  const result = { prb_id: 6001, result: [
    { hop: 1, result: [{ from: '192.168.1.1', rtt: 0.5 }, { from: '192.168.1.1', rtt: 0.4 }, { x: '*' }] },
    { hop: 2, result: [{ from: '195.0.0.1', rtt: 3.2 }, { from: '195.0.0.9', rtt: 2.9 }, { from: '195.0.0.1', rtt: 3.0 }] },
    { hop: 3, result: [{ x: '*' }, { x: '*' }, { x: '*' }] },
    { hop: 4, result: [{ from: '193.0.0.1', rtt: 9.1 }, { from: '193.0.0.1', rtt: 8.7, ttl: 60 }] },
    { hop: 255, result: [{ x: '*' }] },
  ] };
  const s = summariseAtlas(result, { id: 6001, country: 'NL', asn: 3333, latitude: 52.35, longitude: 4.9 }, (ip) => (ip.startsWith('195.') ? 1200 : 3333));
  assert.deepEqual(s.hops.map((h) => [h.n, h.ip, h.rtt]), [[1, '192.168.1.1', 0.4], [2, '195.0.0.1', 3.0], [3, null, null], [4, '193.0.0.1', 8.7]]);
  assert.deepEqual(s.path, [1200, 3333]);
  assert.equal(s.probe.platform, 'atlas');
  assert.equal(s.probe.id, 6001);
  assert.equal(s.status, 'finished');
  assert.equal(s.access, 3.0);                                                    // the first public address
  assert.equal(s.net, 8.7 - 3.0);
  assert.equal(summariseAtlas({ prb_id: 1, error: 'x' }, { id: 1 }, () => null).status, 'failed');
});

test('the SOI floor and the strongest of several proofs', () => {
  assert.equal(soiFloor(80), 0);                                                  // within the margin
  assert.ok(Math.abs(soiFloor(1100) - 10) < 0.01);                                // 1,000 km of fibre there and back: 10 ms
  const milan = [45.464, 9.19];
  const refs = [
    { kind: 'anchor', anchor: 'de-fra', sites: [[50.11, 8.68]], rtt: 2 },        // Frankfurt, 507 km: at least 4.07 ms
    { kind: 'anchor', anchor: 'us-iad', sites: [[39.04, -77.49]], rtt: 20 },     // Ashburn, 6,700 km: at least 66 ms, the stronger proof
    { kind: 'anchor', anchor: 'it-mil', sites: [[45.47, 9.18]], rtt: 0.5 },      // Milan itself: fine
    { kind: 'anchor', anchor: 'none', sites: [[1, 1]], rtt: null },             // no answer: not used
  ];
  const r = soiCheck(...milan, refs);
  assert.equal(r.checked, 3);
  assert.equal(r.misplaced.anchor, 'us-iad');
  assert.equal(r.misplaced.sites, undefined);
  assert.ok(r.misplaced.atLeast > 60);
  assert.ok(r.misplaced.within > 2000 && r.misplaced.within < 2200);              // 100 km + 10 ms of fibre
  assert.deepEqual(soiCheck(...milan, refs.slice(2)), { checked: 1, misplaced: null });
  assert.deepEqual(soiCheck(undefined, 9, refs), { checked: 0, misplaced: null });
});

test('the instances of the root servers: the naming schemes of the operators, and nothing else', () => {
  const cases = [
    ['a', 'nnn1-ams5', 'AMS', null], ['a', 'nnn1-usmia-2b', 'MIA', 'US'], ['a', 'nnn1-jptyo-3', 'TYO', 'JP'],
    ['b', 'b1-sin', 'SIN', null], ['c', 'fra1b.c.root-servers.org', 'FRA', null], ['e', 'c01.TPE.eroot', 'TPE', null], ['e', 'p04.ams.eroot', 'AMS', null],
    ['f', 'TPE.cf.f.root-servers.org', 'TPE', null], ['f', 'ams1a.f.root-servers.org', 'AMS', null], ['h', '001.hkg.h.root-servers.org', 'HKG', null],
    ['j', 'rootns-elgva1', 'GVA', null], ['j', 'rootns-ams6', 'AMS', null], ['j', 'rootns-elp2', 'ELP', null], ['j', 'nnn1-ams1', 'AMS', null],
    ['k', 'ns1.nl-ams.k.ripe.net', 'AMS', 'NL'], ['l', 'de-ham-aa', 'HAM', 'DE'], ['l', 'flr01.l.root-servers.org', 'FLR', null],
    ['m', 'M-ORY-2', 'ORY', null], ['m', 'M-NRT-DIXIE-1', 'NRT', null],
  ];
  for (const [l, h, code, cc] of cases) assert.deepEqual(rootPlace(l, h), { code, cc }, `${l} ${h}`);
  for (const [l, h] of [['a', 'OPNsense.internal'], ['b', 'wall.obskure.net'], ['c', 'gw01.jacobsylvia.com'], ['l', 'There is no hostname, only Zuul!'],
    ['g', 'groot-eur1-1'], ['d', 'mcva3.droot.maxgigapop.net'], ['i', 's1.mtv'], ['k', 'ns1.nl-ams.k.ripe.net.evil'], ['m', 'm-ory-2'], ['x', 'b1-sin']]) {
    assert.equal(rootPlace(l, h), null, `${l} ${h}`);
  }
});

test('reference points from the roots: only the instances whose place has been checked', () => {
  const sites = { k: { 'ns1.nl-ams.k.ripe.net': [52.31, 4.76, 'AMS'] }, m: { 'M-ORY-2': [48.72, 2.38, 'ORY'] } };
  const refs = rootRefs([{ letter: 'k', hostname: 'ns1.nl-ams.k.ripe.net', rtt: 1.1 }, { letter: 'm', hostname: 'M-CDG-2', rtt: 9 },
    { letter: 'a', hostname: 'OPNsense.internal', rtt: 0.2 }, { letter: 'm', hostname: 'M-ORY-2', rtt: null }], sites);
  assert.deepEqual(refs, [{ kind: 'root', letter: 'k', hostname: 'ns1.nl-ams.k.ripe.net', code: 'AMS', sites: [[52.31, 4.76]], rtt: 1.1, margin: 300 }]);
  // a probe declared in Milan that reaches the instance of Amsterdam in 1.1 ms is not in Milan; with the margin of a root, it can be
  // up to 300 km + 0.55 ms of fibre from Amsterdam
  const m = soiCheck(45.464, 9.19, refs).misplaced;
  assert.equal(m.code, 'AMS');
  assert.equal(m.margin, 300);
  assert.equal(m.within, 410);
  // a probe declared in Brussels (about 170 km away) is within the margin of the instance of Amsterdam
  assert.equal(soiCheck(50.85, 4.35, refs).misplaced, null);
});

test('the anchors to ping: spread in the country, and one near each point of the world', () => {
  const A = (id, country, latitude, longitude) => ({ id, ip: `192.0.2.${id}`, country, latitude, longitude, city: `c${id}` });
  const anchors = [A(1, 'IT', 45.46, 9.19), A(2, 'IT', 41.9, 12.5), A(3, 'IT', 45.07, 7.69), A(4, 'IT', 38.12, 13.36), A(5, 'DE', 50.11, 8.68),
    A(6, 'US', 39.04, -77.49), A(7, 'JP', 35.68, 139.69), A(8, 'IT', 44.49, 11.34), { id: 9, ip: null, country: 'IT', latitude: 1, longitude: 1 }];
  const picked = pickAnchors(anchors, 'IT', 3, [[50.11, 8.68], [39.04, -77.49], [35.68, 139.69]]);
  const ids = picked.map((a) => a.id);
  assert.equal(ids.length, 6);
  assert.deepEqual(ids.slice(3), [5, 6, 7]);                                      // the points of the world
  assert.ok(ids.slice(0, 3).every((id) => [1, 2, 3, 4, 8].includes(id)));
  assert.ok(ids.includes(4));                                                     // Palermo, the farthest from the others, is taken
  assert.ok(!ids.includes(9));                                                    // an anchor without an address is not
  assert.deepEqual(pickAnchors(anchors, 'FR', 3, [[50.11, 8.68]]).map((a) => a.id), [5]);
  assert.deepEqual(anchorRefs([{ anchor: anchors[4], rtt: 1.2 }, { anchor: anchors[5], rtt: null }]),
    [{ kind: 'anchor', anchor: '192.0.2.5', city: 'c5', country: 'DE', sites: [[50.11, 8.68]], rtt: 1.2 }]);
});

console.log(`${passed} tests passed`);
