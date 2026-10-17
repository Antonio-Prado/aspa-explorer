// Unit tests for scripts/mrt.mjs and scripts/build-leaks.mjs (no dependencies). Run with: node scripts/test-leaks.mjs
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readRib, readAsPath } from './mrt.mjs';
import { Leaks, aspaMap, relations, byAs, addHistory, dumpUrl, pickLatestRib, rvListing, isRis, COLLECTORS } from './build-leaks.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

// ---- a small MRT dump, built by hand
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const rec = (type, subtype, body) => Buffer.concat([u32(1792200000), u16(type), u16(subtype), u32(body.length), body]);
const peerIndex = (ases) => rec(13, 1, Buffer.concat([u32(0), u16(0), u16(ases.length), ...ases.map((a) => Buffer.concat([Buffer.from([2]), u32(0), u32(0), u32(a)]))]));
const attrs = (segments) => {
  const origin = Buffer.from([0x40, 1, 1, 0]);
  const body = Buffer.concat(segments.map(([t, list]) => Buffer.concat([Buffer.from([t, list.length]), ...list.map(u32)])));
  return Buffer.concat([origin, Buffer.from([0x50, 2]), u16(body.length), body]);
};
const rib = (subtype, entries) => rec(13, subtype, Buffer.concat([u32(0), Buffer.from([24, 193, 0, 0]), u16(entries.length),
  ...entries.map(([peer, segs]) => { const a = attrs(segs); return Buffer.concat([u16(peer), u32(1792100000), u16(a.length), a]); })]));
const dump = Buffer.concat([
  peerIndex([100, 200]),
  rib(2, [[0, [[2, [100, 30, 10]]]], [1, [[2, [200, 20, 10]]]], [1, [[1, [7, 8]]]]]),   // the last has an AS_SET
  rec(12, 1, Buffer.alloc(8)),                                                           // not a TABLE_DUMP_V2 record
  rib(4, [[0, [[2, [100, 10]], [2, [10]]]]]),
]);

await test('an MRT dump: peers, AS paths, AS_SETs skipped, other records ignored', async () => {
  const got = [];
  // the stream is cut in awkward places on purpose
  const stream = Readable.from([dump.subarray(0, 5), dump.subarray(5, 70), dump.subarray(70, 71), dump.subarray(71)]);
  const stats = await readRib(stream, (peerAs, path, n) => got.push([peerAs, Array.from(path.subarray(0, n))]));
  assert.deepEqual(got, [[100, [100, 30, 10]], [200, [200, 20, 10]], [100, [100, 10, 10]]]);
  assert.equal(stats.entries, 3);
  assert.equal(stats.skipped, 1);
});

await test('an AS_PATH with a segment that is not a sequence is refused', () => {
  const out = new Uint32Array(8);
  const b = Buffer.concat([Buffer.from([2, 2]), u32(5), u32(6)]);
  assert.equal(readAsPath(b, 0, b.length, out), 2);
  assert.deepEqual(Array.from(out.subarray(0, 2)), [5, 6]);
  assert.equal(readAsPath(Buffer.concat([Buffer.from([1, 1]), u32(5)]), 0, 6, out), -1);
});

// ---- the leaks
const aspas = aspaMap([
  { customer: 'AS10', providers: ['AS20'] }, { customer: 'AS20', providers: ['AS99'] }, { customer: 'AS40', providers: ['AS99'] },
]);

await test('a path with a valley is invalid and is grouped by its place', () => {
  const l = new Leaks(aspas);
  l.add(500, 'rrc00', [50, 40, 30, 20, 10]);                // origin 10 -> 20 (provider) -> 30 -> 40 -> 50: a valley
  l.add(501, 'rrc00', [50, 40, 30, 20, 10]);
  l.add(502, 'rrc01', [20, 10]);                             // valid
  l.add(503, 'rrc00', [60, 70, 80]);                         // no ASPA at all
  const r = l.result();
  assert.equal(r.total.routes, 4);
  assert.equal(r.total.invalid, 2);
  assert.equal(r.places, 1);
  const g = r.groups[0];
  assert.deepEqual([g.from, g.to, g.between], ['AS20', 'AS40', ['AS30']]);
  assert.deepEqual([g.routes, g.feeders, g.origins, g.kind, g.caida], [2, 2, 1, 'unclear', 'unknown']);
  assert.deepEqual(g.example, ['AS50', 'AS40', 'AS30', 'AS20', 'AS10']);
});

