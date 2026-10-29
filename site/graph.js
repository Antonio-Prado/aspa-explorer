'use strict';

// The neighbourhood of an AS as a graph: the providers that its ASPA lists above it, the ASes whose ASPA names
// it as a provider below it, and, when the routes have been read, the neighbours that they show and the ASPA
// does not list. The layout is a pure function (shared with the tests); draw() builds the SVG.
(function (root) {
  const W = 840, ROW = { top: 46, mid: 170, bottom: 294 }, H = 340, MAX_ROW = 9, MAX_SIDE = 6, MIN_GAP = 6;
  const width = (label) => Math.max(64, label.length * 8 + 22);

  // data: {as, providers: [AS...], customers: [AS...], observed: [{asn, label, paths}]}
  // label of an observed neighbour: 'provider', 'weak' or 'none' (see evidence.js)
  function layout(data) {
    const nodes = [], edges = [];
    const add = (id, label, kind, x, y, extra) => nodes.push(Object.assign({ id, label, kind, x, y, w: width(label), h: 28 }, extra));
    add(data.as, data.as, 'center', W / 2, ROW.mid);
    // A row holds as many boxes as fit in the width (up to MAX_ROW), with the "more" box when some are left out; the boxes are
    // placed by their own widths, with equal gaps, so that long AS numbers do not overlap.
    const fits = (ids, k) => {
      const ws = ids.slice(0, k).map(width).concat(ids.length > k ? [width(`+${ids.length - k} more`)] : []);
      return ws.reduce((t, w) => t + w, 0) + MIN_GAP * (ws.length + 1) <= W;
    };
    const row = (ids, y, kind, edge) => {
      let k = Math.min(MAX_ROW, ids.length);
      while (k > 1 && !fits(ids, k)) k--;
      const shown = ids.slice(0, k), more = ids.length - shown.length;
      const labels = shown.map((a) => ({ id: a, label: a })).concat(more > 0 ? [{ id: null, label: `+${more} more` }] : []);
      const ws = labels.map((n) => width(n.label));
      const gap = (W - ws.reduce((t, w) => t + w, 0)) / (labels.length + 1);
      let left = 0;
      labels.forEach((n, i) => {
        const x = left + gap * (i + 1) + ws[i] / 2;
        left += ws[i];
        if (n.id) { add(n.id, n.label, kind, x, y); edges.push(Object.assign({ from: edge === 'up' ? data.as : n.id, to: edge === 'up' ? n.id : data.as }, { kind })); }
        else add('more-' + kind, n.label, 'more', x, y);
      });
      return shown.length;
    };
    const mutual = new Set(data.providers.filter((p) => data.customers.includes(p)));
    const others = data.customers.filter((c) => !mutual.has(c));
    const shown = { providers: row(data.providers, ROW.top, 'provider', 'up'), customers: row(others, ROW.bottom, 'customer', 'down') };
    for (const e of edges) if (e.kind === 'provider' && mutual.has(e.to)) e.kind = 'mutual';
    for (const n of nodes) if (n.kind === 'provider' && mutual.has(n.id)) n.kind = 'mutual';
    const listed = new Set(data.providers.concat(data.customers));
    const side = (data.observed || []).filter((o) => !listed.has(o.asn) && o.asn !== data.as).slice(0, MAX_SIDE);
    side.forEach((o, i) => {
      const y = ROW.mid - 70 + (140 / Math.max(1, side.length - 1)) * i * (side.length > 1 ? 1 : 0) + (side.length === 1 ? 70 : 0);
      const kind = o.label === 'provider' ? 'seen-provider' : o.label === 'weak' ? 'seen-weak' : 'seen';
      add(o.asn, o.asn, kind, W - 90, y, { paths: o.paths });
      edges.push({ from: data.as, to: o.asn, kind });
    });
    const summary = `${data.as}: ${data.providers.length} provider${data.providers.length === 1 ? '' : 's'} in its ASPA, named as a provider by ${data.customers.length} ASPA${data.customers.length === 1 ? '' : 's'}${mutual.size ? `, ${mutual.size} AS${mutual.size === 1 ? '' : 'es'} listing each other with it` : ''}${side.length ? `, ${side.length} other neighbour${side.length === 1 ? '' : 's'} seen in the routes` : ''}.`;
    // shown: how many providers and how many of the other ASes that name it are drawn (the rest are in the "more" boxes)
    return { width: W, height: H, nodes, edges, summary, mutual: [...mutual], shown, rows: { providers: data.providers.length, customers: others.length } };
  }

  const api = { layout, W, H };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };

  // container gets the SVG; href(id) gives the address of a node, or null for a node that is not a link
  function draw(container, lay, href) {
    const g = svg('svg', { viewBox: `0 0 ${lay.width} ${lay.height}`, class: 'graph-svg', role: 'group', 'aria-label': lay.summary });
    g.append(svg('defs', {}, svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrowhead' }))));
    const byId = new Map(lay.nodes.map((n) => [n.id, n]));
    for (const e of lay.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      // from the border of the first box to the border of the second
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = (n) => Math.min((n.w / 2) / Math.abs(dx || 1e-9), (n.h / 2) / Math.abs(dy || 1e-9));
      const x1 = a.x + dx * t(a), y1 = a.y + dy * t(a), x2 = b.x - dx * t(b), y2 = b.y - dy * t(b);
      g.append(svg('line', { x1, y1, x2, y2, class: `edge e-${e.kind}`, 'marker-end': e.kind === 'seen' || e.kind === 'seen-weak' ? '' : 'url(#arrow)', 'marker-start': e.kind === 'mutual' ? 'url(#arrow)' : '' }));
    }
    const ROLE = { provider: 'a provider in its ASPA', customer: 'its ASPA lists this AS as a provider', mutual: 'lists this AS and is listed by it',
      'seen-provider': 'seen in the routes, looks like a provider, not in the ASPA', 'seen-weak': 'seen in the routes', seen: 'seen in the routes' };
    for (const n of lay.nodes) {
      const link = n.kind !== 'more' && n.kind !== 'center' && href && href(n.id);
      const box = svg(link ? 'a' : 'g', link ? { href: link, class: `node n-${n.kind}`, 'aria-label': `${n.label}, ${ROLE[n.kind]}` } : { class: `node n-${n.kind}` });
      box.append(svg('rect', { x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, rx: 7 }), svg('text', { x: n.x, y: n.y + 5, 'text-anchor': 'middle' }, n.label));
      g.append(box);
    }
    container.replaceChildren(g);
  }

  root.AspaGraph = Object.assign(api, { draw });
})(typeof self !== 'undefined' ? self : this);
