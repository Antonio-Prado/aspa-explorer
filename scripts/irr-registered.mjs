// Whether the origin of a prefix hijack (PRH) or of a more specific announced by another AS (DEG-MA) had a route object in
// the IRR databases of the five RIRs on the day of the incident. A prefix filter built from route objects lets the
// announcement through when there is one for that prefix and origin (`registered`); one built to accept the more specifics
// of the route objects also lets it through when the origin has a route object for a less specific prefix (`less_specific`,
// down to MIN_COVER_LENGTH); with neither (`unregistered`) both stop it.
// The other types are not checked: a leak carries a legitimate origin, so its route object says nothing about it.
//
// The objects come from the daily archive of the IRR databases (tools/irr-archive/fetch-irr.sh, run by cron on the host that keeps the archives):
// one folder a day, YYYY/MM/DD/index.tsv.gz, "prefix<TAB>origin<TAB>source" a line after a first line
// "# snapshot <time of the fetch, UTC>". An incident is checked against the newest snapshot taken before it began, if that
// one is less than SNAPSHOT_MAX_AGE old; otherwise it is `not_covered`, never `unregistered`.
// Only the pairs that the incidents need are kept: an index has millions of lines. An index whose first line ends with
// "canonical" is read as it is (fetch-irr.sh writes it so); another one has each line put in canonical form, five times
// slower. With a cache folder, the verdict of each prefix and origin is kept for each snapshot (a snapshot does not
// change), so that a run reads only the snapshots that have incidents it has not seen.
import { createReadStream } from 'node:fs';
import { readdir, stat, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';

export const SNAPSHOT_MAX_AGE = 36 * 3600;
// the shortest less specific prefix looked for: route objects shorter than these are not looked at
export const MIN_COVER_LENGTH = { v4: 8, v6: 16 };
export const SOURCES = 'the route and route6 objects of the IRR databases of AFRINIC, APNIC, ARIN, LACNIC and the RIPE NCC';

// "192.0.2.0/24", "064.006.160.000/19", "2001:DB8::/32" -> the canonical form (host bits cleared), null when it is not one.
export function canonPrefix(text) {
  const m = /^\s*([0-9A-Fa-f:.]+)\/(\d{1,3})\s*$/.exec(text || '');
  if (!m) return null;
  const len = Number(m[2]);
  if (m[1].includes(':')) {
    if (len > 128) return null;
    let host;
    try { host = new URL(`http://[${m[1]}]/`).hostname.slice(1, -1); } catch { return null; }
    const groups = expand6(host);
    if (!groups) return null;
    let n = 0n;
    for (const g of groups) n = (n << 16n) | BigInt(g);
    n &= len === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - len)) - 1n);
    const parts = [];
    for (let i = 7; i >= 0; i--) parts.push(((n >> BigInt(16 * i)) & 0xffffn).toString(16));
    return `${new URL(`http://[${parts.join(':')}]/`).hostname.slice(1, -1)}/${len}`;
  }
  const o = m[1].split('.');
  if (o.length !== 4 || len > 32) return null;
  let n = 0;
  for (const x of o) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = n * 256 + Number(x);
  }
  n -= n % 2 ** (32 - len);
  return `${[24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.')}/${len}`;
}
function expand6(host) {
  const [head, tail] = host.includes('::') ? host.split('::') : [host, null];
  const h = head ? head.split(':') : [];
  const t = tail === null ? [] : tail ? tail.split(':') : [];
  const fill = tail === null ? 0 : 8 - h.length - t.length;
  const all = [...h, ...new Array(fill).fill('0'), ...t];
  return all.length === 8 && all.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? all.map((g) => parseInt(g, 16)) : null;
}

// "AS64500" or 64500 -> 64500; null otherwise.
export function canonOrigin(v) {
  const m = /^(?:AS)?(\d{1,10})$/i.exec(String(v ?? '').trim());
  return m && Number(m[1]) <= 4294967295 ? Number(m[1]) : null;
}

const key = (prefix, origin) => `${prefix} ${origin}`;

// The less specific prefixes of a canonical prefix, longest first, down to MIN_COVER_LENGTH.
export function lessSpecifics(prefix) {
  const [addr, l] = prefix.split('/');
  const v6 = addr.includes(':');
  const out = [];
  for (let len = Number(l) - 1; len >= (v6 ? MIN_COVER_LENGTH.v6 : MIN_COVER_LENGTH.v4); len--) out.push(canonPrefix(`${addr}/${len}`));
  return out;
}

// The prefix and origin that an incident is about, for the types that are checked; null for the others.
export function subjectOf(inc) {
  const d = inc.details || {};
  let prefix = null, origin = null;
  if (inc.incident_type === 'PRH') { prefix = d.prefix; origin = d.actual_origin; }
  else if (inc.incident_type === 'DEG' && /^Cross-Origin/.test(d.anomaly || '')) { prefix = d.sub_prefix; origin = d.sub_origin; }
  else return null;
  const p = canonPrefix(prefix), o = canonOrigin(origin);
  return p && o !== null ? { prefix: p, origin: o, key: key(p, o), covering: lessSpecifics(p).map((q) => key(q, o)) } : null;
}

const epochOf = (t) => { const ms = Date.parse(`${String(t || '').slice(0, 19).replace(' ', 'T')}Z`); return Number.isNaN(ms) ? null : ms / 1000; };

