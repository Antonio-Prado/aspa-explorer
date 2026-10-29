// Unit tests for site/verify.js (no dependencies). Run with: node scripts/test-verify.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { verify, parsePath, compress, withoutAspa } = require('../site/verify.js');

const aspas = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

// Worked examples of Prado, Centenaro and Vangelista, "Securing Multi-domain 5G/6G Routing":
// AMF -> T1 -> Core -> T2 -> UDM, with complete ASPA information (oriented word +1,+1,-1,-1).
const complete = aspas({
  AS10: ['AS11'],            // AMF is a customer of T1
  AS11: ['AS12'],            // T1 is a customer of Core
  AS13: ['AS12'],            // T2 is a customer of Core
  AS14: ['AS13'],            // UDM is a customer of T2
  AS12: ['AS0'],             // Core has no provider
});

test('valid path: uphill, apex, downhill (downstream)', () => {
  const r = verify(complete, ['AS10', 'AS11', 'AS12', 'AS13', 'AS14'], 'down');
  assert.equal(r.result, 'Valid');
  assert.equal(r.N, 5);
  assert.equal(r.maxUp, 3); assert.equal(r.maxDown, 3);   // u+ = d+ = 3, as in the paper
});

test('route leak across a valley is Invalid (downstream)', () => {
  // P = (T1, MNO-A, T2): MNO-A is a customer of both, so the oriented word is (-1, +1)
  const leak = aspas({ AS30: ['AS20', 'AS21'], AS20: ['AS0'], AS21: ['AS0'] });
  const r = verify(leak, ['AS20', 'AS30', 'AS21'], 'down');
  assert.equal(r.result, 'Invalid');
  assert.equal(r.maxUp + r.maxDown, 2);                    // m(P) = 2 > 1 in the paper
});

test('purely uphill path from a customer is Valid (upstream)', () => {
  assert.equal(verify(complete, ['AS10', 'AS11', 'AS12'], 'up').result, 'Valid');
});

test('upstream: a hop attested as not a provider is Invalid', () => {
  const r = verify(complete, ['AS10', 'AS12', 'AS11'], 'up');   // AS10 does not list AS12
  assert.equal(r.result, 'Invalid');
  assert.equal(r.maxUp, 1);
});

test('upstream: a missing ASPA makes the verdict Unknown, not Invalid', () => {
  const partial = aspas({ AS10: ['AS11'] });                     // AS11 and AS12 publish nothing
  assert.equal(verify(partial, ['AS10', 'AS11', 'AS12'], 'up').result, 'Unknown');
});

test('downstream: one unattested hop at the apex is still Valid', () => {
  // whatever the relation between AS11 and AS12 (peer, up or down), the shape stays valid
  const partial = aspas({ AS10: ['AS11'] });
  assert.equal(verify(partial, ['AS10', 'AS11', 'AS12'], 'down').result, 'Valid');
});

test('downstream: missing ASPAs that leave a part of the path unexplained give Unknown', () => {
  const partial = aspas({ AS10: ['AS11'] });                     // nothing known about AS11, AS12, AS13
  const r = verify(partial, ['AS10', 'AS11', 'AS12', 'AS13'], 'down');
  assert.equal(r.result, 'Unknown');
  assert.equal(r.minUp + r.minDown < r.N, true);
});

test('a single AS is Valid', () => {
  assert.equal(verify(new Map(), ['AS1'], 'down').result, 'Valid');
  assert.equal(verify(new Map(), ['AS1'], 'up').result, 'Valid');
});

test('AS0 means no providers: the hop is attested as not a provider', () => {
  const noProviders = aspas({ AS1: ['AS0'] });
  assert.equal(verify(noProviders, ['AS1', 'AS2'], 'up').result, 'Invalid');
});

test('prepending is removed before verifying', () => {
  assert.deepEqual(compress(['AS1', 'AS1', 'AS2', 'AS2', 'AS2', 'AS3']), ['AS1', 'AS2', 'AS3']);
  const r = verify(complete, ['AS10', 'AS10', 'AS11', 'AS11', 'AS12'], 'up');
  assert.equal(r.N, 3);
  assert.equal(r.result, 'Valid');
});

