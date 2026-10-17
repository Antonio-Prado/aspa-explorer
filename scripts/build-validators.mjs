// The ASPAs of three validators side by side: this site's Routinator, rpki-client (the console of the project)
// and the one that Cloudflare runs (also rpki-client). Their exports are about 100 MB each, but the ASPAs are in
// the last few kilobytes, so only the head and the tail of each file are fetched. Written as one JSON file
// (served as /api/v1/validators.json).
//
//   node scripts/build-validators.mjs OUT_FILE
//
// Environment: ASPA_DATA, the URL or file of Routinator's jsonext (default http://127.0.0.1:8080/data/aspas.json).
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';

if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
const UA = 'aspa-explorer (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';

export const SOURCES = [
  { id: 'routinator', name: 'Routinator (this site)', url: 'https://rpki.ping6.it/' },
  { id: 'rpki-client', name: 'rpki-client (console.rpki-client.org)', url: 'https://console.rpki-client.org/rpki.json' },
  { id: 'cloudflare', name: 'rpki-client (Cloudflare)', url: 'https://rpki.cloudflare.com/rpki.json' },
];

// The array that follows `"aspas":` in a piece of rpki-client's JSON, or null when it is not all in the text.
export function extractArray(text, key) {
  const k = text.indexOf(`"${key}"`);
  if (k < 0) return null;
  const start = text.indexOf('[', k);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}

// Map customer AS number -> sorted provider numbers, from rpki-client's {customer_asid, providers} objects or from
// Routinator's {customer: "AS1", providers: ["AS2"]}; several objects of one customer are merged.
export function normalise(list) {
  const m = new Map();
  for (const a of list) {
    const c = a.customer_asid !== undefined ? Number(a.customer_asid) : Number(String(a.customer).slice(2));
    const ps = (a.providers || []).map((p) => (typeof p === 'number' ? p : Number(String(p).slice(2))));
    m.set(c, [...new Set([...(m.get(c) || []), ...ps])].sort((x, y) => x - y));
  }
  return m;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// sets: {id: Map}. Returns the totals, the agreement of each pair and the ASPAs on which the validators differ.
export function compare(sets) {
  const ids = Object.keys(sets);
  const all = new Set(ids.flatMap((id) => [...sets[id].keys()]));
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = sets[ids[i]], b = sets[ids[j]];
    let both = 0, onlyA = 0, onlyB = 0, differ = 0;
    for (const c of all) {
      const x = a.get(c), y = b.get(c);
      if (x && y) { both++; if (!same(x, y)) differ++; } else if (x) onlyA++; else if (y) onlyB++;
    }
    pairs.push({ a: ids[i], b: ids[j], both, only_a: onlyA, only_b: onlyB, differ });
  }
  const differences = [];
  let identical = 0;
  for (const c of [...all].sort((x, y) => x - y)) {
    const row = ids.map((id) => sets[id].get(c) || null);
    if (row.every((r) => r && same(r, row[0]))) { identical++; continue; }
    // an ASPA with AS0 next to other providers breaks the profile: some validators reject or trim it
    const as0 = row.some((r) => r && r.includes(0) && r.length > 1);
    differences.push({ customer: 'AS' + c, as0, providers: Object.fromEntries(ids.map((id, i) => [id, row[i] && row[i].map((p) => 'AS' + p)])) });
  }
  return { customers: all.size, identical, differences, pairs };
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(120000) });
  if (!(r.ok || r.status === 206)) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

// One rpki-client export: its build time and counts from the head, the ASPAs from the tail.
async function fetchRpkiClient(url) {
  const head = await (await get(url, { Range: 'bytes=0-3999' })).text();
  const meta = (key) => { const m = new RegExp(`"${key}":\\s*"?([^",\\n]+)"?`).exec(head); return m ? m[1] : null; };
  const size = Number((await get(url, { Range: 'bytes=0-0' })).headers.get('content-range')?.split('/')[1]);
  for (const tail of [2e6, 8e6, 32e6]) {
    const text = await (await get(url, { Range: `bytes=${Math.max(0, size - tail)}-${size - 1}` })).text();
    const list = extractArray(text, 'aspas');
    if (list) return { built: meta('buildtime'), count: Number(meta('aspas')), failed: Number(meta('failedaspas')), list };
  }
  throw new Error(`${url}: the ASPAs were not found in the file`);
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: build-validators.mjs OUT_FILE'); process.exit(2); }
  const dataUrl = process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json';
  const ours = /^https?:/.test(dataUrl) ? await (await get(dataUrl)).json() : JSON.parse(await readFile(dataUrl, 'utf8'));
  const sets = { routinator: normalise(ours.aspas || []) };
  const sources = [{ id: 'routinator', name: SOURCES[0].name, built: (ours.metadata && ours.metadata.generatedTime) || null, count: sets.routinator.size, failed: null }];
  for (const s of SOURCES.slice(1)) {
    try {
      const x = await fetchRpkiClient(s.url);
      sets[s.id] = normalise(x.list);
      sources.push({ id: s.id, name: s.name, built: x.built, count: sets[s.id].size, failed: x.failed });
    } catch (err) { console.error(`${s.id}: ${err.message}`); sources.push({ id: s.id, name: s.name, built: null, count: null, failed: null, error: err.message }); }
  }
  const c = compare(sets);
  const doc = { generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), sources, ...c, differences: c.differences.slice(0, 200), differences_total: c.differences.length };
  const tmp = `${out}.tmp`;
  await writeFile(tmp, JSON.stringify(doc) + '\n');
  await rename(tmp, out);
  console.log(`${doc.generated}: ${sources.map((s) => `${s.id} ${s.count}`).join(', ')}; ${doc.customers} ASPAs, ${doc.identical} identical, ${doc.differences_total} differ`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
