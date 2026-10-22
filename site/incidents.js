'use strict';

// The Incidents page: /api/v1/incidents.json, built by scripts/build-incidents.mjs from the incidents that the detectors of
// data_scripts (incident.py) found, with the verdict of the ASPAs on the AS paths that each incident kept.
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const NAMES = {
    RLK: 'Valley in the path', PRH: 'Origin that no ROA authorises', DEG: 'More specific with another origin',
    VOL: 'Flapping', ATR: 'Mass withdrawal', ASM: 'Path manipulation', other: 'Other',
  };
  const ORDER = ['RLK', 'PRH', 'DEG', 'VOL', 'ATR', 'ASM', 'other'];

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
    $('inc-rows').replaceChildren(...typesOf(d).map((k) => {
      const b = d.by_type[k];
      return el('tr', {}, el('th', { scope: 'row' }, el('span', { class: 'chip', text: k }), ' ', NAMES[k] || k),
        el('td', { class: 'num', text: fmt.format(b.incidents) }), el('td', { class: 'num', text: fmt.format(b.with_path) }),
        cell(b.real[2], b.with_path), cell(b.real[1], b.with_path), cell(b.real[0], b.with_path),
        cell(b.ideal[2], b.with_path), cell(b.ideal[1], b.with_path), cell(b.ideal[0], b.with_path));
    }));
    $('inc-note').textContent = 'The percentages are of the incidents with a path: flapping and mass withdrawals mostly have none. A type with no path shows a dash.';
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
    $('meta').textContent = `${fmt.format(d.total.incidents)} incidents, from ${day(d.period.from)} to ${day(d.period.to)} · built ${new Date(d.generated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
    tiles(d);
    rows(d);
    curve(d);
    $('inc-sources').textContent = `ASPAs: ${d.aspas}. Relationships: ${d.relationships}. The incidents come from the update messages of one RIPE RIS collector (rrc00), classified by the detectors of the research project (data_scripts).`;
  }

  main();
})();
