'use strict';

// What the IRR object of an AS (its aut-num in an Internet Routing Registry: the RIPE database and the mirrors that it serves) says about its
// neighbours, read next to its ASPA. Pure functions over the attributes of the object, so that they can be tried without a browser (scripts/test-irr.mjs).
//
// An aut-num says its routing policy in import and export lines, in a free order, with remarks to tell the sections. What this reads is cautious:
//   * a neighbour that the AS accepts ANY from, in a part of the object that is called transit, upstream or provider, is a transit provider;
//   * a neighbour that the AS announces ANY to (and does not accept ANY from) is a customer;
//   * import-via and export-via name the AS that stands between the AS and other ASes: in practice the route server of an exchange point. An AS that
//     appears only so is an intermediary (list `ixp`); one that has ordinary import and export lines too keeps the role that they give it, and is also in `via`;
//   * the others (a set of prefixes in both directions) are listed as `peer`, but all that the object says is that the sets are exchanged: it can be a peer,
//     a private interconnect, an exchange point or a service that is bought, such as DDoS scrubbing, and the object cannot tell them apart.
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
        // a header is short, at most four words: the long remarks that document the communities say "customer" and "upstream" without opening a section
        if (text && text.length <= 60 && text.split(/\s+/).length <= 4) for (const [kind, re] of SECTION) if (re.test(text)) { context = kind; sections++; break; }
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
      else if (anyOut && !anyIn) out.customer.push(n);      // a section called customers is not enough: the sections after it may not say that they are over
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

  // The three sources side by side for the providers of one AS: the IRR object (`r`, from roles), CAIDA (a list of numbers, or null when its file is not
  // there) and the ASPA. One row for each AS that any of them calls a provider, with who says so and how the IRR describes it when it does not.
  // `reading` puts the rows in order of how much they say: where two sources agree against the third, the third is the one to ask about.
  function threeWay(aspaProviders, r, caida) {
    const aspa = new Set(aspaProviders.filter((n) => n !== 0));
    const irr = new Set(r.transit);
    const cai = new Set(caida || []);
    const all = [...new Set([...aspa, ...irr, ...cai])].sort((a, b) => a - b);
    const rows = all.map((n) => {
      const by = [irr.has(n) && 'IRR', cai.has(n) && 'CAIDA', aspa.has(n) && 'ASPA'].filter(Boolean);
      const sources = caida ? 3 : 2;
      let reading;
      if (by.length === sources) reading = 'all agree';
      else if (by.length === 1) reading = `only ${by[0]} says it`;
      else if (!aspa.has(n)) reading = 'IRR and CAIDA say it, the ASPA does not';
      else if (!irr.has(n)) reading = 'the ASPA and CAIDA say it, the IRR does not';
      else reading = 'the IRR and the ASPA say it, CAIDA does not';
      return { as: n, irr: irr.has(n) ? 'transit' : (say(r, n) ? say(r, n) : null), caida: caida ? cai.has(n) : null, aspa: aspa.has(n), by, reading };
    });
    const order = (x) => (x.by.length === 3 ? 0 : x.reading.startsWith('IRR and CAIDA') ? 2 : 1);
    rows.sort((a, b) => order(b) - order(a) || a.as - b.as);
    return { rows, aspaMissesWhatTheOthersSay: rows.filter((x) => !x.aspa && x.irr === 'transit' && x.caida).map((x) => x.as), caidaAvailable: !!caida };
  }

  // What the object says about one neighbour, in a few words (for a hop of a path).
  function say(r, n) {
    if (r.transit.includes(n)) return 'a transit provider';
    if (r.customer.includes(n)) return 'a customer';
    if (r.ixp.includes(n)) return 'an intermediary AS (in practice the route server of an exchange point)';
    if (r.peer.includes(n)) return r.via.includes(n) ? 'sets of prefixes only, and also an intermediary (import-via)' : 'sets of prefixes only (a peer, a private link or a service)';
    if (r.candidate.includes(n)) return 'accepted from ANY (not said what it is)';
    return null;
  }

  const api = { rules, roles, compare, say, threeWay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaIrr = api;
})(typeof self !== 'undefined' ? self : this);
