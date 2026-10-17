'use strict';

// Possible tromboning, from the routes that the RIPE RIS collectors see right now.
//
// In the literature a route "trombones" when it starts and ends in the same country but crosses another
// one on the way (Edmundson et al., Princeton; before them Obar and Clement for Canada). The papers measure
// it with traceroutes. From BGP alone only a candidate can be told: a path seen by a collector feeder
// registered in the country of the origin, which goes through a network registered in another country,
// or in another region (RIR). The country where an AS is registered is not where it works (a transit
// network registered in the United States has points of presence in Europe), so this is a lead to be
// confirmed with measurements, never proof. Pure functions shared by the page and the tests.
(function (root) {
  const MIN_FEEDERS = 3;     // domestic feeders needed before a result is shown

  // routes: [{path: [AS numbers, collector side first], source_id}], origin: AS number,
  // lookup(asn) -> {cc, rir} | null (rir: one letter), opts.ixp: Set of exchange-point ASes
  function analyse(routes, origin, lookup, opts) {
    const ixp = (opts && opts.ixp) || new Set();
    const home = lookup(origin);
    const out = { country: home ? home.cc : null, region: home ? home.rir : null, domestic: 0, feeders: new Set(), crossCountry: 0, crossRegion: 0, byAs: new Map(), examples: [] };
    if (!home) { out.feeders = 0; return out; }
    for (const rt of routes) {
      if (!Array.isArray(rt.path)) continue;
      const p = [];
      for (const a of rt.path) { if (ixp.has(a)) continue; if (p[p.length - 1] !== a) p.push(a); }
      if (p.length < 3 || p[p.length - 1] !== origin) continue;
      const feeder = lookup(p[0]);
      if (!feeder || feeder.cc !== home.cc) continue;                 // only paths between two networks of the country
      out.domestic++; out.feeders.add(p[0]);
      const middle = p.slice(1, -1);
      const foreign = middle.filter((a) => { const w = lookup(a); return w && w.cc !== home.cc; });
      if (!foreign.length) continue;
      out.crossCountry++;
      const outside = foreign.filter((a) => lookup(a).rir !== home.rir);
      if (outside.length) { out.crossRegion++; if (out.examples.length < 3) out.examples.push(p); }
      for (const a of new Set(foreign)) {
        const w = lookup(a);
        const e = out.byAs.get(a) || { cc: w.cc, outsideRegion: w.rir !== home.rir, paths: 0, feeders: new Set() };
        e.paths++; e.feeders.add(p[0]);
        out.byAs.set(a, e);
      }
    }
    out.feeders = out.feeders.size;
    for (const e of out.byAs.values()) e.feeders = e.feeders.size;
    out.enough = out.feeders >= MIN_FEEDERS;
    return out;
  }

  const api = { analyse, MIN_FEEDERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaTromboning = api;
})(typeof self !== 'undefined' ? self : this);
