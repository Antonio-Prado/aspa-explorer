// The announcements that the ASPAs prove invalid, as the route collectors receive them (RIPE RIS Live): a few minutes of the
// stream at a time, every announcement checked with the downstream verification, counted by hour, by origin AS and by prefix;
// the last 14 days are summed into one report (served as /api/v1/invalid.json) with the busiest origins and prefixes, in the
// manner of a BGP instability report. Meant for a cron job every ten minutes: each run listens for most of the ten.
//
//   node scripts/watch-invalid.mjs OUT_DIR [SECONDS]
//
// OUT_DIR gets invalid-days/YYYYMMDD.json (one file for each day, kept 14 days) and invalid.json (the report).
// Environment: ASPA_DATA (Routinator's jsonext, default http://127.0.0.1:8080/data/aspas.json), WATCH_HOSTS (the collectors of RIS
// Live to listen to, comma separated; default all of them: it costs about a tenth of a core), WATCH_ADOPTION (the file with the IXP ASes,
// default adoption.json in OUT_DIR).
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { classify, aspaMap } from './build-leaks.mjs';

if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
const UA = 'aspa-explorer';
const RIS_LIVE = `wss://ris-live.ripe.net/v1/ws/?client=${UA}`;
export const KEEP_DAYS = 14;
const VERDICT = ['valid', 'unknown', 'invalid'];

// The announcements of one RIS Live message: [{prefix, path (origin first, no prepending, no IXP ASes), peer}]; paths with an AS_SET
// (a nested array) are left out, as everywhere on the site.
export function announcementsOf(data, ixp = new Set()) {
  const raw = data && data.path;
  if (!Array.isArray(raw) || !raw.length || !raw.every((n) => Number.isInteger(n))) return [];
  const path = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    const a = raw[i];
    if (ixp.has(a)) continue;
    if (path[path.length - 1] !== a) path.push(a);
  }
  const out = [];
  for (const a of data.announcements || []) for (const prefix of a.prefixes || []) out.push({ prefix, path, peer: data.peer_asn });
  return out;
}

export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const blankDay = (date) => ({ date, hours: Array.from({ length: 24 }, () => ({ seconds: 0, messages: 0, announcements: 0, valid: 0, unknown: 0, invalid: 0, peak_ann: 0, peak_inv: 0 })), origins: {}, prefixes: {} });

// One announcement into a day: `verdict` 0 valid, 1 unknown, 2 invalid.
export function count(day, ms, origin, prefix, verdict) {
  const h = day.hours[new Date(ms).getUTCHours()];
  h.announcements++; h[VERDICT[verdict]]++;
  const o = day.origins[origin] || (day.origins[origin] = [0, 0]);
  o[0]++;
  if (verdict === 2) {
    o[1]++;
    const k = `${prefix}|${origin}`;
    day.prefixes[k] = (day.prefixes[k] || 0) + 1;
  }
}

// The report of the days (oldest first): the hours, the profile and the busiest origins and prefixes.
export function buildReport(days, now = Date.now(), top = 50) {
  const hours = [];
  const origins = new Map(), prefixes = new Map();
  let messages = 0, announcements = 0, valid = 0, unknown = 0, invalid = 0, seconds = 0;
  const peak = { ann: { v: 0, at: null }, inv: { v: 0, at: null } };
  for (const d of days) {
    d.hours.forEach((h, i) => {
      if (!h.seconds && !h.announcements) return;
      const at = `${d.date}T${String(i).padStart(2, '0')}:00:00Z`;
      hours.push({ at, seconds: h.seconds, messages: h.messages, announcements: h.announcements, valid: h.valid, unknown: h.unknown, invalid: h.invalid });
      messages += h.messages; announcements += h.announcements; valid += h.valid; unknown += h.unknown; invalid += h.invalid; seconds += h.seconds;
      if (h.peak_ann > peak.ann.v) peak.ann = { v: h.peak_ann, at };
      if (h.peak_inv > peak.inv.v) peak.inv = { v: h.peak_inv, at };
    });
    for (const [as, [a, inv]] of Object.entries(d.origins)) { const e = origins.get(as) || [0, 0]; e[0] += a; e[1] += inv; origins.set(as, e); }
    for (const [k, n] of Object.entries(d.prefixes)) prefixes.set(k, (prefixes.get(k) || 0) + n);
  }
  const prefixCount = new Map();                                   // distinct prefixes with an invalid announcement, by origin
  for (const k of prefixes.keys()) { const as = k.slice(k.lastIndexOf('|') + 1); prefixCount.set(as, (prefixCount.get(as) || 0) + 1); }
  const withInvalid = [...origins].filter(([, [, inv]]) => inv > 0);
  const row = ([as, [a, inv]]) => ({ asn: `AS${as}`, invalid: inv, announcements: a, share: Math.round((inv / a) * 10000) / 100, prefixes: prefixCount.get(as) || 0 });
  const byCount = withInvalid.map(row).sort((x, y) => y.invalid - x.invalid || x.asn.localeCompare(y.asn)).slice(0, top);
  const byShare = withInvalid.filter(([, [a]]) => a >= 100).map(row).sort((x, y) => y.share - x.share || y.invalid - x.invalid).slice(0, top);
  const topPrefixes = [...prefixes].sort((x, y) => y[1] - x[1]).slice(0, top).map(([k, n]) => ({ prefix: k.slice(0, k.lastIndexOf('|')), origin: `AS${k.slice(k.lastIndexOf('|') + 1)}`, invalid: n }));
  return {
    generated: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'),
    from: days.length ? days[0].date : null, to: days.length ? days[days.length - 1].date : null,
    profile: {
      seconds, messages, announcements, valid, unknown, invalid,
      invalid_share: announcements ? Math.round((invalid / announcements) * 1e6) / 1e4 : 0,
      announcements_per_second: seconds ? Math.round((announcements / seconds) * 100) / 100 : 0,
      origins: origins.size, origins_with_invalid: withInvalid.length, prefixes_with_invalid: prefixes.size,
      peak_announcements_per_second: peak.ann, peak_invalid_per_second: peak.inv,
    },
    hours, by_count: byCount, by_share: byShare, prefixes: topPrefixes,
  };
}

