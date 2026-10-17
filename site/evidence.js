'use strict';

// Who is the provider of an AS, judged from the routes that the RIPE RIS collectors see right now.
//
// A route is announced from the origin to the left of the AS path as seen by a collector. A network that
// passes the routes of its peers or providers on only to its customers passes the routes of its customers
// on to everybody, so: when a route reaches a Tier-1 network through the neighbour N of the origin X, that
// is, the path ends "... T1 N X", then N received the route of X from a customer and X is a customer of N.
// A peer, or a provider that is not asked to carry the route upwards, would not have sent it up.
//
// This needs at least three ASes in the path (with two, the left one is only the network that feeds the
// collector), and a list of Tier-1 networks. What it finds is evidence, not a verdict: the absence of it
// proves nothing, and a route leak can fake some of it. Pure functions shared by the page and the tests.
(function (root) {
  const MIN_PATHS = 5;         // informative paths (three ASes or more) before any label is given
  const STRONG_FEEDERS = 3;    // distinct feeders that must see the route through a Tier-1
  const STRONG_SHARE = 0.2;    // share of the informative paths that go through a Tier-1

  // the path without prepending and without the ASes of exchange points (they are not in the way)
  function clean(path, ixp) {
    const p = [];
    for (const a of path) {
      if (ixp && ixp.has(a)) continue;
      if (p[p.length - 1] !== a) p.push(a);
    }
    return p;
  }

  // routes: [{path: [AS numbers, collector side first], source_id}], origin: AS number;
  // opts.clique and opts.ixp are Sets of AS numbers.
  // Returns Map neighbour -> {paths, short, informative, viaT1, feeders, share, label}
  function analyse(routes, origin, opts) {
    const clique = (opts && opts.clique) || new Set();
    const ixp = (opts && opts.ixp) || new Set();
    const nb = new Map();
    for (const rt of routes) {
      if (!Array.isArray(rt.path)) continue;
      const p = clean(rt.path, ixp);
      if (p.length < 2 || p[p.length - 1] !== origin) continue;
      const n = p[p.length - 2];
      let e = nb.get(n);
      if (!e) { e = { paths: 0, short: 0, informative: 0, viaT1: 0, feeders: new Set() }; nb.set(n, e); }
      e.paths++;
      if (p.length === 2) { e.short++; continue; }
      e.informative++;
      const left = p[p.length - 3];
      if (clique.has(left) && left !== n) { e.viaT1++; e.feeders.add(rt.source_id); }
    }
    for (const e of nb.values()) {
      e.feeders = e.feeders.size;
      e.share = e.informative ? e.viaT1 / e.informative : 0;
      e.label = e.informative < MIN_PATHS ? 'few'
        : e.feeders >= STRONG_FEEDERS && e.share >= STRONG_SHARE ? 'provider'
          : e.viaT1 > 0 ? 'weak' : 'none';
    }
    return nb;
  }

  // A starting point for the ASPA of the origin, from what it declares now (an array of "AS123", or null without an ASPA) and the
  // evidence about its neighbours (the Map of analyse). Providers with strong evidence are proposed; the declared ones stay, whether
  // the routes show them or not (a backup provider is invisible); weak evidence is only a lead.
  const num = (a) => Number(a.slice(2));
  function suggest(declared, ev) {
    const has = declared && declared.length ? declared.filter((p) => p !== 'AS0') : [];
    const zero = Boolean(declared && declared.includes('AS0'));
    const strong = [], weak = [];
    for (const [n, e] of ev) (e.label === 'provider' ? strong : e.label === 'weak' ? weak : []).push('AS' + n);
    const declaredSet = new Set(has);
    const sort = (l) => l.sort((a, b) => num(a) - num(b));
    return {
      keep: sort(has.filter((p) => strong.includes(p) || weak.includes(p))),
      keepUnseen: sort(has.filter((p) => !strong.includes(p) && !weak.includes(p))),
      add: sort(strong.filter((p) => !declaredSet.has(p))),
      check: sort(weak.filter((p) => !declaredSet.has(p) && !strong.includes(p))),
      zero,
      list: sort([...new Set([...has, ...strong])]),
    };
  }

  const api = { analyse, clean, suggest, MIN_PATHS, STRONG_FEEDERS, STRONG_SHARE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaEvidence = api;
})(typeof self !== 'undefined' ? self : this);
