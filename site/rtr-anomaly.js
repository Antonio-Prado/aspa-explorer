'use strict';

// A link to one anomaly of the RTR caches tab of the Right now page (#rtr-a-<cache>-<time>-<what was off>), and the anomaly itself read from the raw
// telemetry of its monitor (/api/v1/rtr/<cache>.ndjson) when /api/v1/rtr.json, which keeps the newest ones only, has it no more.
// The entry is the one that scripts/build-rtr.mjs writes in the list of the anomalies of a cache: scripts/test-rtr.mjs compares the two.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AspaRtrAnomaly = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
  const nz = (x) => (Number.isFinite(x) ? x : 0);

  // 'routinator', '2026-11-18T14:18:02Z', 'vrp_withdrawn' <-> 'rtr-a-routinator-20261118T141802Z-vrp_withdrawn'. The trigger is part
  // of it because a sync can have two anomalies, one of its numbers and one of the records against the protocol.
  const idOf = (cache, at, trigger) => `rtr-a-${cache}-${String(at).replace(/[-:]/g, '')}-${trigger || 'unknown'}`;
  const parseId = (id) => {
    const m = /^rtr-a-([a-z0-9_]+)-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z-([a-z0-9_]+)$/.exec(String(id || ''));
    return m ? { cache: m[1], at: `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`, trigger: m[8] } : null;
  };

  // The anomaly of that trigger written in the second `at` (as in rtr.json: UTC, no fraction), or null: {at, category, trigger, severity, z, raw} and,
  // as there, `repeated` and `unknown` for the records against the protocol. A refused probe of the RTR version is not an anomaly.
  function fromTelemetry(text, at, trigger) {
    const want = Date.parse(at);
    if (!Number.isFinite(want)) return null;
    const near = [];
    for (const line of String(text || '').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let r;
      try { r = JSON.parse(s); } catch { continue; }
      if (!r || typeof r !== 'object' || typeof r.event_type !== 'string') continue;
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t) && Math.abs(t - want) <= 3000) near.push({ ...r, t });
    }
    const probe = (a) => a.category === 'structural' && a.trigger === 'error_report' && near.some((r) => r.event_type === 'error' && r.error_code === 4 && Math.abs(r.t - a.t) <= 1000);
    const a = near.find((r) => r.event_type === 'anomaly' && Math.floor(r.t / 1000) * 1000 === want && (r.trigger || 'unknown') === trigger && !probe(r));
    if (!a) return null;
    const faultsOf = (code) => near.reduce((n, e) => n + (e.event_type === 'error' && e.error_origin === 'client' && e.error_code === code && Math.abs(e.t - a.t) <= 1000 ? nz(e.error_count) || 1 : 0), 0);
    const net = near.some((r) => r.event_type === 'sync' && Number.isFinite(r.vrp_added) && Math.abs(r.t - a.t) <= 1000);
    return {
      at, category: a.category || null, trigger: a.trigger || null, severity: a.severity || null,
      z: Object.fromEntries(Object.entries(a.z_scores || {}).map(([k, v]) => [k, round(v)])),
      raw: Object.fromEntries(Object.entries(a.raw || {}).map(([k, v]) => [k, round(v, 0)])),
      ...(faultsOf(7) && (a.trigger === 'protocol_error' || !net) ? { repeated: faultsOf(7) } : {}),
      ...(a.trigger === 'protocol_error' && faultsOf(6) ? { unknown: faultsOf(6) } : {}),
    };
  }

  return { idOf, parseId, fromTelemetry };
});
