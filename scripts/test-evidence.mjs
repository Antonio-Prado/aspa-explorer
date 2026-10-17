// Unit tests for site/evidence.js (no dependencies). Run with: node scripts/test-evidence.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { analyse, clean, suggest } = createRequire(import.meta.url)('../site/evidence.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const opts = { clique: new Set([1, 2]), ixp: new Set([100]) };
const route = (path, source) => ({ path, source_id: source });
const many = (path, n, prefix = 'f') => Array.from({ length: n }, (_, i) => route(path, `${prefix}${i}`));

test('prepending and exchange points are dropped', () => {
  assert.deepEqual(clean([7, 5, 5, 100, 9, 9, 9], new Set([100])), [7, 5, 9]);
});

test('a neighbour that passes the route to a Tier-1 is a provider', () => {
  const nb = analyse([...many([1, 5, 9], 6), ...many([2, 5, 9], 2, 'g')], 9, opts);
  const e = nb.get(5);
  assert.equal(e.label, 'provider');
  assert.equal(e.feeders, 8);
  assert.equal(e.informative, 8);
});

test('a neighbour whose routes never go to a Tier-1 gets no evidence, however many paths', () => {
  const nb = analyse(many([7, 6, 9], 40), 9, opts);
  assert.equal(nb.get(6).label, 'none');
  assert.equal(nb.get(6).paths, 40);
});

test('paths of two ASes carry no information', () => {
  const nb = analyse([...many([5, 9], 30), ...many([7, 5, 9], 4)], 9, opts);
  const e = nb.get(5);
  assert.equal(e.short, 30);
  assert.equal(e.informative, 4);
  assert.equal(e.label, 'few');
});

test('a Tier-1 next to the origin is not a provider by position alone: it needs another Tier-1 on its left', () => {
  // AS1 is a Tier-1 next to the origin, seen only towards ordinary networks: a peer
  const peer = analyse(many([7, 1, 9], 10), 9, opts);
  assert.equal(peer.get(1).label, 'none');
  // and seen by another Tier-1 as well: it passes the route of its customer to a peer
  const prov = analyse([...many([2, 1, 9], 5), ...many([7, 1, 9], 5, 'g')], 9, opts);
  assert.equal(prov.get(1).label, 'provider');
});

test('weak evidence: a few feeders or a small share', () => {
  const few = analyse([...many([1, 5, 9], 2), ...many([7, 5, 9], 20, 'g')], 9, opts);
  assert.equal(few.get(5).label, 'weak');          // two feeders only
  const small = analyse([...many([1, 5, 9], 4), ...many([7, 5, 9], 100, 'g')], 9, opts);
  assert.equal(small.get(5).label, 'weak');        // four feeders but 4% of the paths
});

test('a Tier-1 on the left of the neighbour is not counted when it is the neighbour itself', () => {
  const nb = analyse(many([1, 1, 9], 10), 9, opts);   // prepending: the path is "1 9"
  assert.equal(nb.get(1).short, 10);
  assert.equal(nb.get(1).viaT1, 0);
});

test('routes that do not end at the origin, or are not paths, are ignored', () => {
  const nb = analyse([route([1, 5, 8], 'a'), { path: null }, route([9], 'b'), route([1, 5, 9], 'c')], 9, opts);
  assert.equal(nb.size, 1);
  assert.equal(nb.get(5).paths, 1);
});

test('a suggested ASPA: strong evidence added, declared providers kept, weak evidence only a lead', () => {
  const ev = new Map([[5, { label: 'provider' }], [6, { label: 'provider' }], [7, { label: 'weak' }], [8, { label: 'none' }], [9, { label: 'few' }]]);
  const s = suggest(['AS5', 'AS7', 'AS12'], ev);
  assert.deepEqual(s, { keep: ['AS5', 'AS7'], keepUnseen: ['AS12'], add: ['AS6'], check: [], zero: false, list: ['AS5', 'AS6', 'AS7', 'AS12'] });
  assert.deepEqual(suggest(null, ev).add, ['AS5', 'AS6']);
  assert.deepEqual(suggest(null, ev).check, ['AS7']);
  assert.equal(suggest(['AS0'], ev).zero, true);
  assert.deepEqual(suggest(['AS0'], new Map()).list, []);
});

console.log(`${passed} tests passed`);
