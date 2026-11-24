// Unit tests for site/ask-aspa.js (no dependencies). Run with: node scripts/test-ask-aspa.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Ask = createRequire(import.meta.url)('../site/ask-aspa.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

const net = (pocs, name = 'Example Net') => ({ data: [{ name, poc_set: pocs }] });

test('the contact: NOC first, then technical, then policy; abuse and sales never', () => {
  const pocs = [
    { role: 'Abuse', email: 'abuse@example.net' },
    { role: 'Technical', email: 'tech@example.net' },
    { role: 'NOC', email: ' noc@example.net ' },
    { role: 'Sales', email: 'sales@example.net' },
  ];
  assert.deepEqual(Ask.pickContact(net(pocs)), { email: 'noc@example.net', role: 'NOC', network: 'Example Net' });
  assert.equal(Ask.pickContact(net(pocs.filter((p) => p.role !== 'NOC'))).email, 'tech@example.net');
  assert.equal(Ask.pickContact(net([{ role: 'Policy', email: 'peering@example.net' }])).role, 'Policy');
  assert.equal(Ask.pickContact(net([{ role: 'Abuse', email: 'abuse@example.net' }, { role: 'Sales', email: 's@example.net' }])), null);
});

test('no contact: no network, no list, an empty or malformed address', () => {
  assert.equal(Ask.pickContact({ data: [] }), null);
  assert.equal(Ask.pickContact(null), null);
  assert.equal(Ask.pickContact(net(undefined)), null);
  assert.equal(Ask.pickContact(net([{ role: 'NOC', email: '' }])), null);
  assert.equal(Ask.pickContact(net([{ role: 'NOC', email: 'noc@example.net\r\nBcc: x@evil.example' }])), null, 'a header injection is not an address');
  assert.equal(Ask.pickContact(net([{ role: 'NOC', email: 'not an address' }, { role: 'Technical', email: 'tech@example.net' }])).email, 'tech@example.net');
});

test('the mailto: address: the recipient, the subject and the approved text, encoded', () => {
  const link = Ask.mailto('noc@example.net', 'AS64500');
  assert.ok(link.startsWith('mailto:noc@example.net?subject='));
  const q = new URLSearchParams(link.slice(link.indexOf('?') + 1));
  assert.equal(q.get('subject'), 'An ASPA for AS64500?');
  const text = q.get('body');
  assert.ok(text.startsWith('Hello,\n\nI looked up AS64500 on ASPA Explorer'));
  assert.ok(text.includes('https://aspa.ping6.it/as/AS64500'));
  assert.ok(text.includes('https://aspa.ping6.it/examples.html'));
  assert.ok(text.endsWith('Best regards,\n'));
  assert.ok(!link.includes(' ') && !link.includes('\n'), 'nothing left unencoded');
});

test('no mailto: for an address or an AS that is not one', () => {
  assert.equal(Ask.mailto('noc@example.net?cc=x@evil.example', 'AS64500'), null);
  assert.equal(Ask.mailto('noc@example.net', '64500'), null);
  assert.equal(Ask.mailto('noc@example.net', 'AS64500&body=x'), null);
  assert.equal(Ask.mailto(null, 'AS64500'), null);
});

console.log(`\n${passed} tests passed`);