// The newest snapshot taken before `start` (seconds), if it is younger than SNAPSHOT_MAX_AGE; snapshots: [{ time, file }].
export function pickSnapshot(snapshots, start) {
  if (start === null) return null;
  let best = null;
  for (const s of snapshots) if (s.time <= start && (!best || s.time > best.time)) best = s;
  return best && start - best.time <= SNAPSHOT_MAX_AGE ? best : null;
}

// The lines of a gzipped file; a file that cannot be opened or is not gzip makes the loop throw, it does not crash the process.
function gzLines(file) {
  const src = createReadStream(file), gz = createGunzip();
  src.on('error', (err) => gz.destroy(err));
  return createInterface({ input: src.pipe(gz), crlfDelay: Infinity });
}

async function firstLine(file) {
  const rl = gzLines(file);
  for await (const line of rl) { rl.close(); return line; }
  return '';
}

// The snapshots of the archive (YYYY/MM/DD/index.tsv.gz under dir), oldest first; [] when the archive is not there.
export async function listSnapshots(dir) {
  const out = [];
  const sub = async (d, re) => { try { return (await readdir(d)).filter((x) => re.test(x)).sort(); } catch { return []; } };
  for (const y of await sub(dir, /^\d{4}$/)) for (const m of await sub(join(dir, y), /^\d{2}$/)) for (const d of await sub(join(dir, y, m), /^\d{2}$/)) {
    const file = join(dir, y, m, d, 'index.tsv.gz');
    try {
      if (!(await stat(file)).size) continue;
      const head = /^# snapshot (\S+)( canonical)?/.exec(await firstLine(file));
      const time = head ? epochOf(head[1].replace('T', ' ').replace('Z', '')) : null;
      if (time !== null) out.push({ day: `${y}-${m}-${d}`, time, file, canonical: Boolean(head[2]) });
    } catch { /* an index being written, or unreadable: left out */ }
  }
  return out;
}

// The checker of a run: need(inc) during the first reading, load() once, then verdict(inc) for each incident:
// 'registered', 'less_specific', 'unregistered', 'not_covered', or null for an incident that is not checked.
// cacheDir: where the verdicts of each snapshot are kept between runs (null: no cache).
const CODE = { r: 'registered', l: 'less_specific', u: 'unregistered' };
export function irrChecker(snapshots, cacheDir = null) {
  const byFile = new Map(snapshots.map((s) => [s.file, s]));
  const known = new Map();      // snapshot file -> Map subject key -> 'r' | 'l' | 'u' (from the cache and the reading)
  const needs = new Map();      // snapshot file -> Map subject key -> subject, not in the cache
  const at = (inc) => pickSnapshot(snapshots, epochOf(inc.start));
  const cacheFile = (snap) => join(cacheDir, `irr-${snap.day}.json`);
  const cached = async (snap) => {
    if (known.has(snap.file)) return known.get(snap.file);
    let m = new Map();
    if (cacheDir) {
      try {
        const c = JSON.parse(await readFile(cacheFile(snap), 'utf8'));
        if (c.snapshot === snap.time) m = new Map(Object.entries(c.verdicts));
      } catch { /* no cache yet */ }
    }
    known.set(snap.file, m);
    return m;
  };
  const pending = [];
  const need = (inc) => {
    const s = subjectOf(inc);
    if (!s) return;
    const snap = at(inc);
    if (!snap) return;
    if (!needs.has(snap.file)) needs.set(snap.file, new Map());
    needs.get(snap.file).set(s.key, s);
  };
  const load = async () => {
    for (const [file, subjects] of needs) {
      const snap = byFile.get(file);
      const m = await cached(snap);
      const todo = [...subjects.values()].filter((s) => !m.has(s.key));
      if (!todo.length) continue;
      const wanted = new Set();
      for (const s of todo) { wanted.add(s.key); for (const k of s.covering) wanted.add(k); }
      const hits = new Set();
      try {
        for await (const line of gzLines(file)) {
          if (line[0] === '#') continue;
          const tab = line.indexOf('\t'), tab2 = line.indexOf('\t', tab + 1);
          let k;
          if (snap.canonical) k = `${line.slice(0, tab)} ${line.slice(tab + 3, tab2 < 0 ? undefined : tab2)}`;
          else {
            const [p, o] = line.split('\t');
            const cp = canonPrefix(p), co = canonOrigin(o);
            if (!cp || co === null) continue;
            k = key(cp, co);
          }
          if (wanted.has(k)) hits.add(k);
        }
      } catch (err) {
        console.error(`IRR snapshot ${file} not read (${err.message}): its new incidents are not covered`);
        continue;
      }
      for (const s of todo) m.set(s.key, hits.has(s.key) ? 'r' : s.covering.some((k) => hits.has(k)) ? 'l' : 'u');
      if (cacheDir) pending.push(snap);
    }
    for (const snap of pending) {
      try {
        await mkdir(cacheDir, { recursive: true });
        const tmp = `${cacheFile(snap)}.tmp`;
        await writeFile(tmp, JSON.stringify({ snapshot: snap.time, verdicts: Object.fromEntries(known.get(snap.file)) }));
        await rename(tmp, cacheFile(snap));
      } catch (err) { console.error(`IRR cache of ${snap.day} not written: ${err.message}`); }
    }
  };
  const verdict = (inc) => {
    const s = subjectOf(inc);
    if (!s) return null;
    const snap = at(inc);
    const v = snap ? known.get(snap.file)?.get(s.key) : undefined;
    return v ? CODE[v] : 'not_covered';
  };
  return { need, load, verdict, snapshots };
}