test('apex with a peer-like hop is Valid (downstream)', () => {
  // two Tier-1s peering: origin -> T1a, T1a -- T1b (lateral), T1b -> customer. Neither lists the other.
  const peer = aspas({ AS1: ['AS2'], AS2: ['AS0'], AS3: ['AS0'], AS4: ['AS3'] });
  const r = verify(peer, ['AS1', 'AS2', 'AS3', 'AS4'], 'down');
  assert.equal(r.result, 'Valid');
});

test('two lateral hops in a row are Invalid (downstream)', () => {
  const lateral = aspas({ AS1: ['AS0'], AS2: ['AS0'], AS3: ['AS0'] });
  assert.equal(verify(lateral, ['AS1', 'AS2', 'AS3'], 'down').result, 'Invalid');
});

test('parsePath reads the path as routers print it (neighbour first) and returns origin first', () => {
  assert.deepEqual(parsePath('3356 1299 AS680').path, ['AS680', 'AS1299', 'AS3356']);
  assert.deepEqual(parsePath('as3356, 1299').path, ['AS1299', 'AS3356']);
});

test('parsePath rejects junk and flags AS_SETs', () => {
  assert.ok(parsePath('').error);
  assert.ok(parsePath('3356 abc').error);
  assert.ok(parsePath('3356 99999999999').error);
  assert.ok(parsePath('3356 -1').error);
  assert.ok(parsePath('0').error);                       // AS0 cannot be in an AS_PATH (RFC 7607)
  assert.ok(parsePath('AS0').error);
  assert.ok(parsePath('3356 0 680').error);
  assert.ok(parsePath('00').error);
  assert.equal(parsePath('3356 {1299,174} 680').asSet, true);
  assert.ok(!('path' in parsePath('<script>')));
});


// ---- site/history.js: events, replay and daily diff ----
const { stateOf, replay, replayBefore, diff, applyDay, classify } = require('../site/history.js');
const st = (obj) => new Map(Object.entries(obj));

test('stateOf merges the objects of one customer and sorts providers numerically', () => {
  const s = stateOf([{ customer: 'AS1', providers: ['AS10', 'AS2'] }, { customer: 'AS1', providers: ['AS2', 'AS3'] }, { customer: 'AS5', providers: ['AS0'] }]);
  assert.deepEqual(s.get('AS1'), ['AS2', 'AS3', 'AS10']);
  assert.deepEqual(s.get('AS5'), ['AS0']);
});

test('diff reports new, changed and removed ASPAs, and nothing when equal', () => {
  const prev = st({ AS1: ['AS2'], AS3: ['AS4'], AS9: ['AS8'] });
  const cur = st({ AS1: ['AS2'], AS3: ['AS4', 'AS5'], AS7: ['AS0'] });
  assert.deepEqual(diff(prev, cur, '2026-01-02'), [['2026-01-02', 'AS3', ['AS4', 'AS5']], ['2026-01-02', 'AS7', ['AS0']], ['2026-01-02', 'AS9', null]]);
  assert.deepEqual(diff(cur, cur, '2026-01-03'), []);
});

test('replay rebuilds the state of a day from the events', () => {
  const ev = [['2026-01-01', 'AS1', ['AS2']], ['2026-01-02', 'AS1', ['AS2', 'AS3']], ['2026-01-02', 'AS4', ['AS0']], ['2026-01-03', 'AS1', null]];
  assert.deepEqual([...replay(ev, '2026-01-01')], [['AS1', ['AS2']]]);
  assert.deepEqual([...replay(ev, '2026-01-02')], [['AS1', ['AS2', 'AS3']], ['AS4', ['AS0']]]);
  assert.deepEqual([...replay(ev)], [['AS4', ['AS0']]]);
});

test('replayBefore gives the state at the start of a day: the changes of that day are not in it', () => {
  const ev = [['2026-01-01', 'AS1', ['AS2']], ['2026-01-02', 'AS1', ['AS2', 'AS3']], ['2026-01-02', 'AS4', ['AS0']], ['2026-01-03', 'AS1', null]];
  assert.deepEqual([...replayBefore(ev, '2026-01-01')], []);
  assert.deepEqual([...replayBefore(ev, '2026-01-02')], [['AS1', ['AS2']]]);
  assert.deepEqual([...replayBefore(ev, '2026-01-03')], [...replay(ev, '2026-01-02')]);
  assert.deepEqual([...replayBefore(ev, '2026-01-05')], [...replay(ev)]);
});

