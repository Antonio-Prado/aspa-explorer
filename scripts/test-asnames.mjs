// Unit tests for the pure parts of site/asnames.js (no dependencies). Run with: node scripts/test-asnames.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { asnOf, holderOf, tooltipText } = createRequire(import.meta.url)('../site/asnames.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the AS of a link: the lookup, the page of the AS, the home with a hash, an external page of the AS', () => {
  assert.equal(asnOf('#AS3333'), '3333');
  assert.equal(asnOf('/#AS3333'), '3333');
  assert.equal(asnOf('/as/AS41327'), '41327');
  assert.equal(asnOf('/as/AS41327/'), '41327');
  assert.equal(asnOf('https://stat.ripe.net/app/launchpad/AS3333'), '3333');
  assert.equal(asnOf('#as3333'), '3333');
});

test('the AS of a label or of data-asn, when the link says nothing', () => {
  assert.equal(asnOf(null, 'AS6939'), '6939');
  assert.equal(asnOf('#top', ' AS6939 '), '6939');
  assert.equal(asnOf(null, null, '174'), '174');
});

test('no AS: AS0, other links, other texts, numbers out of range', () => {
  assert.equal(asnOf('#AS0', 'AS0'), null);
  assert.equal(asnOf('/statistics.html', 'Statistics'), null);
  assert.equal(asnOf('#AS3333x', 'AS3333 and more'), null);
  assert.equal(asnOf('#AS12345678901'), null);
  assert.equal(asnOf(null, null, '0'), null);
});

test('the name in an answer of RIPEstat as-overview', () => {
  assert.equal(holderOf({ data: { holder: 'FIBERTELECOM-AS Fiber Telecom S.p.A.', resource: '41327' } }), 'FIBERTELECOM-AS Fiber Telecom S.p.A.');
  assert.equal(holderOf({ data: { holder: null } }), '');
  assert.equal(holderOf({ data: {} }), '');
  assert.equal(holderOf(null), '');
  assert.equal(holderOf({ data: { holder: 'x'.repeat(500) } }).length, 200);
});

test('the text of the tooltip, and none without a name', () => {
  assert.equal(tooltipText('41327', 'FIBERTELECOM-AS Fiber Telecom S.p.A.'), 'AS41327: FIBERTELECOM-AS Fiber Telecom S.p.A.');
  assert.equal(tooltipText('64496', ''), '');
});

test('the number is said once when the registry repeats it (ARIN), and only that number', () => {
  assert.equal(tooltipText('6453', 'AS6453 - TATA COMMUNICATIONS (AMERICA) INC'), 'AS6453: TATA COMMUNICATIONS (AMERICA) INC');
  assert.equal(tooltipText('6453', 'AS6453'), '');
  assert.equal(tooltipText('645', 'AS6453 - TATA'), 'AS645: AS6453 - TATA');
});

console.log(`${passed} tests passed`);
