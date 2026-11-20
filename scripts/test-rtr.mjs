// Unit tests for scripts/build-rtr.mjs (no dependencies). Run with: node scripts/test-rtr.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseLines, parseMetrics, summarise, cachesFromEnv, KEEP_DAYS, MAX_ANOMALIES, STALE_AFTER, apartOf, APART, versionIn } from './build-rtr.mjs';

const { idOf, parseId, fromTelemetry, idOfWindow, parseWindow, windowOf } = createRequire(import.meta.url)('../site/rtr-anomaly.js');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

const T0 = Date.parse('2026-11-09T14:00:00Z');
const at = (min) => new Date(T0 + min * 60e3).toISOString().replace(/\.\d+Z$/, 'Z');
const sync = (min, extra = {}) => JSON.stringify({ timestamp: at(min), cache: 'c:3323', event_type: 'sync', vrp_total: 1000, aspa_total: 40, sync_type: 'incremental', serial_changed: true, sync_duration_ns: 7e8, interval_since_ns: 5e11, ...extra });

test('the lines of the file: bad lines skipped, sorted by time', () => {
  const text = ['not json', '{"event_type": 1}', sync(10), '', JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 }), '{"timestamp":"never","event_type":"sync"}'].join('\n');
  const r = parseLines(text);
  assert.deepEqual(r.map((x) => x.event_type), ['connected', 'sync']);
  assert.equal(r[1].t, T0 + 10 * 60e3);
  assert.deepEqual(parseLines(''), []);
});

test('the Prometheus text: gauges by name, the anomaly counter by severity', () => {
  const m = parseMetrics(['# HELP raven_rtr_vrp_count x', '# TYPE raven_rtr_vrp_count gauge', 'raven_rtr_vrp_count{cache="c:3323"} 1032693', 'raven_rtr_session_state{cache="c:3323"} 1',
    'raven_rtr_anomaly_total{cache="c:3323",severity="high"} 2', 'raven_rtr_anomaly_total{cache="c:3323",severity="medium"} 0', 'raven_rtr_protocol_version{cache="c:3323"} 2', 'go_memstats_heap_inuse_bytes 5', 'raven_rtr_data_expired{cache="c:3323"} NaN'].join('\n'));
  assert.equal(m.vrp_count, 1032693);
  assert.equal(m.session_state, 1);
  assert.deepEqual(m.anomaly_total, { high: 2, medium: 0 });
  assert.equal(m.protocol_version, 2);
  assert.equal('data_expired' in m, false);
  assert.deepEqual(parseMetrics(''), {});
});

test('a session: the connection, a full resync and incremental syncs, the last 24 hours and the hourly points', () => {
  const lines = [
    JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 }),
    sync(0, { sync_type: 'full', vrp_announced: 1000, aspa_announced: 40, interval_since_ns: undefined }),
    sync(9, { serial: 1, vrp_total: 1010, vrp_announced: 15, vrp_withdrawn: 5 }),
    sync(18, { serial: 1, serial_changed: false, vrp_total: 1010, interval_since_ns: 54e10 }),
    sync(70, { serial: 2, vrp_total: 1012, aspa_total: 41, vrp_announced: 2, aspa_announced: 1, sync_duration_ns: 9e8 }),
  ];
  const now = T0 + 80 * 60e3;
  const d = summarise(parseLines(lines.join('\n')), now);
  assert.equal(d.session.connected, true);
  assert.equal(d.session.protocol, 2);
  assert.equal(d.session.from_metrics, false);
  assert.equal(d.last_sync.serial, 2);
  assert.equal(d.last_sync.aspa_total, 41);
  assert.equal(d.last_sync.duration_ms, 900);
  assert.equal(d.last_sync.interval_s, 500);
  assert.equal(d.last_24h.syncs, 4);
  assert.equal(d.last_24h.full, 1);
  assert.equal(d.last_24h.serial_changes, 3);
  assert.equal(d.last_24h.vrp_announced, 17);                 // the full resync is not counted
  assert.equal(d.last_24h.vrp_withdrawn, 5);
  assert.equal(d.last_24h.aspa_announced, 1);
  assert.equal(d.last_24h.interval_median_s, 500);
  assert.equal(d.last_24h.duration_max_ms, 900);
  assert.deepEqual(d.series.points, [[T0 / 1000, 1010, 40, 20, 0], [T0 / 1000 + 3600, 1012, 41, 2, 1]]);
  assert.equal(d.anomalies.total, 0);
  assert.deepEqual(d.anomalies.list, []);
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].type, 'connected');
  assert.equal(d.telemetry.syncs, 4);
  assert.equal(d.telemetry.from, at(0));
});

