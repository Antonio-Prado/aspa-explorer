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
    'RLK-UL': 'Upward leak (to a provider)', 'RLK-LL': 'Lateral leak (to a peer)', 'RLK-FP': 'Full propagation (one AS leaks to 3 or more neighbours)',
    'PRH-AB': 'Abusive hijack candidate (space that is not allocated)',
    'ASM-PE': 'Poisoning candidate (an AS that comes back, or a number that is not allocated)', 'ASM-EX': 'Extension candidate (private AS number)',
    'ASM-FI': 'Forged origin candidate (link to the origin that CAIDA does not know)', 'ASM-PS': 'Path shortening candidate (other link that CAIDA does not know)',
    'VOL-FO': 'Oscillation (flapping of a prefix from one peer)', 'VOL-DC': 'Delayed convergence (a prefix that does not settle)', 'VOL-AC': 'Amplified churn (one origin, many prefixes and peers)',
    'DEG-MA': 'Deaggregation with another origin', 'DEG-XS': 'Excessive deaggregation (the intent is not visible)', 'DEG-FF': 'Fragmentation flood',
    'ATR-EH': 'Session ended by an update error', 'ATR-MA': 'Session ended by a malformed attribute',
  };
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
      tile('Invalid, complete ASPAs', pct(t.ideal[2], t.with_path), 'the best case'),
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
      line(el('th', { scope: 'row' }, el('span', { class: 'chip', text: k }), ' ', NAMES[k] || k), d.by_type[k]),
      ...Object.keys(SUBNAMES).filter((t) => t.startsWith(`${k}-`) && subs[t]).map((t) => line(el('th', { scope: 'row', class: 'sub' }, el('span', { class: 'chip', text: t }), ' ', SUBNAMES[t]), subs[t])),
    ]));
    $('inc-note').textContent = 'Percentages are of the incidents with a path (flapping and mass withdrawals mostly have none: a dash). The lines under a class are the types of the survey that the detector tells apart; an incident is in one of them at most, and the ones that fit none are only in the line of the class. ASM is made of candidates: a link that CAIDA does not know may be a real one.';
  }

  // The curve: the share of the incidents with a path that would be Invalid, for 0 to 100% of the networks publishing.
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };
  const SERIES = [{ key: 'largest', label: 'Largest networks first', cls: 's1' }, { key: 'random', label: 'At random', cls: 's2' }];

  function points(d, type) {
    const base = type === 'total' ? d.total.with_path : d.by_type[type].with_path;
    return SERIES.map((s) => ({ ...s, values: ((d.adoption[s.key] || {})[type] || []).map((n) => (base ? (100 * n) / base : 0)) }));
  }

  function draw(box, d, type) {
    const levels = d.adoption.levels, series = points(d, type);
    const W = Math.max(280, box.clientWidth || 640), H = 220, m = { l: 40, r: 10, t: 10, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = (i) => m.l + (iw * i) / (levels.length - 1);
    const y = (v) => m.t + ih - (ih * v) / 100;
    const label = (s) => `${s.label.toLowerCase()} ${s.values[0].toFixed(0)}% then ${s.values[s.values.length - 1].toFixed(0)}%`;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Share of the incidents that the ASPAs would prove Invalid, from none to all of the networks publishing: ${series.map(label).join('; ')}.` });
    for (const v of [0, 25, 50, 75, 100]) g.append(svg('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), svg('text', { class: 'tick', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, `${v}%`));
    levels.forEach((l, i) => { if (l % 20 === 0) g.append(svg('text', { class: 'tick', x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === levels.length - 1 ? 'end' : 'middle' }, `${l}%`)); });
    for (const s of series) g.append(svg('polyline', { class: `line ${s.cls}`, points: s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') }));
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
      $('inc-legend').replaceChildren(...series.map((s) => el('li', {}, el('span', { class: `sw ${s.cls}`, 'aria-hidden': 'true' }), el('span', { class: 'lg', text: s.label }), ' ', el('span', { class: 'lv', text: `${s.values[i10].toFixed(0)}% at 10%` }))));
      const [largest, random] = series;
      $('inc-curve-note').textContent = `With the largest 10% of the ${fmt.format(d.adoption.ases)} networks of the dataset publishing, ${largest.values[i10].toFixed(0)}% of these incidents would be Invalid; with 10% chosen at random, ${random.values[i10].toFixed(0)}%.`;
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
