// Unit tests for scripts/build-incidents-history.mjs (needs xz, as the builder). Run with: node scripts/test-incidents-history.mjs
import assert from 'node:assert/strict';
import { sources, readDay, caidaFor, sum, buildFile, dayOfIncident, rowOf, periods, FIRST_DAY } from './build-incidents-history.mjs';
import { relationSets } from './build-incidents.mjs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

// 1 and 3 are providers of 2, 4 of 1, 1 of 100; 5 and 3 are peers
const REL = relationSets('1|2|-1|bgp\n3|2|-1|bgp\n4|1|-1|bgp\n1|100|-1|bgp\n5|3|0|bgp\n');
const inc = (type, start, extra) => ({ incident_type: type, actor_key: `${type}_x`, start, end: start, end_reason: 'timeout', ...extra });
const ann = (path) => ({ type: 'A', compressed_path: path });
const leak = (start) => inc('RLK', start, { details: { path: [3, 2, 1, 100], by: 2, to: 3, rlk_type: 'UL' }, messages: [ann([3, 2, 1, 100])] });
const epoch = (day) => Date.parse(`${day}T00:00:00Z`) / 1000;

const dir = await mkdtemp(join(tmpdir(), 'inc-history-'));
const xz = async (file, incidents) => {
  await writeFile(file.replace(/\.xz$/, ''), incidents.map((i) => JSON.stringify(i)).join('\n') + '\nnot json\n');
  execFileSync('xz', ['-f', file.replace(/\.xz$/, '')]);
};
const live = join(dir, 'live'), blk = join(dir, 'blk');
await mkdir(live);
await mkdir(join(blk, 'archive'), { recursive: true });
// the recorder: two files on 2026-10-05; the backfill: the last day of a block (2026-09-30) with its open incidents, a day
// that days.jsonl does not have yet, a warm-up day, and a day before the first day of ASPA
await xz(join(live, `incidents_records_${epoch('2026-10-05') + 4}.jsonl.xz`), [leak('2026-10-04 23:50:00'), inc('VOL', '2026-10-05 01:00:00')]);
await xz(join(live, `incidents_records_${epoch('2026-10-05') + 3600}.jsonl.xz`), [inc('PRH', '2026-10-05 02:00:00', { messages: [ann([4, 1, 100])] })]);
await xz(join(blk, 'archive', `incidents_records_${epoch('2026-09-30')}.jsonl.xz`), [leak('2026-08-31 22:00:00'), leak('2026-09-30 10:00:00')]);
await xz(join(blk, 'archive', `incidents_open_${epoch('2026-09-30')}.jsonl.xz`), [inc('VOL', '2026-09-29 10:00:00'), inc('VOL', '2026-08-30 10:00:00')]);
await xz(join(blk, 'archive', `incidents_records_${epoch('2026-09-29')}.jsonl.xz`), [inc('VOL', '2026-09-29 10:00:00')]);
await xz(join(blk, 'archive', `incidents_records_${epoch('2023-10-11')}.jsonl.xz`), [inc('VOL', '2023-10-11 10:00:00')]);
await writeFile(join(blk, 'days.jsonl'), [
  { day: '2026-08-31', block: '2026-09-01_2026-09-30', warmup: true },
  { day: '2026-09-30', block: '2026-09-01_2026-09-30', warmup: false },
  { day: '2023-10-11', block: '2023-10-01_2023-10-31', warmup: false },
].map((r) => JSON.stringify(r)).join('\n') + '\n{"day": "2026-0');

await test('the files: the recorder, and the backfill only when days.jsonl has the day, with the first day of the block', async () => {
  const s = await sources([live], [blk, join(dir, 'missing')]);
  assert.deepEqual(s.map((x) => `${x.day} ${x.name.slice(10, 14)} ${x.since}`), ['2023-10-11 reco 2023-10-01', '2026-09-30 open 2026-09-01', '2026-09-30 reco 2026-09-01', '2026-10-05 reco null', '2026-10-05 reco null']);
  assert.ok(FIRST_DAY > '2023-10-11');
});

await test('a backfill file leaves out what began before its block, the recorder leaves out nothing', async () => {
  const s = await sources([live], [blk]);
  const got = async (day, only) => { const out = []; for await (const i of readDay(s.filter((x) => x.day === day), only)) out.push(`${i.incident_type} ${i.start.slice(0, 10)}`); return out.sort(); };
  assert.deepEqual(await got('2026-09-30'), ['RLK 2026-09-30', 'VOL 2026-09-29']);
  assert.deepEqual(await got('2026-10-05'), ['PRH 2026-10-05', 'RLK 2026-10-04', 'VOL 2026-10-05']);
  assert.deepEqual(await got('2026-10-05', /"RLK"/), ['RLK 2026-10-04']);
});

