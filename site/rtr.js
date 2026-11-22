'use strict';

// The "validator as a router sees it" section of the Right now page: /api/v1/rtr.json, built every five minutes by scripts/build-rtr.mjs
// from the telemetry of independent RTR clients (RAVEN's `rtr monitor`): one follows the Routinator of this site over RTR version 2,
// the others reference caches; the charts and the session events are those of the first, the anomalies those of all.
(function () {
  const $ = (id) => document.getElementById(id);
  const { el, fmt, when, lineChart } = window.AspaUI;
  const A = window.AspaRtrAnomaly;
  const WHAT = {
    interval_since_ns: 'the time since the previous sync', sync_duration_ns: 'the duration of the sync',
    vrp_announced: 'the VRPs announced', vrp_withdrawn: 'the VRPs withdrawn', aspa_announced: 'the ASPAs announced', aspa_withdrawn: 'the ASPAs withdrawn',
    correlated: 'several measures at once', protocol_error: 'records against the protocol', data_stale: 'data unchanged for longer than usual', data_regressed: 'back to data served before', reset: 'the session was reset', error: 'an error in the session', disconnected: 'the session dropped', cache_not_ready: 'the cache was not ready',
  };
  const EVENT = { connected: 'Connected', disconnected: 'Disconnected', reset: 'Session reset', error: 'Error', cache_not_ready: 'Cache not ready',
    stale: 'Data stopped changing', stale_resolved: 'Data changing again', data_regressed: 'Back to data served before' };
  const MIN = 60e3, HOUR = 3600e3;
  const ago = (ms) => (ms < 2 * MIN ? 'just now' : ms < 90 * MIN ? `${Math.round(ms / MIN)} min ago` : ms < 48 * HOUR ? `${Math.round(ms / HOUR)} h ago` : `${Math.round(ms / 86400e3)} days ago`);
  const value = (k, v) => (k.endsWith('_ns') ? `${fmt.format(Math.round(v / 1e9))} s` : fmt.format(v));
  const hourLabel = (s) => new Date(s * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const ext = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text, el('span', { class: 'sr-only', text: ' (opens in a new tab)' }));

  let doc = null;
  let hours = 168;                                             // the period of the charts: the pressed button of #rtr-range
  function drawCharts() {
    const key = $('rtr-metric').value;                        // aspa or vrp
    const from = doc.series.points.length ? doc.series.points[doc.series.points.length - 1][0] - (hours - 1) * 3600 : 0;
    const pts = doc.series.points.filter((p) => p[0] >= from);          // the period chosen, counted back from the last hour
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
    $('rtr-chart-note').textContent = `${fmt.format(pts.length)} hours from ${labels[0]} to ${labels[labels.length - 1]} UTC${pts.length < hours && pts.length === doc.series.points.length ? ': all the telemetry there is so far' : ''}. ${lo === hi ? `The ${word} stayed at ${fmt.format(lo)}` : `The ${word} went from ${fmt.format(lo)} at least to ${fmt.format(hi)} at most`}; the second chart counts the records announced or withdrawn in each hour (a full resync, which announces everything again, is not counted). The vertical axis of the first chart starts at zero, as the other charts of the page.`;
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
    // a cache that holds a number of records far from the median of the others (`apart` in the file) says so under the number
    const apartNote = (c, k) => (c.apart && Array.isArray(c.apart.beyond) && c.apart.beyond.includes(k)
      ? [el('br'), el('small', { class: 'apart', text: `${fmt.format(Math.abs(c.apart[k]))} ${c.apart[k] < 0 ? 'fewer' : 'more'} than the others` })] : []);
    $('rtr-caches').replaceChildren(...caches.flatMap((c) => {
      const cs = c.session || {}, cl = c.last_sync, cd = c.last_24h || {}, ca = c.anomalies || {};
      // A cache is who runs it (and where, when an operator has two), its AS number, and the software with its version and the
      // version of RTR that the session speaks; what is peculiar to it has a line of its own under the row, as wide as the table.
      // A file without those fields (an older one) shows the name of the cache in the first column.
      const note = [c.note ? `${c.note[0].toUpperCase()}${c.note.slice(1)}${/[.!?]$/.test(c.note) ? '' : '.'}` : '',
        ca.probes ? `${fmt.format(ca.probes)} version probe${ca.probes === 1 ? ' is' : 's are'} left out of its anomalies.` : ''].filter(Boolean).join(' ');
      const proto = cs.protocol === null || cs.protocol === undefined ? '' : `RTR v${cs.protocol}`;
      const soft = [c.software, c.software && c.version].filter(Boolean).join(' ');
      const row = el('tr', note ? { class: 'hasnote' } : {},
        el('th', { scope: 'row' }, c.operator || c.name || c.id, c.operator && c.place ? el('small', { class: 'place', text: ` ${c.place}` }) : null),
        el('td', { class: 'nowrap' }, (c.asn && c.country && window.AspaNames && window.AspaNames.flagEl(c.country, `registered in ${window.AspaNames.countryName(c.country)}`)) || '', c.asn ? `AS${c.asn}` : '–'),
        el('td', { class: 'nowrap' }, soft || (proto ? '' : '–'), soft && proto ? el('small', { class: 'place', text: ` ${proto}` }) : (soft ? null : proto)),
        el('td', {}, el('span', { class: `badge ${cs.connected && !cs.expired ? 'v-valid' : 'v-invalid'}`, text: cs.connected ? (cs.expired ? 'Up, data expired' : 'Up') : 'Down' })),
        el('td', { class: 'num' }, cl ? fmt.format(cl.vrp_total) : '–', ...apartNote(c, 'vrp')),
        el('td', { class: 'num' }, cl ? (cs.carries_aspa ? fmt.format(cl.aspa_total) : 'not carried') : '–', ...apartNote(c, 'aspa')),
        el('td', { class: 'nowrap', text: cl ? `${ago(now - Date.parse(cl.at))}${cl.type && cl.type !== 'incremental' ? `, ${cl.type}` : ''}` : 'none yet' }),
        el('td', { class: 'num', text: fmt.format(cd.syncs || 0) }),
        el('td', { class: 'num', text: fmt.format(ca.last_7_days || 0) }));
      return note ? [row, el('tr', { class: 'noterow' }, el('td', { colspan: '9', text: note }))] : [row];
    }));
    if (caches.length > 1) {
      const withSync = caches.filter((c) => c.last_sync);
      const vrps = withSync.map((c) => c.last_sync.vrp_total);
      const spread = vrps.length > 1 ? Math.max(...vrps) - Math.min(...vrps) : 0;
      const ours = caches.filter((c) => c.host === doc.cache).length;
      $('rtr-caches-sub').textContent = `${caches.length} caches are followed, each by its own monitor: ${ours === 1 ? 'the validator of this site' : `the ${ours} validators of this site, with different code on the same host`}, and ${caches.length - ours === 1 ? 'a reference cache' : `${caches.length - ours} reference caches`} run by somebody else, from different code and different fetches of the same repositories. A change that every cache sees comes from upstream (a registry, a repository, a holder); one that a single cache sees is that validator's own; one that the validators of the site share and the references do not is in the network or the timing of the host.${vrps.length > 1 ? ` Right now the counts of VRPs are ${fmt.format(spread)} apart between the highest and the lowest${spread ? ' (they read the repositories at different moments)' : ''}.` : ''} A reference that speaks a version of RTR below 2 carries no ASPA, so it checks the VRPs only.`;
    } else $('rtr-caches-sub').textContent = 'One cache is followed: the validator of this site.';

    $('rtr-metric').addEventListener('change', drawCharts);
    const ranges = [...$('rtr-range').querySelectorAll('[data-range]')];
    for (const b of ranges) {
      b.addEventListener('click', () => {
        hours = Number(b.dataset.range);
        for (const o of ranges) o.setAttribute('aria-pressed', String(o === b));
        drawCharts();
      });
    }
    drawCharts();

    const faults = (a) => [a.repeated ? `${fmt.format(a.repeated)} VRP${a.repeated === 1 ? '' : 's'} announced again while held` : null, a.unknown ? `${fmt.format(a.unknown)} record${a.unknown === 1 ? '' : 's'} withdrawn while not held` : null, a.unreadable ? `${fmt.format(a.unreadable)} record${a.unreadable === 1 ? '' : 's'} that the monitor could not read` : null].filter(Boolean).join('; ');
    const values = (a) => a.trigger === 'protocol_error' ? faults(a) : [Object.keys(a.raw || {}).filter((k) => k === a.trigger || (a.z && Math.abs(a.z[k] || 0) >= 3)).map((k) => `${WHAT[k] || k}: ${value(k, a.raw[k])}${a.z && Number.isFinite(a.z[k]) ? ` (z ${a.z[k]})` : ''}`).join('; '), a.repeated ? `of the VRPs, ${fmt.format(a.repeated)} were announced again while held and changed nothing` : null].filter(Boolean).join('; ');
    // every anomaly has an address of its own (#rtr-a-<cache>-<time>-<trigger>): the first, should two share one
    const ids = new Set();
    const addressed = (a, c) => { const id = A.idOf(c.id, a.at, a.trigger); const first = c.id && !ids.has(id); ids.add(id); return { ...a, cache: c.name || c.id, id: first ? id : null }; };
    const everyAnomaly = caches.flatMap((c) => ((c.anomalies && c.anomalies.list) || []).map((a) => addressed(a, c))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const allAnomalies = everyAnomaly.slice(0, 50);
    let linked = [];                                             // the anomalies of the address of the page that are not among the ones shown
    let marked = new Set();                                      // the anomalies of the address of the page (one, or the ones of a period): their rows are marked
    const seen = caches.map((c) => `${fmt.format(c.telemetry ? c.telemetry.syncs : 0)} on ${c.name || c.id}`).join(', ');
    // the ten most recent anomalies, then all of them on request
    const anomalyRow = (a) => el('tr', a.id ? { id: a.id, ...(marked.has(a.id) ? { class: 'linked' } : {}) } : {},
      a.id ? el('td', {}, el('a', { href: `#${a.id}`, title: 'The address of this anomaly, to link to it', text: when(a.at) })) : el('td', { text: when(a.at) }),
      el('td', { text: a.cache }),
      el('td', {}, el('span', { class: `badge ${a.severity === 'high' ? 'v-invalid' : 'v-unknown'}`, text: a.severity || 'unknown' })),
      el('td', { text: `${WHAT[a.trigger] || a.trigger || 'unknown'}${a.category === 'structural' ? ' (the session itself)' : ''}` }),
      el('td', { text: values(a) || '–' }));
    const drawAnomalies = (n) => $('rtr-anomalies').replaceChildren(...(allAnomalies.length
      ? [...linked.map(anomalyRow), ...allAnomalies.slice(0, n).map(anomalyRow), ...(allAnomalies.length > n ? [el('tr', {}, el('td', { colspan: '5' }, more(allAnomalies.length)))] : [])]
      : [el('tr', {}, el('td', { colspan: '5', text: `None so far. The detector says nothing before it has seen 100 syncs on a cache and compares each sync with the last 500; it has seen ${seen}.` }))]));
    function more(all) {
      const b = el('button', { type: 'button', class: 'linkish', text: `Show all ${all}` });
      b.addEventListener('click', () => drawAnomalies(all));
      return b;
    }
    drawAnomalies(10);

    // The address of one anomaly opens the table on it: among the ten shown, among all the ones of the file or, for an older one, read
    // from the raw telemetry of its monitor and put in the first row. The address of a period (#rtr-w-<from>-<to>) shows what every
    // cache did in it, from the telemetry of each, above the table, with the anomalies of the period marked in it. The Right now page
    // has opened the tab already (now.js).
    const telemetry = async (c) => {
      try { const r = await fetch(`/api/v1/rtr/${c.id}.ndjson`); return r.ok ? await r.text() : null; } catch { return null; }
    };
    // the rows shown stay the ones shown (ten, or all after "Show all"), unless a marked anomaly is further down
    const show = (ids, extra) => {
      const shown = $('rtr-anomalies').rows.length - linked.length;
      linked = extra;
      marked = new Set(ids);
      drawAnomalies(shown > 11 || allAnomalies.some((a, i) => i >= 10 && marked.has(a.id)) ? allAnomalies.length : 10);
    };
    const hm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const heldCell = (w, k) => {
      const b = (w.before || {})[k], l = (w.lowest || {})[k], a = (w.after || {})[k];
      const n = (x) => (Number.isFinite(x) ? fmt.format(x) : null);
      if (!w.syncs) return n(b) || '–';
      if (a === null || a === undefined) return '–';
      return (w.fell && l < a ? [n(b), n(l), n(a)] : b === a || b === null || b === undefined ? [n(a)] : [n(b), n(a)]).filter(Boolean).join(' → ');
    };
    const did = (w) => {
      if (!w) return 'The telemetry of its monitor could not be read.';
      if (!w.syncs) return 'No sync in the period.';
      const n = `${fmt.format(w.syncs)} sync${w.syncs === 1 ? '' : 's'}`;
      if (!w.fell) return `Nothing out of the ordinary in ${n}.`;
      const down = [w.drop.vrp > 0 ? `${fmt.format(w.drop.vrp)} VRPs` : null, w.drop.aspa > 0 ? `${fmt.format(w.drop.aspa)} ASPAs` : null].filter(Boolean).join(' and ');
      return `Down by ${down} at ${hm(w.lowest.at)}; ${w.back ? `back at ${hm(w.back)}` : 'not back by the end of the period'}.`;
    };
    async function openWindow(win) {
      const texts = await Promise.all(caches.map(telemetry));
      const rows = caches.map((c, i) => ({ c, text: texts[i], w: texts[i] === null ? null : A.windowOf(texts[i], win.from, win.to) }));
      const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
      const from = new Date(win.from).toISOString(), to = new Date(win.to).toISOString();
      $('rtr-window-title').textContent = `What each cache did, ${day(win.from)}, ${hm(from)} to ${day(win.to) === day(win.from) ? '' : `${day(win.to)}, `}${hm(to)} UTC`;
      const fell = rows.filter((r) => r.w && r.w.fell).length, read = rows.filter((r) => r.w && r.w.syncs).length;
      $('rtr-window-sub').textContent = `${fell ? `${fmt.format(fell)} of the ${fmt.format(read)} caches that synced in the period lost records and ${fmt.format(read - fell)} did not` : `None of the ${fmt.format(read)} caches that synced in the period lost records`}. The records are the ones that each cache held before the period, at its lowest point when it lost some, and at its last sync in the period, from the raw telemetry of its monitor; a cache that speaks a version of RTR below 2 carries no ASPA. The anomalies of the period are marked in the table below.`;
      $('rtr-window-rows').replaceChildren(...rows.map(({ c, w }) => el('tr', w && w.fell ? { class: 'linked' } : {},
        el('td', { text: c.name || c.id }),
        el('td', { class: 'num', text: w ? heldCell(w, 'vrp') : '–' }),
        el('td', { class: 'num', text: w ? heldCell(w, 'aspa') : '–' }),
        el('td', { text: did(w) }))));
      const ids = [], extra = [];
      for (const { c, text, w } of rows) {
        for (const a of (w ? w.anomalies : [])) {
          const id = A.idOf(c.id, a.at, a.trigger);
          ids.push(id);
          if (allAnomalies.some((x) => x.id === id)) continue;
          const entry = everyAnomaly.find((x) => x.id === id) || A.fromTelemetry(text, a.at, a.trigger);
          if (entry) extra.push({ ...entry, cache: c.name || c.id, id });
        }
      }
      show(ids, extra.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
      $('rtr-around').hidden = true;
      $('rtr-window').hidden = false;
      $('rtr-window').scrollIntoView({ block: 'start' });
    }
    async function openLinked() {
      const hash = location.hash.slice(1);
      const win = A.parseWindow(hash);
      if (win) return openWindow(win);
      const want = A.parseId(hash);
      const cache = want && caches.find((c) => c.id === want.cache);
      if (!cache) return undefined;
      const id = A.idOf(cache.id, want.at, want.trigger);
      let found = allAnomalies.some((a) => a.id === id) ? null : everyAnomaly.find((a) => a.id === id) || null;
      if (!found && !allAnomalies.some((a) => a.id === id)) {
        const entry = A.fromTelemetry(await telemetry(cache), want.at, want.trigger);
        if (!entry) return undefined;
        found = { ...entry, cache: cache.name || cache.id, id };
      }
      show([id], found ? [found] : []);
      // from one anomaly to what every cache did around it: a quarter of an hour before, half an hour after
      const t = Math.floor(Date.parse(want.at) / 60e3) * 60e3;
      $('rtr-around').replaceChildren(el('a', { href: `#${A.idOfWindow(t - 15 * MIN, t + 30 * MIN)}`, text: 'What every cache did around that time' }), ', from a quarter of an hour before the marked anomaly to half an hour after it.');
      $('rtr-around').hidden = false;
      $('rtr-window').hidden = true;
      $(id).scrollIntoView({ block: 'center' });
      return undefined;
    }
    openLinked();
    window.addEventListener('hashchange', openLinked);

    $('rtr-events').replaceChildren(...(doc.events && doc.events.length ? doc.events.map((e) => el('tr', {},
      el('td', { text: when(e.at) }),
      el('td', { text: e.probe ? 'Version probe refused' : e.found_by_monitor ? (e.code === 0 ? 'Records that the monitor could not read' : 'Records against the protocol') : (EVENT[e.type] || e.type) }),
      el('td', { text: [e.reason, e.code !== undefined ? `code ${e.code}` : null, e.protocol !== undefined ? `RTR version ${e.protocol}` : null, e.next_protocol !== undefined ? `goes on with version ${e.next_protocol}` : null].filter(Boolean).join(', ') || '–' }))) : [el('tr', {}, el('td', { colspan: '3', text: 'No session event recorded.' }))]));

    $('rtr-note').replaceChildren(`In the last 24 hours the cache of the site announced ${fmt.format(d.vrp_announced || 0)} VRPs and withdrew ${fmt.format(d.vrp_withdrawn || 0)}, announced ${fmt.format(d.aspa_announced || 0)} ASPAs and withdrew ${fmt.format(d.aspa_withdrawn || 0)}${d.duration_max_ms ? `; the longest sync took ${fmt.format(d.duration_max_ms)} ms` : ''}. The same data is available as `, el('a', { href: '/api/v1/rtr.json', text: 'JSON' }), ', the raw telemetry of each monitor as NDJSON (/api/v1/rtr/<id>.ndjson, see the ', el('a', { href: '/api.html', text: 'API page' }), '), and whoever runs the site is told of every anomaly. RAVEN is BSD-3-Clause software by Nokia, with its ', ext('https://ritmukhe.github.io/raven-docs/user-guide/cli-reference/#raven-rtr-monitor', 'documentation of the monitor'), '; the idea is explained in the RIPE Labs article ', ext('https://labs.ripe.net/author/ritesh-mukherjee/your-router-trusts-its-validator-but-whos-watching-the-validator/', 'Your router trusts its validator. But who\'s watching the validator?'), ' by Ritesh Mukherjee.');
  }
  main();
})();
