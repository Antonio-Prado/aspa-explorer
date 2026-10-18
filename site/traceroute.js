'use strict';

// A traceroute measured from probes in the country of an AS (Globalping, globalping.io), read as a tromboning check:
// where do the hops go, how long does the packet take. Pure functions shared by the page and the tests; the page does the requests.
//
// What it can say is limited: a delay is not a distance (queues, tunnels, an access network and slow answers add milliseconds),
// so a long delay between two points of one country is a lead, not proof, that the packet went somewhere else on the way.
(function (root) {
  const LONG_DELAY_MS = 50;      // a round trip longer than this between two points of one country is longer than it should be
  const TROMBONE_MS = 100;       // and from here it is a trombone: the packet has crossed an ocean, or gone round Europe twice
  const JUMP_MS = 10;            // a step of the delay between two hops that is worth saying

  const toNum = (s) => s.split('.').reduce((n, x) => n * 256 + Number(x), 0);
  const fromNum = (n) => [24, 16, 8, 0].map((sh) => Math.floor(n / 2 ** sh) % 256).join('.');

  // An address to aim at in a prefix: the first host of an IPv4 prefix (the address itself for a /32), the first host of an IPv6 one.
  function hostIn(prefix) {
    const m = /^([0-9a-f.:]+)\/(\d{1,3})$/i.exec(String(prefix).trim());
    if (!m) return null;
    const [, addr, len] = m;
    if (!addr.includes(':')) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(addr) || addr.split('.').some((x) => Number(x) > 255) || Number(len) > 32) return null;
      const base = toNum(addr);
      const size = 2 ** (32 - Number(len));
      const net = base - (base % size);
      return fromNum(Number(len) >= 31 ? net : net + 1);
    }
    return Number(len) <= 128 ? (addr.endsWith('::') ? `${addr}1` : addr) : null;
  }

  // The address to measure for an origin: from the prefixes that it originates in the routes. A default route or a very short prefix
  // says nothing about where the AS is, and a private address leads nowhere: those are left out. IPv4 by preference; among the
  // prefixes of a usual length (12 to 24 for IPv4, 24 to 48 for IPv6) the shortest, then the others.
  // `family` (4 or 6) limits the choice to that family, for the comparison of the two: without it, IPv4 by preference.
  function targetOf(routes, origin, family) {
    const seen = new Set();
    for (const rt of routes) {
      if (Array.isArray(rt.path) && rt.path[rt.path.length - 1] === origin && rt.target_prefix) seen.add(String(rt.target_prefix).toLowerCase());
    }
    const len = (p) => Number(p.split('/')[1]);
    const usable = (p) => { const h = hostIn(p); return h && !isPrivate(h) && (p.includes(':') ? len(p) >= 19 && len(p) <= 64 : len(p) >= 8 && len(p) <= 24); };
    const order = (list, lo, hi) => [...list.filter((p) => len(p) >= lo && len(p) <= hi).sort((a, b) => len(a) - len(b)), ...list.filter((p) => len(p) < lo || len(p) > hi).sort((a, b) => len(a) - len(b))];
    const ok = [...seen].filter(usable).filter((p) => !family || (family === 6) === p.includes(':'));
    const prefix = order(ok.filter((p) => !p.includes(':')), 12, 24)[0] || order(ok.filter((p) => p.includes(':')), 24, 48)[0];
    return prefix ? { prefix, address: hostIn(prefix) } : null;
  }

  // Addresses that no registry maps to an AS: private, shared, link-local, loopback.
  function isPrivate(ip) {
    if (!ip) return true;
    if (ip.includes(':')) return /^(fc|fd|fe[89ab]|::1$|::$)/i.test(ip);
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0 || a >= 224;
  }

  // result: one entry of `results` of a finished Globalping traceroute; asnOf(ip) -> AS number | null.
  function summarise(result, asnOf) {
    const hops = (result.result.hops || []).map((h, i) => {
      const rtts = (h.timings || []).map((t) => t.rtt).filter((x) => typeof x === 'number');
      const ip = h.resolvedAddress || null;
      const asn = ip && !isPrivate(ip) ? asnOf(ip) : null;
      const rtt = rtts.length ? Math.min(...rtts) : null;
      return { n: i + 1, ip, host: h.resolvedHostname && h.resolvedHostname !== ip ? h.resolvedHostname : null, asn, rtt };
    });
    const answering = hops.filter((h) => h.ip);
    const last = answering[answering.length - 1] || null;
    // The biggest rise of the delay between two hops that answer. It counts only if the delay stays up from there to the end
    // (a slow answer of one router does not), and not when it comes out of a private address (the access network of the probe: a
    // tunnel, a mobile network, a modem), where the delay says nothing about the route.
    let jump = null;
    const timed = hops.filter((h) => h.rtt !== null);
    for (let i = 1; i < timed.length; i++) {
      const prev = timed[i - 1];
      if (isPrivate(prev.ip)) continue;
      const by = Math.min(...timed.slice(i).map((h) => h.rtt)) - prev.rtt;
      if (by >= JUMP_MS && (!jump || by > jump.by)) jump = { from: prev.n, hop: timed[i].n, by };
    }
    // the delay that the probe has before the first public address, whatever the route
    const firstPublic = hops.find((h) => h.ip && !isPrivate(h.ip) && h.rtt !== null);
    const access = firstPublic ? firstPublic.rtt : 0;
    const path = [];
    for (const h of hops) if (h.asn && path[path.length - 1] !== h.asn) path.push(h.asn);
    const lastRtt = last && last.rtt !== null ? last.rtt : null;
    return {
      probe: { city: result.probe.city, country: result.probe.country, asn: result.probe.asn, network: result.probe.network },
      status: result.result.status, hops, path, jump, lastRtt, reachedAddress: last ? last.ip : null,
      access, net: lastRtt === null ? null : Math.max(0, lastRtt - access),
      // from the first public address to the end, supposing that the target is in the country of the probe
      verdict: lastRtt === null ? null : lastRtt - access >= TROMBONE_MS ? 'trombone' : lastRtt - access > LONG_DELAY_MS ? 'long' : 'ok',
    };
  }

  // The probes together: how many, the median of their round trips (from the first public address) and how many fall in each fascia.
  // The median, because a probe on a slow access network or with a bad route is one voice among many.
  function aggregate(summaries) {
    const done = summaries.filter((s) => s.verdict);
    if (!done.length) return null;
    const nets = done.map((s) => s.net).sort((a, b) => a - b);
    const mid = Math.floor(nets.length / 2);
    const median = nets.length % 2 ? nets[mid] : (nets[mid - 1] + nets[mid]) / 2;
    const counts = { ok: 0, long: 0, trombone: 0 };
    for (const s of done) counts[s.verdict]++;
    const near = nets.filter((x) => x < 10).length;       // probes that are close to the target
    return { n: done.length, median, min: nets[0], max: nets[nets.length - 1], counts, near, verdict: median >= TROMBONE_MS ? 'trombone' : median > LONG_DELAY_MS ? 'long' : 'ok' };
  }

  // The same probes seen in two measurements, one over IPv4 and one over IPv6 (the second was run on the probes of the first, so they are the
  // same; Globalping gives no probe id, so a probe is told by its network, its city and the order in which it comes): one row for each probe, with
  // the two summaries (null when the probe has no result in one of them), the difference of the net round trips (IPv6 minus IPv4, in ms),
  // the winner and whether the networks on the way are the same.
  function pairProbes(s4, s6) {
    const key = (s) => `${s.probe.asn || ''}|${s.probe.city || ''}|${s.probe.network || ''}`;
    const rest = new Map();
    for (const s of s4) { const k = key(s); if (!rest.has(k)) rest.set(k, []); rest.get(k).push(s); }
    const rows = [];
    const row = (a, b) => {
      const n4 = a && a.net !== null ? a.net : null, n6 = b && b.net !== null ? b.net : null;
      const delta = n4 !== null && n6 !== null ? n6 - n4 : null;
      const winner = n4 === null && n6 === null ? 'none' : n6 === null ? 'v4 only' : n4 === null ? 'v6 only' : Math.abs(delta) < 1 ? 'tie' : delta < 0 ? 'v6' : 'v4';
      const transit = (x) => (x ? x.path.filter((as) => as !== x.probe.asn).join(' ') : null);
      return { probe: (a || b).probe, v4: a, v6: b, delta, winner, sameNetworks: a && b && a.path.length && b.path.length ? transit(a) === transit(b) : null };
    };
    for (const b of s6) { const q = rest.get(key(b)); rows.push(row(q && q.length ? q.shift() : null, b)); }
    for (const q of rest.values()) for (const a of q) rows.push(row(a, null));
    return rows;
  }

  // The rows together: the probes that answered on both sides, the medians of the net round trips over IPv4 and IPv6 and of their difference,
  // and how many probes each family wins. The median, as everywhere else: a probe with a slow access network is one voice.
  function comparePairs(rows) {
    const med = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length ? Math.round((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) * 10) / 10 : null; };
    const both = rows.filter((r) => r.delta !== null);
    const counts = { v4: 0, v6: 0, tie: 0, 'v4 only': 0, 'v6 only': 0, none: 0 };
    for (const r of rows) counts[r.winner]++;
    return {
      probes: rows.length, both: both.length, counts,
      median4: med(both.map((r) => r.v4.net)), median6: med(both.map((r) => r.v6.net)), medianDelta: med(both.map((r) => r.delta)),
      differentNetworks: both.filter((r) => r.sameNetworks === false).length,
    };
  }

  const api = { hostIn, targetOf, isPrivate, summarise, aggregate, pairProbes, comparePairs, LONG_DELAY_MS, TROMBONE_MS, JUMP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaTraceroute = api;
})(typeof self !== 'undefined' ? self : this);
