// Unit tests for scripts/build-client-origin.mjs (no dependencies). Run with: node scripts/test-client-origin.mjs
import assert from 'node:assert/strict';
import { parse, geoLines, MIN_PEERS } from './build-client-origin.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('the origin seen by the most peers wins, and the weak, the default, the too short or long and the AS_SETs are left out', () => {
  const v4 = ['% comment', '', `3333\t193.0.0.0/21\t${MIN_PEERS + 300}`, `64512\t193.0.0.0/21\t${MIN_PEERS + 5}`, `174\t0.0.0.0/0\t300`,
    `1299\t10.0.0.0/8\t${MIN_PEERS - 1}`, `{40179}\t8.41.202.0/24\t319`, `13335\t1.0.0.0/25\t300`, `13335\t1.0.0.0/24\t300`, '\t\t', 'junk'].join('\n');
  const m = parse(v4, 4);
  assert.deepEqual([...m.keys()].sort(), ['1.0.0.0/24', '193.0.0.0/21']);
  assert.equal(m.get('193.0.0.0/21').as, 3333);
  const v6 = [`3333\t2001:67c:2e8::/48\t300`, `6939\t2000::/3\t300`, `6939\t2001:db8::/64\t300`].join('\n');
  assert.deepEqual([...parse(v6, 6).keys()], ['2001:67c:2e8::/48']);
});

test('the lines of the geo file are sorted and end with a semicolon', () => {
  const text = geoLines([new Map([['193.0.0.0/21', { as: 3333 }], ['1.0.0.0/24', { as: 13335 }]]), new Map([['2001:67c:2e8::/48', { as: 3333 }]])]);
  assert.equal(text, '1.0.0.0/24 13335;\n193.0.0.0/21 3333;\n2001:67c:2e8::/48 3333;\n');
});

console.log(`${passed} tests passed`);
