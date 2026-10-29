'use strict';

// The Incidents page: /api/v1/incidents.json, built by scripts/build-incidents.mjs from the incidents that the detectors of
// data_scripts (incident.py) found, with the verdict of the ASPAs on the AS paths that each incident kept.
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const NAMES = {
    RLK: 'Routing leak (valley in the path)', PRH: 'Prefix hijack (origin that no ROA authorises)', DEG: 'Prefix deaggregation (more specific, another origin)',
    VOL: 'State volatility (flapping)', ATR: 'Attribute-based session reset (mass withdrawal)', ASM: 'AS path manipulation', other: 'Other',
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
    'ASM-EX': 'EX, path extension evasion: an AS path made longer to evade checks. Seen here as a private AS number in the path.',
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
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };
  const SERIES = [{ key: 'largest', label: 'The biggest networks publish first', cls: 's1' }, { key: 'random', label: 'Networks publish in random order', cls: 's2' }];

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
    g.append(svg('text', { class: 'axistitle', x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle' }, 'Networks that publish an ASPA (% of all the networks)'),
      svg('text', { class: 'axistitle', transform: `translate(13 ${m.t + ih / 2}) rotate(-90)`, 'text-anchor': 'middle' }, 'Incidents that are Invalid (%)'));
    box.replaceChildren(g);
    return series;
  }

  function curve(d) {
    const select = $('inc-type'), box = $('inc-chart');
    const options = [['total', 'All the incidents with a path']].concat(typesOf(d).filter((k) => d.by_type[k].with_path).map((k) => [k, `${k}, ${(NAMES[k] || k).toLowerCase()}`]));
    if (options.length < 2 || !d.adoption || !d.adoption.levels) { $('inc-curve-title').parentElement.hidden = true; return; }
    select.replaceChildren(...options.map(([v, t]) => el('option', { value: v, text: t })));
    const show = () => {
      const type = select.value, series = draw(box, d, type), i10 = d.adoption.levels.indexOf(10);
      $('inc-legend').replaceChildren(...series.map((s) => el('li', {}, el('span', { class: `sw ${s.cls}`, 'aria-hidden': 'true' }), el('span', { class: 'lg', text: s.label }), ' ', el('span', { class: 'lv', text: `${s.values[i10].toFixed(0)}% Invalid when 10% publish` }))));
      const [largest, random] = series, i50 = d.adoption.levels.indexOf(50), leaks = type === 'RLK';
      const pc = (v) => `${v.toFixed(0)}%`;
      $('inc-curve-note').textContent = `How to read it: if only the biggest 10% of the ${fmt.format(d.adoption.ases)} networks of the dataset published an ASPA, ${pc(largest.values[i10])} of these incidents would be Invalid; if 10% of the networks did it in random order, ${pc(random.values[i10])}. With half of the networks, ${pc(largest.values[i50])} and ${pc(random.values[i50])}. The dots are the points that were computed (every 10%); the lines between them only join them.${leaks ? ' For a valley the right end is always 100%, because the detector and the ASPAs use the same CAIDA relationships: look at the shape of the lines, not at the end. The persistent valleys (RLK-PV) are not in this chart.' : ''}`;
    };
    select.addEventListener('change', show);
    show();
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(show, 150); });
  }

  async function main() {
    let d;
    try {
      const r = await fetch('/api/v1/incidents.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      d = await r.json();
    } catch {
      $('meta').textContent = 'No incident data is published yet. It is built from the files of the detectors and appears here when there is one.';
      for (const id of ['inc-types-title', 'inc-curve-title']) $(id).parentElement.hidden = true;
      return;
    }
    const length = span(d.period.from, d.period.to);
    $('meta').textContent = `${plural(d.total.incidents, 'incident')} in the updates of RIPE RIS rrc00, from ${utc(d.period.from)} to ${utc(d.period.to)}${length ? ` (${length} of data)` : ''} · built ${new Date(d.generated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
    tiles(d);
    rows(d);
    curve(d);
    $('inc-sources').textContent = `ASPAs: ${d.aspas}. Relationships: ${d.relationships}. Detectors: the research project (data_scripts).`;
  }

  main();
})();
