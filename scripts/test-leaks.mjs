// Unit tests for scripts/mrt.mjs and scripts/build-leaks.mjs (no dependencies). Run with: node scripts/test-leaks.mjs
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readRib, readAsPath } from './mrt.mjs';
import { Leaks, aspaMap, relations } from './build-leaks.mjs';

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

console.log(`${passed} tests passed`);
