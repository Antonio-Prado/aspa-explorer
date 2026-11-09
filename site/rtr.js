'use strict';

// The "validator as a router sees it" section of the statistics page: /api/v1/rtr.json, built every five minutes by scripts/build-rtr.mjs
// from the telemetry of an independent RTR client (RAVEN's `rtr monitor`) that follows the Routinator of this site over RTR version 2.
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, fmt, when, lineChart } = window.AspaUI;
  const WHAT = {
    interval_since_ns: 'the time since the previous sync', sync_duration_ns: 'the duration of the sync',
    vrp_announced: 'the VRPs announced', vrp_withdrawn: 'the VRPs withdrawn', aspa_announced: 'the ASPAs announced', aspa_withdrawn: 'the ASPAs withdrawn',
    correlated: 'several measures at once', reset: 'the session was reset', error: 'an error in the session', disconnected: 'the session dropped', cache_not_ready: 'the cache was not ready',
  };
  const EVENT = { connected: 'Connected', disconnected: 'Disconnected', reset: 'Session reset', error: 'Error', cache_not_ready: 'Cache not ready' };
  const MIN = 60e3, HOUR = 3600e3;
  const ago = (ms) => (ms < 2 * MIN ? 'just now' : ms < 90 * MIN ? `${Math.round(ms / MIN)} min ago` : ms < 48 * HOUR ? `${Math.round(ms / HOUR)} h ago` : `${Math.round(ms / 86400e3)} days ago`);
  const value = (k, v) => (k.endsWith('_ns') ? `${fmt.format(Math.round(v / 1e9))} s` : fmt.format(v));
  const hourLabel = (s) => new Date(s * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  let doc = null;
  function drawCharts() {
    const key = $('rtr-metric').value;                        // aspa or vrp
    const pts = doc.series.points;
    const word = key === 'aspa' ? 'ASPAs' : 'VRPs';
    if (pts.length < 2) {
      $('rtr-chart').replaceChildren(el('p', { class: 'hint', text: 'Not enough hours of telemetry for a chart yet.' }));
      $('rtr-changes').replaceChildren();
      $('rtr-chart-note').textContent = '';
      return;
    }
    const labels = pts.map((p) => hourLabel(p[0]));
    const totals = pts.map((p) => (key === 'aspa' ? p[2] : p[1]));
    const changes = pts.map((p) => (key === 'aspa' ? p[4] : p[3]));
    lineChart($('rtr-chart'), labels, totals, { label: `${word} held by the RTR client, one point an hour`, yTitle: word });
    lineChart($('rtr-changes'), labels, changes, { label: `${word} announced or withdrawn in each hour`, yTitle: `${word} changed` });
    const lo = Math.min(...totals), hi = Math.max(...totals);
    $('rtr-chart-note').textContent = `${fmt.format(pts.length)} hours from ${labels[0]} to ${labels[labels.length - 1]} UTC. ${lo === hi ? `The ${word} stayed at ${fmt.format(lo)}` : `The ${word} went from ${fmt.format(lo)} at least to ${fmt.format(hi)} at most`}; the second chart counts the records announced or withdrawn in each hour (a full resync, which announces everything again, is not counted). The vertical axis of the first chart starts at zero, as the other charts of the page.`;
  }

  async function main() {
    if (!$('rtr-sub')) return;
    try {
      const r = await fetch('/api/v1/rtr.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      doc = await r.json();
    } catch (err) {
      $('rtr-sub').textContent = `The telemetry of the RTR session is not available (${err.message}). It is rebuilt every five minutes.`;
      return;
    }
    const now = Date.now();
    const s = doc.session || {}, ls = doc.last_sync, d = doc.last_24h || {}, an = doc.anomalies || { list: [] };
    $('rtr-sub').textContent = `An independent RTR client (RAVEN, the open-source BGP routing security monitor of Nokia, in its "rtr monitor" mode) follows the Routinator of this site at ${doc.cache} the way a router does, over RTR version ${s.protocol || 2}, which carries the ASPAs as well as the VRPs. It records every sync and runs an adaptive detector on them: each measure of a sync (its duration, the time since the one before, the records announced and withdrawn) against the median and the deviation of the previous ones. A validator that stops publishing, loses objects or floods its routers shows up here before any route changes. Telemetry since ${doc.telemetry && doc.telemetry.from ? when(doc.telemetry.from) : 'unknown'}, read ${when(doc.generated)}.`;

    const httpNote = doc.http && doc.http.aspas !== null && ls
      ? (doc.http.aspas === ls.aspa_total ? `the same as the JSON export of the site` : `the JSON export of the site has ${fmt.format(doc.http.aspas)}: a different moment of the cache, or a difference worth a look`)
      : 'the JSON export was not read';
    const tiles = [
      { label: 'RTR session', value: s.connected ? 'Up' : 'Down', note: s.connected ? `since ${s.since ? when(s.since) : 'unknown'}${s.expired ? ' · data expired' : ''}` : (s.since ? `last change ${when(s.since)}` : 'no session seen'), cls: s.connected && !s.expired ? 'v-valid' : 'v-invalid' },
      { label: 'Last sync', value: ls ? ago(now - Date.parse(ls.at)) : '–', note: ls ? `${ls.type || 'sync'}${ls.serial !== null ? `, serial ${fmt.format(ls.serial)}` : ''}${ls.duration_ms !== null ? `, ${fmt.format(ls.duration_ms)} ms` : ''}` : 'no sync yet' },
      { label: 'VRPs over RTR', value: ls ? fmt.format(ls.vrp_total) : '–', note: ls ? `last sync: +${fmt.format(ls.vrp_announced)} −${fmt.format(ls.vrp_withdrawn)}` : '' },
      { label: 'ASPAs over RTR', value: ls ? fmt.format(ls.aspa_total) : '–', note: httpNote },
      { label: 'Syncs in 24 hours', value: fmt.format(d.syncs || 0), note: d.syncs ? `${fmt.format(d.serial_changes || 0)} changed the serial${d.interval_median_s ? `, one every ${Math.round(d.interval_median_s / 60)} min` : ''}${d.full ? `, ${d.full} full` : ''}` : '' },
      { label: 'Anomalies in 7 days', value: fmt.format(an.last_7_days || 0), note: `${fmt.format(an.high || 0)} high and ${fmt.format(an.medium || 0)} medium since the start`, cls: an.last_7_days ? 'v-unknown' : 'v-valid' },
    ];
    $('rtr-tiles').replaceChildren(...tiles.map((t) => el('div', { class: `tile card${t.cls ? ` ${t.cls}` : ''}` },
      el('div', { class: 'label', text: t.label }), el('div', { class: 'value', text: t.value }), el('div', { class: 'note', text: t.note }))));

    $('rtr-metric').addEventListener('change', drawCharts);
    drawCharts();

    const values = (a) => Object.keys(a.raw || {}).filter((k) => k === a.trigger || (a.z && Math.abs(a.z[k] || 0) >= 3)).map((k) => `${WHAT[k] || k}: ${value(k, a.raw[k])}${a.z && Number.isFinite(a.z[k]) ? ` (z ${a.z[k]})` : ''}`).join('; ');
    $('rtr-anomalies').replaceChildren(...(an.list && an.list.length ? an.list.map((a) => el('tr', {},
      el('td', { text: when(a.at) }),
      el('td', {}, el('span', { class: `badge ${a.severity === 'high' ? 'v-invalid' : 'v-unknown'}`, text: a.severity || 'unknown' })),
      el('td', { text: `${WHAT[a.trigger] || a.trigger || 'unknown'}${a.category === 'structural' ? ' (the session itself)' : ''}` }),
      el('td', { text: values(a) || '–' }))) : [el('tr', {}, el('td', { colspan: '4', text: `None so far. The detector says nothing before it has seen 100 syncs and compares each sync with the last 500; it has seen ${fmt.format(doc.telemetry ? doc.telemetry.syncs : 0)}.` }))]));

    $('rtr-events').replaceChildren(...(doc.events && doc.events.length ? doc.events.map((e) => el('tr', {},
      el('td', { text: when(e.at) }),
      el('td', { text: EVENT[e.type] || e.type }),
      el('td', { text: [e.reason, e.code !== undefined ? `code ${e.code}` : null, e.protocol ? `RTR version ${e.protocol}` : null].filter(Boolean).join(', ') || '–' }))) : [el('tr', {}, el('td', { colspan: '3', text: 'No session event recorded.' }))]));

    $('rtr-note').textContent = `In the last 24 hours the cache announced ${fmt.format(d.vrp_announced || 0)} VRPs and withdrew ${fmt.format(d.vrp_withdrawn || 0)}, announced ${fmt.format(d.aspa_announced || 0)} ASPAs and withdrew ${fmt.format(d.aspa_withdrawn || 0)}${d.duration_max_ms ? `; the longest sync took ${fmt.format(d.duration_max_ms)} ms` : ''}. The same data is available as JSON (/api/v1/rtr.json), and the subscribers to the status alerts are told of every anomaly. RAVEN is BSD-3-Clause software by Nokia; the idea is explained in the RIPE Labs article "Your router trusts its validator. But who's watching the validator?".`;
  }
  main();
})();
