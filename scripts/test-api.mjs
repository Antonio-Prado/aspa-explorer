// Unit tests for scripts/build-api.mjs (no dependencies). Run with: node scripts/test-api.mjs
import assert from 'node:assert/strict';
import { makeContext, describe, badge, badgeFor, feed, subjects, aspaRows, toCsv, qualityDoc } from './build-api.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

const src = (end) => [{ tal: 'ripe', uri: 'rsync://x/y.asa', validity: { notBefore: '2026-01-01T00:00:00Z', notAfter: end } }];
const data = { aspas: [
  { customer: 'AS10', providers: ['AS20', 'AS30'], source: src('2027-01-01T00:00:00Z') },
  { customer: 'AS40', providers: ['AS0'], source: src('2027-01-01T00:00:00Z') },
  { customer: 'AS50', providers: ['AS0', 'AS20'], source: src('2027-01-01T00:00:00Z') },
] };
const events = [
  ['2025-01-01', 'AS10', ['AS20']],
  ['2025-06-01', 'AS10', ['AS20', 'AS30']],
  ['2025-07-01', 'AS60', ['AS30']],
  ['2025-08-01', 'AS60', null],
];
const ctx = makeContext(data, events, new Set(['AS30']), '2026-10-17T00:00:00Z');

test('an AS with an ASPA', () => {
  const d = describe('AS10', ctx);
  assert.equal(d.number, 10);
  assert.deepEqual(d.aspa.providers, ['AS20', 'AS30']);
  assert.equal(d.aspa.published, true);
  assert.deepEqual(d.history.map((e) => e.kind), ['new', 'changed']);
  assert.deepEqual(d.history[1].added, ['AS30']);
  assert.equal(d.seen_in_bgp, true);
  assert.equal(d.links.badge, 'https://aspa.ping6.it/badge/AS10.svg');
  assert.ok(d.quality.some((f) => f.kind === 'provider-unseen'));
});

test('a provider knows its customers and the changes that name it', () => {
  const d = describe('AS30', ctx);
  assert.deepEqual(d.provider_of, ['AS10']);
  assert.equal(d.aspa.published, false);
  assert.equal(d.seen_in_bgp, false);
  assert.deepEqual(d.named_as_provider_history.map((e) => [e.customer, e.action]), [['AS10', 'added'], ['AS60', 'added'], ['AS60', 'dropped']]);
});

test('an AS that no current ASPA names: whether it is seen in BGP is not known', () => {
  assert.equal(describe('AS60', ctx).seen_in_bgp, null);       // its ASPA was removed
});

test('AS0 is not a provider', () => {
  assert.deepEqual(describe('AS40', ctx).aspa.no_providers, true);
  assert.deepEqual(ctx.byProvider.has('AS0'), false);
  assert.ok(describe('AS50', ctx).quality.some((f) => f.kind === 'as0-mixed'));
});

test('every AS with something to say gets files, sorted by number', () => {
  assert.deepEqual(subjects(ctx), ['AS10', 'AS20', 'AS30', 'AS40', 'AS50', 'AS60']);
});

test('badges', () => {
  assert.match(badgeFor(describe('AS10', ctx)), /2 providers/);
  assert.match(badgeFor(describe('AS40', ctx)), /no transit providers \(AS0\)/);
  assert.match(badgeFor(describe('AS50', ctx)), /with errors/);
  assert.match(badgeFor(describe('AS30', ctx)), />not configured yet</);
  assert.match(badgeFor(describe('AS30', ctx)), />ASPA AS30</);       // the badge says which AS it is about
  assert.match(badge('a<b', 'x&y', '#000'), /a&lt;b/);
});

test('feed: newest first, own changes and changes that name the AS', () => {
  const xml = feed('AS30', describe('AS30', ctx), ctx);
  assert.match(xml, /<title>ASPA changes for AS30<\/title>/);
  const titles = [...xml.matchAll(/<entry>\s*<title>([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['AS60 no longer lists AS30 as a provider', 'AS60 now lists AS30 as a provider', 'AS10 now lists AS30 as a provider']);
  assert.match(xml, /<updated>2025-08-01T00:00:00Z<\/updated>/);
  const own = feed('AS10', describe('AS10', ctx), ctx);
  assert.match(own, /AS10: ASPA changed/);
  assert.match(own, /added AS30/);
});

test('feed of an AS with no history is a valid empty feed', () => {
  const empty = makeContext({ aspas: [] }, [], null, '2026-10-17T00:00:00Z');
  const xml = feed('AS77', describe('AS77', empty), empty);
  assert.doesNotMatch(xml, /<entry>/);
  assert.match(xml, /<updated>2026-10-17T00:00:00Z<\/updated>/);
});

test('the full list: one row per ASPA, as JSON rows and as CSV', () => {
  const rows = aspaRows(ctx);
  assert.deepEqual(rows.map((r) => r.customer), ['AS10', 'AS40', 'AS50']);
  assert.deepEqual(rows[0], { customer: 'AS10', providers: ['AS20', 'AS30'], rir: 'ripe', valid_from: '2026-01-01T00:00:00Z', valid_until: '2027-01-01T00:00:00Z' });
  const lines = toCsv(rows).trimEnd().split('\n');
  assert.equal(lines[0], 'customer,providers,rir,valid_from,valid_until');
  assert.equal(lines[1], 'AS10,AS20 AS30,ripe,2026-01-01T00:00:00Z,2027-01-01T00:00:00Z');
  assert.equal(lines.length, 4);
  assert.equal(toCsv([{ customer: 'AS1', providers: ['AS0'], rir: 'a,b"c', valid_from: null, valid_until: null }]).split('\n')[1], 'AS1,AS0,"a,b""c",,');
});

test('AS numbers that are not AS and digits are dropped before they become file names or markup', () => {
  const bad = makeContext({ aspas: [
    { customer: 'AS../../x', providers: ['AS1'], source: [] },
    { customer: 'AS7', providers: ['AS1', 'AS"><x', '../y'], source: [] },
  ] }, [['2026-10-01', 'AS../z', ['AS1']], ['2026-10-02', 'AS8', ['AS2', '<b>']], ['2026-10-03', 'AS9', 'nope']], null, '2026-10-17T00:00:00Z');
  assert.deepEqual(subjects(bad), ['AS1', 'AS2', 'AS7', 'AS8']);
  assert.deepEqual(bad.byCustomer.get('AS7').providers, ['AS1']);
});

test('the quality checks as one document: the kinds with their counts, every finding in the order of the page', () => {
  const q = qualityDoc(ctx);
  assert.equal(q.generated, ctx.generated);
  assert.equal(q.aspas, ctx.byCustomer.size);
  assert.equal(q.bgp_visibility, true);
  assert.equal(q.findings.length, Object.values(q.kinds).reduce((n, k) => n + k.count, 0));
  assert.equal(q.with_findings, new Set(q.findings.map((f) => f.customer)).size);
  assert.ok(q.kinds['as0-mixed'].count >= 1 && q.kinds['as0-mixed'].severity === 'error' && q.kinds['as0-mixed'].why);
  assert.deepEqual(Object.keys(q.findings[0]), ['customer', 'kind', 'severity', 'detail', 'providers']);
  const order = Object.keys(q.kinds);
  const ranks = q.findings.map((f) => order.indexOf(f.kind));
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
  // without the visibility the checks that need it are not there, and the document says so
  const blind = qualityDoc(makeContext(data, events, null, 'x'));
  assert.equal(blind.bgp_visibility, false);
  assert.equal(blind.kinds['provider-unseen'].count, 0);
});

console.log(`${passed} tests passed`);
