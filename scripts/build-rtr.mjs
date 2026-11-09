// The validator as a router sees it. RAVEN (github.com/nokia/bgp-routing-security-monitor, BSD-3-Clause), in its `rtr monitor` mode, is an
// independent RTR client that follows the Routinator of this site the way a router does, over RTR version 2, which carries the ASPAs as
// well as the VRPs. It writes one NDJSON record for each session event and each sync, and one for each anomaly that its adaptive detector
// finds in the stream of syncs (each measure of a sync against the median and the deviation of the previous ones). This builder sums the
// file up as one JSON (served as /api/v1/rtr.json): the session, the last sync, the last 24 hours, the counts of VRPs and ASPAs hour by hour
// for 30 days, the anomalies and the session events, next to the count of ASPAs of the JSON export that the site shows: the two should agree
// within a refresh of the cache. Meant for a cron job every five minutes. More than one cache can be followed, each by its own
// monitor: the first is the cache of the site (the top-level fields of the file, which the status check and the notifier read), the
// others are references, and all of them are in `caches`, so that the page can put them side by side: a change that every cache sees
// comes from upstream (a registry, a repository), one that a single cache sees is that validator's own.
//
//   node scripts/build-rtr.mjs OUT_FILE
//
// Environment: RTR_CACHES, the caches as a JSON array or the path of a file with one, each {id, name, host, telemetry (the NDJSON file
// of its monitor), metrics (its Prometheus endpoint, or none)}; without it one cache, from RTR_TELEMETRY (default
// /var/db/raven/rtr-telemetry.ndjson), RTR_METRICS (default http://127.0.0.1:9595/metrics; empty to do without) and RTR_CACHE (the name
// of the cache shown on the page, default rpki.ping6.it). ASPA_DATA, the URL or file of Routinator's jsonext (default
// http://127.0.0.1:8080/data/aspas.json), whose count of ASPAs is put next to the one of the first cache.
import { readFile, writeFile, rename } from 'node:fs/promises';

export const KEEP_DAYS = 30;        // of hourly points
export const MAX_ANOMALIES = 50;    // kept in the file, the newest first
export const MAX_EVENTS = 20;       // session events kept, the newest first
export const STALE_AFTER = 3 * 3600e3;   // a cache whose serial has not changed for this long, while it answers, has stopped publishing or stalled
const HOUR = 3600e3, DAY = 86400e3;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

// The records of the NDJSON file, oldest first, with the time in ms as `t`; a line that is not JSON, or not a record, is skipped.
export function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let r;
    try { r = JSON.parse(s); } catch { continue; }
    if (!r || typeof r !== 'object' || typeof r.event_type !== 'string') continue;
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t)) continue;
    out.push({ ...r, t });
  }
  return out.sort((a, b) => a.t - b.t);
}

// The gauges and counters of the monitor from the Prometheus text format, by name without the prefix: {session_state, vrp_count, aspa_count,
// last_sync_seconds, last_serial_change_seconds, data_expired, protocol_version, anomaly_total: {high, medium}}; a name that is not there is absent.
export function parseMetrics(text) {
  const m = {};
  for (const line of String(text || '').split('\n')) {
    const mt = /^raven_rtr_(\w+)(?:\{([^}]*)\})?\s+(\S+)/.exec(line);
    if (!mt) continue;
    const v = Number(mt[3]);
    if (!Number.isFinite(v)) continue;
    if (mt[1] === 'anomaly_total') {
      const sev = /severity="(\w+)"/.exec(mt[2] || '');
      (m.anomaly_total = m.anomaly_total || {})[sev ? sev[1] : 'all'] = v;
    } else m[mt[1]] = v;
  }
  return m;
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const nz = (x) => (Number.isFinite(x) ? x : 0);