await test('prepending, exchange points and a path of one AS are handled', () => {
  const l = new Leaks(aspas, new Set([30]));
  l.add(1, 'rrc00', [50, 40, 30, 20, 20, 10]);              // AS30 is an exchange point: left out, the path is 10 20 40 50
  l.add(2, 'rrc00', [10]);
  assert.equal(l.total.routes, 2);
  assert.equal(l.total.valid, 1);
});

await test('CAIDA relations: provider, customer, peer or unknown', () => {
  const rel = relations('# comment\n1|2|-1|bgp\n3|4|0|bgp\n');
  assert.equal(rel(2, 1), 'provider');      // 1 is a provider of 2
  assert.equal(rel(1, 2), 'customer');
  assert.equal(rel(3, 4), 'peer');
  assert.equal(rel(4, 3), 'peer');
  assert.equal(rel(1, 9), 'unknown');
});

await test('the kind of a place: a gap in an ASPA, a leak, or unclear, by what CAIDA says of the first AS after the ramp', () => {
  const rels = { 20: 'provider', 21: 'peer', 22: 'customer' };
  const asp = aspaMap([{ customer: 'AS10', providers: ['AS99'] }, { customer: 'AS40', providers: ['AS99'] }]);
  const l = new Leaks(asp, new Set(), (c, n) => rels[n] || 'unknown');
  l.add(1, 'rrc00', [50, 40, 30, 20, 10]);        // valley after AS10, first AS after the ramp is AS20: a provider of AS10 per CAIDA
  l.add(2, 'rrc00', [50, 40, 30, 21, 10]);        // AS21 is a peer: a leak by AS21
  l.add(3, 'rrc00', [50, 40, 30, 22, 10]);        // AS22 is a customer: a leak by AS22
  l.add(4, 'rrc00', [50, 40, 30, 23, 10]);        // nothing known about AS23
  const r = l.result();
  assert.deepEqual(r.kinds, { gap: 1, leak: 2, unclear: 1 });
  assert.deepEqual(r.leakers.map((x) => x.asn).sort(), ['AS21', 'AS22']);
  assert.deepEqual(r.gaps.map((x) => [x.customer, x.missing]), [['AS10', 'AS20']]);
  assert.equal(new Leaks(asp).result().places, 0);
});

await test('the by-AS index: valley members, the customer of a gap, few feeders and unclear places left out', () => {
  const g = (kind, from, between, feeders, routes = 1) => ({ kind, from, to: 'AS9', between, feeders, routes });
  const idx = byAs([g('leak', 'AS1', ['AS2', 'AS3'], 5, 10), g('gap', 'AS1', ['AS4'], 4), g('gap', 'AS7', ['AS2'], 2), g('unclear', 'AS8', ['AS5'], 9)]);
  assert.deepEqual(Object.keys(idx).sort(), ['AS1', 'AS2', 'AS3', 'AS4']);
  assert.deepEqual(idx.AS1.map((x) => [x.role, x.kind]), [['gap', 'gap']]);
  assert.deepEqual(idx.AS2.map((x) => x.role), ['valley']);
  assert.equal(byAs([g('leak', 'AS1', ['AS2'], 5), g('leak', 'AS1', ['AS2', 'AS6'], 6)], 3, 1).AS2.length, 1);
});

await test('the history keeps one row a day, in order, and a rerun replaces the day', () => {
  const doc = (invalid) => ({ total: { routes: 100, invalid, unknown: 40 }, places: 5, kinds: { leak: 2, gap: 3, unclear: 0 } });
  let rows = addHistory([], '2026-10-17', doc(7));
  rows = addHistory(rows, '2026-10-16', doc(6));
  rows = addHistory(rows, '2026-10-17', doc(8));
  assert.deepEqual(rows.map((r) => [r.date, r.invalid]), [['2026-10-16', 6], ['2026-10-17', 8]]);
  assert.equal(rows[1].leak, 2);
});

