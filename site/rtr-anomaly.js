'use strict';

// A link to one anomaly of the RTR caches tab of the Right now page (#rtr-a-<cache>-<time>-<what was off>) and to what every cache did in
// a period (#rtr-w-<from>-<to>), and both read from the raw
// telemetry of its monitor (/api/v1/rtr/<cache>.ndjson) when /api/v1/rtr.json, which keeps the newest ones only, has it no more.
// The entry is the one that scripts/build-rtr.mjs writes in the list of the anomalies of a cache: scripts/test-rtr.mjs compares the two.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AspaRtrAnomaly = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
  const nz = (x) => (Number.isFinite(x) ? x : 0);
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

  // 'routinator', '2026-11-18T14:18:02Z', 'vrp_withdrawn' <-> 'rtr-a-routinator-20261118T141802Z-vrp_withdrawn'. The trigger is part
  // of it because a sync can have two anomalies, one of its numbers and one of the records against the protocol.
  const idOf = (cache, at, trigger) => `rtr-a-${cache}-${String(at).replace(/[-:]/g, '')}-${trigger || 'unknown'}`;
  const parseId = (id) => {
    const m = /^rtr-a-([a-z0-9_]+)-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z-([a-z0-9_]+)$/.exec(String(id || ''));
    return m ? { cache: m[1], at: `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`, trigger: m[8] } : null;
  };

  const records = (text) => {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let r;
      try { r = JSON.parse(s); } catch { continue; }
      if (!r || typeof r !== 'object' || typeof r.event_type !== 'string') continue;
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) out.push({ ...r, t });
    }
    return out.sort((a, b) => a.t - b.t);
  };

  // The anomaly of that trigger written in the second `at` (as in rtr.json: UTC, no fraction), or null: {at, category, trigger, severity, z, raw} and,
  // as there, `repeated` and `unknown` for the records against the protocol. A refused probe of the RTR version is not an anomaly.
  function fromTelemetry(text, at, trigger) {
    const want = Date.parse(at);
    if (!Number.isFinite(want)) return null;
    const near = records(text).filter((r) => Math.abs(r.t - want) <= 3000);
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

  // A period, to the minute, as the address of what every cache did in it: Date.parse('2026-11-18T14:10Z') and ...T14:40Z <->
  // 'rtr-w-20261118T1410Z-20261118T1440Z'. A day at most.
  const MAX_WINDOW = 24 * 3600e3;
  const stamp = (ms) => `${new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 13)}Z`;
  const idOfWindow = (from, to) => `rtr-w-${stamp(from)}-${stamp(to)}`;
  const parseWindow = (id) => {
    const m = /^rtr-w-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)Z-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)Z$/.exec(String(id || ''));
    if (!m) return null;
    const n = m.slice(1).map(Number);
    const from = Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4]), to = Date.UTC(n[5], n[6] - 1, n[7], n[8], n[9]);
    return to > from && to - from <= MAX_WINDOW && idOfWindow(from, to) === id ? { from, to } : null;
  };

  // What a cache did from `from` to `to` (ms), from the raw telemetry of its monitor: the records it held at the last sync before the
  // period, at the lowest point in it and at its last sync ({at, vrp, aspa}; aspa null for a session that carries no ASPA), how many it
  // lost from the first to the lowest (`drop`), whether that is out of the ordinary (`fell`: more than a thousand VRPs or twenty ASPAs,
  // and more than 1% of them, the changes that the alerts of the site take as ones that could hurt a router), when it had them back
  // (`back`, null when not by the end) and the anomalies written in the period ({at, trigger}, as in rtr.json).
  function windowOf(text, from, to) {
    const all = records(text);
    const held = (r) => ({ at: iso(r.t), vrp: nz(r.vrp_total), aspa: r.proto_version >= 2 ? nz(r.aspa_total) : null });
    const syncs = all.filter((r) => r.event_type === 'sync' && Number.isFinite(r.vrp_total));
    const inside = syncs.filter((r) => r.t >= from && r.t <= to).map(held);
    const last = syncs.filter((r) => r.t < from).pop();
    const before = last ? held(last) : null;
    const probe = (a) => a.category === 'structural' && a.trigger === 'error_report' && all.some((r) => r.event_type === 'error' && r.error_code === 4 && Math.abs(r.t - a.t) <= 1000);
    const seen = new Set();
    const anomalies = all.filter((r) => r.event_type === 'anomaly' && r.t >= from && r.t <= to && !probe(r)).map((a) => ({ at: iso(a.t), trigger: a.trigger || 'unknown' }))
      .filter((a) => !seen.has(`${a.at} ${a.trigger}`) && seen.add(`${a.at} ${a.trigger}`));
    if (!inside.length) return { syncs: 0, before, lowest: null, after: null, drop: { vrp: 0, aspa: 0 }, fell: false, back: null, anomalies };
    const first = before || inside[0];
    const low = (k) => inside.reduce((m, r) => (r[k] !== null && (m === null || r[k] < m[k]) ? r : m), null);
    const lv = low('vrp'), la = low('aspa');
    const drop = { vrp: Math.max(0, first.vrp - lv.vrp), aspa: la && first.aspa !== null ? Math.max(0, first.aspa - la.aspa) : 0 };
    const vrpFell = drop.vrp > 1000 && drop.vrp > first.vrp / 100, aspaFell = drop.aspa > 20 && drop.aspa > first.aspa / 100;
    const lowest = vrpFell || !aspaFell ? lv : la;
    const ok = (r) => (!vrpFell || r.vrp >= first.vrp - Math.max(1000, first.vrp / 100)) && (!aspaFell || (r.aspa !== null && r.aspa >= first.aspa - Math.max(20, first.aspa / 100)));
    const again = vrpFell || aspaFell ? inside.find((r) => Date.parse(r.at) > Date.parse(lowest.at) && ok(r)) : null;
    return { syncs: inside.length, before, lowest, after: inside[inside.length - 1], drop, fell: vrpFell || aspaFell, back: again ? again.at : null, anomalies };
  }

  return { idOf, parseId, fromTelemetry, idOfWindow, parseWindow, windowOf, MAX_WINDOW };
});
