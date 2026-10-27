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

  // An address as a family and a number (BigInt), or null: dotted IPv4, IPv6 with or without ::
  function parseIp(text) {
    const t = String(text).trim().toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) {
      const parts = t.split('.').map(Number);
      return parts.some((x) => x > 255) ? null : { family: 4, bits: 32, n: BigInt(toNum(t)) };
    }
    if (!/^[0-9a-f:]+$/.test(t) || !t.includes(':') || (t.match(/::/g) || []).length > 1 || t.includes(':::')) return null;
    const [head, tail] = t.includes('::') ? t.split('::') : [t, null];
    const h = head ? head.split(':') : [], tl = tail ? tail.split(':') : [];
    const groups = tail === null ? h : [...h, ...Array(8 - h.length - tl.length).fill('0'), ...tl];
    if (groups.length !== 8 || tail !== null && h.length + tl.length > 7 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return { family: 6, bits: 128, n: groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g, 16)), 0n) };
  }

  // Does the prefix ("193.0.0.0/21") contain the address?
  function contains(prefix, address) {
    const m = /^([0-9a-f.:]+)\/(\d{1,3})$/i.exec(String(prefix).trim());
    const net = m && parseIp(m[1]), ip = parseIp(address);
    if (!net || !ip || net.family !== ip.family || Number(m[2]) > net.bits) return false;
    const shift = BigInt(net.bits - Number(m[2]));
    return net.n >> shift === ip.n >> shift;
  }

  // The prefixes that an origin announces in the routes (every length, lower case): where an address may be aimed at for it.
  function prefixesOf(routes, origin) {
    const out = new Set();
    for (const rt of routes) if (Array.isArray(rt.path) && rt.path[rt.path.length - 1] === origin && rt.target_prefix) out.add(String(rt.target_prefix).toLowerCase());
    return [...out];
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
      probe: { city: result.probe.city, country: result.probe.country, asn: result.probe.asn, network: result.probe.network,
        latitude: result.probe.latitude, longitude: result.probe.longitude },
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
  // `origin` (an AS number): a measurement counts only when its last network is the origin's, that is when the packet got into the AS that is aimed at;
  // a traceroute that stops on a router on the way has the round trip of that router, which says nothing about the target and is left out (net null).
  function pairProbes(s4, s6, origin) {
    const key = (s) => `${s.probe.asn || ''}|${s.probe.city || ''}|${s.probe.network || ''}`;
    const rest = new Map();
    for (const s of s4) { const k = key(s); if (!rest.has(k)) rest.set(k, []); rest.get(k).push(s); }
    const rows = [];
    const row = (a, b) => {
      const reached = (x) => !!x && x.net !== null && (origin === undefined || x.path[x.path.length - 1] === origin);
      const n4 = reached(a) ? a.net : null, n6 = reached(b) ? b.net : null;
      const delta = n4 !== null && n6 !== null ? n6 - n4 : null;
      const winner = n4 === null && n6 === null ? 'none' : n6 === null ? 'v4 only' : n4 === null ? 'v6 only' : Math.abs(delta) < 1 ? 'tie' : delta < 0 ? 'v6' : 'v4';
      const transit = (x) => (x ? x.path.filter((as) => as !== x.probe.asn).join(' ') : null);
      return { probe: (a || b).probe, v4: a, v6: b, n4, n6, delta, winner, sameNetworks: n4 !== null && n6 !== null ? transit(a) === transit(b) : null };
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
      median4: med(both.map((r) => r.n4)), median6: med(both.map((r) => r.n6)), medianDelta: med(both.map((r) => r.delta)),
      differentNetworks: both.filter((r) => r.sameNetworks === false).length,
    };
  }

  // Where a probe is. Globalping places a probe by the address it connects from (geolocation databases), and a probe that is
  // not in the country makes a trombone that is not there. Izhikevich and others (IMC 2026) test the place of RIPE Atlas probes
  // with the round trips to the DNS root servers: a round trip shorter than light in fibre allows from the declared place proves
  // that the probe is elsewhere. Globalping cannot ask a root server which of its instances answers, but a traceroute has its own
  // reference points: a hop that answers from the LAN of an exchange point is on the other side of that exchange's switch, so
  // the packet went at least to the nearest site of the exchange and came back. Queues, slow answers and tunnels only add time,
  // so they never make a probe look misplaced; the margin covers places that are cities and not points.
  const FIBRE_KM_PER_MS = (299792.458 * 2) / 3 / 1000;    // light in fibre, 2/3 of c: about 200 km in a millisecond
  const PLACE_MARGIN_KM = 100;

  // The distance on the Earth between two [latitude, longitude], in km.
  function distanceKm(a, b) {
    const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // A prefix of a LAN as it can be used: IPv4 from /16 to /30, IPv6 from /32 to /126, in lower case; null for anything else.
  function lanPrefix(text) {
    const m = /^([0-9a-f.:]+)\/(\d{1,3})$/i.exec(String(text || '').trim());
    const net = m && parseIp(m[1]), len = m ? Number(m[2]) : 0;
    if (!net || (net.family === 6 ? len < 32 || len > 126 : len < 16 || len > 30)) return null;
    return `${m[1].toLowerCase()}/${len}`;
  }

  // The exchanges from the tables of PeeringDB (ixpfx, ixlan, ix, ixfac, fac, as the API gives them with depth=0): those with a
  // usable prefix and a facility with coordinates. A site is [latitude, longitude] rounded to three decimals (about 100 m),
  // once for each place. The page asks PeeringDB for them from the browser: the data are not copied anywhere.
  function ixpsFrom({ ixpfx = [], ixlan = [], ix = [], ixfac = [], fac = [] }) {
    const ixOfLan = new Map(ixlan.map((l) => [l.id, l.ix_id]));
    const place = new Map();
    for (const f of fac) {
      const lat = Number(f.latitude), lon = Number(f.longitude);
      if (f.status !== 'ok' || f.latitude === null || f.longitude === null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
      place.set(f.id, [Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000]);
    }
    const prefixes = new Map(), sites = new Map();
    for (const p of ixpfx) {
      const id = ixOfLan.get(p.ixlan_id), pfx = lanPrefix(p.prefix);
      if (id === undefined || !pfx) continue;
      if (!prefixes.has(id)) prefixes.set(id, new Set());
      prefixes.get(id).add(pfx);
    }
    for (const l of ixfac) {
      const s = place.get(l.fac_id);
      if (!s) continue;
      if (!sites.has(l.ix_id)) sites.set(l.ix_id, new Map());
      sites.get(l.ix_id).set(s.join(','), s);
    }
    return ix.filter((x) => x.status === 'ok' && prefixes.has(x.id) && sites.has(x.id))
      .sort((a, b) => a.id - b.id)
      .map((x) => ({ id: x.id, name: x.name, city: x.city, country: x.country, prefixes: [...prefixes.get(x.id)].sort(), sites: [...sites.get(x.id).values()] }));
  }

  // The LANs of the exchanges (ixpsFrom) as an index for the addresses of the hops: one table for each length of prefix,
  // the longest first.
  function ixpIndex(ixps) {
    const groups = new Map();
    for (const x of ixps || []) {
      for (const p of x.prefixes || []) {
        const m = /^([0-9a-f.:]+)\/(\d{1,3})$/i.exec(p), net = m && parseIp(m[1]);
        if (!net || Number(m[2]) > net.bits) continue;
        const key = `${net.family}/${m[2]}`;
        if (!groups.has(key)) groups.set(key, { family: net.family, len: Number(m[2]), shift: BigInt(net.bits - Number(m[2])), nets: new Map() });
        const g = groups.get(key);
        g.nets.set(String(net.n >> g.shift), x);
      }
    }
    return [...groups.values()].sort((a, b) => b.len - a.len);
  }

  // The exchange whose LAN has the address, or null.
  function ixpOf(index, address) {
    const ip = parseIp(address);
    if (!ip) return null;
    for (const g of index) if (g.family === ip.family) { const x = g.nets.get(String(ip.n >> g.shift)); if (x) return x; }
    return null;
  }

  // The check of a probe (a summary, with the latitude and longitude that Globalping gives it): how many of its hops answer from
  // the LAN of an exchange with known sites, and the first one whose round trip is too short for the declared place, with the
  // figures that prove it (null when there is none).
  function placeCheck(summary, index) {
    const p = summary.probe;
    if (!index || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return { checked: 0, misplaced: null };
    let checked = 0;
    for (const h of summary.hops) {
      if (!h.ip || h.rtt === null || isPrivate(h.ip)) continue;
      const x = ixpOf(index, h.ip);
      if (!x || !x.sites || !x.sites.length) continue;
      checked++;
      const km = Math.min(...x.sites.map((s) => distanceKm([p.latitude, p.longitude], s)));
      const atLeast = (2 * Math.max(0, km - PLACE_MARGIN_KM)) / FIBRE_KM_PER_MS;
      if (h.rtt < atLeast) {
        return { checked, misplaced: { hop: h.n, ip: h.ip, ixp: x.name, city: x.city, country: x.country, km: Math.round(km), rtt: h.rtt,
          atLeast: Math.round(atLeast * 10) / 10, within: Math.round(PLACE_MARGIN_KM + (h.rtt / 2) * FIBRE_KM_PER_MS) } };
      }
    }
    return { checked, misplaced: null };
  }

  const api = { hostIn, targetOf, parseIp, contains, prefixesOf, isPrivate, summarise, aggregate, pairProbes, comparePairs, distanceKm, lanPrefix, ixpsFrom, ixpIndex, ixpOf, placeCheck,
    LONG_DELAY_MS, TROMBONE_MS, JUMP_MS, FIBRE_KM_PER_MS, PLACE_MARGIN_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaTraceroute = api;
})(typeof self !== 'undefined' ? self : this);
