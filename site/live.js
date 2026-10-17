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

  const api = { subscription, parseUpdate, URL };
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
