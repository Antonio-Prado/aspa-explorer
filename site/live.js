'use strict';

// RIPE RIS Live in the browser: the BGP updates that the route collectors receive, as they arrive
// (https://ris-live.ripe.net/manual/). The page opens one WebSocket, subscribes to the updates whose AS path
// has the AS in it (or ends with it), and gives every announcement to a callback. Nothing is kept.
(function (root) {
  const URL = 'wss://ris-live.ripe.net/v1/ws/?client=aspa-explorer';

  // The subscription message: updates with announcements whose path ends with the AS ("origin") or has it anywhere.
  function subscription(asn, mode) {
    return { type: 'ris_subscribe', data: { path: mode === 'origin' ? `${asn}$` : String(asn), type: 'UPDATE', require: 'announcements' } };
  }

  // The announcements of one "ris_message" payload: [{prefix, path, peer, host}], the path as the collector got it
  // (collector side first). Paths with an AS_SET (a nested array) are left out, as everywhere on the site.
  function parseUpdate(data) {
    const path = data && data.path;
    if (!Array.isArray(path) || !path.length || !path.every((n) => Number.isInteger(n))) return [];
    const out = [];
    for (const a of data.announcements || []) for (const prefix of a.prefixes || []) out.push({ prefix, path, peer: data.peer_asn, host: data.host });
    return out;
  }

  // How old a moment is, in words: "12 min", "3 h 39 min", "2 days".
  function ageText(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'less than a minute';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h >= 48 ? `${Math.floor(h / 24)} days` : `${h} h ${m % 60} min`;
  }

  // The origins of the routes of a RIPEstat "bgp-state" answer, by prefix: Map prefix -> Map origin -> routes.
  // Paths that end in an AS_SET (a nested array) have no single origin and are left out.
  function snapshotOrigins(routes) {
    const out = new Map();
    for (const r of routes) {
      const origin = Array.isArray(r.path) ? r.path[r.path.length - 1] : null;
      if (!Number.isInteger(origin)) continue;
      const prefix = String(r.target_prefix).toLowerCase();
      if (!out.has(prefix)) out.set(prefix, new Map());
      const o = out.get(prefix);
      o.set(origin, (o.get(origin) || 0) + 1);
    }
    return out;
  }

  // The origins in a RIPEstat "looking-glass" answer for one prefix: Map origin -> peers that hold a route
  // with it right now. Only the routes of that very prefix count.
  function lookingGlassOrigins(data, prefix) {
    const out = new Map();
    for (const rrc of (data && data.rrcs) || []) {
      for (const p of rrc.peers || []) {
        const origin = Number(p.asn_origin);
        if (!Number.isInteger(origin) || String(p.prefix).toLowerCase() !== prefix.toLowerCase()) continue;
        out.set(origin, (out.get(origin) || 0) + 1);
      }
    }
    return out;
  }

  // The snapshot against the looking glass, prefix by prefix. `snapshot` is the Map of snapshotOrigins; `now` maps
  // a prefix to the Map of lookingGlassOrigins (a prefix that could not be read is left out of it). A row says
  // which origins of the snapshot are no longer announced (gone), which are new (added) and which stayed (kept).
  function compare(snapshot, now) {
    const rows = [];
    for (const [prefix, before] of snapshot) {
      const after = now.get(prefix);
      if (!after) continue;
      const gone = [...before.keys()].filter((o) => !after.has(o));
      const added = [...after.keys()].filter((o) => !before.has(o));
      const kept = [...before.keys()].filter((o) => after.has(o));
      rows.push({ prefix, before, after, gone, added, kept, changed: gone.length > 0 || added.length > 0 });
    }
    return rows;
  }

  // The routes of the snapshot whose origin the looking glass no longer holds, from the rows of compare: how many routes,
  // and for which prefixes (`items`: prefix, the origins gone, the routes they had in the snapshot).
  function withdrawn(rows) {
    const items = rows.filter((r) => r.gone.length).map((r) => ({ prefix: r.prefix, origins: r.gone, routes: r.gone.reduce((n, o) => n + r.before.get(o), 0) }));
    return { routes: items.reduce((n, i) => n + i.routes, 0), items };
  }

  const api = { subscription, parseUpdate, URL, ageText, snapshotOrigins, lookingGlassOrigins, compare, withdrawn };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // handlers: {announcement(a), status(text, state)}; returns {stop()}
  function watch(asn, mode, handlers) {
    const ws = new WebSocket(URL);
    let closed = false;
    ws.onopen = () => { handlers.status('Connected: waiting for updates…', 'open'); ws.send(JSON.stringify(subscription(asn, mode))); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'ris_error') { handlers.status(`RIS Live said: ${(m.data && m.data.message) || 'an error'}`, 'error'); return; }
      if (m.type === 'ris_message') for (const a of parseUpdate(m.data)) handlers.announcement(a);
    };
    ws.onerror = () => handlers.status('Could not reach RIS Live.', 'error');
    ws.onclose = () => { if (!closed) handlers.status('The connection was closed.', 'closed'); };
    return { stop() { closed = true; ws.close(); handlers.status('Stopped.', 'closed'); } };
  }

  root.AspaLive = Object.assign(api, { watch });
})(typeof self !== 'undefined' ? self : this);
