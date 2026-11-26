// Unit tests for scripts/aspa-timeline.mjs and scripts/build-timeline.mjs (no dependencies, no network).
// Run with: node scripts/test-timeline.mjs
import assert from 'node:assert/strict';
import { VERSION, FETCH_MARGIN, TAS, replayEvents, diffStates, archiveTime, archiveSteps, commitStep, validate, Timeline } from './aspa-timeline.mjs';
import { extend, apiCommits } from './build-timeline.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };
const T = (iso) => Date.parse(iso) / 1000;
const row = (day, hhmm = '04:30') => Object.fromEntries(TAS.map((ta, i) => [ta, T(`${day}T${hhmm}:00Z`) + i * 60]));

await test('states: replay and diff, providers sorted as numbers, a removal is null', () => {
  const ev = [['2026-10-01', 'AS10', ['AS200', 'AS3']], ['2026-10-02', 'AS11', ['AS5']], ['2026-10-03', 'AS10', null]];
  assert.deepEqual([...replayEvents(ev, '2026-10-02')], [[10, [3, 200]], [11, [5]]]);
  assert.deepEqual([...replayEvents(ev)], [[11, [5]]]);
  assert.deepEqual(diffStates(replayEvents(ev, '2026-10-01'), replayEvents(ev)), [[10, null], [11, [5]]]);
  assert.deepEqual(diffStates(new Map([[1, [2, 3]]]), new Map([[1, [2, 3]]])), []);
});

await test('archive times: the latest and the earliest of the five files, at whatever hour; a missing file is no day; a time of another day is an error', () => {
  const t = archiveTime('2026-10-01', row('2026-10-01'));
  assert.deepEqual(t, { seen: T('2026-10-01T04:34:00Z'), first: T('2026-10-01T04:30:00Z') });
  assert.equal(archiveTime('2026-10-01', { ...row('2026-10-01'), arin: null }), null);
  assert.equal(archiveTime('2026-10-01', undefined), null);
  // a day whose files were generated late (13 January 2024: 12:36), and one past midnight (6 December 2025: 00:24 of the 7th)
  assert.equal(archiveTime('2024-01-13', row('2024-01-13', '12:30')).seen, T('2024-01-13T12:34:00Z'));
  assert.equal(archiveTime('2025-12-06', { ...row('2025-12-06', '23:40'), ripencc: T('2025-12-07T00:24:00Z') }).seen, T('2025-12-07T00:24:00Z'));
  assert.throws(() => archiveTime('2026-10-01', { ...row('2026-10-01'), arin: T('2026-10-03T12:00:00Z') }), /not within its day/);
  assert.throws(() => archiveTime('2026-10-01', { ...row('2026-10-01'), arin: T('2026-09-30T23:00:00Z') }), /not within its day/);
});

const EV = [
  ['2026-10-10', 'AS10', ['AS1']],
  ['2026-10-12', 'AS10', ['AS1', 'AS2']],          // nothing on the 11th, whose archive is missing
  ['2026-10-12', 'AS11', ['AS1']],
  ['2026-10-15', 'AS11', null],
];
const TIMES = { '2026-10-09': row('2026-10-09'), '2026-10-10': row('2026-10-10'), '2026-10-11': { ...row('2026-10-11'), apnic: null }, '2026-10-12': row('2026-10-12', '05:40'), '2026-10-13': row('2026-10-13'), '2026-10-14': row('2026-10-14'), '2026-10-15': row('2026-10-15') };

await test('archive steps: a step for each day with changes, from the day before that has an archive, less the margin', () => {
  const { steps, state } = archiveSteps(EV, TIMES);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0], [T('2026-10-09T04:30:00Z') - FETCH_MARGIN, T('2026-10-10T04:34:00Z'), [[10, [1]]]]);
  // the 11th has no archive: the look before the 12th is the one of the 10th
  assert.deepEqual(steps[1], [T('2026-10-10T04:30:00Z') - FETCH_MARGIN, T('2026-10-12T05:44:00Z'), [[10, [1, 2]], [11, [1]]]]);
  assert.deepEqual(steps[2][2], [[11, null]]);
  assert.deepEqual([...state], [[10, [1, 2]]]);
  assert.throws(() => archiveSteps([['2026-10-11', 'AS1', ['AS2']]], TIMES), /no complete archive/);
});

