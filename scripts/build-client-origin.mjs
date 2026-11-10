// The network of a visitor, known on this server: the dumps of RIPE RIS whois (prefix, origin AS, how many RIS peers see
// it) become a map from prefix to origin for the geo module of nginx, which answers /client-ip with the address of the
// visitor and the AS that originates it. The home page reads it to give its answer at once; nothing about the visitor
// leaves the server.
//
//   node scripts/build-client-origin.mjs OUT_FILE [IPV4_DUMP IPV6_DUMP]
//
// Without the two dumps (gzipped, as published), they are fetched from www.ris.ripe.net. For each prefix the origin seen
// by the most peers wins; a prefix seen by fewer than MIN_PEERS peers, a default route, a prefix shorter than /8 (IPv4)
// or /16 (IPv6) or longer than /24 or /48, and an origin that is an AS_SET are left out. The file is written only when it
// changes, and the script says so (exit 0 written, 3 unchanged), so that the caller reloads nginx only then.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export const MIN_PEERS = 10;
const URLS = ['https://www.ris.ripe.net/dumps/riswhoisdump.IPv4.gz', 'https://www.ris.ripe.net/dumps/riswhoisdump.IPv6.gz'];
const UA = 'aspa-explorer (https://aspa.ping6.it)';

// lines of one dump -> Map prefix -> {as, peers}
export function parse(text, family) {
  const best = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '%') continue;
    const [o, prefix, seen] = line.split('\t');
    if (!prefix || !/^\d+$/.test(o)) continue;            // an AS_SET ({…}) or a broken line
    const peers = Number(seen);
    const len = Number(prefix.split('/')[1]);
    if (!(peers >= MIN_PEERS)) continue;
    if (family === 4 ? (len < 8 || len > 24 || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(prefix)) : (len < 16 || len > 48 || !/^[0-9a-f:]+\/\d+$/i.test(prefix))) continue;
    const as = Number(o);
    if (!(as > 0 && as <= 4294967295)) continue;
    const old = best.get(prefix);
    if (!old || peers > old.peers || (peers === old.peers && as < old.as)) best.set(prefix, { as, peers });
  }
  return best;
}

// the include file of the geo block: one "prefix as;" a line, sorted, so that the same data gives the same file
export function geoLines(maps) {
  const lines = [];
  for (const m of maps) for (const [prefix, { as }] of m) lines.push(`${prefix} ${as};`);
  return lines.sort().join('\n') + '\n';
}

async function fetchGz(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const [out, v4, v6] = process.argv.slice(2);
  if (!out) { console.error('usage: build-client-origin.mjs OUT_FILE [IPV4_DUMP IPV6_DUMP]'); process.exit(2); }
  const raw = v4 && v6 ? await Promise.all([readFile(v4), readFile(v6)]) : await Promise.all(URLS.map(fetchGz));
  const maps = [parse(gunzipSync(raw[0]).toString('utf8'), 4), parse(gunzipSync(raw[1]).toString('utf8'), 6)];
  // a dump cut short or empty must not replace a good map
  if (maps[0].size < 500000 || maps[1].size < 100000) throw new Error(`too few prefixes (${maps[0].size} IPv4, ${maps[1].size} IPv6): not written`);
  const text = geoLines(maps);
  const old = await readFile(out, 'utf8').catch(() => '');
  if (old === text) { console.log(`unchanged: ${maps[0].size} IPv4 and ${maps[1].size} IPv6 prefixes`); process.exit(3); }
  await writeFile(`${out}.tmp`, text);
  await rename(`${out}.tmp`, out);
  console.log(`written: ${maps[0].size} IPv4 and ${maps[1].size} IPv6 prefixes`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
