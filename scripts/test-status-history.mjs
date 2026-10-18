// Unit tests for the status history: the recorder (scripts/build-status.mjs) and the helpers of site/status-history.js.
// No dependencies. Run with: node scripts/test-status-history.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { addSample, addMonths, remap, KEEP_DAYS } from './build-status.mjs';

const { cellsOf, uptime, problems, fmtPct, monthRows } = createRequire(import.meta.url)('../site/status-history.js');

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

test('the mark of assumed samples is kept', () => {
  const d = addSample({ checks, samples: [[T0, 'oo']], assumed: { from: T0 - 900, to: T0 } }, T0 + 900, 'oo', checks);
  assert.deepEqual(d.assumed, { from: T0 - 900, to: T0 });
  assert.equal(addSample(null, T0, 'oo', checks).assumed, undefined);
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

test('months: every sample is counted once, also when the history is read again, and a run twice in a minute counts once', () => {
  const day = Date.UTC(2026, 9, 31, 23, 0, 0) / 1000;               // 31 Oct 2026 23:00 UTC
  let d = addSample(null, day, 'oo', checks);
  d = addSample(d, day + 900, 'ol', checks);
  d = addSample(d, day + 1800, 'dd', checks);
  d = addSample(d, day + 3600, 'o-', checks);                       // 00:00 on 1 Nov
  let m = addMonths(null, d);
  assert.deepEqual(m.months['2026-10'], { samples: 3, parts: { a: [2, 0, 1], b: [1, 1, 1] } });
  assert.deepEqual(m.months['2026-11'], { samples: 1, parts: { a: [1, 0, 0] } });   // '-' is not a check
  const again = addMonths(m, d);
  assert.deepEqual(again.months, m.months);
  d = addSample(d, day + 4500, 'dl', checks);
  d = addSample(d, day + 4510, 'dl', checks);                       // the same slot: replaces the one before
  m = addMonths(m, d);
  assert.equal(m.months['2026-11'].samples, 2);
  assert.deepEqual(m.months['2026-11'].parts.a, [1, 0, 1]);
});

test('months: the history can forget the old samples, the months do not', () => {
  const t = Date.UTC(2026, 6, 15) / 1000;
  let m = addMonths(null, addSample(null, t, 'oo', checks));
  const later = t + 100 * 86400;
  m = addMonths(m, addSample(addSample(null, later, 'oo', checks), later + 900, 'oo', checks));   // a history that starts 100 days later
  assert.equal(m.months['2026-07'].samples, 1);
  assert.equal(Object.keys(m.months).length, 2);
});

test('month rows: shares, and the coverage against a full month, newest first', () => {
  const doc = { interval: 900, checks, months: { '2026-09': { samples: 2880, parts: { a: [2880, 0, 0], b: [2592, 144, 144] } }, '2026-10': { samples: 100, parts: { a: [100, 0, 0] } } } };
  const now = Date.UTC(2026, 9, 2) / 1000;                          // 1 day into October: 96 checks expected
  const rows = monthRows(doc, now);
  assert.deepEqual(rows.map((r) => r.key), ['2026-10', '2026-09']);
  assert.equal(rows[0].coverage, 100);                              // capped
  assert.equal(rows[0].parts.b.ok, null);                           // nothing for b this month
  assert.equal(rows[1].coverage, 100);                              // 30 days x 96 = 2880
  assert.equal(rows[1].parts.b.ok, 90);
  assert.equal(rows[1].parts.b.late, 5);
});

console.log(`${passed} tests passed`);
