// Unit tests for scripts/build-adoption.mjs (no dependencies). Run with: node scripts/test-adoption.mjs
import assert from 'node:assert/strict';
import { parseDelegated, registry, parseRelationships, coneSizes, aggregate, tierOf, parseCaidaHeader, registryDoc } from './build-adoption.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

const delegated = `2|ripencc|20261017|1234|20261017|+0200
ripencc|*|asn|*|10|summary
ripencc|NL|asn|1103|1|19900101|allocated|abc
ripencc|IT|asn|137|1|19900101|assigned
ripencc|EU|asn|2000|4|20000101|allocated
ripencc||asn|3000|1|20000101|available
ripencc|DE|asn|4000|1|20000101|reserved
ripencc|NL|ipv4|193.0.0.0|2048|19900101|allocated`;

test('delegation files: only the AS numbers in use, with their country', () => {
  const r = parseDelegated(delegated, 'ripe');
  assert.deepEqual(r.map((x) => [x.start, x.end, x.cc, x.rir]), [[137, 137, 'IT', 'ripe'], [1103, 1103, 'NL', 'ripe'], [2000, 2003, 'EU', 'ripe']]);
});

test('registry lookup over ranges', () => {
  const where = registry(parseDelegated(delegated, 'ripe'));
  assert.equal(where(1103).cc, 'NL');
  assert.equal(where(2002).cc, 'EU');
  assert.equal(where(2004), null);
  assert.equal(where(1), null);
});

const rel = `# comment
1|2|-1|bgp
1|3|-1|bgp
2|4|-1|bgp
2|5|-1|bgp
3|5|-1|bgp
6|7|0|bgp
4|2|-1|bgp`;

test('relationships and customer cones (peering ignored, cycles survive)', () => {
  const customers = parseRelationships(rel);
  assert.deepEqual(customers.get(1), [2, 3]);
  assert.equal(customers.has(6), false);
  const cones = coneSizes(customers);
  assert.equal(cones.get(1), 5);     // 1, 2, 3, 4, 5
  assert.equal(cones.get(3), 2);
  assert.equal(cones.get(2), 3);     // 2, 4, 5 (4 lists 2 as a customer: a cycle, counted once)
  assert.equal(cones.get(5), undefined);
});

test('tiers', () => {
  assert.deepEqual([1, 2, 9, 10, 99, 100, 999, 1000, 70000].map(tierOf), ['stub', 'small', 'small', 'medium', 'medium', 'large', 'large', 'huge', 'huge']);
});

test('aggregation: by RIR, country, size; the largest networks', () => {
  const where = registry([{ start: 1, end: 3, cc: 'IT', rir: 'ripe' }, { start: 4, end: 5, cc: 'US', rir: 'arin' }]);
  const cones = coneSizes(parseRelationships(rel));
  const seen = new Set([1, 2, 3, 4, 5, 99]);
  const aspa = new Map([[1, 0], [4, 2], [77, 1]]);          // 77 is not seen
  const a = aggregate({ seen, aspa, where, cones, topN: 3 });
  assert.equal(a.seen, 6); assert.equal(a.aspa, 2); assert.equal(a.pct, 33.33); assert.equal(a.aspa_not_seen, 1);
  assert.deepEqual(a.by_rir.map((r) => [r.rir, r.seen, r.aspa]), [['ripe', 3, 1], ['arin', 2, 1], ['unknown', 1, 0]]);
  assert.deepEqual(a.by_country.map((r) => [r.cc, r.seen, r.aspa]), [['IT', 3, 1], ['US', 2, 1], ['ZZ', 1, 0]]);
  const size = (k) => a.by_size.find((t) => t.tier === k);
  assert.deepEqual([size('stub').seen, size('stub').aspa, size('small').seen, size('small').aspa], [2, 0, 4, 2]);   // 5 and 99 are stubs
  assert.deepEqual(a.top_transit.map((t) => [t.asn, t.cone, t.aspa]), [['AS1', 5, true], ['AS2', 3, false], ['AS4', 3, true]]);
  assert.equal(a.top_transit_with_aspa, 2);
  assert.equal(a.top_transit[0].providers, 0);
});
test('the clique and the exchange points come from the header of the CAIDA file', () => {
  const h = parseCaidaHeader('# source:topology|BGP|20261001\n# input clique: 174 209 3356\n# IXP ASes: 1200 4635\n1|2|-1|bgp\n');
  assert.deepEqual(h, { clique: [174, 209, 3356], ixp: [1200, 4635] });
  assert.deepEqual(parseCaidaHeader('1|2|-1|bgp\n'), { clique: [], ixp: [] });
});
test('the country and registry of the ASes seen, in one small object', () => {
  const where = registry(parseDelegated(delegated, 'ripe'));
  assert.deepEqual(registryDoc(new Set([137, 1103, 2002, 99999]), where), { 137: 'ITr', 1103: 'NLr', 2002: 'EUr' });
});
console.log(`${passed} tests passed`);
