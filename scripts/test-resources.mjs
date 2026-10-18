// Unit tests for scripts/build-resources.mjs (no dependencies, no network). Run with: node scripts/test-resources.mjs
import assert from 'node:assert/strict';
import { parseAsnRecords, reservedKind, aggregateResources } from './build-resources.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

const ripe = ['# comment', '2|ripencc|20261018|1|x|x|+0200', 'ripencc|*|asn|*|3|summary',
  'ripencc|IT|asn|100|2|19990105|allocated|x', 'ripencc|FR|asn|200|1|20150310|assigned|x', 'ripencc|ZZ|asn|300|1||available|x', 'ripencc||asn|400|2||reserved|x', 'ripencc|IT|ipv4|1.0.0.0|256|19990105|allocated|x'].join('\n');

test('the lines of a delegation file: every status, the year, no other resource', () => {
  const r = parseAsnRecords(ripe, 'ripe');
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { start: 100, end: 101, cc: 'IT', rir: 'ripe', status: 'allocated', year: 1999 });
  assert.equal(r[2].status, 'available'); assert.equal(r[2].year, null);
  assert.equal(r[3].cc, 'ZZ');
});

test('the AS numbers that are not for the Internet', () => {
  for (const [n, k] of [[0, 'reserved'], [23456, 'AS_TRANS'], [64500, 'documentation'], [64512, 'private'], [65535, 'reserved'], [65540, 'documentation'], [70000, 'reserved'], [4200000001, 'private'], [3333, null], [4200000000 - 1, null], [131072, null]]) assert.equal(reservedKind(n), k, String(n));
});

test('the funnel by RIR, economy, year and width, and the figures per million users', () => {
  const records = parseAsnRecords(ripe, 'ripe').concat(parseAsnRecords('arin|US|asn|70000|2|2012-1|allocated|x\narin|US|asn|70002|1|20200101|allocated|x', 'arin'));
  const seen = new Set([100, 200, 70000]);
  const aspa = new Map([[100, [200]], [70000, [100, 999]], [64512, [100]], [301, [0]], [400, [100]]]);
  const bank = { users: new Map([['IT', 2e6], ['US', 4e6]]), population: new Map([['IT', 3e6]]), region: new Map([['IT', 'Europe'], ['FR', 'Europe'], ['US', 'North America']]) };
  const r = aggregateResources({ records, seen, aspa, bank });
  const ripeRow = r.registries.find((x) => x.rir === 'ripe');
  assert.deepEqual([ripeRow.allocated, ripeRow.advertised, ripeRow.aspa, ripeRow.available, ripeRow.reserved, ripeRow.unadvertised], [3, 2, 1, 1, 2, 1]);
  const it = r.economies.find((e) => e.cc === 'IT');
  assert.deepEqual([it.allocated, it.advertised, it.aspa, it.users, it.aspa_per_million_users, it.advertised_per_million_users], [2, 1, 1, 2000000, 0.5, 0.5]);
  assert.equal(r.economies.find((e) => e.cc === 'FR').users, null);
  assert.equal(r.economies.find((e) => e.cc === 'FR').aspa_per_million_users, null);
  assert.deepEqual(r.regions.map((g) => [g.region, g.allocated, g.aspa]).sort(), [['Europe', 3, 1], ['North America', 3, 1]]);
  assert.deepEqual(r.by_year.map((y) => [y.year, y.allocated, y.advertised]), [[1999, 2, 1], [2015, 1, 1], [2020, 1, 0]]);
  assert.deepEqual(r.by_width.map((w) => [w.width, w.allocated, w.advertised, w.aspa]), [['16-bit', 3, 2, 1], ['32-bit', 3, 1, 1]]);
});

test('the ASPAs that should not be there: customers and providers that are not allocated, reserved or private', () => {
  const records = parseAsnRecords(ripe, 'ripe');
  const aspa = new Map([[100, [200, 777, 64512]], [64512, [100]], [300, [100]], [400, [100]], [9999, [0]]]);
  const r = aggregateResources({ records, seen: new Set(), aspa });
  assert.deepEqual(r.suspect.map((s) => [s.asn, s.reason]), [
    ['AS300', 'listed as available in a delegation file'], ['AS400', 'listed as reserved in a delegation file'], ['AS9999', 'not in any delegation file'], ['AS64512', 'private']]);
  assert.deepEqual(r.suspect_providers.map((s) => [s.customer, s.provider, s.reason]), [['AS100', 'AS777', 'not in any delegation file'], ['AS100', 'AS64512', 'private']]);
  assert.equal(r.aspa_customers, 5);
});

console.log(`${passed} tests passed`);