test('applyDay is idempotent: a rerun on the same day replaces that day', () => {
  const ev = [['2026-01-01', 'AS1', ['AS2']]];
  const aspas = [{ customer: 'AS1', providers: ['AS2'] }, { customer: 'AS3', providers: ['AS4'] }];
  const once = applyDay(ev, aspas, '2026-01-02');
  const twice = applyDay(once, aspas, '2026-01-02');
  assert.deepEqual(once, [['2026-01-01', 'AS1', ['AS2']], ['2026-01-02', 'AS3', ['AS4']]]);
  assert.deepEqual(twice, once);
});

test('classify tells new, changed (with the providers added and dropped) and removed', () => {
  const ev = [['d1', 'AS1', ['AS2', 'AS3']], ['d2', 'AS1', ['AS3', 'AS4']], ['d3', 'AS1', null], ['d4', 'AS1', ['AS2']]];
  const k = classify(ev);
  assert.deepEqual(k.map((e) => e.kind), ['new', 'changed', 'removed', 'new']);
  assert.deepEqual([k[1].added, k[1].dropped], [['AS4'], ['AS2']]);
  assert.deepEqual(k[2].dropped, ['AS3', 'AS4']);
});

// ---- site/quality.js: quality checks on the ASPAs ----
const quality = require('../site/quality.js');
const A = (customer, providers, notAfter) => ({ customer, providers, source: notAfter ? [{ validity: { notAfter } }] : [] });
const kinds = (list) => list.map((f) => `${f.kind}:${f.customer}`).sort();
const NOW = Date.parse('2026-10-16T00:00:00Z');

test('quality: AS0 with other providers, self-listing and reserved providers are errors', () => {
  const f = quality.check([A('AS1', ['AS0', 'AS2']), A('AS3', ['AS3', 'AS4']), A('AS5', ['AS64512', 'AS6']), A('AS7', ['AS0'])], { now: NOW });
  assert.deepEqual(kinds(f), ['as0-mixed:AS1', 'reserved-provider:AS5', 'self-provider:AS3']);
  assert.ok(f.every((x) => x.severity === 'error'));
});

test('quality: mutual providers are reported on both ASPAs, one-way ones are not', () => {
  const f = quality.check([A('AS1', ['AS2']), A('AS2', ['AS1']), A('AS3', ['AS1'])], { now: NOW });
  assert.deepEqual(kinds(f), ['mutual:AS1', 'mutual:AS2']);
});

test('quality: BGP visibility checks run only when the unseen set is known', () => {
  const data = [A('AS1', ['AS2', 'AS9']), A('AS8', ['AS2'])];
  assert.deepEqual(kinds(quality.check(data, { now: NOW })), []);
  const f = quality.check(data, { now: NOW, unseen: new Set(['AS9', 'AS8']) });
  assert.deepEqual(kinds(f), ['customer-unseen:AS8', 'provider-unseen:AS1']);
});

test('quality: an ASPA that expires within the window, and a very large provider set', () => {
  const big = Array.from({ length: 30 }, (_, i) => `AS${100 + i}`);
  const f = quality.check([A('AS1', ['AS2'], '2026-10-20T00:00:00Z'), A('AS3', ['AS2'], '2027-10-20T00:00:00Z'), A('AS4', big)], { now: NOW });
  assert.deepEqual(kinds(f), ['expiring:AS1', 'large-set:AS4']);
  assert.match(f.find((x) => x.kind === 'expiring').detail, /expires in 4 days/);
});

test('withoutAspa: going up the ASPA of the neighbour is not read', () => {
  const a = aspas({ AS1: ['AS2'] });
  assert.deepEqual(withoutAspa(a, verify(a, ['AS1', 'AS2', 'AS3'], 'up')), ['AS2']);
  assert.deepEqual(withoutAspa(a, verify(a, ['AS1', 'AS2', 'AS3'], 'down')), ['AS2', 'AS3']);
});

test('quality: reserved ranges', () => {
  for (const as of ['AS23456', 'AS64496', 'AS64512', 'AS65535', 'AS65551', 'AS65552', 'AS131071', 'AS4200000000', 'AS4294967295']) assert.ok(quality.reserved(as), as);
  for (const as of ['AS1', 'AS3333', 'AS131072', 'AS4199999999']) assert.ok(!quality.reserved(as), as);
});

console.log(`\n${passed} tests passed`);
