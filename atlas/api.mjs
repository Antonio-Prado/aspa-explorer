// The RIPE Atlas side of the tromboning test, behind nginx on the loopback interface:
//   POST /api/v1/atlas/measure   {asn, country, targets: {v4?, v6?}}
//   GET  /api/v1/atlas/anchors?country=CC
// The page cannot hold the key of the account, so this service creates the measurements for it, and only these: a traceroute
// towards an address inside a prefix that the AS announces (RIPEstat), from up to PROBES probes of the country chosen, of
// different networks, and pings from the same probes to anchors spread in the country and in the world, with which the page
// checks where each probe is (site/traceroute.js, soiCheck). The results of RIPE Atlas are public: the page reads them from Atlas.
// Everything the handlers need from outside is passed in, so the tests can fake it.
import { createRequire } from 'node:module';

const T = createRequire(import.meta.url)('../site/traceroute.js');

// A sliding counter per key, in memory (as in notifier/server.mjs: restarting the service forgets it, which is harmless; past `maxKeys` keys
// the ones used least recently are forgotten one at a time, not all at once).
export function limiter(max, windowSec, now = () => Date.now() / 1000, maxKeys = 50000) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowSec);
    hits.delete(key);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return true;
  };
}

// The key of a visitor for the limits: an IPv4 address as it is, an IPv6 address by its /64 (one host usually has a whole /64).
export function quotaKey(ip) {
  const p = T.parseIp(String(ip || '').split('%')[0].replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ''));
  if (!p) return String(ip || '');
  return p.family === 4 ? `4:${p.n}` : `6:${(p.n >> 64n).toString(16)}/64`;
}

// An address written the one way (no leading zeros, IPv6 in lower case with the longest run of zero groups as ::): what is sent to RIPE Atlas is
// the address that was checked, not the text of the request, which another parser could read differently.
export function canonicalIp(p) {
  if (p.family === 4) return [24n, 16n, 8n, 0n].map((s) => String((p.n >> s) & 255n)).join('.');
  const g = Array.from({ length: 8 }, (_, i) => Number((p.n >> BigInt(112 - 16 * i)) & 0xffffn));
  let best = -1, len = 0;
  for (let i = 0; i < 8;) { if (g[i]) { i++; continue; } let j = i; while (j < 8 && !g[j]) j++; if (j - i > len && j - i > 1) { best = i; len = j - i; } i = j; }
  const hex = g.map((x) => x.toString(16));
  return best < 0 ? hex.join(':') : `${hex.slice(0, best).join(':')}::${hex.slice(best + len).join(':')}`;
}
export const PROBES = 8;
export const IN_COUNTRY = 3;                 // anchors in the country of the probes, besides those of the world
const HOUR = 3600;
const PROBES_TTL = 10 * 60 * 1000, ANCHORS_TTL = 24 * 3600 * 1000, PREFIXES_TTL = 3600 * 1000;

export const parseAsn = (v) => {
  const m = /^(?:AS)?([1-9]\d{0,9})$/i.exec(String(v ?? '').trim());
  return m && Number(m[1]) <= 4294967295 ? Number(m[1]) : null;
};

