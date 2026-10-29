// From the allocation of an AS number to its ASPA: for each RIR and each economy how many AS numbers are allocated, how many are
// advertised in BGP and how many have an ASPA (aspa: all of them; aspa_advertised: those advertised, the ones that the shares and the
// figures per million users count), by the year of the allocation and the width of the number (16 or 32 bits), with the
// figures per million Internet users, and the ASPAs that name AS numbers that should not be there (not allocated, reserved, private).
// Written as one JSON file (served as /api/v1/resources.json).
//
//   node scripts/build-resources.mjs OUT_FILE [CACHE_DIR]
//
// Sources: the delegation files of the five RIRs (the cache of the adoption job), the ASes that the RIPE RIS collectors see (RIPEstat),
// the ASPAs of the validator (ASPA_DATA, default http://127.0.0.1:8080/data/aspas.json) and, for population and Internet users and the
// regions, the World Bank open data (api.worldbank.org). The economy of an AS number is where the recipient is located, not where it is used.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { DELEGATED, cached } from './build-adoption.mjs';

if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
const WB = 'https://api.worldbank.org/v2';

// Every AS number line of a delegation file: [{start, end, cc, rir, status, year}], whatever the status
// (allocated, assigned, available, reserved).
export function parseAsnRecords(text, rir) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split('|');
    if (f[2] !== 'asn') continue;
    const start = Number(f[3]), count = Number(f[4]);
    if (!Number.isInteger(start) || !Number.isInteger(count) || count < 1) continue;
    out.push({ start, end: start + count - 1, cc: /^[a-z]{2}$/i.test(f[1]) ? f[1].toUpperCase() : 'ZZ', rir, status: f[6], year: /^\d{8}$/.test(f[5]) ? Number(f[5].slice(0, 4)) : null });
  }
  return out;
}

// What an AS number is when it is not one for the Internet: 'private', 'documentation', 'reserved', 'AS_TRANS' or null (RFC 6996, 5398, 7300, IANA registry).
export function reservedKind(asn) {
  if (asn === 0 || asn === 65535 || asn === 4294967295) return 'reserved';
  if (asn === 23456) return 'AS_TRANS';
  if ((asn >= 64496 && asn <= 64511) || (asn >= 65536 && asn <= 65551)) return 'documentation';
  if ((asn >= 64512 && asn <= 65534) || (asn >= 4200000000 && asn <= 4294967294)) return 'private';
  if (asn >= 65552 && asn <= 131071) return 'reserved';
  return null;
}

const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : 0);
const per = (n, d) => (d ? Math.round((n / d) * 100) / 100 : null);