const syncOf = (r) => ({
  at: iso(r.t), type: r.sync_type || null, serial: Number.isFinite(r.serial) ? r.serial : null, serial_changed: r.serial_changed === true,
  vrp_total: nz(r.vrp_total), aspa_total: nz(r.aspa_total),
  vrp_announced: nz(r.vrp_announced), vrp_withdrawn: nz(r.vrp_withdrawn), aspa_announced: nz(r.aspa_announced), aspa_withdrawn: nz(r.aspa_withdrawn),
  duration_ms: Number.isFinite(r.sync_duration_ns) ? round(r.sync_duration_ns / 1e6, 0) : null,
  interval_s: Number.isFinite(r.interval_since_ns) ? round(r.interval_since_ns / 1e9, 0) : null,
});

// What the page needs from the records; `now` in ms. `metrics` (parseMetrics) says whether the session is up right now: without it the last
// session event of the file is used, which cannot tell a monitor that stopped from one that is quiet.
export function summarise(records, now = Date.now(), metrics = null) {
  const syncs = records.filter((r) => r.event_type === 'sync');
  // The monitor asks for RTR version 2 and, when the cache refuses it with error 4 (Bad protocol version), goes on with a lower one and
  // writes a structural anomaly: that is the probe, repeated every hour, not a fault of the cache. Such errors are kept among the events
  // as probes and their anomalies are left out of the counts.
  const probeTimes = new Set(records.filter((r) => r.event_type === 'error' && r.error_code === 4).map((r) => r.t));
  const isProbe = (r) => r.category === 'structural' && r.trigger === 'error_report' && [...probeTimes].some((t) => Math.abs(t - r.t) <= 1000);
  const anomalies = records.filter((r) => r.event_type === 'anomaly' && !isProbe(r));
  const probes = records.filter((r) => r.event_type === 'anomaly' && isProbe(r)).length;
  const events = records.filter((r) => r.event_type !== 'sync' && r.event_type !== 'anomaly');
  const last = syncs.length ? syncs[syncs.length - 1] : null;
  const lastConn = [...events].reverse().find((e) => e.event_type === 'connected' || e.event_type === 'disconnected') || null;
  const connected = metrics && 'session_state' in metrics ? metrics.session_state === 1 : Boolean(lastConn && lastConn.event_type === 'connected');
  const protocol = metrics && Number.isFinite(metrics.protocol_version) ? metrics.protocol_version : (lastConn && lastConn.proto_version) ?? null;
  // the connection that brought the last sync says the version agreed (a record without proto_version means version 0: the monitor
  // leaves zero out); before the first sync the gauge of the monitor says the version it asked for, not the one agreed
  const lastEstablished = last ? [...events].reverse().find((e) => e.event_type === 'connected' && e.t <= last.t) || null : null;
  const negotiated = last ? (lastEstablished ? (lastEstablished.proto_version ?? 0) : protocol) : null;
  // the last sync that changed the serial: a cache that keeps answering with the same serial for hours is not being updated. A full resync
  // (a new session, after a reset or a restart of the validator) delivers everything the cache holds and so proves its data as fresh as the
  // serial does: it restarts the clock, which the gauge of the monitor (last_serial_change_seconds) does not know; the later of the two counts.
  const lastChange = [...syncs].reverse().find((r) => r.serial_changed === true || r.sync_type === 'full') || null;
  const gaugeAt = metrics && Number.isFinite(metrics.last_serial_change_seconds) && metrics.last_serial_change_seconds > 0 ? metrics.last_serial_change_seconds * 1000 : null;
  const lastChangeAt = Math.max(gaugeAt || 0, lastChange ? lastChange.t : 0) || null;
  const session = {
    connected, since: lastConn ? iso(lastConn.t) : null, protocol: negotiated, expired: metrics && 'data_expired' in metrics ? metrics.data_expired === 1 : null,
    from_metrics: Boolean(metrics && 'session_state' in metrics), carries_aspa: Boolean(last) && ((negotiated ?? 0) >= 2 || nz(last.aspa_total) > 0),
    last_serial_change: lastChangeAt ? iso(lastChangeAt) : null,
    serial_stale: Boolean(connected && last && lastChangeAt && now - lastChangeAt > STALE_AFTER && now - last.t <= STALE_AFTER),
    stale_after_s: STALE_AFTER / 1000,
  };

  const day = syncs.filter((r) => r.t > now - DAY);
  const last_24h = {
    syncs: day.length, full: day.filter((r) => r.sync_type === 'full').length, serial_changes: day.filter((r) => r.serial_changed === true).length,
    vrp_announced: day.reduce((s, r) => s + (r.sync_type === 'full' ? 0 : nz(r.vrp_announced)), 0), vrp_withdrawn: day.reduce((s, r) => s + nz(r.vrp_withdrawn), 0),
    aspa_announced: day.reduce((s, r) => s + (r.sync_type === 'full' ? 0 : nz(r.aspa_announced)), 0), aspa_withdrawn: day.reduce((s, r) => s + nz(r.aspa_withdrawn), 0),
    interval_median_s: round(median(day.map((r) => r.interval_since_ns).filter(Number.isFinite).map((x) => x / 1e9)), 0),
    duration_max_ms: day.length ? round(Math.max(...day.map((r) => nz(r.sync_duration_ns))) / 1e6, 0) : null,
  };

  // one point an hour: the last sync of the hour, and the announcements and withdrawals of the whole hour (a full resync announces everything: not counted)
  const hours = new Map();
  for (const r of syncs) {
    if (r.t < now - KEEP_DAYS * DAY) continue;
    const h = Math.floor(r.t / HOUR) * HOUR;
    const p = hours.get(h) || { t: h, vrp: 0, aspa: 0, vrp_changes: 0, aspa_changes: 0 };
    p.vrp = nz(r.vrp_total); p.aspa = nz(r.aspa_total);
    if (r.sync_type !== 'full') { p.vrp_changes += nz(r.vrp_announced) + nz(r.vrp_withdrawn); p.aspa_changes += nz(r.aspa_announced) + nz(r.aspa_withdrawn); }
    hours.set(h, p);
  }
  const points = [...hours.values()].sort((a, b) => a.t - b.t).map((p) => [Math.round(p.t / 1000), p.vrp, p.aspa, p.vrp_changes, p.aspa_changes]);

  const list = anomalies.slice(-MAX_ANOMALIES).reverse().map((a) => ({
    at: iso(a.t), category: a.category || null, trigger: a.trigger || null, severity: a.severity || null,
    z: Object.fromEntries(Object.entries(a.z_scores || {}).map(([k, v]) => [k, round(v)])),
    raw: Object.fromEntries(Object.entries(a.raw || {}).map(([k, v]) => [k, round(v, 0)])),
  }));
  const count = (sev) => anomalies.filter((a) => a.severity === sev).length;
  return {
    session,
    last_sync: last ? syncOf(last) : null,
    last_24h,
    series: { interval: 'hour', columns: ['time', 'vrp_total', 'aspa_total', 'vrp_changes', 'aspa_changes'], points },
    anomalies: { total: anomalies.length, high: count('high'), medium: count('medium'), last_7_days: anomalies.filter((a) => a.t > now - 7 * DAY).length, probes, list },
    events: events.slice(-MAX_EVENTS).reverse().map((e) => ({
      at: iso(e.t), type: e.event_type, reason: (e.reset_reason || e.disconnect_reason || e.error_text || null) && String(e.reset_reason || e.disconnect_reason || e.error_text).replace(/\0+$/, ''),
      ...(e.event_type === 'error' && e.error_code === 4 ? { probe: true } : {}),
      ...(Number.isFinite(e.error_code) ? { code: e.error_code } : {}), ...(e.proto_version ? { protocol: e.proto_version } : {}),
    })),
    telemetry: { from: records.length ? iso(records[0].t) : null, records: records.length, syncs: syncs.length },
  };
}

