// Unit tests for the pure parts of site/live.js (no dependencies). Run with: node scripts/test-live.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { subscription, parseUpdate, ageText, snapshotOrigins, lookingGlassOrigins, compare, withdrawn } = createRequire(import.meta.url)('../site/live.js');

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

test('the age of a snapshot in words', () => {
  assert.equal(ageText(20000), 'less than a minute');
  assert.equal(ageText(12 * 60000), '12 min');
  assert.equal(ageText((3 * 60 + 39) * 60000), '3 h 39 min');
  assert.equal(ageText(60 * 3600000), '2 days');
  assert.equal(ageText(-5), 'less than a minute');
});

test('origins of the snapshot by prefix; a path with an AS_SET has none', () => {
  const s = snapshotOrigins([
    { target_prefix: '0.0.0.0/0', path: [57111, 41327] },
    { target_prefix: '193.0.0.0/21', path: [1, 3333] }, { target_prefix: '193.0.0.0/21', path: [2, 3333] }, { target_prefix: '193.0.0.0/21', path: [2, 9] },
    { target_prefix: '10.0.0.0/8', path: [1, [2, 3]] },
  ]);
  assert.deepEqual([...s.get('193.0.0.0/21')], [[3333, 2], [9, 1]]);
  assert.equal(s.has('10.0.0.0/8'), false);
});

test('origins of the looking glass: peers per origin, only the prefix asked', () => {
  const lg = { rrcs: [{ peers: [{ asn_origin: '3333', prefix: '193.0.0.0/21' }, { asn_origin: '3333', prefix: '193.0.0.0/21' }, { asn_origin: '9', prefix: '193.0.0.0/20' }] }, { peers: [{ asn_origin: '12', prefix: '193.0.0.0/21' }] }] };
  assert.deepEqual([...lookingGlassOrigins(lg, '193.0.0.0/21')], [[3333, 2], [12, 1]]);
  assert.equal(lookingGlassOrigins(null, 'x').size, 0);
});

test('the comparison: gone, added, kept, and a prefix that could not be read is skipped', () => {
  const snap = new Map([['0.0.0.0/0', new Map([[41327, 1]])], ['193.0.0.0/21', new Map([[3333, 5]])], ['10.0.0.0/8', new Map([[1, 1]])], ['11.0.0.0/8', new Map([[1, 1]])]]);
  const now = new Map([['0.0.0.0/0', new Map([[7, 3]])], ['193.0.0.0/21', new Map([[3333, 9]])], ['10.0.0.0/8', new Map()]]);
  const rows = compare(snap, now);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].gone, [41327]);
  assert.deepEqual(rows[0].added, [7]);
  assert.equal(rows[1].changed, false);
  assert.deepEqual(rows[1].kept, [3333]);
  assert.deepEqual(rows[2].gone, [1]);
  assert.equal(rows[2].changed, true);
});

test('withdrawn: the routes of the snapshot whose origin the looking glass no longer holds', () => {
  const snap = new Map([['0.0.0.0/0', new Map([[41327, 1]])], ['193.0.0.0/21', new Map([[3333, 5]])], ['10.0.0.0/8', new Map([[1, 2], [2, 3]])]]);
  const now = new Map([['0.0.0.0/0', new Map([[7, 3]])], ['193.0.0.0/21', new Map([[3333, 9]])], ['10.0.0.0/8', new Map([[2, 1]])]]);
  const w = withdrawn(compare(snap, now));
  assert.equal(w.routes, 3);
  assert.deepEqual(w.items.map((i) => [i.prefix, i.origins, i.routes]), [['0.0.0.0/0', [41327], 1], ['10.0.0.0/8', [1], 2]]);
  assert.equal(withdrawn([]).routes, 0);
});

console.log(`${passed} tests passed`);