test('the metrics say whether the session is up; without them the last event does', () => {
  const lines = [JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 }), sync(5)];
  const r = parseLines(lines.join('\n'));
  assert.equal(summarise(r, T0 + 6e5, { session_state: 0, protocol_version: 2, data_expired: 1 }).session.connected, false);
  assert.equal(summarise(r, T0 + 6e5, { session_state: 0, data_expired: 1 }).session.expired, true);
  assert.equal(summarise(r, T0 + 6e5, { session_state: 1 }).session.from_metrics, true);
  const dropped = parseLines([...lines, JSON.stringify({ timestamp: at(7), cache: 'c', event_type: 'disconnected', disconnect_reason: 'EOF' })].join('\n'));
  const d = summarise(dropped, T0 + 6e5);
  assert.equal(d.session.connected, false);
  assert.equal(d.events[0].type, 'disconnected');
  assert.equal(d.events[0].reason, 'EOF');
  assert.equal(summarise([], T0).last_sync, null);
  assert.equal(summarise([], T0).session.connected, false);
  // before the first sync the version is not known, whatever the monitor asked for
  const fresh = summarise(parseLines(JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 })), T0 + 1000, { session_state: 1, protocol_version: 2 });
  assert.equal(fresh.session.protocol, null);
  assert.equal(fresh.session.carries_aspa, false);
});

test('anomalies: the newest first, rounded, counted by severity and in the last 7 days; events keep reasons and codes', () => {
  const lines = [sync(0, { sync_type: 'full' })];
  for (let i = 0; i < MAX_ANOMALIES + 5; i++) lines.push(JSON.stringify({ timestamp: at(i + 1), cache: 'c', event_type: 'anomaly', category: 'statistical', trigger: 'vrp_announced', severity: i % 2 ? 'high' : 'medium', z_scores: { vrp_announced: 161.234, sync_duration_ns: 0.4 }, raw: { vrp_announced: 1200, sync_duration_ns: 712345678.9 } }));
  lines.push(JSON.stringify({ timestamp: at(-10 * 24 * 60), cache: 'c', event_type: 'anomaly', category: 'structural', trigger: 'reset', severity: 'high' }));
  lines.push(JSON.stringify({ timestamp: at(2), cache: 'c', event_type: 'error', error_text: 'bad PDU', error_code: 3 }));
  lines.push(JSON.stringify({ timestamp: at(3), cache: 'c', event_type: 'reset', reset_reason: 'cache_reset_pdu' }));
  const d = summarise(parseLines(lines.join('\n')), T0 + 3600e3);
  assert.equal(d.anomalies.total, MAX_ANOMALIES + 6);
  assert.equal(d.anomalies.last_7_days, MAX_ANOMALIES + 5);
  assert.equal(d.anomalies.high + d.anomalies.medium, MAX_ANOMALIES + 6);
  assert.equal(d.anomalies.list.length, MAX_ANOMALIES);
  assert.equal(d.anomalies.list[0].at, at(MAX_ANOMALIES + 5));
  assert.deepEqual(d.anomalies.list[0].z, { vrp_announced: 161.2, sync_duration_ns: 0.4 });
  assert.deepEqual(d.anomalies.list[0].raw, { vrp_announced: 1200, sync_duration_ns: 712345679 });
  assert.deepEqual(d.events.map((e) => e.type), ['reset', 'error']);
  assert.equal(d.events[1].code, 3);
  assert.equal(d.events[1].reason, 'bad PDU');
  assert.equal(d.events[0].reason, 'cache_reset_pdu');
});

test('the hourly points keep 30 days', () => {
  const lines = [sync(-(KEEP_DAYS + 1) * 24 * 60), sync(-(KEEP_DAYS - 1) * 24 * 60), sync(0)];
  const d = summarise(parseLines(lines.join('\n')), T0);
  assert.equal(d.series.points.length, 2);
  assert.equal(d.telemetry.syncs, 3);
});

