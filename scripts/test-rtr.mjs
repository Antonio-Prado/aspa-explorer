// Unit tests for scripts/build-rtr.mjs (no dependencies). Run with: node scripts/test-rtr.mjs
import assert from 'node:assert/strict';
import { parseLines, parseMetrics, summarise, cachesFromEnv, KEEP_DAYS, MAX_ANOMALIES } from './build-rtr.mjs';

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
  await assert.rejects(cachesFromEnv({ RTR_CACHES: '[{"name":"no id"}]' }));
  await assert.rejects(cachesFromEnv({ RTR_CACHES: '[]' }));
});

console.log(`${passed} tests passed`);
