// Unit tests for scripts/build-incidents-collectors.mjs (no dependencies). Run with: node scripts/test-incidents-collectors.mjs
import assert from 'node:assert/strict';
import { collectorsIndex } from './build-incidents-collectors.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const doc = (collector, days, extra = {}) => ({ generated: '2026-11-19T13:10:20Z', collector, days_expected: 1134, days: days.map((day) => ({ day, incidents: 10 })), periods: { all: { total: { incidents: 10 * days.length } } }, ...extra });

test('the list of the collectors: the one of the recorder first, the days each covers, bad files left out', () => {
  const index = collectorsIndex([
    { file: 'incidents-history-rrc18.json', doc: doc('rrc18', ['2023-10-12', '2026-10-31', '2024-05-01']) },
    { file: 'incidents-history.json', doc: doc('rrc00', ['2026-11-18', '2025-10-01']) },
    { file: 'incidents-history-rrc06.json', doc: doc('rrc06', ['2024-04-17']) },
    { file: 'incidents-history-rrc22.json', doc: doc('rrc22', []) },                         // no day read yet
    { file: 'incidents-history-rrc23.json', doc: doc('rrc10', ['2026-09-29']) },             // under the name of another collector
    { file: 'incidents-history-rrc01.json', doc: null },
    { file: 'incidents-history-rrc03.json', doc: doc('../x', ['2026-09-29']) },
    { file: 'incidents.json', doc: doc('rrc00', ['2026-11-18']) },                           // not a history
    { file: 'incidents-history-rrc18.json', doc: doc('rrc18', ['2026-01-01']) },             // the same collector twice: the first is kept
  ], new Date('2026-11-19T14:00:00.500Z'));
  assert.equal(index.generated, '2026-11-19T14:00:00Z');
  assert.deepEqual(index.collectors.map((c) => [c.id, c.main, c.history, c.days_covered, c.first, c.last, c.incidents]), [
    ['rrc00', true, '/api/v1/incidents-history.json', 2, '2025-10-01', '2026-11-18', 20],
    ['rrc06', false, '/api/v1/incidents-history-rrc06.json', 1, '2024-04-17', '2024-04-17', 10],
    ['rrc18', false, '/api/v1/incidents-history-rrc18.json', 3, '2023-10-12', '2026-10-31', 30],
  ]);
  assert.equal(index.collectors[0].days_expected, 1134);
  assert.deepEqual(collectorsIndex([]).collectors, []);
});

console.log(`${passed} tests passed`);