async function readDay(dir, date) {
  try { return JSON.parse(await readFile(join(dir, `${date.replaceAll('-', '')}.json`), 'utf8')); } catch { return blankDay(date); }
}
const writeJson = async (file, value) => { await writeFile(`${file}.tmp`, JSON.stringify(value)); await rename(`${file}.tmp`, file); };

async function main() {
  const out = process.argv[2];
  const seconds = Number(process.argv[3] || 540);
  if (!out) { console.error('usage: node scripts/watch-invalid.mjs OUT_DIR [SECONDS]'); process.exit(2); }
  const dir = join(out, 'invalid-days');
  await mkdir(dir, { recursive: true });
  const data = await (await fetch(process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json', { headers: { 'User-Agent': UA } })).json();
  if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('the ASPA data is empty');
  const aspas = aspaMap(data.aspas);
  let ixp = new Set();
  try { ixp = new Set(JSON.parse(await readFile(process.env.WATCH_ADOPTION || join(out, 'adoption.json'), 'utf8')).ixp || []); } catch { /* no list */ }
  const hosts = (process.env.WATCH_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const days = new Map();
  const dayAt = async (ms) => { const d = dayOf(ms); if (!days.has(d)) days.set(d, await readDay(dir, d)); return days.get(d); };
  let sec = { at: 0, ann: 0, inv: 0 };
  const started = Date.now();
  let today = await dayAt(started);

  const onMessage = (m) => {
    const now = Date.now();
    const d = days.get(dayOf(now)) || today;
    const h = d.hours[new Date(now).getUTCHours()];
    h.messages++;
    const s = Math.floor(now / 1000);
    if (s !== sec.at) {                                            // close the second that ended: its peak, and the time listened to
      if (sec.at) { const sh = (days.get(dayOf(sec.at * 1000)) || d).hours[new Date(sec.at * 1000).getUTCHours()]; sh.peak_ann = Math.max(sh.peak_ann, sec.ann); sh.peak_inv = Math.max(sh.peak_inv, sec.inv); }
      sec = { at: s, ann: 0, inv: 0 };
    }
    for (const a of announcementsOf(m, ixp)) {
      const k = classify(aspas, a.path);
      sec.ann++; if (k === 2) sec.inv++;
      count(d, now, a.path[0], a.prefix, k);
    }
  };

  await new Promise((resolve) => {
    const deadline = started + seconds * 1000;
    let ws = null, tries = 0;
    const open = () => {
      ws = new WebSocket(RIS_LIVE);
      ws.onopen = () => { for (const host of hosts.length ? hosts : [undefined]) ws.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'UPDATE', require: 'announcements', ...(host ? { host } : {}) } })); };
      ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === 'ris_message') onMessage(m.data); } catch { /* a message that is not JSON */ } };
      ws.onclose = () => { if (Date.now() < deadline - 5000 && tries++ < 3) setTimeout(open, 2000); else resolve(); };
      ws.onerror = () => { /* the close follows */ };
    };
    open();
    setTimeout(() => { if (ws) { ws.onclose = () => resolve(); ws.close(); } setTimeout(resolve, 2000); }, seconds * 1000);
  });
  // the time listened to goes to the hours it covered
  for (let t = started; t < Date.now(); t += 1000) { const d = days.get(dayOf(t)) || (await dayAt(t)); d.hours[new Date(t).getUTCHours()].seconds++; }
  for (const d of days.values()) await writeJson(join(dir, `${d.date.replaceAll('-', '')}.json`), d);
  const names = (await readdir(dir)).filter((f) => /^\d{8}\.json$/.test(f)).sort();
  for (const f of names.slice(0, -KEEP_DAYS)) await unlink(join(dir, f));
  const keep = [];
  for (const f of names.slice(-KEEP_DAYS)) keep.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
  const report = buildReport(keep);
  await writeJson(join(out, 'invalid.json'), report);
  console.log(`${report.generated}: ${report.profile.announcements} announcements in ${report.profile.seconds} s over ${keep.length} days, ${report.profile.invalid} invalid (${report.profile.invalid_share}%)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
