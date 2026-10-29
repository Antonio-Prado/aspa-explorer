// Unit tests for the layout of site/graph.js (no dependencies). Run with: node scripts/test-graph.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { layout, W, H } = createRequire(import.meta.url)('../site/graph.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const byId = (l, id) => l.nodes.find((n) => n.id === id);

test('providers above, customers below, the AS in the middle, arrows in the direction of the ASPA', () => {
  const l = layout({ as: 'AS680', providers: ['AS1299', 'AS3356'], customers: ['AS553', 'AS12816', 'AS29484'], observed: [] });
  assert.equal(l.nodes.length, 6);
  assert.ok(byId(l, 'AS1299').y < byId(l, 'AS680').y && byId(l, 'AS680').y < byId(l, 'AS553').y);
  assert.equal(l.width, W); assert.equal(l.height, H);
  assert.deepEqual(l.edges.find((e) => e.to === 'AS1299'), { from: 'AS680', to: 'AS1299', kind: 'provider' });     // customer -> provider
  assert.deepEqual(l.edges.find((e) => e.from === 'AS553'), { from: 'AS553', to: 'AS680', kind: 'customer' });
  assert.match(l.summary, /2 providers in its ASPA, named as a provider by 3 ASPAs/);
});

test('two ASes that list each other are one mutual node, not a provider and a customer', () => {
  const l = layout({ as: 'AS1', providers: ['AS2', 'AS3'], customers: ['AS2', 'AS4'], observed: [] });
  assert.deepEqual(l.mutual, ['AS2']);
  assert.equal(byId(l, 'AS2').kind, 'mutual');
  assert.equal(l.nodes.filter((n) => n.id === 'AS2').length, 1);
  assert.equal(l.edges.filter((e) => e.kind === 'mutual').length, 1);
});

test('long rows are cut with a "more" node', () => {
  const many = Array.from({ length: 15 }, (_, i) => `AS${100 + i}`);
  const l = layout({ as: 'AS1', providers: [], customers: many, observed: [] });
  assert.equal(l.nodes.filter((n) => n.kind === 'customer').length, 9);
  assert.equal(l.nodes.find((n) => n.kind === 'more').label, '+6 more');
});

test('long AS numbers: fewer boxes in the row, and none overlaps another', () => {
  const many = Array.from({ length: 17 }, (_, i) => `AS${131314 + i * 1111}`);
  const l = layout({ as: 'AS41327', providers: [], customers: many, observed: [] });
  const row = l.nodes.filter((n) => n.kind === 'customer' || n.kind === 'more').sort((a, b) => a.x - b.x);
  const drawn = row.filter((n) => n.kind === 'customer').length;
  assert.ok(drawn < 9 && drawn > 0);
  assert.equal(l.shown.customers, drawn);
  assert.equal(row[row.length - 1].label, `+${17 - drawn} more`);
  for (let i = 1; i < row.length; i++) assert.ok(row[i].x - row[i - 1].x >= (row[i].w + row[i - 1].w) / 2, `${row[i - 1].label} and ${row[i].label} overlap`);
  assert.ok(row[0].x - row[0].w / 2 >= 0 && row[row.length - 1].x + row[row.length - 1].w / 2 <= l.width);
});

test('neighbours seen in the routes and not in the ASPA go to the side, with their evidence', () => {
  const l = layout({ as: 'AS12779', providers: ['AS2914'], customers: [], observed: [
    { asn: 'AS60798', label: 'provider', paths: 1135 }, { asn: 'AS2914', label: 'provider', paths: 878 }, { asn: 'AS6939', label: 'none', paths: 529 }, { asn: 'AS3257', label: 'weak', paths: 5 }] });
  assert.equal(byId(l, 'AS60798').kind, 'seen-provider');
  assert.equal(byId(l, 'AS6939').kind, 'seen');
  assert.equal(byId(l, 'AS3257').kind, 'seen-weak');
  assert.equal(l.nodes.filter((n) => n.id === 'AS2914').length, 1);         // already listed: not drawn twice
  assert.match(l.summary, /3 other neighbours seen/);
});

test('an AS alone has just itself', () => {
  const l = layout({ as: 'AS9', providers: [], customers: [], observed: [] });
  assert.equal(l.nodes.length, 1);
  assert.equal(l.edges.length, 0);
});

console.log(`${passed} tests passed`);
