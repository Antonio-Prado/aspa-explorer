// The ASPAs as they were known at a given time, and whether that is certain.
//
// The history of the ASPAs (events.json of the history branch) has one state a day, which is not enough to judge an event of
// that day: the state of the day before can be a day and a half old, and the state of the day can come after the event. The
// timeline is the same history with the time of each change: a list of steps, each one the changes that were seen for the
// first time at `seen` and that were not there at `after`, the time of the look before it. Two sources:
//   - until ARCHIVE_TO, the daily files of the RIPE NCC RPKI archive (tools/backfill-history.py): a step for each day with
//     changes, `seen` the time the files of that day say they were generated at (the latest of the five trust anchors) and
//     `after` the time of the files of the day before that has them (the earliest of the five), less FETCH_MARGIN for the
//     validation run;
//   - after it, the commits of the hourly job on the history branch: a step for each commit that changes the state, `seen` the
//     time of the commit and `after` the time of the commit before it.
// The rule, for an event at time t (an incident, a table dump):
//   - its ASPAs are the ones of the newest step with seen <= t: what was known at that time, never what came after;
//   - the verdict is firm when no step whose interval (after, seen] contains t changes the ASPA of an AS of its paths, or when
//     the verdict is the same with those changes: otherwise the ASPA changed around the event and the history cannot say on
//     which side of it. For an event that lasts, the steps up to its end count too: an ASPA that changed while it went on.
//     An event later than the last commit read (the horizon) is not firm yet.
// Times are epoch seconds, AS numbers are numbers, a change is [customer, providers | null].
export const VERSION = 1;
export const ARCHIVE_TO = '2026-10-15';
export const FETCH_MARGIN = 1800;
export const TAS = ['afrinic', 'apnic', 'arin', 'lacnic', 'ripencc'];
// a file of the archive of a day is generated from 00:00 of that day to 06:00 of the next (the latest seen: 00:24 of the next)
export const ARCHIVE_SPAN = [0, 30 * 3600];

const num = (as) => Number(String(as).slice(2));
const epochOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// customer -> sorted providers (numbers), from events [[date, 'AS1', ['AS2'] | null], ...] up to and including `upTo` (all when omitted)
export function replayEvents(events, upTo = null) {
  const state = new Map();
  for (const [date, customer, providers] of events) {
    if (upTo && date > upTo) break;
    if (providers) state.set(num(customer), providers.map(num).sort((a, b) => a - b)); else state.delete(num(customer));
  }
  return state;
}

// The changes that turn the state prev into cur, by customer number.
export function diffStates(prev, cur) {
  const out = [];
  for (const c of [...new Set([...prev.keys(), ...cur.keys()])].sort((a, b) => a - b)) {
    const a = prev.get(c), b = cur.get(c);
    if (a && b ? !sameList(a, b) : a !== b) out.push([c, b || null]);
  }
  return out;
}

// The time of the archive of a day: {seen, first}, the latest and the earliest of the times its five files say they were
// generated at ("generated" in their metadata: scripts/data/archive-times.json), or null when a file is missing
// (tools/backfill-history.py skips such a day). Most days it is between 04:00 and 06:00 UTC, but some thirty days are hours
// later, twice past midnight: the time of the file is used, whatever it is, as long as it is within ARCHIVE_SPAN of its day.
export function archiveTime(day, row) {
  if (!row || TAS.some((ta) => row[ta] === null || row[ta] === undefined)) return null;
  const d0 = epochOf(day);
  const ts = TAS.map((ta) => row[ta]);
  for (const t of ts) if (!Number.isFinite(t) || t < d0 + ARCHIVE_SPAN[0] || t > d0 + ARCHIVE_SPAN[1]) throw new Error(`the archive of ${day} says it was generated at ${t}: not within its day`);
  return { seen: Math.max(...ts), first: Math.min(...ts) };
}