await test('a cache that refuses RTR version 2: the probe is an event, not an anomaly, and the session carries no ASPA', () => {
  const lines = [
    JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 }),
    JSON.stringify({ timestamp: at(0.01), cache: 'c', event_type: 'error', error_text: 'Bad protocol version\u0000', error_code: 4, proto_version: 2 }),
    JSON.stringify({ timestamp: at(0.01), cache: 'c', event_type: 'anomaly', category: 'structural', trigger: 'error_report', severity: 'high' }),
    JSON.stringify({ timestamp: at(0.1), cache: 'c', event_type: 'connected' }),                      // version 0: the monitor leaves the zero out
    sync(0.2, { sync_type: 'full', aspa_total: 0, vrp_announced: 1000 }),
    sync(2, { serial: 3, aspa_total: 0 }),
    JSON.stringify({ timestamp: at(3), cache: 'c', event_type: 'anomaly', category: 'structural', trigger: 'reset', severity: 'high' }),
  ];
  const d = summarise(parseLines(lines.join('\n')), T0 + 5 * 60e3, { session_state: 1, protocol_version: 2 });   // the gauge still says 2
  assert.equal(d.anomalies.total, 1);                                  // the reset, not the probe
  assert.equal(d.anomalies.probes, 1);
  assert.equal(d.anomalies.list[0].trigger, 'reset');
  assert.equal(d.session.protocol, 0);
  assert.equal(d.session.carries_aspa, false);
  const err = d.events.find((e) => e.type === 'error');
  assert.equal(err.probe, true);
  assert.equal(err.reason, 'Bad protocol version');
  assert.equal(err.code, 4);
  const v2 = summarise(parseLines([JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 }), sync(1)].join('\n')), T0 + 5 * 60e3);
  assert.equal(v2.session.protocol, 2);
  assert.equal(v2.session.carries_aspa, true);
});

await test('a later monitor writes the refusal as a version_downgrade: one probe event, no anomaly, the refused session left out', () => {
  const lines = [
    JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'version_downgrade', schema_version: 1, error_text: 'Bad protocol version\u0000', error_code: 4, proto_version: 2, next_proto_version: 0, downgrade_reason: 'unsupported_version' }),
    JSON.stringify({ timestamp: at(0.001), cache: 'c', event_type: 'disconnected', schema_version: 1, error_text: 'cache does not support this RTR protocol version', error_code: 4, proto_version: 2, disconnect_reason: 'error_report' }),
    JSON.stringify({ timestamp: at(0.01), cache: 'c', event_type: 'connected', schema_version: 1, proto_version: 0 }),
    sync(0.2, { sync_type: 'full', aspa_total: 0, vrp_announced: 1000, proto_version: 0 }),
    sync(2, { serial: 3, aspa_total: 0, proto_version: 0 }),
    JSON.stringify({ timestamp: at(3), cache: 'c', event_type: 'disconnected', schema_version: 1, proto_version: 0, disconnect_reason: 'eof' }),
    JSON.stringify({ timestamp: at(3.1), cache: 'c', event_type: 'connected', schema_version: 1, proto_version: 0 }),
  ];
  const d = summarise(parseLines(lines.join('\n')), T0 + 5 * 60e3, { session_state: 1, protocol_version: 0 });
  assert.equal(d.anomalies.total, 0);
  assert.equal(d.anomalies.probes, 0);
  assert.equal(d.session.protocol, 0);
  assert.equal(d.session.carries_aspa, false);
  assert.deepEqual(d.events.map((e) => e.type), ['connected', 'disconnected', 'connected', 'version_downgrade']);   // newest first
  const down = d.events[3];
  assert.equal(down.probe, true);
  assert.equal(down.reason, 'Bad protocol version');
  assert.equal(down.code, 4);
  assert.equal(down.protocol, 2);
  assert.equal(down.next_protocol, 0);
  assert.equal(d.events[1].reason, 'eof');                             // a session that drops later is still an event
});

