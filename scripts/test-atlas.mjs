// Unit tests for atlas/api.mjs, with RIPEstat and RIPE Atlas faked. Run with: node scripts/test-atlas.mjs
import assert from 'node:assert/strict';
import { makeAtlasApi, parseAsn, limiter, PROBES, quotaKey, canonicalIp } from '../atlas/api.mjs';
import { createRequire } from 'node:module';
const T = createRequire(import.meta.url)('../site/traceroute.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

const ANCHORS = [
  { id: 1, fqdn: 'it-mil-as1.anchors.atlas.ripe.net', probe: 101, ip_v4: '192.0.2.1', city: 'Milan', country: 'IT', geometry: { coordinates: [9.19, 45.46] }, is_disabled: false },
  { id: 2, fqdn: 'it-rom-as2.anchors.atlas.ripe.net', probe: 102, ip_v4: '192.0.2.2', city: 'Rome', country: 'IT', geometry: { coordinates: [12.5, 41.9] }, is_disabled: false },
  { id: 3, fqdn: 'de-fra-as3.anchors.atlas.ripe.net', probe: 103, ip_v4: '192.0.2.3', city: 'Frankfurt', country: 'DE', geometry: { coordinates: [8.68, 50.11] }, is_disabled: false },
  { id: 4, fqdn: 'us-ash-as4.anchors.atlas.ripe.net', probe: 104, ip_v4: '192.0.2.4', city: 'Ashburn', country: 'US', geometry: { coordinates: [-77.49, 39.04] }, is_disabled: false },
  { id: 5, fqdn: 'jp-tyo-as5.anchors.atlas.ripe.net', probe: 105, ip_v4: '192.0.2.5', city: 'Tokyo', country: 'JP', geometry: { coordinates: [139.69, 35.68] }, is_disabled: true },
  { id: 6, fqdn: 'nl-ams-as6.anchors.atlas.ripe.net', probe: 106, ip_v4: null, city: 'Amsterdam', country: 'NL', geometry: { coordinates: [4.9, 52.37] }, is_disabled: false },
];
const PROBES_IT = Array.from({ length: 12 }, (_, i) => ({ id: 1000 + i, asn_v4: 64500 + (i % 6), geometry: { coordinates: [9 + i / 10, 45] } }));

function fake(over = {}) {
  const calls = { get: [], created: [] };
  const getJson = async (url) => {
    calls.get.push(url);
    if (url.includes('announced-prefixes')) return { data: { prefixes: [{ prefix: '193.0.0.0/21' }, { prefix: '2001:67C:2E8::/48' }] } };
    if (url.includes('is_anchor=true')) return { results: [101, 102, 103, 104, 106].map((id) => ({ id })), next: null };
    if (url.includes('/anchors/')) return { results: ANCHORS, next: null };
    if (url.includes('country_code=IT')) return { results: PROBES_IT, next: null };
    if (url.includes('country_code=')) return { results: [], next: null };
    throw new Error(`unexpected ${url}`);
  };
  let next = 50000000;
  const createMeasurements = async (body) => { calls.created.push(body); return body.definitions.map(() => next++); };
  let r = 0;
  const api = makeAtlasApi({ getJson, createMeasurements, random: () => ((r = (r * 9301 + 49297) % 233280) / 233280), ...over });
  return { api, calls };
}

await test('the AS numbers that are accepted', () => {
  assert.equal(parseAsn('AS3333'), 3333);
  assert.equal(parseAsn(3333), 3333);
  assert.equal(parseAsn('as4294967295'), 4294967295);
  for (const bad of ['', 'AS0', '0', 'AS4294967296', 'x', '33 33', null, undefined]) assert.equal(parseAsn(bad), null, String(bad));
});

await test('a measurement: a traceroute for each family and pings to the anchors, from the same probes', async () => {
  const { api, calls } = fake();
  const r = await api.measure({ asn: 'AS3333', country: 'it', targets: { v4: '193.0.0.1', v6: '2001:67c:2e8::1' } }, '198.51.100.1');
  assert.equal(r.status, 200);
  assert.equal(calls.created.length, 1);
  const body = calls.created[0];
  assert.equal(body.is_oneoff, true);
  assert.deepEqual(body.definitions.slice(0, 2).map((d) => [d.type, d.af, d.target]), [['traceroute', 4, '193.0.0.1'], ['traceroute', 6, '2001:67c:2e8::1']]);
  const pings = body.definitions.slice(2);
  assert.ok(pings.every((d) => d.type === 'ping' && d.af === 4));
  assert.deepEqual(new Set(pings.map((d) => d.target)), new Set(['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4']));   // not the disabled one, not the one without IPv4
  const ids = body.probes[0].value.split(',').map(Number);
  assert.equal(body.probes[0].requested, ids.length);
  assert.ok(ids.length <= PROBES);
  assert.equal(new Set(r.body.probes.map((p) => p.asn)).size, r.body.probes.length);                                         // one probe for each network
  assert.deepEqual(r.body.traceroutes, { v4: 50000000, v6: 50000001 });
  assert.equal(r.body.pings[0].id, 50000002);
  assert.equal(r.body.pings[0].anchor.city, 'Milan');
  assert.ok(calls.get.some((u) => u.includes('tags=system-ipv4-works,system-ipv6-works')));
});

await test('only targets inside the prefixes of the AS, public, of the right family', async () => {
  const { api, calls } = fake();
  for (const targets of [{ v4: '8.8.8.8' }, { v4: '10.0.0.1' }, { v4: '2001:67c:2e8::1' }, { v6: '2001:db8::1' }, {}, { v4: 'x' }]) {
    const r = await api.measure({ asn: 3333, country: 'IT', targets }, '198.51.100.2');
    assert.equal(r.status, 400, JSON.stringify(targets));
  }
  assert.equal((await api.measure({ asn: 'AS0', country: 'IT', targets: { v4: '193.0.0.1' } }, 'x')).status, 400);
  assert.equal((await api.measure({ asn: 3333, country: 'ITA', targets: { v4: '193.0.0.1' } }, 'x')).status, 400);
  assert.equal((await api.measure('nope', 'x')).status, 400);
  assert.equal(calls.created.length, 0);
});

await test('a country without probes, and the limits', async () => {
  const { api } = fake({ perIp: limiter(2, 3600), maxRunning: 2 });
  const ask = (country, ip) => api.measure({ asn: 3333, country, targets: { v4: '193.0.0.1' } }, ip).then((r) => r.status);
  assert.equal(await ask('FR', '198.51.100.3'), 404);                 // no probe in France: it counts for the address all the same
  assert.equal(await ask('IT', '198.51.100.3'), 200);
  assert.equal(await ask('IT', '198.51.100.3'), 429);                 // the address has used its two
  assert.equal(await ask('IT', '198.51.100.4'), 200);
  assert.equal(await ask('IT', '198.51.100.5'), 429);                 // two tests in flight
});

await test('the anchors for a country, without measuring anything', async () => {
  const { api, calls } = fake();
  const r = await api.anchorsFor({ country: 'it' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.anchors.slice(0, 2).map((a) => a.city).sort(), ['Milan', 'Rome']);
  assert.equal((await api.anchorsFor({ country: '1' })).status, 400);
  assert.equal(calls.created.length, 0);
});

await test('the quota key: one IPv6 /64 is one visitor, and the target is sent as the address that was checked', () => {
  assert.equal(quotaKey('2001:db8:1:2::1'), quotaKey('2001:db8:1:2:ffff::9'));
  assert.notEqual(quotaKey('2001:db8:1:2::1'), quotaKey('2001:db8:1:3::1'));
  assert.notEqual(quotaKey('198.51.100.1'), quotaKey('198.51.100.2'));
  assert.equal(quotaKey('::ffff:198.51.100.1'), quotaKey('198.51.100.1'));
  assert.equal(canonicalIp(T.parseIp('193.000.0.001')), '193.0.0.1');
  assert.equal(canonicalIp(T.parseIp('2001:067C:02E8:0000:0000:0000:0000:0001')), '2001:67c:2e8::1');
  assert.equal(canonicalIp(T.parseIp('2001:db8:0:1:0:0:0:1')), '2001:db8:0:1::1');
  assert.equal(canonicalIp(T.parseIp('2001:db8:1:2:3:4:5:6')), '2001:db8:1:2:3:4:5:6');
});

await test('requests that create no measurement do not use the budget of the day, and one /64 has one per-address limit', async () => {
  const { api, calls } = fake({ perDay: limiter(2, 86400), perIp: limiter(6, 3600) });
  for (let i = 1; i <= 20; i++) {
    const r = await api.measure({ asn: 3333, country: 'IT', targets: { v4: '8.8.8.8' } }, `198.51.100.${i}`);
    assert.equal(r.status, 400);
  }
  assert.equal(calls.created.length, 0);
  assert.equal((await api.measure({ asn: 3333, country: 'IT', targets: { v4: '193.0.0.1' } }, '198.51.100.200')).status, 200);   // the budget is still there
  const statuses = [];
  for (let i = 1; i <= 7; i++) statuses.push((await api.measure({ asn: 3333, country: 'FR', targets: { v4: '193.0.0.1' } }, `2001:db8:1:2::${i}`)).status);
  assert.deepEqual(statuses, [404, 404, 404, 404, 404, 404, 429]);         // seven addresses of one /64 share its six
});

await test('the measurements in flight: concurrent requests cannot go past the limit', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const created = [];
  const answers = (url) => (url.includes('announced-prefixes') ? { data: { prefixes: [{ prefix: '193.0.0.0/21' }] } }
    : url.includes('is_anchor=true') ? { results: [{ id: 101 }], next: null }
      : url.includes('/anchors/') ? { results: [ANCHORS[0]], next: null }
        : { results: PROBES_IT, next: null });
  const slow = makeAtlasApi({
    getJson: async (url) => { await gate; return answers(url); },             // the upstream answers only after every request has arrived
    createMeasurements: async (body) => { created.push(body); return body.definitions.map((_, i) => i + 1); },
    maxRunning: 3,
  });
  const pending = Array.from({ length: 12 }, (_, i) => slow.measure({ asn: 3333, country: 'IT', targets: { v4: '193.0.0.1' } }, `198.51.100.${i + 1}`));
  open();
  const statuses = (await Promise.all(pending)).map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 3);
  assert.equal(statuses.filter((s) => s === 429).length, 9);
  assert.equal(created.length, 3);
});

