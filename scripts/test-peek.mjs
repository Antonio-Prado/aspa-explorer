// Unit tests for the pure part of site/peek.js (no dependencies). Run with: node scripts/test-peek.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { asnOfHref, summary } = createRequire(import.meta.url)('../site/peek.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the AS of a link: the page or the lookup of an AS, nothing else', () => {
  assert.equal(asnOfHref('#AS680'), 'AS680');
  assert.equal(asnOfHref('/as/AS3333'), 'AS3333');
  assert.equal(asnOfHref('/as/as3333/'), 'AS3333');
  for (const bad of ['', null, '#routes=AS680', '#path=1+2&from=up', '/api/v1/as/680', 'https://example.org/as/AS1', '#AS0', '#AS12345678901', '/as/AS1/x', '#changes']) assert.equal(asnOfHref(bad), null, String(bad));
});

test('what the window says: no ASPA', () => {
  const l = summary({ aspa: { published: false, providers: [] }, provider_of: [], seen_in_bgp: null, quality: [], history: [] });
  assert.deepEqual(l.map((x) => x.label), ['ASPA', 'Named as a provider', 'Seen in BGP']);
  assert.match(l[0].text, /Publishes no ASPA/);
  assert.equal(l[1].text, 'by no ASPA.');
  assert.equal(l[2].text, 'Not checked (it is checked for the ASes that an ASPA names).');
});

test('what the window says: an ASPA with providers, named by others, a change, findings', () => {
  const many = Array.from({ length: 15 }, (_, i) => `AS${100 + i}`);
  const l = summary({ aspa: { published: true, providers: ['AS1299', 'AS3356'], no_providers: false }, provider_of: many, seen_in_bgp: true,
    quality: [{ kind: 'provider-unallocated', severity: 'error', detail: 'names AS64999, which is not allocated' }, { kind: 'customer-unseen', severity: 'note', detail: 'is not seen in BGP' }, { kind: 'expires', severity: 'warning', detail: 'expires on 2026-11-20' }],
    history: [{ date: '2026-03-27', kind: 'new', added: ['AS1299'] }, { date: '2026-04-10', kind: 'changed', added: ['AS3356'], dropped: ['AS174'] }] });
  assert.equal(l[0].text, 'Publishes an ASPA with 2 providers:');
  assert.deepEqual(l[0].chips, ['AS1299', 'AS3356']);
  assert.equal(l[1].text, 'by 15 ASPAs, for instance:');
  assert.equal(l[1].chips.length, 12);
  assert.equal(l[1].more, 3);
  assert.match(l.find((x) => x.label === 'Seen in BGP').text, /^Yes/);
  assert.equal(l.find((x) => x.label === 'Quality').text, '3 findings on its ASPA: names AS64999, which is not allocated; is not seen in BGP…');
  assert.equal(l.find((x) => x.label === 'Last change').text, '2026-04-10: the providers changed, added AS3356, dropped AS174.');
});

test('what the window says: AS0, singular forms', () => {
  const l = summary({ aspa: { published: true, providers: ['AS0'], no_providers: true }, provider_of: ['AS5'], seen_in_bgp: false, quality: [], history: [{ date: '2026-01-01', kind: 'removed' }] });
  assert.match(l[0].text, /no transit providers \(AS0\)/);
  assert.equal(l[1].text, 'by 1 ASPA:');
  assert.match(l[2].text, /^No:/);
  assert.equal(l.find((x) => x.label === 'Quality').text, 'No finding on its ASPA.');
  assert.equal(l.find((x) => x.label === 'Last change').text, '2026-01-01: the ASPA was removed.');
});

console.log(`${passed} tests passed`);