// The steps of the archive period: events up to ARCHIVE_TO and the times of the files ({day: {ta: epoch}}).
export function archiveSteps(events, times) {
  const days = Object.keys(times).filter((d) => d <= ARCHIVE_TO).sort();
  const good = days.map((d) => [d, archiveTime(d, times[d])]).filter(([, t]) => t);
  const at = new Map(good);
  const before = new Map(good.map(([d], i) => [d, i ? good[i - 1][1] : null]));
  const steps = [];
  let state = new Map();
  const byDay = new Map();
  for (const e of events) { if (e[0] > ARCHIVE_TO) break; if (!byDay.has(e[0])) byDay.set(e[0], []); byDay.get(e[0]).push(e); }
  for (const [day, evs] of byDay) {
    const t = at.get(day);
    if (!t) throw new Error(`events on ${day}, a day with no complete archive`);
    const next = new Map(state);
    for (const [, customer, providers] of evs) { if (providers) next.set(num(customer), providers.map(num).sort((a, b) => a - b)); else next.delete(num(customer)); }
    const prev = before.get(day);
    steps.push([prev ? prev.first - FETCH_MARGIN : t.first - 86400, t.seen, diffStates(state, next)]);
    state = next;
  }
  return { steps, state };
}

// The step of a commit of the hourly job: its events.json against the state so far. Returns null when the state is the same.
// The events of the archive period must be the ones the timeline was built from (archiveEvents: their JSON text).
export function commitStep(state, events, time, lastTime, archiveText = null) {
  if (archiveText !== null) {
    const mine = JSON.stringify(events.filter((e) => e[0] <= ARCHIVE_TO));
    if (mine !== archiveText) throw new Error('the events of the archive period differ from the ones the timeline was built from');
  }
  if (!(time > lastTime)) throw new Error(`a commit at ${time} that is not after ${lastTime}`);
  const cur = replayEvents(events);
  const changes = diffStates(state, cur);
  return { step: changes.length ? [lastTime, time, changes] : null, state: cur };
}

// Checks of a whole timeline document against the events it was built from; throws on the first failure.
//   - the steps are in order of `seen`, each with after < seen and at least one change;
//   - for every day of the events, the state of that day is replay(events, day): for an archive day the state at the time its
//     files were generated (`times`, as archiveSteps), for a day of the job the state at the end of the day.
export function validate(doc, events, times) {
  if (doc.version !== VERSION) throw new Error(`timeline version ${doc.version}, expected ${VERSION}`);
  const steps = doc.steps;
  for (let i = 0; i < steps.length; i++) {
    const [after, seen, changes] = steps[i];
    if (!(after < seen)) throw new Error(`step ${i}: after ${after} is not before seen ${seen}`);
    if (i && !(seen > steps[i - 1][1])) throw new Error(`step ${i}: seen ${seen} is not after the step before`);
    if (!changes.length) throw new Error(`step ${i}: no change`);
  }
  const tl = new Timeline(doc);
  const days = [...new Set(events.map((e) => e[0]))];
  const state = new Map();
  let k = 0;
  for (const day of days) {
    while (k < events.length && events[k][0] === day) { const [, c, p] = events[k++]; if (p) state.set(num(c), p.map(num).sort((a, b) => a - b)); else state.delete(num(c)); }
    let t = epochOf(day) + 86400 - 1;                                 // a day of the job: the last commit before midnight
    if (day <= ARCHIVE_TO) { const a = archiveTime(day, times[day]); if (!a) throw new Error(`events on ${day}, a day with no complete archive`); t = a.seen; }
    if (t > doc.horizon) break;                                       // a day that is not over in the timeline
    const got = tl.raw(tl.indexAt(t));
    const d = diffStates(got, state);
    if (d.length) throw new Error(`${day}: the timeline and the events differ for ${d.length} customers (first AS${d[0][0]})`);
  }
  return true;
}

const KEEP = 128;

// Lookup in a timeline document {version, horizon, steps}.
export class Timeline {
  constructor(doc) {
    this.steps = doc.steps;
    this.horizon = doc.horizon;
    this.seen = Float64Array.from(doc.steps, (s) => s[1]);
    this.cache = new Map();                        // n -> Map customer -> providers array, after the first n steps
    this.sets = new Map();                         // n -> Map customer -> Set of providers (what the verification reads)
  }

