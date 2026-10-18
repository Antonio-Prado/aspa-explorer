// Unit tests for the status history: the recorder (scripts/build-status.mjs) and the helpers of site/status-history.js.
// No dependencies. Run with: node scripts/test-status-history.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { addSample, remap, KEEP_DAYS } from './build-status.mjs';

const { cellsOf, uptime, problems, fmtPct } = createRequire(import.meta.url)('../site/status-history.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const checks = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const T0 = 1_800_000_000;

test('a sample is added in order, and the one of the same minute is replaced', () => {
  let d = addSample(null, T0, 'oo', checks);
  d = addSample(d, T0 + 900, 'ol', checks);
  d = addSample(d, T0 + 910, 'od', checks);
  assert.deepEqual(d.samples.map(([t]) => t), [T0, T0 + 910]);
  assert.equal(d.samples.length, 2);
  assert.equal(d.samples[1][1], 'od');
});

test('samples older than the limit are dropped', () => {
  let d = addSample(null, T0, 'oo', checks);
  d = addSample(d, T0 + KEEP_DAYS * 86400 + 900, 'oo', checks, T0 + KEEP_DAYS * 86400 + 900);
  assert.equal(d.samples.length, 1);
});

test('a new list of checks keeps the old letters by id and marks the new part as not checked', () => {
  const doc = { checks: [{ id: 'a' }, { id: 'b' }], samples: [[T0, 'ol']] };
  assert.deepEqual(remap(doc, [{ id: 'b' }, { id: 'c' }, { id: 'a' }]), [[T0, 'l-o']]);
  assert.equal(remap(doc, [{ id: 'a' }, { id: 'b' }]), doc.samples);
});

test('the cells take the worst state in their stretch, empty ones stay empty', () => {
  const s = [[0, 'o'], [10, 'o'], [20, 'l'], [25, 'd'], [60, 'o']];
  assert.deepEqual(cellsOf(s, 0, 0, 100, 4), ['l', 'd', 'o', '']);
  assert.deepEqual(cellsOf(s, 0, 0, 100, 2), ['d', 'o']);
  assert.deepEqual(cellsOf([[5, '-']], 0, 0, 10, 1), ['']);
});

test('uptime is the share of OK samples in the range', () => {
  const s = [[1, 'o'], [2, 'o'], [3, 'l'], [4, 'd'], [50, 'o'], [5, '-']];
  assert.deepEqual(uptime(s, 0, 0, 10), { pct: 50, samples: 4 });
  assert.deepEqual(uptime(s, 0, 100, 200), { pct: null, samples: 0 });
  assert.equal(fmtPct(100), '100%');
  assert.equal(fmtPct(99.5), '99.50%');
  assert.equal(fmtPct(87.456), '87.5%');
  assert.equal(fmtPct(null), 'no data');
});

test('problems are runs of consecutive samples in the same state; a gap or an OK ends a run', () => {
  const s = [[0, 'o'], [900, 'l'], [1800, 'l'], [2700, 'd'], [3600, 'o'], [4500, 'l'], [9000, 'l']];
  assert.deepEqual(problems(s, 0, 0, 10000, 900), [
    { state: 'l', from: 900, to: 2700 },
    { state: 'd', from: 2700, to: 3600 },
    { state: 'l', from: 4500, to: 5400 },
    { state: 'l', from: 9000, to: 9900 },
  ]);
});

console.log(`${passed} tests passed`);