// The caches to follow, from RTR_CACHES (a JSON array, or the path of a file with one) or from the single-cache variables.
export async function cachesFromEnv(env = process.env) {
  if (env.RTR_CACHES) {
    const text = env.RTR_CACHES.trim().startsWith('[') ? env.RTR_CACHES : await readFile(env.RTR_CACHES, 'utf8');
    const list = JSON.parse(text);
    if (!Array.isArray(list) || !list.length || list.some((c) => !c || typeof c.id !== 'string' || typeof c.telemetry !== 'string')) throw new Error('RTR_CACHES: an array of {id, name, host, telemetry, metrics} is expected');
    return list.map((c) => ({ id: c.id, name: c.name || c.id, host: c.host || c.id, telemetry: c.telemetry, metrics: c.metrics || null, note: c.note || null }));
  }
  return [{
    id: 'routinator', name: 'Routinator of this site', host: env.RTR_CACHE || 'rpki.ping6.it',
    telemetry: env.RTR_TELEMETRY || '/var/db/raven/rtr-telemetry.ndjson',
    metrics: env.RTR_METRICS === undefined ? 'http://127.0.0.1:9595/metrics' : (env.RTR_METRICS || null), note: null,
  }];
}

// one cache: its telemetry and metrics read and summed up
async function readCache(c, now) {
  let text = '';
  try { text = await readFile(c.telemetry, 'utf8'); } catch (err) { console.error(`${c.id}: telemetry not read: ${err.message}`); }
  let metrics = null;
  if (c.metrics) {
    try {
      const r = await fetch(c.metrics, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      metrics = parseMetrics(await r.text());
    } catch (err) { console.error(`${c.id}: metrics not read: ${err.message}`); }
  }
  return {
    id: c.id, name: c.name, host: c.host, ...(c.note ? { note: c.note } : {}),
    ...summarise(parseLines(text), now, metrics),
    metrics: metrics && Object.keys(metrics).length ? {
      vrp: metrics.vrp_count ?? null, aspa: metrics.aspa_count ?? null,
      last_sync: Number.isFinite(metrics.last_sync_seconds) && metrics.last_sync_seconds > 0 ? iso(metrics.last_sync_seconds * 1000) : null,
      last_serial_change: Number.isFinite(metrics.last_serial_change_seconds) && metrics.last_serial_change_seconds > 0 ? iso(metrics.last_serial_change_seconds * 1000) : null,
      anomalies: metrics.anomaly_total || null,
    } : null,
  };
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/build-rtr.mjs OUT_FILE'); process.exit(2); }
  const dataUrl = process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json';
  const now = Date.now();
  const caches = [];
  for (const c of await cachesFromEnv()) caches.push(await readCache(c, now));
  let http = null;
  try {
    const raw = /^https?:/.test(dataUrl) ? await (await fetch(dataUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })).text() : await readFile(dataUrl, 'utf8');
    const d = JSON.parse(raw);
    http = { aspas: Array.isArray(d.aspas) ? d.aspas.length : null, generated: d.metadata && d.metadata.generatedTime ? d.metadata.generatedTime : null };
  } catch (err) { console.error(`ASPA export not read: ${err.message}`); }
  const { id, name, host, note, ...primary } = caches[0];
  const doc = { generated: iso(now), cache: host, cache_id: id, cache_name: name, monitor: 'RAVEN rtr monitor', ...primary, http, caches };
  await writeFile(`${out}.tmp`, JSON.stringify(doc));
  await rename(`${out}.tmp`, out);
  console.log(caches.map((c) => `${c.id}: ${c.telemetry.syncs} syncs, ${c.anomalies.total} anomalies, session ${c.session.connected ? 'up' : 'down'}${c.session.carries_aspa ? '' : ', no ASPA'}`).join('; '));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
