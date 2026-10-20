// Tests of scripts/feed.mjs (no dependencies). Run with: node scripts/test-feed.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { atomFeed, readFeed } from './feed.mjs';

const { classify } = createRequire(import.meta.url)('../site/history.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const opts = (extra = {}) => ({ site: 'https://aspa.example.org', classify, ...extra });
const day1 = [['2026-10-18', 'AS100', ['AS1']]];
const day1more = [...day1, ['2026-10-18', 'AS200', ['AS2']]];
const both = [...day1, ['2026-10-19', 'AS300', ['AS3']]];

test('a first feed dates each entry 06:30 of its day, and the feed with the newest', () => {
  const f = atomFeed(both, opts());
  assert.match(f, /<updated>2026-10-19T06:30:00Z<\/updated>\n {2}<\/feed>|<updated>2026-10-19T06:30:00Z<\/updated>\n<entry>|<updated>2026-10-19T06:30:00Z<\/updated>\n {2}<entry>/);
  assert.deepEqual(Object.keys(readFeed(f)).sort(), ['2026-10-18', '2026-10-19']);
});

test('the same content keeps the time it had; a day that gained changes gets the time of the run', () => {
  const first = atomFeed(day1, opts());
  const again = atomFeed(day1, opts({ old: first, now: new Date('2026-10-18T15:00:00Z') }));
  assert.equal(readFeed(again)['2026-10-18'].updated, '2026-10-18T06:30:00Z');
  const more = atomFeed(day1more, opts({ old: first, now: new Date('2026-10-18T15:00:00Z') }));
  assert.equal(readFeed(more)['2026-10-18'].updated, '2026-10-18T15:00:00.000Z');
  assert.equal(readFeed(more)['2026-10-18'].content.includes('AS200'), true);
  assert.match(more, /<updated>2026-10-18T15:00:00.000Z<\/updated>\n {2}<entry>/);        // and the feed itself is as new as its newest entry
});

test('only the day that changed moves, the id of an entry stays', () => {
  const first = atomFeed(both, opts());
  const next = atomFeed([...both, ['2026-10-19', 'AS400', null]], opts({ old: first, now: new Date('2026-10-19T09:00:00Z') }));
  const r = readFeed(next);
  assert.equal(r['2026-10-18'].updated, '2026-10-18T06:30:00Z');
  assert.equal(r['2026-10-19'].updated, '2026-10-19T09:00:00.000Z');
  assert.equal((next.match(/<id>tag:aspa.ping6.it,2026-10-19:changes<\/id>/g) || []).length, 1);
});

test('no events: the feed is still a feed, and a text that is not a feed is ignored', () => {
  assert.match(atomFeed([], opts({ now: new Date('2026-10-20T00:00:00Z') })), /<updated>2026-10-20T00:00:00.000Z<\/updated>/);
  assert.deepEqual(readFeed('nothing'), {});
  assert.deepEqual(readFeed(null), {});
});

console.log(`${passed} tests passed`);