await test('a request that fails after taking a place gives it back', async () => {
  const { api } = fake({ maxRunning: 1, perIp: () => true });
  assert.equal((await api.measure({ asn: 3333, country: 'IT', targets: { v4: '8.8.8.8' } }, 'a')).status, 400);   // outside the prefixes
  assert.equal((await api.measure({ asn: 3333, country: 'FR', targets: { v4: '193.0.0.1' } }, 'b')).status, 404);  // no probes
  assert.equal((await api.measure({ asn: 3333, country: 'IT', targets: { v4: '193.0.0.1' } }, 'c')).status, 200);  // the only place was still free
  assert.equal((await api.measure({ asn: 3333, country: 'IT', targets: { v4: '193.0.0.1' } }, 'd')).status, 429);  // now it is taken
  const broken = makeAtlasApi({ getJson: async () => { throw new Error('down'); }, createMeasurements: async () => [], maxRunning: 1, perIp: () => true });
  await assert.rejects(broken.measure({ asn: 3333, country: 'IT', targets: { v4: '193.0.0.1' } }, 'e'));
  await assert.rejects(broken.measure({ asn: 3333, country: 'IT', targets: { v4: '193.0.0.1' } }, 'f'));   // not 429: the failed one gave its place back
});

console.log(`${passed} tests passed`);
