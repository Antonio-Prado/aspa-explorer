'use strict';

// "What if the ASPA of this AS listed ...": the verdicts of the routes of an origin as they are now and with another list
// of providers for that origin (the other ASPAs stay as published). Pure functions shared by the page and the tests.
(function (root) {
  const Verify = typeof module !== 'undefined' && module.exports ? require('./verify.js') : root.AspaVerify;

  // "AS1299 3356, 174" -> { providers: ['AS174', 'AS1299', 'AS3356'] } (sorted, no duplicates), or { error }.
  // "0" or "AS0" alone is the ASPA that declares no provider; AS0 next to others is refused (the profile forbids it).
  function parseProviders(text) {
    const tokens = String(text).trim().split(/[\s,]+/).filter(Boolean);
    const out = new Set();
    for (const t of tokens) {
      const m = t.match(/^(?:as)?(\d{1,10})$/i);
      if (!m || Number(m[1]) > 4294967295) return { error: `"${t}" is not an AS number. Use numbers such as 1299 or AS1299, separated by spaces.` };
      out.add(Number(m[1]));
    }
    if (out.has(0) && out.size > 1) return { error: 'AS0 means "no provider" and cannot be listed next to other providers.' };
    return { providers: [...out].sort((a, b) => a - b).map((n) => 'AS' + n) };
  }

  // aspas: Map customer -> Set of providers; rows: [{ path: ['AS9', 'AS5', ...] (origin first), routes: n }];
  // origin: 'AS9'; providers: array of 'AS..' (the new ASPA of the origin); direction as in verify.js.
  // Returns { before, after } (routes by verdict) and the rows whose verdict changes, most routes first.
  function compare(aspas, rows, origin, providers, direction = 'down') {
    const hypo = new Map(aspas);
    hypo.set(origin, new Set(providers));
    const zero = () => ({ Valid: 0, Unknown: 0, Invalid: 0 });
    const before = zero(), after = zero(), changed = [];
    for (const r of rows) {
      const a = Verify.verify(aspas, r.path, direction).result;
      const b = Verify.verify(hypo, r.path, direction).result;
      before[a] += r.routes; after[b] += r.routes;
      if (a !== b) changed.push({ path: r.path, routes: r.routes, from: a, to: b });
    }
    changed.sort((x, y) => y.routes - x.routes);
    return { before, after, changed };
  }

  const api = { parseProviders, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaWhatIf = api;
})(typeof self !== 'undefined' ? self : this);
