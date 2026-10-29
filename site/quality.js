'use strict';

// Quality checks on the ASPAs: things that are wrong, doubtful or worth a look in an ASPA, found from the
// ASPAs alone plus, when it is known, which ASes the RIPE RIS collectors see in BGP. Pure functions shared
// by the page and the tests.
//
// An ASPA here is {customer: "AS680", providers: ["AS1299", ...], source: [{validity: {notAfter}}]}, as
// the page builds them from Routinator's JSON.
(function (root) {
  const asNum = (as) => Number(as.slice(2));

  // AS numbers that are private, reserved or for documentation (RFC 5398, 6996, 7300, 7607, and 65552-131071,
  // which IANA keeps reserved) or AS_TRANS
  const reserved = (as) => {
    const n = asNum(as);
    return n === 23456 || (n >= 64496 && n <= 131071) || n >= 4200000000;
  };

  const KINDS = {
    'as0-mixed': { severity: 'error', title: 'AS0 together with other providers',
      why: 'AS0 stands for "no provider". Listed next to real providers it makes the ASPA contradict itself, and verifiers may read it differently.' },
    'self-provider': { severity: 'error', title: 'An AS listed as its own provider',
      why: 'An AS cannot be its own provider; the entry has no meaning.' },
    'reserved-provider': { severity: 'error', title: 'A private or reserved provider AS number',
      why: 'Private, documentation and reserved AS numbers do not appear in the global routing system, so no real path can pass them.' },
    mutual: { severity: 'warning', title: 'Two ASes that list each other as provider',
      why: 'A customer-to-provider link has a direction. When both ASes list each other (siblings may do it on purpose), a path can climb and descend over that link, which weakens the detection of route leaks.' },
    'provider-unseen': { severity: 'warning', title: 'A provider not seen in BGP',
      why: 'The RIPE RIS collectors see no route that goes through this AS: a typo, a retired AS, or an AS that does not announce anything.' },
    expiring: { severity: 'warning', title: 'An ASPA that expires soon',
      why: 'When the signed object expires the ASPA disappears, and the hops from the AS can no longer be checked until a new one is published.' },
    'customer-unseen': { severity: 'note', title: 'A customer not seen in BGP',
      why: 'The RIPE RIS collectors see no route of this AS: it may announce only where they do not look, or have stopped.' },
    'large-set': { severity: 'note', title: 'A very large provider set',
      why: 'With so many providers almost any path through the AS is accepted, so the ASPA stops very little.' },
  };
  const ORDER = ['as0-mixed', 'self-provider', 'reserved-provider', 'mutual', 'provider-unseen', 'expiring', 'customer-unseen', 'large-set'];

  // opts.unseen: a Set of the ASes not seen in BGP (null when unknown: those checks are skipped);
  // opts.now: the current time; opts.largeAt: provider count that makes a set "very large";
  // opts.expiryDays: how close an expiry must be.
  function check(aspas, opts) {
    const o = Object.assign({ unseen: null, now: Date.now(), largeAt: 30, expiryDays: 30 }, opts || {});
    const byCustomer = new Map(aspas.map((a) => [a.customer, a]));
    const out = [];
    const add = (kind, customer, detail, providers) =>
      out.push({ kind, severity: KINDS[kind].severity, customer, detail, providers: providers || [] });
    const list = (ps) => ps.slice(0, 5).join(', ') + (ps.length > 5 ? ` and ${ps.length - 5} more` : '');
    for (const a of aspas) {
      const real = a.providers.filter((p) => p !== 'AS0');
      if (a.providers.includes('AS0') && real.length) add('as0-mixed', a.customer, `lists AS0 and ${real.length} other provider${real.length === 1 ? '' : 's'}`, real);
      if (real.includes(a.customer)) add('self-provider', a.customer, 'lists itself as a provider', [a.customer]);
      const res = real.filter(reserved);
      if (res.length) add('reserved-provider', a.customer, `names ${list(res)}`, res);
      const mutual = real.filter((p) => p !== a.customer && byCustomer.has(p) && byCustomer.get(p).providers.includes(a.customer));
      if (mutual.length) add('mutual', a.customer, `and ${list(mutual)} list each other`, mutual);
      if (o.unseen) {
        const gone = real.filter((p) => o.unseen.has(p));
        if (gone.length) add('provider-unseen', a.customer, `names ${list(gone)}, not seen in BGP`, gone);
        if (o.unseen.has(a.customer)) add('customer-unseen', a.customer, 'is not seen in BGP', []);
      }
      if (real.length >= o.largeAt) add('large-set', a.customer, `names ${real.length} providers`, []);
      const ends = (a.source || []).map((s) => s.validity && Date.parse(s.validity.notAfter)).filter((t) => t > 0);
      if (ends.length) {
        const days = Math.ceil((Math.max(...ends) - o.now) / 86400000);
        if (days <= o.expiryDays) add('expiring', a.customer, days <= 0 ? 'has expired' : `expires in ${days} day${days === 1 ? '' : 's'}`, []);
      }
    }
    return out;
  }

  const api = { check, reserved, KINDS, ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaQuality = api;
})(typeof self !== 'undefined' ? self : this);
