'use strict';

// The Incidents page: /api/v1/incidents.json, built by scripts/build-incidents.mjs from the incidents that the detectors of
// data_scripts (incident.py) found, with the verdict of the ASPAs on the AS paths that each incident kept.
(function () {
  // the method (taxonomy, coverage, the five known incidents) moved to the guide in 1.69: an old link follows it there;
  // "How to read this" is a closed box, opened by a link to it
  const MOVED = ['inc-tax-title', 'inc-coverage-title', 'inc-known-title'];
  const follow = () => {
    const h = location.hash.slice(1);
    if (MOVED.includes(h)) { location.replace(`/guide.html#${h}`); return true; }
    if (h === 'inc-how-title') document.addEventListener('DOMContentLoaded', () => { document.getElementById('inc-how-box').open = true; document.getElementById(h).scrollIntoView({ block: 'start' }); }, { once: true });
    return false;
  };
  if (follow()) return;
  window.addEventListener('hashchange', () => { if (!follow() && location.hash === '#inc-how-title') { document.getElementById('inc-how-box').open = true; } });
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const NAMES = {
    RLK: 'Routing leak (valley in the path)', PRH: 'Prefix hijack (origin or address space)', DEG: 'Prefix deaggregation (another origin, or in excess)',
    VOL: 'State volatility (flapping, slow convergence, churn)', ATR: 'Attribute-based session reset (session ended, mass withdrawal)', ASM: 'AS path manipulation', other: 'Other',
  };
  const ORDER = ['RLK', 'PRH', 'DEG', 'VOL', 'ATR', 'ASM', 'other'];
  // the types of the survey that a detector can tell apart (data_scripts, extra_detectors.py), shown under their class
  const SUBNAMES = {
    'RLK-UL': 'Upward leak (to a provider)', 'RLK-LL': 'Lateral leak (to a peer)', 'RLK-FP': 'Full propagation (one AS leaks to 10 or more neighbours within an hour)', 'RLK-PV': 'Persistent valley (the same AS in the valley all day: a relationship CAIDA gets wrong, not a leak)',
    'PRH-AB': 'Abusive hijack candidate (space that is not allocated)',
    'ASM-PE': 'Poisoning candidate (an AS that comes back, or a number that is not allocated)', 'ASM-EX': 'Extension candidate (private AS number)',
    'ASM-FI': 'Forged origin candidate (link to the origin that CAIDA does not know)', 'ASM-PS': 'Path shortening candidate (other link that CAIDA does not know)',
    'VOL-FO': 'Oscillation (a prefix flapping for 3 peers or more)', 'VOL-DC': 'Delayed convergence (a prefix that does not settle)', 'VOL-AC': 'Amplified churn (one origin, many prefixes and peers)',
    'DEG-MA': 'Deaggregation with another origin (no ROA for it, no link between the two origins)', 'DEG-XS': 'Excessive deaggregation (the intent is not visible)', 'DEG-FF': 'Fragmentation flood',
    'ATR-EH': 'Session ended by an update error', 'ATR-MA': 'Session ended by a malformed attribute',
  };
  // What each code stands for, in the taxonomy of Servillo and others (IEEE COMST 2026), and what the detectors look for: the tooltip of the code.
  const TIPS = {
    RLK: 'RLK, routing leak: a route passed on beyond what the relationships of the ASes allow (RFC 7908). The detectors look for a valley in the AS path, with the relationships of CAIDA.',
    PRH: 'PRH, prefix hijack: a prefix announced by an origin that is not entitled to it. The detectors look for an origin that no ROA authorises.',
    DEG: 'DEG, prefix deaggregation: more specifics of a prefix, announced by another origin or in excess.',
    VOL: 'VOL, state volatility: routes that keep changing, by flapping, slow convergence or bursts of updates.',
    ATR: 'ATR, attribute-based session reset: an update whose attributes make a router close the BGP session, with the withdrawal of all its routes.',
    ASM: 'ASM, AS path manipulation: an AS path altered on purpose, by poisoning, a forged origin, shortening or extension.',
    'RLK-UL': 'UL, upward leak: a route learned from a provider or a peer and passed on to a provider.',
    'RLK-LL': 'LL, lateral leak: a route learned from a provider or a peer and passed on to a peer.',
    'RLK-FP': 'FP, full propagation: a leak passed on to all the neighbours. A proxy here: one AS that leaks to 10 or more neighbours within an hour.',
    'RLK-PV': 'PV, persistent valley: not a type of the taxonomy. The leak candidates of an AS that begin in 12 or more different hours of the window: most likely a relationship that CAIDA gets wrong, rarely a recurring leak.',
    'PRH-CH': 'CH, complete hijack: an origin that no covering ROA authorises.',
    'PRH-IH': 'IH, incomplete hijack: a more specific beyond the maximum length of the ROA, or another origin.',
    'PRH-AB': 'AB, abusive hijack: a prefix in space that is not for public use, or not allocated.',
    'ASM-PE': 'PE, AS path poisoning: an AS put into the path on purpose. Seen here as an AS that comes back after another, or an AS number that is not allocated.',
    'ASM-EX': 'EX, path extension evasion: an AS path made longer with extra AS numbers, so that a route is less likely to be chosen. Seen here as a private AS number in the path.',
    'ASM-FI': 'FI, forged origin injection: a fake link to the real origin, which passes route origin validation. Seen here as a last link that CAIDA does not know and the table of the collector does not have.',
    'ASM-PS': 'PS, path shortening: a path without some of the ASes it crosses. Seen here as another link that CAIDA does not know and the table of the collector does not have.',
    'VOL-FO': 'FO, flooding through oscillation: a prefix that flaps, seen by 3 peers or more within a window.',
    'VOL-DC': 'DC, delayed convergence: a prefix that keeps receiving updates without a pause for a long time.',
    'VOL-AC': 'AC, amplified churn injection: a burst of updates for one origin, from many peers.',
    'DEG-MA': 'MA, malicious deaggregation: a more specific with another origin, no ROA for it and no link between the two origins in CAIDA.',
    'DEG-XS': 'XS, excessive deaggregation: one line for two types of the taxonomy, careless (CA) and exploitative (EX) deaggregation, whose intent the updates do not show.',
    'DEG-FF': 'FF, fragmentation flood: a very large number of more specifics in a day.',
    'ATR-EH': 'EH, error handling policy abuse: a NOTIFICATION for an error in an UPDATE, with the withdrawal of the routes of the session.',
    'ATR-MA': 'MA, malformed attribute injection: a NOTIFICATION caused by an attribute in error.',
  };
  // a code as a button with its tooltip (asnames.js shows data-tip on hover, focus and tap)
  const codeChip = (k) => (TIPS[k] ? el('button', { type: 'button', class: 'chip tipchip', 'data-tip': TIPS[k] }, k) : el('span', { class: 'chip', text: k }));
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(a / b < 0.1 && a ? 1 : 0)}%` : '0%');
  const day = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // "2026-10-22 11:42:03" (UTC) -> "22 Oct 2026, 11:42 UTC"; an older file has the day only
  const utc = (t) => (/^\d{4}-\d{2}-\d{2}$/.test(t) ? day(t) : `${new Date(t.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`);
  const plural = (n, w) => `${fmt.format(n)} ${w}${n === 1 ? '' : 's'}`;
  function span(a, b) {
    const m = Math.round((Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 60000);
    if (!(m >= 0)) return '';
    return m < 90 ? plural(m, 'minute') : m < 48 * 60 ? plural(Math.round(m / 60), 'hour') : plural(Math.round(m / 1440), 'day');
  }
  const typesOf = (d) => ORDER.filter((t) => d.by_type[t]);

  const tile = (label, value, note, cls) => el('div', { class: 'tile card ' + (cls || '') }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note }));

  function tiles(d) {
    const t = d.total;
    $('inc-tiles').replaceChildren(
      tile('Incidents', fmt.format(t.incidents), `${fmt.format(t.with_path)} with an AS path`),
      tile('Invalid, ASPAs of the day', pct(t.real[2], t.with_path), `${fmt.format(t.real[2])} of ${fmt.format(t.with_path)}`, 'v-invalid'),
      tile('Unknown, ASPAs of the day', pct(t.real[1], t.with_path), 'no ASPA to say', 'v-unknown'),
    );
  }

  function rows(d) {
    const cell = (n, of) => el('td', { class: 'num' }, of ? [fmt.format(n), el('span', { class: 'hint block', text: pct(n, of) })] : '–');
    const line = (th, b) => el('tr', {}, th,
      el('td', { class: 'num', text: fmt.format(b.incidents) }), el('td', { class: 'num', text: fmt.format(b.with_path) }),
      cell(b.real[2], b.with_path), cell(b.real[1], b.with_path), cell(b.real[0], b.with_path),
      cell(b.ideal[2], b.with_path), cell(b.ideal[1], b.with_path), cell(b.ideal[0], b.with_path));
    const subs = d.subtypes || {};
    $('inc-rows').replaceChildren(...typesOf(d).flatMap((k) => [
      line(el('th', { scope: 'row' }, codeChip(k), ' ', NAMES[k] || k), d.by_type[k]),
      ...Object.keys(SUBNAMES).filter((t) => t.startsWith(`${k}-`) && subs[t]).map((t) => line(el('th', { scope: 'row', class: 'sub' }, codeChip(t), ' ', SUBNAMES[t]), subs[t])),
    ]));
    $('inc-note').textContent = 'Percentages are of the incidents with a path (flapping and mass withdrawals mostly have none: a dash). The lines under a class are the types of the survey that the detector tells apart; an incident is in one of them at most, and the ones that fit none are only in the line of the class. ASM is made of candidates: a link that CAIDA does not know may be a real one.';
  }

  // The curve: the share of the incidents with a path that would be Invalid, for 0 to 100% of the networks publishing.
  const SVG = 'http://www.w3.org/2000/svg';
  // eslint-disable-next-line no-restricted-syntax -- the element builder: its keys come from the code that calls it
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };
  const SERIES = [{ key: 'largest', label: 'The networks with the most customers publish first', cls: 's1' }, { key: 'random', label: 'Networks publish in random order', cls: 's2' }];

  function points(d, type) {
    const base = d.adoption.base && d.adoption.base[type] !== undefined ? d.adoption.base[type] : (type === 'total' ? d.total.with_path : d.by_type[type].with_path);    // without the persistent valleys
    return SERIES.map((s) => ({ ...s, values: ((d.adoption[s.key] || {})[type] || []).map((n) => (base ? (100 * n) / base : 0)) }));
  }

  function draw(box, d, type) {
    const levels = d.adoption.levels, series = points(d, type), i10 = levels.indexOf(10), i50 = levels.indexOf(50);
    const W = Math.max(280, box.clientWidth || 640), H = 260, m = { l: 52, r: 12, t: 10, b: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = (i) => m.l + (iw * i) / (levels.length - 1);
    const y = (v) => m.t + ih - (ih * v) / 100;
    const label = (s) => `${s.label.toLowerCase()}: ${s.values[i10].toFixed(0)}% with 10% of the networks publishing, ${s.values[i50].toFixed(0)}% with half, ${s.values[s.values.length - 1].toFixed(0)}% with all`;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Share of the incidents that the ASPAs would prove Invalid, against the share of the networks that publish an ASPA. ${series.map(label).join('; ')}.` });
    for (const v of [0, 25, 50, 75, 100]) g.append(svg('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), svg('text', { class: 'tick', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, `${v}%`));
    levels.forEach((l, i) => { if (l % 20 === 0) g.append(svg('text', { class: 'tick', x: x(i), y: H - 28, 'text-anchor': i === 0 ? 'start' : i === levels.length - 1 ? 'end' : 'middle' }, `${l}%`)); });
    for (const s of series) {
      g.append(svg('polyline', { class: `line ${s.cls}`, points: s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') }));
      s.values.forEach((v, i) => g.append(svg('circle', { class: `dot ${s.cls}`, cx: x(i).toFixed(1), cy: y(v).toFixed(1), r: 3 })));
    }
    g.append(svg('text', { class: 'axistitle', x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle' }, `Networks that publish an ASPA (% of the ${fmt.format(d.adoption.ases)} ASes of the CAIDA data)`),
      svg('text', { class: 'axistitle', transform: `translate(13 ${m.t + ih / 2}) rotate(-90)`, 'text-anchor': 'middle' }, 'Incidents that are Invalid (%)'));
    box.replaceChildren(g);
    return series;
  }

  let curveData = null, curveShow = null;
  function curve(d) {
    const select = $('inc-type'), box = $('inc-chart');
    const before = select.value;
    curveData = d;
    const options = [['total', 'All the incidents with a path, without the persistent valleys']].concat(typesOf(d).filter((k) => d.by_type[k].with_path).map((k) => [k, `${k}, ${(NAMES[k] || k).replace(/^(?!AS )./, (c) => c.toLowerCase())}`]));
    $('inc-curve-title').parentElement.hidden = options.length < 2 || !d.adoption || !d.adoption.levels;
    if ($('inc-curve-title').parentElement.hidden) return;
    select.replaceChildren(...options.map(([v, t]) => el('option', { value: v, text: t })));
    if (options.some(([v]) => v === before)) select.value = before;
    if (curveShow) { curveShow(); return; }
    const show = curveShow = () => {
      const d = curveData;                                         // the period shown now
      const type = select.value, series = draw(box, d, type), i10 = d.adoption.levels.indexOf(10);
      $('inc-legend').replaceChildren(...series.map((s) => el('li', {}, el('span', { class: `sw ${s.cls}`, 'aria-hidden': 'true' }), el('span', { class: 'lg', text: s.label }), ' ', el('span', { class: 'lv', text: `${s.values[i10].toFixed(0)}% Invalid when 10% publish` }))));
      const [largest, random] = series, i50 = d.adoption.levels.indexOf(50), leaks = type === 'RLK';
      const pc = (v) => `${v.toFixed(0)}%`;
      $('inc-curve-note').textContent = `How to read it: if only the 10% of the ${fmt.format(d.adoption.ases)} networks of the CAIDA data with the most customers published an ASPA, ${pc(largest.values[i10])} of these incidents would be Invalid; if 10% of the networks did it in random order, ${pc(random.values[i10])}. With half of the networks, ${pc(largest.values[i50])} and ${pc(random.values[i50])}. The dots are the points that were computed (every 10%); the lines between them only join them.${leaks ? ' For a valley the right end is always 100%, because the detector and the ASPAs use the same CAIDA relationships: look at the shape of the lines, not at the end. The persistent valleys (RLK-PV) are not in this chart.' : ''}`;
    };
    select.addEventListener('change', show);
    show();
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(show, 150); });
  }

  // The days of the history (/api/v1/incidents-history.json): a bar for each day that was read, from the first day of
  // ASPA to yesterday; a day that is missing has no bar. With the pointer on the chart, a box says the day and its numbers.
  const DAY = 86400e3;
  // where the collectors of RIPE RIS are, for the ones that have a history here
  const PLACE = { rrc00: 'Amsterdam, multihop', rrc01: 'London, LINX', rrc03: 'Amsterdam, AMS-IX', rrc06: 'Tokyo', rrc10: 'Milan, MIX', rrc18: 'Barcelona, CATNIX', rrc19: 'Johannesburg', rrc22: 'Bucharest', rrc23: 'Singapore' };
  function daysChart(h) {
    const box = $('inc-days-chart'), select = $('inc-days-metric');
    const types = ORDER.filter((t) => h.days.some((r) => r.types[t]));
    const metrics = [
      ['incidents', 'Incidents', 'Incidents', (r) => r.incidents, (v) => fmt.format(v)],
      ['invalid', 'Invalid with the ASPAs of the day (% of the incidents with a path)', 'Invalid (%)', (r) => (r.with_path ? (100 * r.real[2]) / r.with_path : 0), (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`],
      ['unknown', 'Unknown with the ASPAs of the day (% of the incidents with a path)', 'Unknown (%)', (r) => (r.with_path ? (100 * r.real[1]) / r.with_path : 0), (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`],
      ...types.map((t) => [t, `${t}, ${(NAMES[t] || t).replace(/^(?!AS )./, (c) => c.toLowerCase())}`, `${t} incidents`, (r) => r.types[t] || 0, (v) => fmt.format(v)]),
    ];
    select.replaceChildren(...metrics.map(([v, t]) => el('option', { value: v, text: t })));
    const t0 = Date.parse(h.first_day), n = h.days_expected;
    const at = new Map(h.days.map((r) => [Math.round((Date.parse(r.day) - t0) / DAY), r]));
    const iso = (i) => new Date(t0 + i * DAY).toISOString().slice(0, 10);
    const pick = $('inc-day'), link = $('inc-day-link');
    // the link of the file comes from the data (the day of the line that is chosen), never from the text of the page
    const listed = [...h.days].reverse().filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
    const collector = /^[a-z0-9-]+$/.test(h.collector) ? h.collector : 'rrc00';
    const href = () => { const r = listed[pick.selectedIndex]; if (r) link.href = `/api/v1/incidents/${collector}/${r.day}.jsonl.gz`; };
    // the time window of the chart: the days from `a` to `b` (numbers of the day, 0 is the first day), the last week at the start
    // (the last week that has data: a collector read from the archive ends where its backfill began)
    const end = Math.max(...at.keys());
    let a = Math.max(0, end - 6), b = end;
    const from = $('inc-days-from'), to = $('inc-days-to'), buttons = [...$('inc-days-range').querySelectorAll('[data-range]')];
    for (const f of [from, to]) { f.min = iso(0); f.max = iso(n - 1); }
    const show = () => {
      const cnt = b - a + 1, inside = h.days.filter((r) => { const i = Math.round((Date.parse(r.day) - t0) / DAY); return i >= a && i <= b; });
      from.value = iso(a); to.value = iso(b);
      $('inc-days-note').textContent = `${fmt.format(inside.length)} of the ${fmt.format(cnt)} days from ${day(iso(a))} to ${day(iso(b))} have been read${cnt > inside.length ? `; ${fmt.format(cnt - inside.length)} are still to come` : ''}. Move the pointer over the chart for the numbers of a day; a click chooses its file below.`;
      const [, title, yTitle, value, fmtY] = metrics.find((x) => x[0] === select.value) || metrics[0];
      const W = Math.max(280, box.clientWidth || 640), H = 240, m = { l: 68, r: 10, t: 10, b: 24 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const max = Math.max(...inside.map(value), 0);
      const step = Math.pow(10, Math.floor(Math.log10(max || 1))) / 2, top = max > 0 ? Math.max(step, Math.ceil(max / step) * step) : 1;
      const x = (i) => m.l + (iw * (i - a)) / cnt, y = (v) => m.t + ih - (ih * v) / top, w = Math.max(iw / cnt, 0.6);
      const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}, one bar for each day from ${day(iso(a))} to ${day(iso(b))}: ${fmt.format(inside.length)} of ${fmt.format(cnt)} days have been read.` });
      g.append(svg('text', { class: 'axistitle', transform: `translate(13 ${m.t + ih / 2}) rotate(-90)`, 'text-anchor': 'middle' }, yTitle));
      for (let k = 0; k <= 4; k++) {
        const v = (top * k) / 4;
        g.append(svg('line', { class: k ? 'grid' : 'axisline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), svg('text', { class: 'tick', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmtY(v)));
      }
      g.append(svg('text', { class: 'tick', x: m.l, y: H - 6, 'text-anchor': 'start' }, day(iso(a))), svg('text', { class: 'tick', x: W - m.r, y: H - 6, 'text-anchor': 'end' }, day(iso(b))));
      // a line at the first of January of each year, or at the first of each month when the window is a year or less
      const months = cnt <= 400;
      for (let t = new Date(Date.UTC(Number(iso(a).slice(0, 4)), months ? Number(iso(a).slice(5, 7)) : 12, 1)); ; t.setUTCMonth(t.getUTCMonth() + (months ? 1 : 12))) {
        const i = Math.round((t.getTime() - t0) / DAY);
        if (i > b) break;
        g.append(svg('line', { class: 'grid', x1: x(i), x2: x(i), y1: m.t, y2: m.t + ih }));
        const text = months ? t.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : String(t.getUTCFullYear());
        if (x(i) - m.l > 90 && W - m.r - x(i) > 90 && (!months || cnt > 45)) g.append(svg('text', { class: 'tick', x: x(i), y: H - 6, 'text-anchor': 'middle' }, text));
      }
      const bw = cnt <= 120 ? w * 0.8 : w;          // a short window leaves a gap between the days
      let d = '';
      for (const [i, r] of at) { if (i < a || i > b) continue; const v = value(r); if (v > 0) d += `M${(x(i) + (w - bw) / 2).toFixed(2)},${y(0)}v${(y(v) - y(0)).toFixed(2)}h${bw.toFixed(2)}V${y(0)}z`; }
      g.append(svg('path', { class: 'daybars', d }));
      const cross = svg('line', { class: 'crossline', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
      g.append(cross);
      const tip = el('div', { class: 'ctip', hidden: '' }, el('strong', {}), el('span', {}), el('span', {}));
      box.replaceChildren(g, tip);
      const [tValue, tWhen, tMore] = tip.children;
      const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
      const point = (e) => {
        const r = g.getBoundingClientRect();
        if (!r.width) return -1;
        const px = ((e.clientX - r.left) / r.width) * W;
        const i = Math.max(a, Math.min(b, a + Math.floor(((px - m.l) / iw) * cnt)));
        const row = at.get(i), cx = x(i) + w / 2;
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
        tValue.textContent = row ? fmtY(value(row)) : 'Not read yet';
        tWhen.textContent = day(iso(i));
        tMore.textContent = row ? `${plural(row.incidents, 'incident')}, ${pct(row.real[2], row.with_path)} Invalid` : '';
        tMore.hidden = !row;
        tip.hidden = false;
        const left = (cx / W) * r.width, tw = tip.offsetWidth;
        tip.style.left = `${Math.max(0, Math.min(r.width - tw, left + 12 + tw > r.width ? left - 12 - tw : left + 12))}px`;
        tip.style.top = '8px';
        return i;
      };
      box.onpointermove = point;
      // a click on a day that was read also chooses its file below
      box.onpointerdown = (e) => { const i = point(e); if (at.has(i)) { pick.selectedIndex = listed.findIndex((r) => r.day === iso(i)); href(); } };
      box.onpointerleave = hide;
    };
    select.addEventListener('change', show);
    $('inc-days').hidden = false;                 // before the first drawing: a hidden box has no width to draw for
    show();
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(show, 150); });
    // the window: a button for the last days, or the two dates
    const press = (v) => buttons.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.range === v)));
    buttons.forEach((x) => x.addEventListener('click', () => {
      const days = Number(x.dataset.range);
      b = days ? end : n - 1; a = days ? Math.max(0, end - days + 1) : 0;
      press(x.dataset.range);
      show();
    }));
    const dated = () => {
      const i = (f, other) => (/^\d{4}-\d{2}-\d{2}$/.test(f.value) ? Math.max(0, Math.min(n - 1, Math.round((Date.parse(f.value) - t0) / DAY))) : other);
      const x = i(from, a), z = i(to, b);
      a = Math.min(x, z); b = Math.max(x, z);
      press(null);
      show();
    };
    from.addEventListener('change', dated);
    to.addEventListener('change', dated);

    // every incident of a day: the file of the day
    pick.replaceChildren(...listed.map((r) => el('option', { value: r.day, text: `${day(r.day)} (${fmt.format(r.incidents)})` })));
    pick.addEventListener('change', href);
    href();
  }

  const built = (iso) => `built ${new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
  // What the page shows for a period: `d` has the shape of /api/v1/incidents.json, `meta` is the line under the title.
  function render(d, meta, sources, note) {
    $('meta').textContent = meta;
    tiles(d);
    rows(d);
    if (note) $('inc-note').textContent += ` ${note}`;
    curve(d);
    $('inc-sources').textContent = sources;
  }

  async function main() {
    const get = async (url) => {
      try { const r = await fetch(url, { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; } catch { return null; }
    };
    // The collectors that have a history (/api/v1/incidents-collectors.json): the one of the recorder at the start, another one
    // with ?collector=<id>. The address of its file comes from the list, never from the address of the page; the window of the
    // last 30 days exists for the collector of the recorder only.
    const index = await get('/api/v1/incidents-collectors.json');
    const collectors = index && Array.isArray(index.collectors) ? index.collectors.filter((c) => c && /^[a-z0-9]+$/.test(c.id) && /^\/api\/v1\/incidents-history(-[a-z0-9]+)?\.json$/.test(c.history)) : [];
    const asked = new URLSearchParams(location.search).get('collector');
    const chosen = collectors.find((c) => c.id === asked) || collectors.find((c) => c.main) || null;
    const other = Boolean(chosen && !chosen.main);
    const [d, h] = await Promise.all([other ? null : get('/api/v1/incidents.json'), get(chosen ? chosen.history : '/api/v1/incidents-history.json')]);
    if (collectors.length > 1) {
      const pick = $('inc-collector');
      pick.replaceChildren(...collectors.map((c) => el('option', { value: c.id, text: `${c.id}${PLACE[c.id] ? `, ${PLACE[c.id]}` : ''} (${fmt.format(c.days_covered)} days)` })));
      pick.selectedIndex = Math.max(0, collectors.indexOf(chosen));
      pick.addEventListener('change', () => { const c = collectors[pick.selectedIndex]; if (c) location.search = c.main ? '' : `?collector=${c.id}`; });
      $('inc-collector-box').hidden = false;
    }
    const history = h && Array.isArray(h.days) && h.days.length && h.periods && h.periods.all ? h : null;
    if (!d && !history) {
      $('meta').textContent = 'No incident data is published yet. It is built from the files of the detectors and appears here when there is one.';
      for (const id of ['inc-types-title', 'inc-curve-title']) $(id).parentElement.hidden = true;
      return;
    }
    const where = `in the updates of RIPE RIS ${history ? `${history.collector}${PLACE[history.collector] ? ` (${PLACE[history.collector]})` : ''}` : 'rrc00'}`;
    const recent = () => {
      const length = span(d.period.from, d.period.to);
      render(d, `${plural(d.total.incidents, 'incident')} ${where}, from ${utc(d.period.from)} to ${utc(d.period.to)}${length ? ` (${length} of data)` : ''} · ${built(d.generated)}`,
        `ASPAs: ${d.aspas}. Relationships: ${d.relationships}. Detectors: the research project (data_scripts).`);
    };
    if (!history) { recent(); return; }

    // the periods: everything (the choice at the start), each year, and the window of the last 30 days
    const yesterday = history.days_expected - 1, t0 = Date.parse(history.first_day);
    const expected = (key) => {
      if (key === 'all') return history.days_expected;
      const a = Math.max(0, Math.round((Date.parse(`${key}-01-01`) - t0) / DAY)), b = Math.min(yesterday, Math.round((Date.parse(`${key}-12-31`) - t0) / DAY));
      return b - a + 1;
    };
    const years = Object.keys(history.periods).filter((k) => /^\d{4}$/.test(k)).sort().reverse();
    const select = $('inc-period');
    select.replaceChildren(
      el('option', { value: 'all', text: `Everything since ${day(history.first_day)}` }),
      ...years.map((k) => el('option', { value: k, text: k })),
      d ? el('option', { value: 'recent', text: 'The last 30 days, as one window' }) : null,
    );
    const show = () => {
      const key = select.value;
      if (key === 'recent') { $('inc-period-note').textContent = ''; recent(); return; }
      const p = history.periods[key], of = expected(key);
      $('inc-period-note').textContent = p.days < of ? `${fmt.format(p.days)} of the ${fmt.format(of)} days of this period have been read so far` : '';
      render(p, `${plural(p.total.incidents, 'incident')} ${where}, in ${plural(p.days, 'day')} from ${day(p.first)} to ${day(p.last)} · ${built(history.generated)}`,
        `ASPAs: ${history.aspas}. Relationships: ${history.relationships}. Detectors: the research project (data_scripts).`,
        'In this period the leaking networks (FP, PV) are judged within each day.');
    };
    select.addEventListener('change', show);
    $('inc-period-box').hidden = false;
    show();
    daysChart(history);
  }

  main();
})();
