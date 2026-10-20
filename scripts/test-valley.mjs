// Unit tests for site/valley.js (no dependencies). Run with: node scripts/test-valley.mjs
// The cases are the valleys that AS41327 showed on 2026-10-20, with the ASPAs and the registry objects as they were that day (shortened).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verify, parsePath } = require('../site/verify.js');
const { roles } = require('../site/irr.js');
const { breakers, dominantUpstream, explain, words, hops, neighbourReading } = require('../site/valley.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const attrs = (...lines) => lines.map((l) => { const i = l.indexOf(': '); return { name: l.slice(0, i), value: l.slice(i + 2) }; });
const aspas = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]));
const run = (text, a, ctx, ixp) => { const v = verify(a, parsePath(text).path, 'down'); return { v, r: explain(v, a, ctx, ixp) }; };
const ctxOf = (irr, caida, observed) => ({ irr: new Map(irr), caida: caida || null, observed: new Map(observed || []) });

const FT = ['AS1299', 'AS2914', 'AS3223', 'AS3257', 'AS3356', 'AS3491', 'AS6453', 'AS6762'];

test('Connesi and Zayo: its own IRR says transit, adding it clears the path', () => {
  const a = aspas({ AS41327: FT, AS15605: ['AS3356', 'AS6762', 'AS12637', 'AS41327', 'AS56911'] });
  const connesi = roles(attrs('remarks: TRANSITS', 'remarks: -- Zayo --', 'mp-import: from AS6461 accept ANY', 'mp-export: to AS6461 announce AS15605:AS-CONNESI'));
  const { v, r } = run('15605 6461 41327', a, ctxOf([[15605, connesi]]));
  assert.equal(v.result, 'Invalid');
  assert.deepEqual(breakers(v).map((b) => [b.side, b.customer, b.provider]), [['up', 'AS41327', 'AS6461'], ['down', 'AS15605', 'AS6461']]);
  assert.equal(r.kind, 'gap');
  const w = words(r);
  assert.match(w.lead, /Probably a gap/);
  assert.deepEqual(w.ask, [{ as: 'AS15605', add: 'AS6461', clears: 'Valid' }]);
  assert.match(w.body, /With AS6461 in the ASPA of AS15605 this path would be Valid/);
});

test('with Zayo in the ASPA of Connesi the path is no longer a valley', () => {
  const a = aspas({ AS41327: FT, AS15605: ['AS3356', 'AS6461', 'AS6762', 'AS12637', 'AS41327', 'AS56911'] });
  assert.equal(verify(a, parsePath('15605 6461 41327').path, 'down').result, 'Valid');
});

test('RASCOM and Rostelecom: the provider says that RASCOM is its customer, CAIDA agrees', () => {
  const a = aspas({ AS41327: FT, AS3257: ['AS0'], AS20764: ['AS3356'] });
  const rascom = roles(attrs('import: from AS12389 accept ANY', 'export: to AS12389 announce AS20764:AS-RASCOM'));
  const rostelecom = roles(attrs('remarks: Transit', 'import: from AS3257 accept ANY', 'export: to AS20764 announce ANY'));
  const { v, r } = run('20764 12389 3257 41327', a, ctxOf([[20764, rascom], [12389, rostelecom]], { 20764: [12389] }));
  assert.equal(v.result, 'Invalid');
  assert.equal(r.kind, 'gap');
  const ask = words(r).ask;
  assert.deepEqual(ask.map((x) => [x.as, x.add]), [['AS20764', 'AS12389']]);
  // GTT to Rostelecom is the other breaker: Rostelecom declares GTT as its own provider, so it counts against, not for
  const up = r.breakers.find((b) => b.side === 'up');
  assert.equal(up.kind, 'none');
  assert.match(up.against[0].text, /the other way round/);
});

test('FNXTEC and Hurricane Electric: only the paths that RIPEstat sees say that it is its upstream', () => {
  const a = aspas({ AS41327: FT, AS60503: ['AS1031', 'AS3257', 'AS9002'] });
  const ft = roles(attrs('import: from AS6939 accept AS-HURRICANE', 'export: to AS6939 announce AS41327:AS-CUSTOMERS'));
  const left = [{ asn: 6939, type: 'left', power: 51449 }, { asn: 3257, type: 'left', power: 1928 }, { asn: 9498, type: 'uncertain', power: 5622 }];
  const { r } = run('60503 6939 41327', a, ctxOf([[41327, ft], [60503, null]], { 60503: [3257, 9002] }, [[60503, left]]));
  assert.equal(r.kind, 'maybe');
  const down = r.breakers.find((b) => b.side === 'down');
  assert.equal(down.kind, 'maybe');
  assert.match(down.forIt[0].text, /RIPEstat sees AS6939 right before AS60503 in 96% of the paths/);
  // the peer that FT declares is the reason why its ASPA is right to leave HE out: it counts against
  const up = r.breakers.find((b) => b.side === 'up');
  assert.equal(up.kind, 'none');
  assert.match(up.against[0].text, /sets of prefixes only/);
  assert.equal(words(r).ask[0].clears, 'Valid');
});

