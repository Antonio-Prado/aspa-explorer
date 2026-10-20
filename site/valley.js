'use strict';

// Why a path is a valley: a reading of the evidence, never a verdict. Pure functions (tried without a browser in scripts/test-valley.mjs).
//
// The ASPA verification calls a path a valley when the up-ramp (from the origin) and the down-ramp (from the neighbour) do not meet. Each ramp
// stops at a hop that an ASPA says is not customer to provider: the *breakers* below, each one a customer X and the AS Y that its ASPA does not
// list as a provider. A valley can come from a leak, from a forged path, or from an ASPA that misses a real provider; this module looks at what
// else says that Y is a provider of X (the IRR object of X, the IRR object of Y, CAIDA, the paths that RIPEstat sees) and at what says the opposite,
// and tries the ASPA with Y added to see whether the path would stop being a valley.
(function (root) {
  const irrLib = typeof module !== 'undefined' && module.exports ? require('./irr.js') : root.AspaIrr;
  const verifyLib = typeof module !== 'undefined' && module.exports ? require('./verify.js') : root.AspaVerify;
  const num = (as) => Number(String(as).slice(2));

  // The hops of a valley that the ASPAs refuse: [{side: 'up'|'down', customer, provider}] (AS numbers as "AS123"), from a verify() result.
  function breakers(v) {
    const p = v.path, N = v.N, out = [];
    if (v.maxUp < N) out.push({ side: 'up', customer: p[v.maxUp - 1], provider: p[v.maxUp] });
    if (v.maxDown < N && N - v.maxDown - 1 >= 0) out.push({ side: 'down', customer: p[N - v.maxDown], provider: p[N - v.maxDown - 1] });
    return out;
  }

  // The neighbour that RIPEstat sees most often right before `n` in the paths (asn-neighbours, type "left"), with its share, or null if it is not the first
  // or has less than a quarter of them. It says how the AS is reached, not what it has paid for.
  function dominantUpstream(neighbours, y) {
    const left = (neighbours || []).filter((x) => x.type === 'left').sort((a, b) => b.power - a.power);
    const total = left.reduce((s, x) => s + x.power, 0);
    if (!left.length || !total || left[0].asn !== y || left[0].power < total * 0.25) return null;
    return { power: left[0].power, share: left[0].power / total };
  }

  // ctx: {irr: Map(number -> roles | null), caida: providers object or null, observed: Map(number -> neighbours list)}
  // An IRR number that is not in the map was not asked (or the question failed); null means that the registry holds no policy for it.
  function evidenceFor(b, ctx) {
    const X = num(b.customer), Y = num(b.provider);
    const forIt = [], against = [];
    const rx = ctx.irr.get(X), ry = ctx.irr.get(Y);
    if (rx) {
      const s = irrLib.say(rx, Y);
      if (rx.transit.includes(Y)) forIt.push({ w: 3, src: 'IRR', text: `the IRR object of ${b.customer} declares ${b.provider} as a transit provider` });
      else if (rx.candidate.includes(Y)) forIt.push({ w: 1, src: 'IRR', text: `the IRR object of ${b.customer} accepts ANY from ${b.provider} (it does not say what it is)` });
      else if (s) against.push({ src: 'IRR', text: `the IRR object of ${b.customer} describes ${b.provider} as ${s}` });
    }
    if (ry) {
      if (ry.customer.includes(X)) forIt.push({ w: 2, src: 'IRR', text: `the IRR object of ${b.provider} announces ANY to ${b.customer}, as it does to its customers` });
      else if (ry.transit.includes(X)) against.push({ src: 'IRR', text: `the IRR object of ${b.provider} declares ${b.customer} as its transit provider, the other way round` });
    }
    if (ctx.caida) {
      if ((ctx.caida[X] || []).includes(Y)) forIt.push({ w: 1, src: 'CAIDA', text: `CAIDA infers ${b.provider} as a provider of ${b.customer}` });
      else if ((ctx.caida[Y] || []).includes(X)) against.push({ src: 'CAIDA', text: `CAIDA infers ${b.customer} as a provider of ${b.provider}, the other way round` });
    }
    const obs = ctx.observed && ctx.observed.get(X) ? dominantUpstream(ctx.observed.get(X), Y) : null;
    if (obs) forIt.push({ w: 1, src: 'RIPEstat', text: `RIPEstat sees ${b.provider} right before ${b.customer} in ${Math.round(obs.share * 100)}% of the paths that go through ${b.customer}, more than any other neighbour` });
    const score = forIt.reduce((s, e) => s + e.w, 0);
    const strong = forIt.some((e) => e.w === 3);
    let kind = strong || score >= 3 ? 'gap' : score >= 1 ? 'maybe' : 'none';
    if (kind === 'gap' && !strong && against.length) kind = 'maybe';
    return { ...b, forIt, against, score, kind };
  }

  // The path with `provider` added to the ASPA of `customer`: what the verification would say.
  function whatIf(aspas, v, b) {
    const m = new Map([...aspas].map(([k, s]) => [k, new Set(s)]));
    if (!m.has(b.customer)) return null;
    m.get(b.customer).add(b.provider);
    return verifyLib.verify(m, v.path, 'down').result;
  }

  const RANK = { gap: 3, maybe: 2, none: 1 };

  // The reading of one valley. `v` is the verify() result of the path (origin first), `ixp` a Set of exchange-point AS numbers.
  function explain(v, aspas, ctx, ixp) {
    const found = breakers(v).map((b) => {
      const e = evidenceFor(b, ctx);
      e.clears = e.kind === 'none' ? null : whatIf(aspas, v, b);
      return e;
    });
    const between = v.path.slice(v.maxUp, v.N - v.maxDown);
    const ixps = between.filter((as) => ixp && ixp.has(num(as)));
    const asked = [...new Set(found.flatMap((b) => [num(b.customer), num(b.provider)]))];
    const answered = asked.filter((n) => ctx.irr.get(n)).length;
    let kind = found.reduce((k, b) => (RANK[b.kind] > RANK[k] ? b.kind : k), 'none');
    if (kind === 'none' && ixps.length) kind = 'ixp';
    else if (kind === 'none' && !answered && !ctx.caida) kind = 'nodata';
    return { kind, breakers: found, ixps, between };
  }

  // The words for the page: {lead, body, ask}. `ask` lists who could clear it: [{as, add}].
  function words(r) {
    const act = r.breakers.filter((b) => b.kind !== 'none');
    const ask = act.map((b) => ({ as: b.customer, add: b.provider, clears: b.clears }));
    const clearsText = (b) => (b.clears && b.clears !== 'Invalid' ? ` With ${b.provider} in the ASPA of ${b.customer} this path would be ${b.clears}.` : '');
    if (r.kind === 'gap' || r.kind === 'maybe') {
      const lead = r.kind === 'gap' ? 'Probably a gap in an ASPA, not a leak.' : 'Possibly a gap in an ASPA.';
      const body = act.map((b) => `${b.customer} does not list ${b.provider} as a provider, and ${b.forIt.map((e) => e.text).join('; ')}.${b.against.length ? ` Against it: ${b.against.map((e) => e.text).join('; ')}.` : ''}${clearsText(b)}`).join(' ');
      return { lead, body, ask };
    }
    if (r.kind === 'ixp') {
      return { lead: 'An exchange-point AS is in the valley.', body: `${r.ixps.join(', ')} ${r.ixps.length === 1 ? 'is' : 'are'} in the list of exchange-point ASes. A route server can keep its own AS in the path (RFC 7947 only says SHOULD NOT prepend it), and the same AS number can also belong to a network that sells transit: the ASPAs cannot tell which. Nothing else read here explains the valley.`, ask };
    }
    if (r.kind === 'nodata') {
      return { lead: 'Not enough data.', body: 'The registries did not answer, or hold no policy, for the ASes at the ends of the valley, and CAIDA is not available: there is nothing to read.', ask };
    }
    const pairs = r.breakers.map((b) => `${b.provider} as a provider of ${b.customer}`).join(' and ');
    const against = r.breakers.flatMap((b) => b.against.map((e) => e.text));
    return { lead: 'Nothing read here explains this valley.', body: `The IRR objects, CAIDA and RIPEstat do not say ${pairs}.${against.length ? ` What they do say: ${against.join('; ')}.` : ''} It can still be an ASPA that misses a provider that nobody declared, or a leak or a forged path. Look at who these ASes are and at the other paths of the same prefixes before concluding.`, ask };
  }

  // The hops of the path, with what each source says: [{a, b, aspa: [text, text], irr: [text], caida: text|null}] (origin first).
  function hops(v, aspas, ctx) {
    const listed = (x, y) => { const s = aspas.get(x); return !s ? `${x} publishes no ASPA` : s.has(y) ? `${x} lists ${y}` : `${x} does not list ${y}`; };
    const out = [];
    for (let i = 0; i < v.path.length - 1; i++) {
      const a = v.path[i], b = v.path[i + 1], A = num(a), B = num(b);
      const irr = [];
      for (const [x, y, X, Y] of [[a, b, A, B], [b, a, B, A]]) {
        const r = ctx.irr.get(X);
        if (r === undefined) continue;
        if (r === null) { irr.push(`IRR of ${x}: no policy in the registry`); continue; }
        irr.push(`IRR of ${x} on ${y}: ${irrLib.say(r, Y) || 'not mentioned'}`);
      }
      let caida = null;
      if (ctx.caida) caida = (ctx.caida[A] || []).includes(B) ? `${b} is a provider of ${a}` : (ctx.caida[B] || []).includes(A) ? `${a} is a provider of ${b}` : 'no relation';
      out.push({ a, b, aspa: [listed(a, b), listed(b, a)], irr, caida });
    }
    return out;
  }

  // What the registry and CAIDA add to a neighbour of the origin in the routes. `listed`: the ASPA of the origin lists it; `r`: the roles of the IRR object
  // of the origin (null when the registry holds no policy for it, undefined when it was not read); `caida`: the providers that CAIDA gives to the origin, or null;
  // `evidence`: the label of the evidence of the routes ('provider', 'weak', ...). Returns {kind, label, sources, against}.
  function neighbourReading(listed, n, r, caida, evidence) {
    const N = Number(n), sources = [], against = [];
    let score = 0;
    if (r) {
      if (r.transit.includes(N)) { score += 3; sources.push('a transit provider in its IRR object'); }
      else if (r.candidate.includes(N)) { score += 1; sources.push('accepted from ANY in its IRR object'); }
      else { const s = irrLib.say(r, N); if (s) against.push(`its IRR object: ${s}`); }
    }
    if (caida && caida.includes(N)) { score += 1; sources.push('a provider for CAIDA'); }
    if (evidence === 'provider') { score += 1; sources.push('the routes reach a Tier-1 through it'); }
    const asked = r !== undefined || Boolean(caida);
    let kind;
    if (listed) kind = score > 0 ? 'agrees' : (asked ? 'aspa-only' : 'none');
    else if (score >= 3) kind = 'probably-missing';
    else if (score >= 1) kind = 'maybe-missing';
    else kind = against.length ? 'other' : 'none';
    const label = { agrees: 'confirmed', 'aspa-only': 'only the ASPA', 'probably-missing': 'probably missing', 'maybe-missing': 'maybe missing', other: 'not a provider?', none: '–' }[kind];
    return { kind, label, sources, against };
  }

  const api = { neighbourReading, breakers, dominantUpstream, evidenceFor, whatIf, explain, words, hops };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaValley = api;
})(typeof self !== 'undefined' ? self : this);