// deps: getJson(url) for RIPEstat and the public API of Atlas, createMeasurements(body) -> ids (with the key), random() for the
// choice of the probes; limits that the tests can set.
export function makeAtlasApi(deps) {
  const { getJson, createMeasurements, random = Math.random, now = () => Date.now() } = deps;
  const perIp = deps.perIp || limiter(6, HOUR);
  const perDay = deps.perDay || limiter(150, 24 * HOUR);               // the measurements that are created: only a request that creates one uses it
  const perAttempt = deps.perAttempt || limiter(1500, 24 * HOUR);      // every request that gets to the lookups of RIPEstat and RIPE Atlas
  const MAX_RUNNING = deps.maxRunning || 3, RUN_MS = deps.runMs || 4 * 60 * 1000;
  const running = [];                         // the times at which the measurements of the tests in flight end
  const cache = new Map();
  const cached = async (key, ttl, get) => {
    const c = cache.get(key);
    if (c && now() - c.at < ttl) return c.value;
    const value = await get();
    cache.set(key, { at: now(), value });
    if (cache.size > 2000) cache.clear();
    return value;
  };

  const reply = (status, body) => ({ status, body });
  const bad = (msg, status = 400) => reply(status, { error: msg });

  const prefixesOf = (asn) => cached(`p${asn}`, PREFIXES_TTL, async () => {
    const d = await getJson(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asn}&sourceapp=aspa-explorer`);
    return ((d.data && d.data.prefixes) || []).map((p) => String(p.prefix).toLowerCase());
  });

  // The connected anchors, with their places (Atlas: the anchors and the probes that are anchors).
  const anchors = () => cached('anchors', ANCHORS_TTL, async () => {
    const up = new Set();
    for (let url = 'https://atlas.ripe.net/api/v2/probes/?is_anchor=true&status=1&page_size=500&fields=id'; url;) {
      const d = await getJson(url);
      for (const p of d.results) up.add(p.id);
      url = d.next;
    }
    const out = [];
    for (let url = 'https://atlas.ripe.net/api/v2/anchors/?page_size=500'; url;) {
      const d = await getJson(url);
      for (const a of d.results) {
        if (a.is_disabled || !up.has(a.probe) || !a.ip_v4 || !a.geometry) continue;
        out.push({ id: a.id, fqdn: a.fqdn, ip: a.ip_v4, city: a.city, country: a.country, latitude: a.geometry.coordinates[1], longitude: a.geometry.coordinates[0] });
      }
      url = d.next;
    }
    return out;
  });

  // Connected public probes of a country that can use the families asked, with their places.
  const probesOf = (country, families) => cached(`c${country}${families.join('')}`, PROBES_TTL, async () => {
    const tags = families.map((f) => `system-ipv${f}-works`).join(',');
    const d = await getJson(`https://atlas.ripe.net/api/v2/probes/?country_code=${country}&status=1&is_public=true&tags=${tags}&page_size=500&fields=id,asn_v4,asn_v6,geometry`);
    return d.results.filter((p) => p.geometry).map((p) => ({ id: p.id, asn: p.asn_v4 || p.asn_v6 || null, country, latitude: p.geometry.coordinates[1], longitude: p.geometry.coordinates[0] }));
  });

  // Up to `n` probes, one for each network, in a random order.
  const choose = (list, n) => {
    const shuffled = list.map((p) => [random(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const seen = new Set(), out = [];
    for (const p of shuffled) { if (out.length >= n) break; if (p.asn && seen.has(p.asn)) continue; seen.add(p.asn); out.push(p); }
    return out;
  };

  async function anchorsFor(query) {
    const country = String(query.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return bad('country must be a code of two letters, such as IT');
    return reply(200, { anchors: T.pickAnchors(await anchors(), country, IN_COUNTRY) });
  }

  async function measure(body, ip) {
    if (!body || typeof body !== 'object') return bad('send a JSON object');
    const asn = parseAsn(body.asn);
    if (!asn) return bad('asn must be an AS number such as AS3333');
    const country = String(body.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return bad('country must be a code of two letters, such as IT');
    const t = body.targets && typeof body.targets === 'object' ? body.targets : {};
    const targets = {};
    for (const f of [4, 6]) {
      const v = t[`v${f}`];
      if (v === undefined || v === null || v === '') continue;
      const p = T.parseIp(v);
      if (!p || p.family !== f) return bad(`the IPv${f} target is not a public IPv${f} address`);
      const text = canonicalIp(p);
      if (T.isPrivate(text)) return bad(`the IPv${f} target is not a public IPv${f} address`);
      targets[f] = text;
    }
    const families = Object.keys(targets).map(Number);
    if (!families.length) return bad('give at least one target, v4 or v6');
    const t0 = now();
    while (running.length && running[0] <= t0) running.shift();
    if (running.length >= MAX_RUNNING) return bad('other measurements are running, try again in a few minutes', 429);
    if (!perIp(quotaKey(ip))) return bad('too many measurements from this address, try again later', 429);
    if (!perAttempt('all')) return bad('too many requests today, try again tomorrow', 429);
    // the place among the measurements in flight is taken now, before the first await: requests that arrive meanwhile see it taken.
    // It is given back if no measurement is created.
    const slot = t0 + RUN_MS;
    running.push(slot); running.sort((a, b) => a - b);
    const release = () => { const i = running.indexOf(slot); if (i >= 0) running.splice(i, 1); };
    try {
      // the targets must be inside the prefixes of the AS: the service measures the AS that the page shows, and nothing else
      const mine = await prefixesOf(asn);
      for (const f of families) if (!mine.some((p) => T.contains(p, targets[f]))) { release(); return bad(`${targets[f]} is not inside a prefix that AS${asn} announces`); }
      const probes = choose(await probesOf(country, families), PROBES);
      if (!probes.length) { release(); return bad(`RIPE Atlas has no connected public probe in ${country} that can do this`, 404); }
      const picked = T.pickAnchors(await anchors(), country, IN_COUNTRY);
      // the budget of the day is for measurements: a request that the checks above refused has not used it
      if (!perDay('all')) { release(); return bad('the measurements of RIPE Atlas for today are over, try again tomorrow', 429); }
      const label = `aspa-explorer tromboning test, AS${asn} from ${country}`;
      const definitions = [
        ...families.map((f) => ({ type: 'traceroute', af: f, target: targets[f], protocol: 'ICMP', packets: 3, paris: 16, description: label })),
        ...picked.map((a) => ({ type: 'ping', af: 4, target: a.ip, packets: 3, description: `${label}: where the probes are` })),
      ];
      const ids = await createMeasurements({ definitions, probes: [{ type: 'probes', value: probes.map((p) => p.id).join(','), requested: probes.length }], is_oneoff: true });
      const traceroutes = {};
      families.forEach((f, i) => { traceroutes[`v${f}`] = ids[i]; });
      return reply(200, { probes, traceroutes, pings: picked.map((a, i) => ({ id: ids[families.length + i], anchor: a })) });
    } catch (err) { release(); throw err; }
  }

  return { measure, anchorsFor };
}