test('NetIX: an exchange-point AS in the valley and nothing else that explains it', () => {
  const a = aspas({ AS41327: FT, AS40994: ['AS174', 'AS1299'] });
  const ft = roles(attrs('remarks: IXP', 'import-via: AS57463 from AS-ANY accept ANY'));
  const { r } = run('40994 57463 41327', a, ctxOf([[41327, ft], [40994, null]], { 41327: [1299], 40994: [174] }), new Set([57463]));
  assert.equal(r.kind, 'ixp');
  assert.deepEqual(r.ixps, ['AS57463']);
  assert.match(words(r).body, /RFC 7947/);
});

test('Hopus: CAIDA says provider, the IRR object calls it an intermediary: possibly, with the objection said', () => {
  const a = aspas({ AS41327: FT, AS6830: ['AS1299'] });
  const ft = roles(attrs('remarks: IXP', 'import-via: AS44530 from AS-ANY accept ANY'));
  const { r } = run('6830 44530 41327', a, ctxOf([[41327, ft], [6830, null]], { 41327: [1299, 44530] }));
  assert.equal(r.kind, 'maybe');
  const w = words(r);
  assert.match(w.body, /CAIDA infers AS44530 as a provider of AS41327/);
  assert.match(w.body, /Against it: the IRR object of AS41327 describes AS44530 as an intermediary/);
});

test('nothing explains it: the words do not accuse and do not absolve', () => {
  const a = aspas({ AS10: ['AS11'], AS11: ['AS12'], AS14: ['AS15'] });
  const { v, r } = run('14 13 11 10', a, ctxOf([[11, roles(attrs('import: from AS99 accept ANY'))], [13, null], [14, null]], { 11: [12], 14: [15] }));
  assert.equal(v.result, 'Invalid');
  assert.equal(r.kind, 'none');
  const w = words(r);
  assert.match(w.lead, /Nothing read here explains/);
  assert.match(w.body, /a leak or a forged path/);
  assert.deepEqual(w.ask, []);
});

test('no registry answer and no CAIDA: not enough data', () => {
  const a = aspas({ AS41327: FT, AS60503: ['AS1031'] });
  const { r } = run('60503 6939 41327', a, ctxOf([]));
  assert.equal(r.kind, 'nodata');
  assert.match(words(r).lead, /Not enough data/);
});

test('dominantUpstream wants the first of the left neighbours with a quarter of them', () => {
  assert.equal(dominantUpstream([{ asn: 1, type: 'left', power: 10 }, { asn: 2, type: 'left', power: 90 }], 1), null);
  assert.equal(dominantUpstream([{ asn: 1, type: 'left', power: 30 }, { asn: 2, type: 'left', power: 10 }], 1).share, 0.75);
  assert.equal(dominantUpstream([{ asn: 1, type: 'right', power: 99 }], 1), null);
  assert.equal(dominantUpstream(null, 1), null);
});

test('hops: what each source says about each hop, in the order of the path from the origin', () => {
  const a = aspas({ AS41327: FT, AS15605: ['AS3356'] });
  const connesi = roles(attrs('remarks: Transit', 'import: from AS6461 accept ANY'));
  const v = verify(a, parsePath('15605 6461 41327').path, 'down');
  const h = hops(v, a, ctxOf([[15605, connesi]], { 15605: [6461] }));
  assert.equal(h.length, 2);
  assert.deepEqual([h[0].a, h[0].b], ['AS41327', 'AS6461']);
  assert.deepEqual(h[0].aspa, ['AS41327 does not list AS6461', 'AS6461 publishes no ASPA']);
  assert.equal(h[0].caida, 'no relation');
  assert.equal(h[1].caida, 'AS6461 is a provider of AS15605');
  assert.deepEqual(h[1].irr, ['IRR of AS15605 on AS6461: a transit provider']);
});

test('neighbours: an unlisted transit of the IRR object is probably a missing provider, a peer is not', () => {
  const ft = roles(attrs('remarks: Transit', 'import: from AS44530 accept ANY', 'remarks: Peering', 'import: from AS6939 accept AS-HE', 'export: to AS6939 announce AS41327:AS-CUSTOMERS'));
  const a = neighbourReading(false, 44530, ft, [44530], 'weak');
  assert.equal(a.kind, 'probably-missing');
  assert.deepEqual(a.sources, ['a transit provider in its IRR object', 'a provider for CAIDA']);
  const b = neighbourReading(false, 6939, ft, [1299], null);
  assert.equal(b.kind, 'other');
  assert.match(b.against[0], /sets of prefixes only/);
});

test('neighbours: only CAIDA or only the routes is "maybe", and an unlisted neighbour that nothing mentions says nothing', () => {
  assert.equal(neighbourReading(false, 7, undefined, [7], null).kind, 'maybe-missing');
  assert.equal(neighbourReading(false, 7, null, [1], 'provider').kind, 'maybe-missing');
  assert.equal(neighbourReading(false, 7, null, [1], 'weak').kind, 'none');
  assert.equal(neighbourReading(false, 7, undefined, null, null).kind, 'none');
});

test('neighbours: a listed one is confirmed by any source, and "only the ASPA" when the sources were asked and say nothing', () => {
  const r = roles(attrs('remarks: Transit', 'import: from AS3356 accept ANY'));
  assert.equal(neighbourReading(true, 3356, r, [], null).kind, 'agrees');
  assert.equal(neighbourReading(true, 3491, r, [], null).kind, 'aspa-only');
  assert.equal(neighbourReading(true, 3491, undefined, null, null).kind, 'none');
});

console.log(`${passed} tests passed`);