const JOB = [...EV, ['2026-10-16', 'AS12', ['AS1']], ['2026-10-17', 'AS10', ['AS1', 'AS2', 'AS3']]];
const commit = (sha, iso, events) => ({ sha, time: T(iso), events: async () => events });
// each commit the child of the one before it (the first one of `first`, the head of the document that is extended)
const chain = (cs, first = null) => cs.map((c, i) => ({ ...c, parent: i ? cs[i - 1].sha : first }));

await test('commits: the first look of the job is after the last archive, a commit with no change moves the look, the archive written again is not a look', async () => {
  const commits = [
    commit('a', '2026-10-16T19:00:00Z', null),                              // before the history had events
    commit('b', '2026-10-16T20:24:00Z', EV),                                // the archive itself
    commit('c', '2026-10-16T20:30:00Z', JOB.slice(0, 5)),
    commit('d', '2026-10-17T03:23:00Z', JOB.slice(0, 5)),                   // a look, nothing changed
    commit('e', '2026-10-17T04:23:00Z', JOB),
  ];
  const { doc, added } = await extend(null, chain(commits), TIMES);
  assert.equal(added, 4);
  assert.equal(doc.steps.length, 5);
  assert.deepEqual(doc.steps[3], [T('2026-10-15T04:30:00Z') - FETCH_MARGIN, T('2026-10-16T20:30:00Z'), [[12, [1]]]]);
  assert.deepEqual(doc.steps[4], [T('2026-10-17T03:23:00Z'), T('2026-10-17T04:23:00Z'), [[10, [1, 2, 3]]]]);
  assert.equal(doc.horizon, T('2026-10-17T04:23:00Z'));
  assert.deepEqual(doc.head, { sha: 'e', time: T('2026-10-17T04:23:00Z') });
  assert.equal(validate(doc, JOB, TIMES), true);
  // more commits later: the same document goes on
  const more = await extend(doc, chain([commit('f', '2026-10-17T05:23:00Z', [...JOB, ['2026-10-17', 'AS13', ['AS9']]])], 'e'), TIMES);
  assert.equal(more.doc.steps.length, 6);
  assert.deepEqual(more.doc.steps[5], [T('2026-10-17T04:23:00Z'), T('2026-10-17T05:23:00Z'), [[13, [9]]]]);
});

await test('what must never pass: archive events that changed, time going back, a document that does not give the events back', async () => {
  const { doc } = await extend(null, chain([commit('c', '2026-10-16T20:30:00Z', JOB.slice(0, 5))]), TIMES);
  const forged = [['2026-10-10', 'AS10', ['AS9']], ...JOB.slice(1)];
  await assert.rejects(extend(structuredClone(doc), chain([commit('x', '2026-10-17T04:23:00Z', forged)], 'c'), TIMES), /archive period are not the ones/);
  await assert.rejects(extend(structuredClone(doc), chain([commit('x', '2026-10-16T20:00:00Z', JOB)], 'c'), TIMES), /not after/);
  // a commit whose parent is not the one read before it: one was skipped, or the branch was written again
  await assert.rejects(extend(structuredClone(doc), chain([commit('x', '2026-10-17T04:23:00Z', JOB)], 'another'), TIMES), /its parent is another, not c/);
  await assert.rejects(extend(structuredClone(doc), [{ ...commit('x', '2026-10-17T04:23:00Z', JOB), parent: 'c' }, { ...commit('z', '2026-10-17T05:23:00Z', JOB), parent: 'y' }], TIMES), /its parent is y, not x/);
  const broken = structuredClone(doc); broken.steps[1][2] = [[10, [1, 7]]];
  assert.throws(() => validate(broken, JOB.slice(0, 5), TIMES), /differ for/);
  const unordered = structuredClone(doc); unordered.steps[2][0] = 0; unordered.steps[2][1] = unordered.steps[1][1];
  assert.throws(() => validate(unordered, JOB.slice(0, 5), TIMES), /not after the step before/);
  assert.throws(() => validate({ ...doc, version: VERSION + 1 }, JOB, TIMES), /version/);
  assert.throws(() => commitStep(new Map(), JOB, 10, 5, 'other'), /differ from the ones/);
});