await test('the table dump of a collector: the latest, or the one of a day', () => {
  assert.equal(dumpUrl('rrc10'), 'https://data.ris.ripe.net/rrc10/latest-bview.gz');
  assert.equal(dumpUrl('rrc10', '20261010'), 'https://data.ris.ripe.net/rrc10/2026.10/bview.20261010.0000.gz');
  assert.equal(COLLECTORS.split(',').filter(isRis).length, 10);
  assert.equal(COLLECTORS.split(',').filter((c) => !isRis(c)).length, 8);
  assert.equal(dumpUrl('route-views2', '20261010'), 'https://archive.routeviews.org/bgpdata/2026.10/RIBS/rib.20261010.0000.bz2');
  assert.equal(dumpUrl('route-views.sg', '20261010'), 'https://archive.routeviews.org/route-views.sg/bgpdata/2026.10/RIBS/rib.20261010.0000.bz2');
  assert.equal(rvListing('route-views3', '2026.10'), 'https://archive.routeviews.org/route-views3/bgpdata/2026.10/RIBS/');
  assert.throws(() => dumpUrl('route-views2'));
});

await test('the newest RouteViews RIB of a listing', () => {
  const html = '<a href="rib.20261016.2200.bz2">x</a><a href="rib.20261017.0000.bz2">y</a><a href="rib.20261017.1400.bz2">z</a><a href="updates.20261017.1400.bz2">u</a>';
  assert.equal(pickLatestRib(html), 'rib.20261017.1400.bz2');
  assert.equal(pickLatestRib('<html>empty</html>'), null);
});

await test('the networks that feed the collectors are counted once, whichever collector they feed', () => {
  const l = new Leaks(new Map());
  l.add(500, 'rrc00', [50, 40]); l.add(500, 'route-views2', [50, 41]); l.add(501, 'rrc00', [51, 40]);
  const r = l.result();
  assert.equal(r.total.feeders, 2);
  assert.equal(r.total.routes, 3);
  assert.equal(addHistory([], '2026-10-17', { total: r.total, places: 0, kinds: { leak: 0, gap: 0, unclear: 0 } })[0].feeders, 2);
});

await test('each collector, and the same places seen by RIS, by RouteViews or by both', () => {
  const asp = aspaMap([{ customer: 'AS10', providers: ['AS99'] }, { customer: 'AS40', providers: ['AS99'] }]);
  const rel = (c, n) => (n === 21 ? 'peer' : 'unknown');
  const l = new Leaks(asp, new Set(), rel);
  const leak = (peer, collector, mid) => l.add(peer, collector, [50, 40, 30, mid, 10]);   // 10 -> mid -> 30 -> 40 -> 50: a valley
  leak(1, 'rrc00', 21); leak(2, 'rrc01', 21); leak(3, 'rrc00', 21);                       // the place of AS21: RIS
  leak(1, 'route-views2', 21); leak(4, 'route-views2', 21);                               // the same place: RouteViews too
  leak(5, 'route-views.sg', 23);                                                          // another place, RouteViews alone (unknown relation)
  l.add(6, 'rrc01', [99, 10]);                                                            // a valid route
  const r = l.result();
  const pc = r.per_collector;
  assert.deepEqual([pc.rrc00.source, pc['route-views2'].source], ['RIS', 'RouteViews']);
  assert.deepEqual([pc.rrc00.routes, pc.rrc00.invalid, pc.rrc00.feeders, pc.rrc00.places, pc.rrc00.only], [2, 2, 2, 1, 0]);
  assert.deepEqual([pc['route-views.sg'].places, pc['route-views.sg'].only], [1, 1]);
  assert.equal(pc.rrc01.routes, 2);
  assert.deepEqual([r.comparison.all.both, r.comparison.all.ris, r.comparison.all.rv], [1, 0, 1]);
  assert.deepEqual(r.comparison.all.kinds.leak, { both: 1, ris: 0, rv: 0 });
  assert.deepEqual(r.comparison.all.kinds.unclear, { both: 0, ris: 0, rv: 1 });
  assert.deepEqual(r.comparison.strong.both, 1);                                          // four feeders see the place of AS21
  assert.equal(r.comparison.strong.rv, 0);                                                // one feeder only: not strong
  assert.deepEqual(r.comparison.feeders, { ris: 4, rv: 3, both: 1 });                     // peers 1,2,3,6 at RIS, 1,4,5 at RouteViews: 1 is in both
});

console.log(`${passed} tests passed`);
