// Unit tests for scripts/watch-invalid.mjs (no dependencies, no network). Run with: node scripts/test-invalid.mjs
import assert from 'node:assert/strict';
import { announcementsOf, blankDay, count, buildReport, dayOf } from './watch-invalid.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the announcements of a message: origin first, prepending and IXP ASes dropped, AS_SETs skipped', () => {
  const m = { peer_asn: '3333', path: [3333, 100, 100, 5, 5, 9], announcements: [{ prefixes: ['192.0.2.0/24', '198.51.100.0/24'] }, { prefixes: ['203.0.113.0/24'] }] };
  const a = announcementsOf(m, new Set([100]));
  assert.equal(a.length, 3);
  assert.deepEqual(a[0].path, [9, 5, 3333]);
  assert.equal(a[2].prefix, '203.0.113.0/24');
  assert.deepEqual(announcementsOf({ path: [1, [2, 3], 4], announcements: [{ prefixes: ['10.0.0.0/8'] }] }), []);
  assert.deepEqual(announcementsOf({ path: [], announcements: [] }), []);
  assert.deepEqual(announcementsOf({ path: [1, 2], withdrawals: ['10.0.0.0/8'] }), []);
});

const at = (iso) => Date.parse(iso);

test('counting: by hour, by origin and, for the invalid ones, by prefix', () => {
  const d = blankDay('2026-10-18');
  count(d, at('2026-10-18T10:05:00Z'), 9, '192.0.2.0/24', 0);
  count(d, at('2026-10-18T10:06:00Z'), 9, '192.0.2.0/24', 2);
  count(d, at('2026-10-18T10:07:00Z'), 9, '192.0.2.0/24', 2);
  count(d, at('2026-10-18T11:00:00Z'), 7, '198.51.100.0/24', 1);
  assert.deepEqual([d.hours[10].announcements, d.hours[10].valid, d.hours[10].invalid, d.hours[11].unknown], [3, 1, 2, 1]);
  assert.deepEqual(d.origins[9], [3, 2]);
  assert.deepEqual(d.prefixes, { '192.0.2.0/24|9': 2 });
  assert.equal(dayOf(at('2026-10-18T23:59:59Z')), '2026-10-18');
});

test('the report sums the days and ranks the origins and the prefixes', () => {
  const d1 = blankDay('2026-10-17'), d2 = blankDay('2026-10-18');
  d1.hours[3].seconds = 3000; d1.hours[3].messages = 50; d1.hours[3].peak_ann = 40; d1.hours[3].peak_inv = 5;
  d2.hours[4].seconds = 600; d2.hours[4].peak_inv = 9;
  for (let i = 0; i < 200; i++) count(d1, at('2026-10-17T03:10:00Z'), 9, '192.0.2.0/24', i < 20 ? 2 : 0);   // AS9: 20 of 200 invalid
  for (let i = 0; i < 150; i++) count(d2, at('2026-10-18T04:10:00Z'), 5, `10.0.${i % 3}.0/24`, i < 30 ? 2 : 0);   // AS5: 30 of 150, three prefixes
  count(d2, at('2026-10-18T04:11:00Z'), 7, '203.0.113.0/24', 2);                                              // AS7: one announcement only
  const r = buildReport([d1, d2], at('2026-10-18T12:00:00Z'));
  assert.equal(r.profile.announcements, 351);
  assert.equal(r.profile.invalid, 51);
  assert.equal(r.profile.invalid_share, 14.5299);
  assert.equal(r.profile.seconds, 3600);
  assert.deepEqual(r.profile.peak_invalid_per_second, { v: 9, at: '2026-10-18T04:00:00Z' });
  assert.equal(r.profile.origins, 3); assert.equal(r.profile.origins_with_invalid, 3);
  assert.deepEqual(r.by_count.map((x) => x.asn), ['AS5', 'AS9', 'AS7']);
  assert.equal(r.by_count[0].prefixes, 3);
  assert.deepEqual(r.by_share.map((x) => x.asn), ['AS5', 'AS9']);          // AS7 has fewer than 100 announcements
  assert.equal(r.by_share[0].share, 20);
  assert.equal(r.prefixes[0].invalid, 20);
  assert.deepEqual(r.hours.map((h) => h.at), ['2026-10-17T03:00:00Z', '2026-10-18T04:00:00Z']);
  assert.equal(r.from, '2026-10-17'); assert.equal(r.to, '2026-10-18');
});

test('no days gives an empty report', () => {
  const r = buildReport([]);
  assert.equal(r.profile.announcements, 0); assert.equal(r.profile.invalid_share, 0); assert.equal(r.from, null);
});

console.log(`${passed} tests passed`);