await test('lookup: the state known at a time, and the verdict that is firm only when no change around the event matters', async () => {
  const { doc } = await extend(null, chain([commit('c', '2026-10-16T20:30:00Z', JOB.slice(0, 5)), commit('e', '2026-10-17T04:23:00Z', JOB), commit('g', '2026-10-17T09:23:00Z', JOB)]), TIMES);
  const tl = new Timeline(doc);
  assert.equal(tl.indexAt(T('2026-10-10T04:33:59Z')), 0);
  assert.equal(tl.indexAt(T('2026-10-10T04:34:00Z')), 1);
  assert.deepEqual([...tl.state(tl.indexAt(T('2026-10-12T05:00:00Z'))).get(10)], [1]);          // the step of the 12th is seen at 05:44
  assert.deepEqual([...tl.state(tl.indexAt(T('2026-10-12T06:00:00Z'))).get(10)], [1, 2]);
  // does AS10 list AS2? the verdict is 2 (invalid) when it does not
  const lists2 = (state) => ((state.get(10) || new Set()).has(2) ? 0 : 2);
  const on10 = (c) => c === 10, on99 = (c) => c === 99;
  // 11 October, noon: AS2 is not listed; the step that adds it runs from the 10th at 04:00 to the 12th at 05:44: not firm
  assert.deepEqual(tl.at(T('2026-10-11T12:00:00Z'), lists2, on10), { verdict: 2, firm: false, others: [0] });
  // the same event for a path that AS10 is not in: firm
  assert.deepEqual(tl.at(T('2026-10-11T12:00:00Z'), () => 1, on99), { verdict: 1, firm: true, others: [] });
  // 13 October: AS2 is listed, and the next step (the 15th) does not touch AS10
  assert.deepEqual(tl.at(T('2026-10-13T12:00:00Z'), lists2, on10), { verdict: 0, firm: true, others: [] });
  // a change of AS10 around the event that does not change the verdict (AS3 added on the 17th): firm
  assert.deepEqual(tl.at(T('2026-10-17T04:00:00Z'), lists2, on10), { verdict: 0, firm: true, others: [] });
  // later than the last commit read: not firm yet
  assert.deepEqual(tl.at(T('2026-10-17T10:00:00Z'), lists2, on10), { verdict: 0, firm: false, others: [], late: true });
  // an event that lasts: firm at its start (the 13th), not firm when it goes on until AS11 is removed (the 15th) and reads AS11
  const has11 = (state) => (state.has(11) ? 2 : 1);
  assert.deepEqual(tl.at(T('2026-10-13T12:00:00Z'), has11, (c) => c === 11), { verdict: 2, firm: true, others: [] });
  assert.deepEqual(tl.at(T('2026-10-13T12:00:00Z'), has11, (c) => c === 11, T('2026-10-15T12:00:00Z')), { verdict: 2, firm: false, others: [1] });
  assert.equal(tl.open(T('2026-10-11T12:00:00Z')), 1);
  assert.equal(tl.open(T('2026-10-13T12:00:00Z')), 0);
});

await test('the API source: pages of commits newest first, read until one that is not new, given back oldest first with parent and events', async () => {
  const id = (i) => String(i).padStart(40, '0');
  // 150 commits at times 2000, 1999, ...: a page of 100 and one of 50
  const all = Array.from({ length: 150 }, (_, i) => ({ id: id(i), committed_date: new Date((2000 - i) * 1000).toISOString(), parent_ids: i < 149 ? [id(i + 1)] : [] }));
  const asked = [];
  const get = async (url) => { asked.push(url); const m = /page=(\d+)$/.exec(url); return m ? all.slice((m[1] - 1) * 100, m[1] * 100) : [['2026-10-16', 'AS1', ['AS2']]]; };
  const list = await apiCommits('https://x/api', 0, get);
  assert.equal(list.length, 150);
  assert.deepEqual([list[0].time, list[0].parent, list[149].time, list[149].parent], [1851, null, 2000, id(1)]);
  assert.deepEqual(await list[0].events(), [['2026-10-16', 'AS1', ['AS2']]]);
  // only the commits after a time: the reading stops at the first one that is not, without asking the next page
  asked.length = 0;
  const some = await apiCommits('https://x/api', 1995, get);
  assert.deepEqual(some.map((c) => c.time), [1996, 1997, 1998, 1999, 2000]);
  assert.equal(asked.length, 1);
  assert.ok(!asked[0].includes('since'));
  await assert.rejects(apiCommits('https://x/api', 0, async () => [{ id: 'short', committed_date: 'x' }]), /without a hash/);
});

console.log(`${passed} tests passed`);