// records: from parseAsnRecords; seen: Set of AS numbers in BGP; aspa: Map customer AS number -> [provider AS numbers];
// bank: { users: Map cc -> number of Internet users, population: Map cc -> number, region: Map cc -> name } (any of them may lack an economy)
export function aggregateResources({ records, seen, aspa, bank = { users: new Map(), population: new Map(), region: new Map() } }) {
  const alloc = new Map();                                         // allocated AS number -> record (one entry per number)
  const regTotals = {};
  const lines = [...records].sort((a, b) => a.start - b.start);
  const tot = (rir) => regTotals[rir] || (regTotals[rir] = { rir, allocated: 0, advertised: 0, aspa: 0, aspa_advertised: 0, reserved: 0, available: 0 });
  const free = new Map();                                          // AS numbers that the files list as available or reserved: start -> {end, status}
  for (const r of lines) {
    const t = tot(r.rir);
    const n = r.end - r.start + 1;
    if (r.status === 'allocated' || r.status === 'assigned') {
      t.allocated += n;
      for (let a = r.start; a <= r.end; a++) {
        alloc.set(a, r);
        if (seen.has(a)) t.advertised++;
        if (aspa.has(a)) t.aspa++;
        if (aspa.has(a) && seen.has(a)) t.aspa_advertised++;
      }
    } else if (r.status === 'reserved') { t.reserved += n; free.set(r.start, { end: r.end, status: 'reserved' }); }
    else if (r.status === 'available') { t.available += n; free.set(r.start, { end: r.end, status: 'available' }); }
  }
  const registries = Object.values(regTotals).sort((a, b) => b.allocated - a.allocated)
    .map((t) => ({ ...t, unadvertised: t.allocated - t.advertised, pct_advertised: pct(t.advertised, t.allocated), pct_aspa_of_advertised: pct(t.aspa_advertised, t.advertised) }));
  // by economy
  const eco = new Map();
  for (const [a, r] of alloc) {
    const e = eco.get(r.cc) || { cc: r.cc, allocated: 0, advertised: 0, aspa: 0, aspa_advertised: 0 };
    e.allocated++; if (seen.has(a)) e.advertised++; if (aspa.has(a)) e.aspa++; if (aspa.has(a) && seen.has(a)) e.aspa_advertised++;
    eco.set(r.cc, e);
  }
  const economies = [...eco.values()].map((e) => {
    const users = bank.users.get(e.cc) ?? null, population = bank.population.get(e.cc) ?? null;
    return {
      ...e, pct_aspa_of_advertised: pct(e.aspa_advertised, e.advertised), region: bank.region.get(e.cc) || null, population, users: users === null ? null : Math.round(users),
      aspa_per_million_users: users ? per(e.aspa_advertised, users / 1e6) : null, advertised_per_million_users: users ? per(e.advertised, users / 1e6) : null,
    };
  }).sort((a, b) => b.allocated - a.allocated || (a.cc < b.cc ? -1 : 1));
  // by region (World Bank regions)
  const reg = new Map();
  for (const e of economies) {
    if (!e.region) continue;
    const g = reg.get(e.region) || { region: e.region, allocated: 0, advertised: 0, aspa: 0, aspa_advertised: 0, population: 0, users: 0 };
    g.allocated += e.allocated; g.advertised += e.advertised; g.aspa += e.aspa; g.aspa_advertised += e.aspa_advertised; g.population += e.population || 0; g.users += e.users || 0;
    reg.set(e.region, g);
  }
  const regions = [...reg.values()].map((g) => ({ ...g, pct_aspa_of_advertised: pct(g.aspa_advertised, g.advertised), aspa_per_million_users: g.users ? per(g.aspa_advertised, g.users / 1e6) : null })).sort((a, b) => b.allocated - a.allocated);
  // by year of the allocation, and by width of the number
  const yr = new Map();
  const widths = { '16-bit': { allocated: 0, advertised: 0, aspa: 0, aspa_advertised: 0 }, '32-bit': { allocated: 0, advertised: 0, aspa: 0, aspa_advertised: 0 } };
  for (const [a, r] of alloc) {
    if (r.year) { const y = yr.get(r.year) || { year: r.year, allocated: 0, advertised: 0, aspa: 0, aspa_advertised: 0 }; y.allocated++; if (seen.has(a)) y.advertised++; if (aspa.has(a)) y.aspa++; if (aspa.has(a) && seen.has(a)) y.aspa_advertised++; yr.set(r.year, y); }
    const w = widths[a <= 65535 ? '16-bit' : '32-bit'];
    w.allocated++; if (seen.has(a)) w.advertised++; if (aspa.has(a)) w.aspa++; if (aspa.has(a) && seen.has(a)) w.aspa_advertised++;
  }
  const by_year = [...yr.values()].sort((a, b) => a.year - b.year).map((y) => ({ ...y, pct_aspa_of_advertised: pct(y.aspa_advertised, y.advertised), pct_aspa_of_allocated: pct(y.aspa, y.allocated) }));
  const by_width = Object.entries(widths).map(([width, w]) => ({ width, ...w, pct_aspa_of_advertised: pct(w.aspa_advertised, w.advertised) }));
  // ASPAs that name AS numbers that should not be there
  const freeKind = (a) => { for (const [s, f] of free) if (a >= s && a <= f.end) return f.status; return null; };
  const why = (a) => reservedKind(a) || (alloc.has(a) ? null : freeKind(a) ? `listed as ${freeKind(a)} in a delegation file` : 'not in any delegation file');
  const suspect = [], badProviders = [];
  for (const [c, providers] of [...aspa].sort((a, b) => a[0] - b[0])) {
    const w = c === 0 ? null : why(c);
    if (w) suspect.push({ asn: `AS${c}`, providers: providers.filter((p) => p !== 0).length, reason: w });
    for (const p of providers) {
      if (p === 0) continue;
      const wp = why(p);
      if (wp) badProviders.push({ customer: `AS${c}`, provider: `AS${p}`, reason: wp });
    }
  }
  return { registries, economies, regions, by_year, by_width, suspect, suspect_providers: badProviders, aspa_customers: aspa.size };
}

