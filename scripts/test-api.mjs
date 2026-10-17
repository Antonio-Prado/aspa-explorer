// Unit tests for scripts/build-api.mjs (no dependencies). Run with: node scripts/test-api.mjs
import assert from 'node:assert/strict';
import { makeContext, describe, badge, badgeFor, feed, subjects } from './build-api.mjs';

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
  assert.match(badgeFor(describe('AS40', ctx)), /no providers \(AS0\)/);
  assert.match(badgeFor(describe('AS50', ctx)), /with errors/);
  assert.match(badgeFor(describe('AS30', ctx)), />none</);
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

console.log(`${passed} tests passed`);
