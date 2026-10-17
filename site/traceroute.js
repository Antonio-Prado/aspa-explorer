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
  function targetOf(routes, origin) {
    const seen = new Set();
    for (const rt of routes) {
      if (Array.isArray(rt.path) && rt.path[rt.path.length - 1] === origin && rt.target_prefix) seen.add(String(rt.target_prefix).toLowerCase());
    }
    const len = (p) => Number(p.split('/')[1]);
    const usable = (p) => { const h = hostIn(p); return h && !isPrivate(h) && (p.includes(':') ? len(p) >= 19 && len(p) <= 64 : len(p) >= 8 && len(p) <= 24); };
    const order = (list, lo, hi) => [...list.filter((p) => len(p) >= lo && len(p) <= hi).sort((a, b) => len(a) - len(b)), ...list.filter((p) => len(p) < lo || len(p) > hi).sort((a, b) => len(a) - len(b))];
    const ok = [...seen].filter(usable);
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

  // Distance on the ground, in km, between two points (degrees).
  function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  // Where a hop is, from the candidates of RIPE IPmap ({cityName, countryCodeAlpha2, latitude, longitude, score}): the best scored one that the
  // delay allows. A packet covers about 100 km each way in a millisecond of round trip, so a place farther than that from the probe is
  // impossible whatever the score says.
  function pickLocation(locations, probe, rtt) {
    const list = [...(locations || [])].filter((l) => l && l.countryCodeAlpha2 && typeof l.latitude === 'number').sort((a, b) => (b.score || 0) - (a.score || 0));
    for (const l of list) {
      if (rtt !== null && probe && typeof probe.latitude === 'number' && distanceKm(probe.latitude, probe.longitude, l.latitude, l.longitude) > rtt * 100 + 30) continue;
      return { city: l.cityName || null, cc: l.countryCodeAlpha2 };
    }
    return null;
  }

  // result: one entry of `results` of a finished Globalping traceroute; asnOf(ip) -> AS number | null;
  // locationsOf(ip) -> the candidates of RIPE IPmap for the address (an array, possibly empty).
  function summarise(result, asnOf, locationsOf) {
    const hops = (result.result.hops || []).map((h, i) => {
      const rtts = (h.timings || []).map((t) => t.rtt).filter((x) => typeof x === 'number');
      const ip = h.resolvedAddress || null;
      const asn = ip && !isPrivate(ip) ? asnOf(ip) : null;
      const rtt = rtts.length ? Math.min(...rtts) : null;
      const geo = ip && !isPrivate(ip) && locationsOf ? pickLocation(locationsOf(ip), result.probe, rtt) : null;
      return { n: i + 1, ip, host: h.resolvedHostname && h.resolvedHostname !== ip ? h.resolvedHostname : null, asn, rtt, geo };
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
    // the countries on the way, where the hops could be placed, and the first hop that is abroad
    const countries = [];
    for (const h of hops) if (h.geo && countries[countries.length - 1] !== h.geo.cc) countries.push(h.geo.cc);
    const home = result.probe.country;
    const abroad = [...new Set(countries.filter((cc) => cc !== home))];
    const exit = hops.find((h) => h.geo && h.geo.cc !== home) || null;
    const lastRtt = last && last.rtt !== null ? last.rtt : null;
    return {
      probe: { city: result.probe.city, country: result.probe.country, asn: result.probe.asn, network: result.probe.network },
      status: result.result.status, hops, path, countries, abroad, exit, jump, lastRtt, reachedAddress: last ? last.ip : null,
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
    const detours = done.filter((s) => (s.abroad || []).length);  // probes whose path goes through another country
    const abroadBy = {};
    for (const s of detours) for (const cc of (s.abroad || [])) abroadBy[cc] = (abroadBy[cc] || 0) + 1;
    return { n: done.length, median, min: nets[0], max: nets[nets.length - 1], counts, near, detours: detours.length, abroadBy, verdict: median >= TROMBONE_MS ? 'trombone' : median > LONG_DELAY_MS ? 'long' : 'ok' };
  }

  const api = { hostIn, targetOf, isPrivate, summarise, aggregate, pickLocation, distanceKm, LONG_DELAY_MS, TROMBONE_MS, JUMP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaTraceroute = api;
})(typeof self !== 'undefined' ? self : this);