// ---------- the World Bank ----------
async function bankJson(url, cache, name) {
  const file = await cached(url, join(cache, name), 30 * 86400e3);
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function worldBank(cache) {
  const countries = (await bankJson(`${WB}/country?format=json&per_page=400`, cache, 'wb-countries.json'))[1] || [];
  const region = new Map();
  for (const c of countries) if (c.iso2Code && c.region && c.region.id !== 'NA' && c.region.value !== 'Aggregates') region.set(c.iso2Code, c.region.value.trim());
  const latest = async (indicator) => {
    const rows = (await bankJson(`${WB}/country/all/indicator/${indicator}?format=json&per_page=400&mrnev=1`, cache, `wb-${indicator}.json`))[1] || [];
    const m = new Map();
    for (const r of rows) if (r.value !== null && r.country && region.has(r.country.id)) m.set(r.country.id, Number(r.value));
    return m;
  };
  const population = await latest('SP.POP.TOTL');
  const share = await latest('IT.NET.USER.ZS');
  const users = new Map();
  for (const [cc, p] of population) if (share.has(cc)) users.set(cc, (p * share.get(cc)) / 100);
  return { users, population, region };
}

async function main() {
  const [outFile, cacheArg] = process.argv.slice(2);
  if (!outFile) { console.error('usage: node scripts/build-resources.mjs OUT_FILE [CACHE_DIR]'); process.exit(2); }
  const cache = cacheArg || join(outFile, '..', 'cache');
  await mkdir(cache, { recursive: true });
  const getJson = async (u) => { const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': UA } }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); };
  const data = await getJson(process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json');
  if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('the ASPA data is empty: not publishing');
  const aspa = new Map();
  for (const a of data.aspas) { const c = Number(a.customer.slice(2)); aspa.set(c, (aspa.get(c) || []).concat(a.providers.map((p) => Number(p.slice(2))))); }
  const seen = new Set((await getJson('https://stat.ripe.net/data/ris-asns/data.json?list_asns=true')).data.asns.map(Number));
  const records = [];
  for (const [rir, url] of Object.entries(DELEGATED)) records.push(...parseAsnRecords(await readFile(await cached(url, join(cache, `delegated-${rir}`), 20 * 3600e3), 'utf8'), rir));
  let bank;
  try { bank = await worldBank(cache); } catch (err) { console.error(`the World Bank data is not available (${err.message}): the figures per user are left out`); bank = { users: new Map(), population: new Map(), region: new Map() }; }
  const out = aggregateResources({ records, seen, aspa, bank });
  const doc = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    sources: { aspas: 'Routinator, rpki.ping6.it', advertised: 'RIPE RIS collectors, through RIPEstat (ris-asns)', registry: 'delegation files of the five RIRs', people: 'World Bank open data (population, Internet users, regions), most recent value of each economy' },
    ...out,
  };
  await writeFile(`${outFile}.tmp`, JSON.stringify(doc) + '\n');
  await rename(`${outFile}.tmp`, outFile);
  console.log(`${doc.generated}: ${doc.registries.reduce((s, r) => s + r.allocated, 0)} AS numbers allocated, ${doc.economies.length} economies, ${doc.suspect.length} suspect ASPA customers, ${doc.suspect_providers.length} suspect providers`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
