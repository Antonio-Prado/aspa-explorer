'use strict';

// What the IRR object of an AS (its aut-num in an Internet Routing Registry: the RIPE database and the mirrors that it serves) says about its
// neighbours, read next to its ASPA. Pure functions over the attributes of the object, so that they can be tried without a browser (scripts/test-irr.mjs).
//
// An aut-num says its routing policy in import and export lines, in a free order, with remarks to tell the sections. What this reads is cautious:
//   * a neighbour that the AS accepts ANY from, in a part of the object that is called transit, upstream or provider, is a transit provider;
//   * a neighbour that the AS announces ANY to, or that is in a part called customers, is a customer;
//   * import-via and export-via name the AS that stands between the AS and other ASes: in practice the route server of an exchange point. An AS that
//     appears only so is an intermediary (list `ixp`); one that has ordinary import and export lines too keeps the role that they give it, and is also in `via`;
//   * the others (a set of prefixes in both directions: peering, private interconnects, exchange points) are peers.
// Without the remarks, "accept ANY" alone is not enough (a route server is accepted from ANY too): such a neighbour is only a candidate.
(function (root) {
  const SECTION = [
    ['transit', /\b(transits?|upstreams?|providers?)\b/i],
    ['customer', /\b(customers?|downstreams?)\b/i],
    ['peer', /\b(ixps?|exchanges?|route[- ]servers?|peers?|peerings?|pni|private network interconnects?|interconnects?)\b/i],
  ];
  const POLICY = ['import', 'export', 'mp-import', 'mp-export', 'import-via', 'export-via'];
  const asn = (s) => { const m = /^AS(\d+)$/i.exec(String(s)); return m ? Number(m[1]) : null; };

  // attributes: [{name, value}] in the order of the object. Returns the rules: {dir: 'import'|'export', via: boolean, as, filter, context}.
  function rules(attributes) {
    const out = [];
    let context = null, sections = 0;
    for (const { name, value } of attributes) {
      if (name === 'remarks') {
        const text = String(value).replace(/^[\s=\-#*]+|[\s=\-#*]+$/g, '');
        // a header is short and says only what the section is; "-- WARIAN --" is the name of a neighbour, not a section
        if (text && text.length <= 60) for (const [kind, re] of SECTION) if (re.test(text) && !/^\s*[A-Za-z0-9 ]+ - /.test(text)) { context = kind; sections++; break; }
        continue;
      }
      if (!POLICY.includes(name)) continue;
      const v = String(value).trim();
      const dir = name.endsWith('export') || name.endsWith('export-via') ? 'export' : 'import';
      if (name.endsWith('-via')) {
        const m = /^(?:afi\s+\S+\s+)?(AS\d+)\s+(?:from|to)\s+(\S+)\s+(?:accept|announce)\s+(.+)$/i.exec(v);
        if (m) out.push({ dir, via: true, as: asn(m[1]), filter: m[3].trim(), context });
        continue;
      }
      const m = dir === 'import'
        ? /^(?:afi\s+\S+\s+)?from\s+(AS\d+)\b.*?\baccept\s+(.+)$/i.exec(v)
        : /^(?:afi\s+\S+\s+)?to\s+(AS\d+)\b.*?\bannounce\s+(.+)$/i.exec(v);
      if (m) out.push({ dir, via: false, as: asn(m[1]), filter: m[2].trim(), context });
    }
    out.sections = sections;
    return out;
  }

  const isAny = (f) => /^ANY$/i.test(String(f).trim()) || /^AS-ANY$/i.test(String(f).trim());

  // The neighbours by what the object says of them: {transit, customer, ixp, peer, candidate} as sorted lists of AS numbers (a number is in one list).
  function roles(attributes) {
    const rs = rules(attributes);
    const by = new Map();
    for (const r of rs) {
      if (r.as === null) continue;
      const e = by.get(r.as) || { in: [], out: [], via: false };
      if (r.via) e.via = true; else (r.dir === 'import' ? e.in : e.out).push(r);
      by.set(r.as, e);
    }
    const out = { transit: [], customer: [], ixp: [], via: [], peer: [], candidate: [], sections: rs.sections, rules: rs.length };
    for (const [n, e] of by) {
      if (e.via) out.via.push(n);
      if (e.via && !e.in.length && !e.out.length) { out.ixp.push(n); continue; }
      const ctx = [...e.in, ...e.out].map((r) => r.context).find(Boolean) || null;
      const anyIn = e.in.some((r) => isAny(r.filter)), anyOut = e.out.some((r) => isAny(r.filter));
      if (ctx === 'transit' && anyIn) out.transit.push(n);
      else if (ctx === 'customer' || (anyOut && !anyIn)) out.customer.push(n);
      else if (anyIn && !anyOut && ctx === null) out.candidate.push(n);       // "accept ANY" with no section to say what it is
      else out.peer.push(n);
    }
    for (const k of ['transit', 'customer', 'ixp', 'via', 'peer', 'candidate']) out[k].sort((a, b) => a - b);
    return out;
  }

  // The providers of the ASPA (numbers) against the transit providers of the object. Neighbours that the object calls route servers or peers are left
  // out of "missing from the ASPA" even if they are accepted from ANY, because only a transit section says that they carry the AS upwards.
  function compare(aspaProviders, r) {
    const aspa = new Set(aspaProviders.filter((n) => n !== 0));
    const irr = new Set(r.transit);
    const cand = new Set(r.candidate);
    return {
      both: [...irr].filter((n) => aspa.has(n)).sort((a, b) => a - b),
      onlyIrr: [...irr].filter((n) => !aspa.has(n)).sort((a, b) => a - b),
      onlyAspa: [...aspa].filter((n) => !irr.has(n)).sort((a, b) => a - b),
      onlyAspaIsPeerOrIxp: [...aspa].filter((n) => !irr.has(n) && (r.peer.includes(n) || r.ixp.includes(n))).sort((a, b) => a - b),
      onlyAspaIsVia: [...aspa].filter((n) => !irr.has(n) && r.via.includes(n)).sort((a, b) => a - b),
      onlyAspaIsCustomer: [...aspa].filter((n) => !irr.has(n) && r.customer.includes(n)).sort((a, b) => a - b),
      candidatesNotInAspa: [...cand].filter((n) => !aspa.has(n)).sort((a, b) => a - b),
      comparable: irr.size > 0,
    };
  }

  // What the object says about one neighbour, in a few words (for a hop of a path).
  function say(r, n) {
    if (r.transit.includes(n)) return 'a transit provider';
    if (r.customer.includes(n)) return 'a customer';
    if (r.ixp.includes(n)) return 'an intermediary AS (in practice the route server of an exchange point)';
    if (r.peer.includes(n)) return r.via.includes(n) ? 'a peer, and also an intermediary (import-via)' : 'a peer';
    if (r.candidate.includes(n)) return 'accepted from ANY (not said what it is)';
    return null;
  }

  const api = { rules, roles, compare, say };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaIrr = api;
})(typeof self !== 'undefined' ? self : this);