await test('with a first day, the recorder leaves out what ended before it', async () => {
  const s = await sources([live], [blk], '2026-10-05');
  assert.deepEqual(s.map((x) => x.from || null), [null, null, null, '2026-10-05', '2026-10-05'], 'only the files of the recorder');
  const out = [];
  for await (const i of readDay(s.filter((x) => x.day === '2026-10-05'))) out.push(`${i.incident_type} ${i.start.slice(0, 10)}`);
  assert.deepEqual(out.sort(), ['PRH 2026-10-05', 'VOL 2026-10-05']);
});

await test('the day of an incident is the day it ended, then the day it began, then the day of the file', () => {
  assert.equal(dayOfIncident({ start: '2026-10-04 23:50:00', end: '2026-10-05 00:10:00' }, 'x'), '2026-10-05');
  assert.equal(dayOfIncident({ start: '2026-10-04 23:50:00', end: null }, 'x'), '2026-10-04');
  assert.equal(dayOfIncident({}, '2026-10-06'), '2026-10-06');
});

await test('the relationships of a day: the newest file that is not of a later month, the oldest when there is none', () => {
  const files = [{ date: '20260801' }, { date: '20260901' }, { date: '20261101' }];
  assert.equal(caidaFor(files, '2026-09-30').date, '20260901');
  assert.equal(caidaFor(files, '2026-10-05').date, '20260901');
  assert.equal(caidaFor(files, '2026-12-01').date, '20261101');
  assert.equal(caidaFor(files, '2024-01-01').date, '20260801');
});

let day1, day2;
await test('a file: counts and verdicts for each day its incidents ended, and their detail', async () => {
  const s = await sources([live], [blk]);
  const asked = [];
  const aspasOf = (d) => { asked.push(d); return new Map([[100, new Set([1])], [1, new Set([4])], [2, new Set([1])], [3, new Set()]]); };      // 3 is no provider of 2, and has none
  const parts = join(dir, 'parts');
  const first = s.filter((x) => x.day === '2026-10-05')[0];
  const days = await buildFile(first, aspasOf, REL, parts);
  assert.deepEqual([...days.keys()].sort(), ['2026-10-04', '2026-10-05'], 'the file of the 5th has an incident that ended on the 4th');
  day1 = days.get('2026-10-04');
  assert.equal(day1.total.incidents, 1);
  assert.deepEqual(day1.by_type.RLK.real, [0, 0, 1]);
  assert.deepEqual(day1.by_type.RLK.ideal, [0, 0, 1]);
  assert.equal(day1.subtypes['RLK-UL'].incidents, 1);
  assert.equal(days.get('2026-10-05').by_type.VOL.incidents, 1);
  assert.ok(asked.includes('2026-10-04'));
  assert.deepEqual((await readdir(parts)).sort(), ['2026-10-04.jsonl.gz', '2026-10-05.jsonl.gz']);
  const rows = gunzipSync(await readFile(join(parts, '2026-10-04.jsonl.gz'))).toString().trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows, [{ type: 'RLK', subtype: 'RLK-UL', actor: 'RLK_x', start: '2026-10-04 23:50:00', end: '2026-10-04 23:50:00', end_reason: 'timeout', paths: 1, real: 'invalid', complete: 'invalid' }]);
  const block = await buildFile(s.find((x) => x.day === '2026-09-30' && x.name.includes('records')), () => new Map(), REL);
  assert.deepEqual([...block.keys()], ['2026-09-30']);
  day2 = block.get('2026-09-30');
  assert.equal(day2.total.incidents, 1);
  assert.deepEqual(day2.by_type.RLK.real, [0, 1, 0]);
});

await test('the sum of results adds every count and keeps the whole time frame', () => {
  const t = sum([day1, day2]);
  assert.equal(t.total.incidents, 2);
  assert.equal(t.by_type.RLK.incidents, 2);
  assert.deepEqual(t.by_type.RLK.real, [0, 1, 1]);
  assert.equal(t.subtypes['RLK-UL'].incidents, 2);
  assert.equal(t.period.from, '2026-09-30 10:00:00');
  assert.equal(t.period.to, '2026-10-04 23:50:00');
  assert.equal(t.adoption.base.RLK, 2);
  assert.equal(t.adoption.largest.RLK[t.adoption.levels.length - 1], 2, 'with every AS publishing the two leaks are Invalid');
  assert.equal(day1.by_type.RLK.incidents, 1, 'the results are not changed');
  assert.deepEqual(sum([]).total, { incidents: 0, with_path: 0, real: [0, 0, 0], ideal: [0, 0, 0] });
});

await test('the line of a day and the periods: everything and each year', () => {
  assert.deepEqual(rowOf('2026-10-04', day1), { day: '2026-10-04', incidents: 1, with_path: 1, real: [0, 0, 1], types: { RLK: 1 } });
  const p = periods(new Map([['2026-10-05', day1], ['2025-09-30', day2]]));
  assert.deepEqual(Object.keys(p).sort(), ['2025', '2026', 'all']);
  assert.equal(p.all.days, 2);
  assert.equal(p.all.first, '2025-09-30');
  assert.equal(p.all.last, '2026-10-05');
  assert.equal(p['2026'].total.incidents, 1);
  assert.equal(p['2025'].days, 1);
});

await rm(dir, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