  // how many steps were seen at or before t
  indexAt(t) {
    let lo = 0, hi = this.seen.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.seen[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  }

  // the state after the first n steps: Map customer -> sorted providers (not to be changed by the caller)
  raw(n) { return this.build(this.cache, n, (p) => p); }

  // the same as the Map customer -> Set of providers that the verification reads (aspaMap of build-leaks.mjs)
  state(n) { return this.build(this.sets, n, (p) => new Set(p)); }

  // A state is the nearest one before it that is kept, with the steps in between applied: the lists that do not change are
  // shared between the states, so that a hundred of them cost little more than one. The oldest ones are dropped past KEEP.
  build(cache, n, make) {
    if (n < 0 || n > this.steps.length) throw new Error(`no state ${n} in a timeline of ${this.steps.length} steps`);
    const had = cache.get(n);
    if (had) { cache.delete(n); cache.set(n, had); return had; }            // the most recently used last
    let m = -1;
    for (const k of cache.keys()) if (k < n && k > m) m = k;
    const state = m < 0 ? new Map() : new Map(cache.get(m));
    for (let i = Math.max(m, 0); i < n; i++) for (const [c, p] of this.steps[i][2]) { if (p) state.set(c, make(p)); else state.delete(c); }
    cache.set(n, state);
    if (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return state;
  }

  // the steps not yet seen at t that may have been true before `end` (their look before is earlier than `end`): [n, n + k).
  // With end = t they are the steps whose interval contains t; k is 0 when the state from t to end is certain.
  open(t, n = this.indexAt(t), end = t) {
    let k = 0;
    while (n + k < this.steps.length && this.steps[n + k][0] < end) k++;
    return k;
  }

  // The verdict of an event that began at t and ended at `end` (the same for a moment): verdictOf(state) is asked with the
  // ASPAs known at t; `touches(customer)` says whether a customer is among the ASes the verdict reads. Returns {verdict, firm}:
  // firm when the verdict is the same with every state that the ASPAs may have had from t to end. An event that ends after
  // the horizon also has `late`: its verdict is the one that will stay, but whether it is firm is not known until a commit
  // later than its end has been read.
  at(t, verdictOf, touches, end = t) {
    const n = this.indexAt(t);
    const verdict = verdictOf(this.state(n));
    if (Math.max(t, end) > this.horizon) return { verdict, firm: false, late: true };    // not known yet: to be asked again
    const k = this.open(t, n, Math.max(t, end));
    for (let j = 1; j <= k; j++) {
      if (!this.steps[n + j - 1][2].some(([c]) => touches(c))) continue;
      if (verdictOf(this.state(n + j)) !== verdict) return { verdict, firm: false };
    }
    return { verdict, firm: true };
  }
}

// The timeline of a file, for a builder: the file has to be of this version and to have been checked not longer than maxAge
// seconds ago (build-timeline.mjs writes `built` at each run, also when there is no new commit). Anything else is an error:
// a builder that cannot have the timeline keeps what it published before, it does not judge with something else.
export async function loadTimeline(file, maxAge = 3 * 3600, now = Date.now() / 1000) {
  const { readFile } = await import('node:fs/promises');
  let doc;
  try { doc = JSON.parse(await readFile(file, 'utf8')); } catch (err) { throw new Error(`the timeline of the ASPAs cannot be read (${file}: ${err.message})`); }
  if (doc.version !== VERSION) throw new Error(`${file}: timeline version ${doc.version}, expected ${VERSION}`);
  if (!Array.isArray(doc.steps) || !doc.steps.length || !Number.isFinite(doc.horizon)) throw new Error(`${file}: not a timeline`);
  const built = Date.parse(doc.built) / 1000;
  if (!Number.isFinite(built) || now - built > maxAge) throw new Error(`${file}: the timeline was last checked at ${doc.built}, more than ${Math.round(maxAge / 60)} minutes ago`);
  return new Timeline(doc);
}
