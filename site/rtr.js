'use strict';

// The "validator as a router sees it" section of the statistics page: /api/v1/rtr.json, built every five minutes by scripts/build-rtr.mjs
// from the telemetry of independent RTR clients (RAVEN's `rtr monitor`): one follows the Routinator of this site over RTR version 2,
// the others reference caches; the charts and the session events are those of the first, the anomalies those of all.
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
  const ext = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text, el('span', { class: 'sr-only', text: ' (opens in a new tab)' }));

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
    $('rtr-sub').replaceChildren('An independent RTR client (', ext('https://github.com/nokia/bgp-routing-security-monitor', 'RAVEN'), `, the open-source BGP routing security monitor of Nokia, in its "rtr monitor" mode) follows the Routinator of this site at ${doc.cache} the way a router does, over RTR version ${s.protocol || 2}, which carries the ASPAs as well as the VRPs. It records every sync and runs an adaptive detector on them: each measure of a sync (its duration, the time since the one before, the records announced and withdrawn) against the median and the deviation of the previous ones. A validator that stops publishing, loses objects or floods its routers shows up here before any route changes. Telemetry since ${doc.telemetry && doc.telemetry.from ? when(doc.telemetry.from) : 'unknown'}, read ${when(doc.generated)}.`);

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

    // the caches side by side: the first is the cache of the site, the others references; a change that all see comes from upstream
    const caches = Array.isArray(doc.caches) && doc.caches.length ? doc.caches : [{ id: doc.cache_id || 'routinator', name: doc.cache_name || 'Routinator of this site', host: doc.cache, session: s, last_sync: ls, last_24h: d, anomalies: an }];
    $('rtr-caches').replaceChildren(...caches.map((c) => {
      const cs = c.session || {}, cl = c.last_sync, cd = c.last_24h || {}, ca = c.anomalies || {};
      return el('tr', {},
        el('th', { scope: 'row' }, el('span', { text: c.name || c.id }), c.note ? el('br') : null, c.note ? el('small', { class: 'muted', text: c.note }) : null),
        el('td', {}, el('span', { class: `badge ${cs.connected && !cs.expired ? 'v-valid' : 'v-invalid'}`, text: cs.connected ? (cs.expired ? 'Up, data expired' : 'Up') : 'Down' })),
        el('td', { text: cs.protocol === null || cs.protocol === undefined ? '–' : `v${cs.protocol}${cs.carries_aspa ? '' : ', no ASPA'}` }),
        el('td', { class: 'num', text: cl ? fmt.format(cl.vrp_total) : '–' }),
        el('td', { class: 'num', text: cl ? (cs.carries_aspa ? fmt.format(cl.aspa_total) : 'not carried') : '–' }),
        el('td', { text: cl ? `${ago(now - Date.parse(cl.at))}${cl.type ? `, ${cl.type}` : ''}` : 'none yet' }),
        el('td', { class: 'num', text: fmt.format(cd.syncs || 0) }),
        el('td', { class: 'num', text: `${fmt.format(ca.last_7_days || 0)}${ca.probes ? ` (+${fmt.format(ca.probes)} version probes left out)` : ''}` }));
    }));
    if (caches.length > 1) {
      const withSync = caches.filter((c) => c.last_sync);
      const vrps = withSync.map((c) => c.last_sync.vrp_total);
      const spread = vrps.length > 1 ? Math.max(...vrps) - Math.min(...vrps) : 0;
      const ours = caches.filter((c) => c.host === doc.cache).length;
      $('rtr-caches-sub').textContent = `${caches.length} caches are followed, each by its own monitor: ${ours === 1 ? 'the validator of this site' : `the ${ours} validators of this site, with different code on the same host`}, and ${caches.length - ours === 1 ? 'a reference cache' : `${caches.length - ours} reference caches`} run by somebody else, from different code and different fetches of the same repositories. A change that every cache sees comes from upstream (a registry, a repository, a holder); one that a single cache sees is that validator's own; one that the validators of the site share and the references do not is in the network or the timing of the host.${vrps.length > 1 ? ` Right now the counts of VRPs are ${fmt.format(spread)} apart between the highest and the lowest${spread ? ' (they read the repositories at different moments)' : ''}.` : ''} A reference that speaks a version of RTR below 2 carries no ASPA, so it checks the VRPs only.`;
    } else $('rtr-caches-sub').textContent = 'One cache is followed: the validator of this site.';

    $('rtr-metric').addEventListener('change', drawCharts);
    drawCharts();

    const values = (a) => Object.keys(a.raw || {}).filter((k) => k === a.trigger || (a.z && Math.abs(a.z[k] || 0) >= 3)).map((k) => `${WHAT[k] || k}: ${value(k, a.raw[k])}${a.z && Number.isFinite(a.z[k]) ? ` (z ${a.z[k]})` : ''}`).join('; ');
    const allAnomalies = caches.flatMap((c) => ((c.anomalies && c.anomalies.list) || []).map((a) => ({ ...a, cache: c.name || c.id }))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
    const seen = caches.map((c) => `${fmt.format(c.telemetry ? c.telemetry.syncs : 0)} on ${c.name || c.id}`).join(', ');
    $('rtr-anomalies').replaceChildren(...(allAnomalies.length ? allAnomalies.map((a) => el('tr', {},
      el('td', { text: when(a.at) }),
      el('td', { text: a.cache }),
      el('td', {}, el('span', { class: `badge ${a.severity === 'high' ? 'v-invalid' : 'v-unknown'}`, text: a.severity || 'unknown' })),
      el('td', { text: `${WHAT[a.trigger] || a.trigger || 'unknown'}${a.category === 'structural' ? ' (the session itself)' : ''}` }),
      el('td', { text: values(a) || '–' }))) : [el('tr', {}, el('td', { colspan: '5', text: `None so far. The detector says nothing before it has seen 100 syncs on a cache and compares each sync with the last 500; it has seen ${seen}.` }))]));

    $('rtr-events').replaceChildren(...(doc.events && doc.events.length ? doc.events.map((e) => el('tr', {},
      el('td', { text: when(e.at) }),
      el('td', { text: e.probe ? 'Version probe refused' : (EVENT[e.type] || e.type) }),
      el('td', { text: [e.reason, e.code !== undefined ? `code ${e.code}` : null, e.protocol !== undefined ? `RTR version ${e.protocol}` : null].filter(Boolean).join(', ') || '–' }))) : [el('tr', {}, el('td', { colspan: '3', text: 'No session event recorded.' }))]));

    $('rtr-note').replaceChildren(`In the last 24 hours the cache of the site announced ${fmt.format(d.vrp_announced || 0)} VRPs and withdrew ${fmt.format(d.vrp_withdrawn || 0)}, announced ${fmt.format(d.aspa_announced || 0)} ASPAs and withdrew ${fmt.format(d.aspa_withdrawn || 0)}${d.duration_max_ms ? `; the longest sync took ${fmt.format(d.duration_max_ms)} ms` : ''}. The same data is available as `, el('a', { href: '/api/v1/rtr.json', text: 'JSON' }), ', the raw telemetry of each monitor as NDJSON (/api/v1/rtr/<id>.ndjson, see the ', el('a', { href: '/api.html', text: 'API page' }), '), and the subscribers to the status alerts are told of every anomaly. RAVEN is BSD-3-Clause software by Nokia, with its ', ext('https://ritmukhe.github.io/raven-docs/user-guide/cli-reference/#raven-rtr-monitor', 'documentation of the monitor'), '; the idea is explained in the RIPE Labs article ', ext('https://labs.ripe.net/author/ritesh-mukherjee/your-router-trusts-its-validator-but-whos-watching-the-validator/', 'Your router trusts its validator. But who\'s watching the validator?'), ' by Ritesh Mukherjee.');
  }
  main();
})();
