// The incidents judged with the timeline of the ASPAs (scripts/build-incidents.mjs, byTimeline). Run with: node scripts/test-incidents-timeline.mjs
import assert from 'node:assert/strict';
import { TAS, Timeline } from './aspa-timeline.mjs';
import { extend } from './build-timeline.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };
const T = (iso) => Date.parse(iso) / 1000;
const row = (day, hhmm = '04:30') => Object.fromEntries(TAS.map((ta, i) => [ta, T(`${day}T${hhmm}:00Z`) + i * 60]));
const EV = [
  ['2026-10-10', 'AS10', ['AS1']],
  ['2026-10-12', 'AS10', ['AS1', 'AS2']],
  ['2026-10-12', 'AS11', ['AS1']],
  ['2026-10-15', 'AS11', null],
];
const TIMES = { '2026-10-09': row('2026-10-09'), '2026-10-10': row('2026-10-10'), '2026-10-11': { ...row('2026-10-11'), apnic: null }, '2026-10-12': row('2026-10-12', '05:40'), '2026-10-13': row('2026-10-13'), '2026-10-14': row('2026-10-14'), '2026-10-15': row('2026-10-15') };
const commit = (sha, iso, events) => ({ sha, time: T(iso), events: async () => events });

await test('incidents: the verdict with the ASPAs known when each began, soft when an ASPA of its paths changed around it or while it lasted', async () => {
  const { analyse, relationSets, byTimeline } = await import('./build-incidents.mjs');
  // AS10 lists AS1 from the 10th and AS2 from the 12th (seen at 05:44); the path 10 -> 2 -> 30, with AS30 that lists nobody
  const ev = [...EV, ['2026-10-10', 'AS30', ['AS0']]];
  const { doc } = await extend(null, [{ ...commit('c', '2026-10-16T20:30:00Z', [...ev, ['2026-10-16', 'AS12', ['AS1']]]), parent: null }], TIMES);
  const tl = new Timeline(doc);
  const leak = (start, end = start) => ({ incident_type: 'RLK', actor_key: 'RLK_10_2_30', start, end, end_reason: 'timeout', details: { from: 10, by: 2, to: 30, path: [30, 2, 10] }, messages: [] });
  const { providers, degree } = relationSets('');
  const detail = [], by = byTimeline(tl);
  const res = analyse([
    leak('2026-10-11 12:00:00'),                          // AS2 not listed yet, but the step that adds it is open: invalid, soft
    leak('2026-10-12 05:00:00'),                          // forty minutes before the step is seen: still invalid, soft
    leak('2026-10-12 06:00:00'),                          // after it: valid (AS2 has no ASPA, nothing says it is not above AS30), firm
    leak('2026-10-10 12:00:00', '2026-10-10 12:05:00'),   // the look before the step is the 10th at 04:00: open here too
    leak('2026-10-09 12:00:00'),                          // before any ASPA is seen, but within the day before the first step: unknown, soft
    leak('2026-10-08 12:00:00'),                          // earlier than that: unknown, firm
    leak('2026-10-16 21:00:00'),                          // after the newest record of the ASPAs: valid, not firm yet, and not among the soft
  ], by, providers, degree, detail);
  assert.deepEqual(detail.map((r) => [r.real, r.firm, r.or]), [['invalid', false, ['valid']], ['invalid', false, ['valid']], ['valid', undefined, undefined], ['invalid', false, ['valid']], ['unknown', false, ['invalid']], ['unknown', undefined, undefined], ['valid', false, undefined]]);
  assert.deepEqual(detail.map((r) => r.late), [undefined, undefined, undefined, undefined, undefined, undefined, true]);
  assert.equal(by.late, 1);
  assert.deepEqual(res.total.real, [2, 2, 3]);
  assert.deepEqual(res.total.soft, [0, 1, 3]);
  assert.deepEqual(res.total.could, [3, 0, 1]);        // three that could be valid, one that could be invalid
});

await test('valleys of a day of the past: the routes whose verdict depends on an open change are soft, and a place with no firm route is counted', async () => {
  const { Leaks, addHistory } = await import('./build-leaks.mjs');
  const S = (o) => new Map(Object.entries(o).map(([c, p]) => [Number(c), new Set(p)]));
  // known at 00:00: AS10 lists AS1 only, AS30 and AS31 list nobody; the open change adds AS2 to AS10
  const known = S({ 10: [1], 30: [0], 31: [0], 40: [1] }), after = S({ 10: [1, 2], 30: [0], 31: [0], 40: [1] });
  const l = new Leaks(known, new Set(), () => 'unknown', { states: [after], delta: new Set([10]) });
  l.add(30, 'rrc00', [30, 2, 10], 24, false);          // invalid now, not with AS2 listed: soft
  l.add(31, 'rrc00', [31, 2, 10], 24, false);          // the same through another feeder: another place, soft
  l.add(30, 'rrc00', [30, 3, 40], 24, false);          // AS40 is not touched by the change: invalid, firm
  l.add(30, 'rrc00', [30, 1, 10], 24, false);          // touched, but the verdict is the same
  const r = l.result();
  assert.equal(r.total.invalid, 3);
  assert.deepEqual(r.total.soft, { valid: 0, unknown: 0, invalid: 2 });
  assert.deepEqual(r.total.could, { valid: 2, unknown: 0, invalid: 0 });
  assert.equal(r.places, 3);
  assert.deepEqual(r.soft_places, { gap: 0, leak: 0, unclear: 2 });
  const row = addHistory([], '2026-10-06', r)[0];
  assert.deepEqual([row.rule, row.invalid, row.invalid_soft, row.invalid_could, row.unclear, row.unclear_soft], [2, 3, 2, 0, 3, 2]);
  // today's valleys have no open state, and none of the new fields
  const now = new Leaks(known, new Set(), () => 'unknown');
  now.add(30, 'rrc00', [30, 2, 10], 24, false);
  const rn = now.result();
  assert.equal(rn.total.soft, undefined);
  assert.equal(addHistory([], '2026-11-25', rn)[0].rule, undefined);
});

console.log(`${passed} tests passed`);