await test('a serial that does not advance: stale after three hours of syncs without a change, not when the session is down or the syncs stopped', () => {
  const lines = [JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', proto_version: 2 }), sync(0, { sync_type: 'full' }), sync(10, { serial: 7 })];
  for (let m = 20; m <= 200; m += 10) lines.push(sync(m, { serial: 7, serial_changed: false }));
  const r = parseLines(lines.join('\n'));
  const d = summarise(r, T0 + 200 * 60e3);
  assert.equal(d.session.last_serial_change, at(10));
  assert.equal(d.session.serial_stale, true);
  assert.equal(d.session.stale_after_s, STALE_AFTER / 1000);
  assert.equal(summarise(r, T0 + 100 * 60e3).session.serial_stale, false);                         // too early
  assert.equal(summarise(r, T0 + 200 * 60e3, { session_state: 0 }).session.serial_stale, false);   // down: another problem
  assert.equal(summarise(r, T0 + 600 * 60e3).session.serial_stale, false);                         // the syncs stopped as well: not this signal
  const m = summarise(r, T0 + 200 * 60e3, { session_state: 1, last_serial_change_seconds: (T0 + 190 * 60e3) / 1000 });
  assert.equal(m.session.serial_stale, false);                                                      // the gauge of the monitor knows better
  assert.equal(m.session.last_serial_change, at(190));
  // a full resync (the validator restarted, or the session was reset) delivers everything again: the clock restarts, whatever the gauge says
  const reset = parseLines([...lines, JSON.stringify({ timestamp: at(150), cache: 'c', event_type: 'connected', proto_version: 2 }), sync(150, { sync_type: 'full', serial_changed: false, serial: undefined })].join('\n'));
  const f = summarise(reset, T0 + 200 * 60e3, { session_state: 1, last_serial_change_seconds: (T0 + 10 * 60e3) / 1000 });
  assert.equal(f.session.serial_stale, false);
  assert.equal(f.session.last_serial_change, at(150));
  assert.equal(f.session.last_change_resync, true, 'the change is a resync on a new session, not the serial moving on');
  assert.equal(d.session.last_change_resync, false);
  assert.equal(m.session.last_change_resync, false, 'the gauge saw the serial move later than any full sync');
  assert.equal(summarise(reset, T0 + 340 * 60e3, { session_state: 1, last_serial_change_seconds: (T0 + 10 * 60e3) / 1000 }).session.serial_stale, true);   // and then stale again
});

await test('the caches from the environment: one by default, several from JSON, a bad list refused', async () => {
  const one = await cachesFromEnv({});
  assert.equal(one.length, 1);
  assert.equal(one[0].id, 'routinator');
  assert.equal(one[0].telemetry, '/var/db/raven/rtr-telemetry.ndjson');
  assert.equal(one[0].metrics, 'http://127.0.0.1:9595/metrics');
  assert.equal((await cachesFromEnv({ RTR_METRICS: '', RTR_CACHE: 'x.example' }))[0].metrics, null);
  const two = await cachesFromEnv({ RTR_CACHES: '[{"id":"a","telemetry":"/a.ndjson"},{"id":"b","name":"B","host":"b.example","telemetry":"/b.ndjson","metrics":"http://127.0.0.1:1/metrics","note":"n"}]' });
  assert.equal(two.length, 2);
  assert.equal(two[0].name, 'a');
  assert.equal(two[0].metrics, null);
  assert.equal(two[1].note, 'n');
  assert.deepEqual(two[1].mute, []);
  assert.deepEqual((await cachesFromEnv({ RTR_CACHES: '[{"id":"a","telemetry":"/a.ndjson","mute":["vrp_announced",3]}]' }))[0].mute, ['vrp_announced']);
  await assert.rejects(cachesFromEnv({ RTR_CACHES: '[{"name":"no id"}]' }));
  // who runs a cache and with what: text fields trimmed, the AS number a positive integer, anything else left out
  const who = (await cachesFromEnv({ RTR_CACHES: '[{"id":"a","telemetry":"/a.ndjson","operator":" Example S.p.A. ","asn":64500,"place":"Zurich","software":"Routinator","version":"0.15.1","version_url":"http://127.0.0.1:1/version"},{"id":"b","telemetry":"/b.ndjson","asn":"64501","operator":7,"software":""}]' }));
  assert.equal(who[0].operator, 'Example S.p.A.');
  assert.equal(who[0].asn, 64500);
  assert.equal(who[0].place, 'Zurich');
  assert.equal(who[0].software, 'Routinator');
  assert.equal(who[0].version, '0.15.1');
  assert.equal(who[0].version_url, 'http://127.0.0.1:1/version');
  for (const k of ['operator', 'asn', 'software', 'version', 'place']) assert.equal(k in who[1], false, k);
  assert.equal(versionIn('0.15.3\n'), '0.15.3');
  assert.equal(versionIn('Routinator 0.15.1-rc2 (built ...)'), '0.15.1-rc2');
  assert.equal(versionIn('fort 1.7.0'), '1.7.0');
  assert.equal(versionIn('<html>not found</html>'), null);
  await assert.rejects(cachesFromEnv({ RTR_CACHES: '[]' }));
});

await test('a delta with VRPs announced again while held: the changes leave them out, the anomaly and the event say how many', () => {
  const fault = (min, code, n) => JSON.stringify({ timestamp: at(min), cache: 'c', event_type: 'error', schema_version: 1, error_text: 'duplicate announcement received', error_code: code, error_origin: 'client', error_count: n, proto_version: 2 });
  const lines = [
    JSON.stringify({ timestamp: at(0), cache: 'c', event_type: 'connected', schema_version: 1, proto_version: 2 }),
    sync(0.1, { sync_type: 'full', vrp_announced: 1000 }),
    sync(10, { serial: 2, vrp_announced: 30, vrp_withdrawn: 10 }),
    fault(20, 7, 2255), fault(20, 6, 3),
    sync(20.001, { serial: 3, vrp_announced: 2276, vrp_withdrawn: 2263 }),
    JSON.stringify({ timestamp: at(20), cache: 'c', event_type: 'anomaly', schema_version: 1, category: 'structural', trigger: 'protocol_error', severity: 'high' }),
    JSON.stringify({ timestamp: at(20.001), cache: 'c', event_type: 'anomaly', schema_version: 1, category: 'statistical', trigger: 'vrp_announced', severity: 'high', z_scores: { vrp_announced: 16.4 }, raw: { vrp_announced: 2276, vrp_withdrawn: 2263 } }),
    sync(20.05, { sync_type: 'full', serial: 3, serial_changed: false, vrp_announced: 1013 }),   // the monitor asks for everything again
  ];
  const d = summarise(parseLines(lines.join('\n')), T0 + 30 * 60e3, { session_state: 1, protocol_version: 2 });
  assert.equal(d.last_24h.vrp_announced, 30 + 21);
  assert.equal(d.last_24h.vrp_withdrawn, 10 + 8);
  assert.equal(d.last_24h.vrp_repeated, 2255);
  assert.equal(d.last_24h.protocol_errors, 2);
  assert.equal(d.series.points[0][3], 30 + 10 + 21 + 8);
  const [stat, proto] = d.anomalies.list;                              // newest first
  assert.equal(proto.trigger, 'protocol_error');
  assert.equal(proto.repeated, 2255);
  assert.equal(proto.unknown, 3);
  assert.equal(proto.unreadable, undefined);
  assert.equal(stat.repeated, 2255);
  assert.equal(stat.unknown, undefined);
  assert.equal(stat.raw.vrp_announced, 2276);                          // what the monitor measured stays as it is
  const ev = d.events.find((e) => e.code === 7);
  assert.equal(ev.found_by_monitor, true);
  assert.equal(ev.count, 2255);
  assert.equal(d.events.find((e) => e.type === 'connected').found_by_monitor, undefined);
  // a sync without such an error is untouched
  const plain = summarise(parseLines([sync(1, { vrp_announced: 5, vrp_withdrawn: 2 })].join('\n')), T0 + 5 * 60e3);
  assert.equal(plain.last_sync.vrp_repeated, undefined);
  assert.equal(plain.last_24h.vrp_repeated, 0);
});

await test('a record that the monitor could not read (code 0) is counted on the anomaly and named in the events', () => {
  const lines = [
    sync(0.1, { sync_type: 'full', vrp_announced: 1000 }),
    JSON.stringify({ timestamp: at(20), cache: 'c', event_type: 'error', schema_version: 1, error_text: 'corrupt data', error_code: 0, error_origin: 'client', error_count: 2, proto_version: 2 }),
    sync(20.001, { serial: 2, vrp_announced: 30, vrp_withdrawn: 10 }),
    JSON.stringify({ timestamp: at(20), cache: 'c', event_type: 'anomaly', schema_version: 1, category: 'structural', trigger: 'protocol_error', severity: 'high' }),
  ];
  const d = summarise(parseLines(lines.join('\n')), T0 + 30 * 60e3);
  const proto = d.anomalies.list.find((a) => a.trigger === 'protocol_error');
  assert.equal(proto.unreadable, 2);
  assert.equal(proto.repeated, undefined);
  assert.equal(proto.unknown, undefined);
  const ev = d.events.find((e) => e.found_by_monitor);
  assert.equal(ev.code, 0);
  assert.equal(ev.count, 2);
  assert.equal(d.last_24h.vrp_announced, 30);                          // the counts of the delta are not corrected for it
  assert.equal(d.last_24h.vrp_repeated, 0);
});

await test('a monitor that says what changed: the changes are the net counts, not the PDUs', () => {
  const fault = (min, n) => JSON.stringify({ timestamp: at(min), cache: 'c', event_type: 'error', schema_version: 1, error_text: 'duplicate announcement received', error_code: 7, error_origin: 'client', error_count: n, proto_version: 2 });
  const lines = [
    sync(0.1, { sync_type: 'full', vrp_announced: 1000, vrp_added: 1000, vrp_removed: 0, aspa_announced: 40, aspa_added: 40, aspa_removed: 0 }),
    // an ASPA announced for a customer that has one already replaces its providers: one PDU, no record more
    sync(10, { serial: 2, vrp_announced: 30, vrp_withdrawn: 10, vrp_added: 30, vrp_removed: 10, aspa_announced: 3, aspa_withdrawn: 1, aspa_added: 2, aspa_removed: 1 }),
    fault(20, 2255),
    sync(20.001, { serial: 3, vrp_announced: 2276, vrp_withdrawn: 2263, vrp_added: 21, vrp_removed: 8, aspa_announced: 0, aspa_withdrawn: 0, aspa_added: 0, aspa_removed: 0 }),
    JSON.stringify({ timestamp: at(20), cache: 'c', event_type: 'anomaly', schema_version: 1, category: 'structural', trigger: 'protocol_error', severity: 'high' }),
    JSON.stringify({ timestamp: at(20.001), cache: 'c', event_type: 'anomaly', schema_version: 1, category: 'statistical', trigger: 'sync_duration_ns', severity: 'medium', z_scores: { sync_duration_ns: 9 }, raw: { sync_duration_ns: 4e9, vrp_announced: 21, vrp_withdrawn: 8 } }),
    // the monitor asks for everything again and finds 5 records it had lost: its own state, not a change of the cache
    sync(20.05, { sync_type: 'full', serial: 3, serial_changed: false, vrp_announced: 1033, vrp_added: 5, vrp_removed: 2, aspa_announced: 41, aspa_added: 0, aspa_removed: 0 }),
  ];
  const d = summarise(parseLines(lines.join('\n')), T0 + 30 * 60e3, { session_state: 1, protocol_version: 2 });
  assert.equal(d.last_24h.vrp_announced, 30 + 21);
  assert.equal(d.last_24h.vrp_withdrawn, 10 + 8);
  assert.equal(d.last_24h.aspa_announced, 2);
  assert.equal(d.last_24h.aspa_withdrawn, 1);
  assert.equal(d.last_24h.vrp_repeated, 2255);
  assert.equal(d.series.points[0][3], 30 + 10 + 21 + 8);
  assert.equal(d.series.points[0][4], 2 + 1);
  assert.equal(d.last_sync.vrp_announced, 1033);                       // a full sync: everything the cache holds
  const [stat, proto] = d.anomalies.list;
  assert.equal(proto.repeated, 2255);
  assert.equal(stat.repeated, undefined);                              // its values are net: nothing to take off
  assert.equal(stat.raw.vrp_announced, 21);
});

test('the address of an anomaly, and the anomaly read from the raw telemetry: the entry that the file has', () => {
  const id = idOf('daknob_zrh2', '2026-11-18T14:24:21Z', 'vrp_withdrawn');
  assert.equal(id, 'rtr-a-daknob_zrh2-20261118T142421Z-vrp_withdrawn');
  assert.deepEqual(parseId(id), { cache: 'daknob_zrh2', at: '2026-11-18T14:24:21Z', trigger: 'vrp_withdrawn' });
  for (const bad of ['', 'rtr-title', 'rtr-a-x-20261118T142421Z', 'rtr-a-../x-20261118T142421Z-a', 'rtr-a-x-2026-11-18T14:24:21Z-a', 'rtr-a-x-20261118T142421Z-<b>']) assert.equal(parseId(bad), null);

  const ms = (min, extra) => new Date(T0 + min * 60e3 + extra).toISOString();
  const rec = (min, extra, o) => JSON.stringify({ timestamp: ms(min, extra), cache: 'c', schema_version: 1, ...o });
  const text = [
    // a statistical anomaly of a sync whose counts are PDUs, with VRPs announced again while held; and the structural one of the same sync
    rec(10, 100, { event_type: 'error', error_code: 7, error_origin: 'client', error_count: 12 }),
    rec(10, 100, { event_type: 'error', error_code: 6, error_origin: 'client', error_count: 3 }),
    rec(10, 100, { event_type: 'anomaly', category: 'structural', trigger: 'protocol_error', severity: 'high' }),
    rec(10, 200, { event_type: 'sync', sync_type: 'incremental', serial_changed: true, vrp_total: 1000, aspa_total: 40, vrp_announced: 500, vrp_withdrawn: 400, aspa_announced: 0, aspa_withdrawn: 0 }),
    rec(10, 200, { event_type: 'anomaly', category: 'statistical', trigger: 'vrp_announced', severity: 'medium', z_scores: { vrp_announced: 12.3456, vrp_withdrawn: 2 }, raw: { vrp_announced: 500, vrp_withdrawn: 400, sync_duration_ns: 1234567890.4 } }),
    // one of a sync that says what changed: nothing to take off
    rec(30, 0, { event_type: 'error', error_code: 7, error_origin: 'client', error_count: 5 }),
    rec(30, 300, { event_type: 'sync', sync_type: 'incremental', serial_changed: true, vrp_total: 1000, aspa_total: 40, vrp_announced: 9000, vrp_withdrawn: 5, vrp_added: 8995, vrp_removed: 0, aspa_added: 0, aspa_removed: 0 }),
    rec(30, 300, { event_type: 'anomaly', category: 'statistical', trigger: 'vrp_announced', severity: 'high', z_scores: { vrp_announced: 3864.386 }, raw: { vrp_announced: 8995 } }),
    // a refused probe of the version, which is not an anomaly, and a later one written with another time zone
    rec(40, 0, { event_type: 'error', error_code: 4 }),
    rec(40, 10, { event_type: 'anomaly', category: 'structural', trigger: 'error_report', severity: 'high' }),
    JSON.stringify({ timestamp: '2026-11-09T15:50:00.5+01:00', cache: 'c', event_type: 'anomaly', category: 'structural', trigger: 'data_stale', severity: 'medium' }),
    'not json',
  ].join('\n');
  const list = summarise(parseLines(text), T0 + 2 * 3600e3).anomalies.list;
  assert.equal(list.length, 4);
  for (const a of list) assert.deepEqual(fromTelemetry(text, a.at, a.trigger), a);
  assert.equal(list.find((a) => a.trigger === 'protocol_error').unknown, 3);
  assert.equal(list.find((a) => a.trigger === 'vrp_announced' && a.severity === 'medium').repeated, 12);
  assert.equal(list.find((a) => a.trigger === 'data_stale').at, '2026-11-09T14:50:00Z');
  assert.equal(fromTelemetry(text, at(40), 'error_report'), null);       // the probe
  assert.equal(fromTelemetry(text, at(10), 'vrp_withdrawn'), null);      // another trigger
  assert.equal(fromTelemetry(text, at(11), 'vrp_announced'), null);      // another time
  assert.equal(fromTelemetry(text, 'never', 'vrp_announced'), null);
  assert.equal(fromTelemetry('', at(10), 'vrp_announced'), null);
});

test('the address of a period, and what a cache did in it: records lost and back, an ordinary change, no sync, no ASPA', () => {
  const from = Date.parse('2026-11-18T14:10:00Z'), to = Date.parse('2026-11-18T14:40:00Z');
  assert.equal(idOfWindow(from, to), 'rtr-w-20261118T1410Z-20261118T1440Z');
  assert.deepEqual(parseWindow('rtr-w-20261118T1410Z-20261118T1440Z'), { from, to });
  assert.deepEqual(parseWindow('rtr-w-20261118T2350Z-20261119T0020Z'), { from: Date.parse('2026-11-18T23:50:00Z'), to: Date.parse('2026-11-19T00:20:00Z') });
  for (const bad of ['', 'rtr-w-20261118T1410Z', 'rtr-w-20261118T1440Z-20261118T1410Z', 'rtr-w-20261118T1410Z-20261118T1410Z', 'rtr-w-20261118T1410Z-20261120T1410Z',
    'rtr-w-20261318T1410Z-20261318T1440Z', 'rtr-w-20261118T1410Z-20261118T1470Z', 'rtr-a-x-20261118T142421Z-a']) assert.equal(parseWindow(bad), null);

  const sync = (time, vrp, aspa, v = 2) => JSON.stringify({ timestamp: time, cache: 'c', event_type: 'sync', sync_type: 'incremental', proto_version: v, vrp_total: vrp, aspa_total: aspa });
  const anomaly = (time, trigger) => JSON.stringify({ timestamp: time, cache: 'c', event_type: 'anomaly', category: 'statistical', trigger, severity: 'high' });
  const lost = [sync('2026-11-18T14:01:15Z', 1036433, 4173), sync('2026-11-18T14:18:02.3Z', 658928, 1821), anomaly('2026-11-18T14:18:02.3Z', 'vrp_withdrawn'),
    sync('2026-11-18T14:33:32.8Z', 1036465, 4172), anomaly('2026-11-18T14:33:32.8Z', 'vrp_announced'), anomaly('2026-11-18T15:00:00Z', 'vrp_announced'), sync('2026-11-18T14:50:00Z', 1036470, 4172)].join('\n');
  const w = windowOf(lost, from, to);
  assert.equal(w.syncs, 2);
  assert.deepEqual(w.before, { at: '2026-11-18T14:01:15Z', vrp: 1036433, aspa: 4173 });
  assert.deepEqual(w.lowest, { at: '2026-11-18T14:18:02Z', vrp: 658928, aspa: 1821 });
  assert.deepEqual(w.after, { at: '2026-11-18T14:33:32Z', vrp: 1036465, aspa: 4172 });
  assert.deepEqual(w.drop, { vrp: 377505, aspa: 2352 });
  assert.equal(w.fell, true);
  assert.equal(w.back, '2026-11-18T14:33:32Z');
  assert.deepEqual(w.anomalies, [{ at: '2026-11-18T14:18:02Z', trigger: 'vrp_withdrawn' }, { at: '2026-11-18T14:33:32Z', trigger: 'vrp_announced' }]);
  // the period ends before the records are back
  const short = windowOf(lost, from, Date.parse('2026-11-18T14:30:00Z'));
  assert.equal(short.fell, true);
  assert.equal(short.back, null);
  // only the ASPAs fall
  const aspas = windowOf([sync('2026-11-18T14:00:00Z', 1000000, 4000), sync('2026-11-18T14:20:00Z', 1000010, 3000), sync('2026-11-18T14:30:00Z', 1000020, 3999)].join('\n'), from, to);
  assert.deepEqual([aspas.fell, aspas.drop, aspas.lowest.at, aspas.back], [true, { vrp: 0, aspa: 1000 }, '2026-11-18T14:20:00Z', '2026-11-18T14:30:00Z']);
  // an ordinary change, on a session that carries no ASPA
  const plain = windowOf([sync('2026-11-18T14:00:00Z', 1036396, 0, 0), sync('2026-11-18T14:17:00Z', 1036387, 0, 0), sync('2026-11-18T14:27:00Z', 1036424, 0, 0)].join('\n'), from, to);
  assert.deepEqual([plain.syncs, plain.fell, plain.drop, plain.back, plain.after.aspa, plain.anomalies], [2, false, { vrp: 9, aspa: 0 }, null, null, []]);
  // no sync before the period: the first one in it is where the cache starts from; no sync in it
  assert.deepEqual(windowOf(sync('2026-11-18T14:20:00Z', 5, 1), from, to).drop, { vrp: 0, aspa: 0 });
  const quiet = windowOf(sync('2026-11-18T13:00:00Z', 7, 1), from, to);
  assert.deepEqual([quiet.syncs, quiet.before.vrp, quiet.lowest, quiet.after, quiet.fell], [0, 7, null, null, false]);
  assert.equal(windowOf('', from, to).before, null);
});

test('a cache next to the others: far from their median in VRPs or ASPAs, among the caches that are up', () => {
  const c = (id, vrp, aspa, o = {}) => ({ id, last_sync: { vrp_total: vrp, aspa_total: aspa }, session: { connected: true, expired: false, carries_aspa: aspa !== null && o.carries !== false, ...o.session } });
  const caches = [c('a', 1036914, 4212), c('b', 1037012, 4213), c('c', 1037016, 4207), c('d', 1037035, 4212), c('old', 1030953, 0), c('v0', 1036898, 0, { carries: false }), c('slow', 1036362, 0, { carries: false })];
  assert.deepEqual(apartOf(caches[4], caches), { vrp: -6010, aspa: null, others: 6, beyond: ['vrp'] });            // an old set; it holds no ASPA, which is not compared
  assert.deepEqual(apartOf(caches[0], caches), { vrp: -41, aspa: 0, others: 6, beyond: [] });
  assert.deepEqual(apartOf(caches[6], caches).beyond, []);                                                         // 600 fewer: under the floor
  assert.deepEqual(apartOf(c('x', 1037000 + APART.vrp + 100, 4212 - APART.aspa), caches).beyond, ['vrp', 'aspa']); // more is apart as well
  assert.equal(apartOf(c('x', 1037000, 4212 - APART.aspa + 1), caches).beyond.length, 0);
  // down, expired or without a sync: not compared, and not among the others
  assert.equal(apartOf(c('x', 1, 1, { session: { connected: false } }), caches), null);
  assert.equal(apartOf(c('x', 1, 1, { session: { expired: true } }), caches), null);
  assert.equal(apartOf({ id: 'x', session: { connected: true }, last_sync: null }, caches), null);
  const few = [c('a', 1000000, 4000), c('b', 1000000, 4000), c('down', 5, 5, { session: { connected: false } })];
  assert.equal(apartOf(c('x', 900000, 3000), few), null);                                                         // two others that are up: too few
  const three = [...few, c('e', 1000000, 4000)];
  assert.deepEqual(apartOf(c('x', 900000, 3000), three), { vrp: -100000, aspa: -1000, others: 3, beyond: ['vrp', 'aspa'] });
  assert.equal(apartOf(c('x', 1000000, 3000), [c('a', 1000000, 4000), c('b', 1000000, 4000), c('v0', 1000000, 0, { carries: false })]).aspa, null);   // two with ASPAs: too few
  assert.equal(apartOf(three[0], three), null);                                                                    // itself is not among the others: two left
  assert.equal(apartOf(three[0], [...three, c('f', 1000000, 4000)]).vrp, 0);
});

console.log(`${passed} tests passed`);
