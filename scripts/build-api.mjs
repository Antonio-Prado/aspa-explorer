// Build the per-AS files of the public API: a JSON document, a badge and an Atom feed for every AS
// that has, or has ever had, an ASPA (or is named as a provider in one). nginx serves them and answers
// the other AS numbers with a generic "no ASPA" reply (see deploy/nginx/aspa.conf).
//
//   node scripts/build-api.mjs OUT_DIR              build into OUT_DIR/<stamp> and point OUT_DIR/current at it
//   node scripts/build-api.mjs OUT_DIR --no-switch  build only
//
// Inputs (environment, with defaults for the production host):
//   ASPA_DATA    URL or file of Routinator's jsonext      http://127.0.0.1:8080/data/aspas.json
//   ASPA_BRANCH  base URL of the `history` branch files    GitLab API of the public project
// Plain HTTP calls, no dependencies (Node.js 18+).

import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, rename, rm, readdir, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const History = require('../site/history.js');
const Quality = require('../site/quality.js');

const SITE = 'https://aspa.ping6.it';
const KEEP_BUILDS = 3;
const FEED_ENTRIES = 100;

const asNum = (as) => Number(as.slice(2));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const list = (ps) => ps.map((p) => p).join(', ');

// ---------- the documents ----------

// Everything the API says about one AS. `ctx` holds what is the same for all of them.
export function describe(as, ctx) {
  const own = ctx.byCustomer.get(as);
  const customers = ctx.byProvider.get(as) || [];
  const history = ctx.eventsByCustomer.get(as) || [];
  const named = ctx.eventsByProvider.get(as) || [];
  const findings = (ctx.findings.get(as) || []).map((f) => ({ kind: f.kind, severity: f.severity, detail: f.detail }));
  // the visibility is checked only for the ASes that a current ASPA names, as customer or provider: for the others it is not known
  const seen = ctx.unseen && (own || customers.length) ? !ctx.unseen.has(as) : null;
  return {
    asn: as,
    number: asNum(as),
    generated: ctx.generated,
    aspa: {
      published: Boolean(own),
      providers: own ? own.providers : [],
      no_providers: Boolean(own) && own.providers.length === 1 && own.providers[0] === 'AS0',
      sources: own ? own.source.map((s) => ({
        trust_anchor: s.tal || null,
        valid_from: (s.validity && s.validity.notBefore) || null,
        valid_until: (s.validity && s.validity.notAfter) || null,
        uri: s.uri || null,
      })) : [],
    },
    provider_of: customers,
    seen_in_bgp: seen,
    quality: findings,
    history: history.map(({ date, kind, providers, added, dropped }) => ({ date, kind, providers, added, dropped })),
    named_as_provider_history: named.map(({ date, customer, kind, providers }) => ({
      date, customer, action: kind === 'removed' || !providers.includes(as) ? 'dropped' : 'added',
    })),
    links: {
      page: `${SITE}/as/${as}`,
      badge: `${SITE}/badge/${as}.svg`,
      feed: `${SITE}/feed/${as}.atom`,
    },
  };
}

// ---------- the badge ----------

const textWidth = (s) => Math.round(s.length * 6.4 + 10);   // Verdana 11 px, close enough for a badge

export function badge(label, value, color) {
  const lw = textWidth(label), vw = textWidth(value), w = lw + vw;
  const title = `${label}: ${value}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>\n`;
}

// Green: an ASPA with providers; blue: AS0 (no transit providers); orange: it has an error-level finding; grey: none.
// The label says which AS it is about: ASPA AS137.
export function badgeFor(doc) {
  const label = `ASPA ${doc.asn}`;
  if (!doc.aspa.published) return badge(label, 'not configured yet', '#9f9f9f');
  if (doc.quality.some((f) => f.severity === 'error')) return badge(label, 'published, with errors', '#e05d44');
  if (doc.aspa.no_providers) return badge(label, 'no transit providers (AS0)', '#007ec6');
  const n = doc.aspa.providers.length;
  return badge(label, `${n} provider${n === 1 ? '' : 's'}`, '#2e8b57');
}

// ---------- the feed ----------

const entryText = (as, e) => {
  if (e.kind === 'new') return [`${as}: new ASPA`, `${as} published an ASPA with ${e.providers.length} provider${e.providers.length === 1 ? '' : 's'}: ${list(e.providers)}.`];
  if (e.kind === 'removed') return [`${as}: ASPA removed`, `The ASPA of ${as} is gone; the hops from it can no longer be checked.`];
  const bits = [];
  if (e.added.length) bits.push(`added ${list(e.added)}`);
  if (e.dropped.length) bits.push(`dropped ${list(e.dropped)}`);
  return [`${as}: ASPA changed`, `The ASPA of ${as} ${bits.join(' and ') || 'changed'}. It now lists ${e.providers.length} provider${e.providers.length === 1 ? '' : 's'}: ${list(e.providers)}.`];
};

export function feed(as, doc, ctx) {
  const entries = [];
  for (const e of ctx.eventsByCustomer.get(as) || []) {
    const [title, text] = entryText(as, e);
    entries.push({ date: e.date, id: `own:${as}:${e.date}:${e.kind}`, title, text });
  }
  for (const e of ctx.eventsByProvider.get(as) || []) {
    const added = e.kind !== 'removed' && e.providers.includes(as);
    entries.push({
      date: e.date, id: `prov:${as}:${e.customer}:${e.date}`,
      title: `${e.customer} ${added ? 'now lists' : 'no longer lists'} ${as} as a provider`,
      text: `${e.customer} ${added ? 'added' : 'dropped'} ${as} ${e.kind === 'removed' ? '(its ASPA was removed)' : 'in its ASPA'}.`,
    });
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  const shown = entries.slice(0, FEED_ENTRIES);
  const updated = shown.length ? `${shown[0].date}T00:00:00Z` : ctx.generated;
  const self = `${SITE}/feed/${as}.atom`;
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <title>ASPA changes for ${as}</title>\n` +
    `  <subtitle>Changes to the ASPA of ${as}, and ASPAs of others that add or drop ${as} as a provider</subtitle>\n` +
    `  <id>tag:aspa.ping6.it,2026:feed:${as}</id>\n  <updated>${updated}</updated>\n` +
    `  <link rel="self" href="${self}"/>\n  <link rel="alternate" href="${SITE}/as/${as}"/>\n` +
    shown.map((e) => `  <entry>\n    <title>${esc(e.title)}</title>\n    <id>tag:aspa.ping6.it,2026:${esc(e.id)}</id>\n` +
      `    <updated>${e.date}T00:00:00Z</updated>\n    <link href="${SITE}/as/${as}"/>\n    <summary>${esc(e.text)}</summary>\n  </entry>\n`).join('') +
    `</feed>\n`;
}

// ---------- the full list ----------

const RIR_NAMES = { afrinic: 'AFRINIC', apnic: 'APNIC', arin: 'ARIN', lacnic: 'LACNIC', ripe: 'RIPE NCC' };

// One row per ASPA, for the download of the whole list: the customer, its providers, the trust anchor
// (the RIR) and the validity of the signed object.
export function aspaRows(ctx) {
  return [...ctx.byCustomer.values()].sort((a, b) => asNum(a.customer) - asNum(b.customer)).map((a) => {
    const s = a.source[0] || {};
    return {
      customer: a.customer, providers: a.providers, rir: s.tal || null,
      valid_from: (s.validity && s.validity.notBefore) || null, valid_until: (s.validity && s.validity.notAfter) || null,
    };
  });
}

const csvCell = (v) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// providers are separated by spaces inside one cell
export function toCsv(rows) {
  const cols = ['customer', 'providers', 'rir', 'valid_from', 'valid_until'];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(c === 'providers' ? r.providers.join(' ') : r[c])).join(','))].join('\n') + '\n';
}

// ---------- the context ----------

export function makeContext(data, events, unseen, generated) {
  const aspas = (data.aspas || []).map((a) => ({
    customer: a.customer, providers: a.providers, source: a.source || [],
  }));
  // one entry per customer, the way the page merges them
  const byCustomer = new Map();
  for (const a of aspas) {
    const e = byCustomer.get(a.customer);
    if (e) { e.providers = History.sortProviders(e.providers.concat(a.providers)); e.source = e.source.concat(a.source); }
    else byCustomer.set(a.customer, { customer: a.customer, providers: History.sortProviders(a.providers), source: a.source.slice() });
  }
  const byProvider = new Map();
  for (const a of byCustomer.values()) {
    for (const p of a.providers) if (p !== 'AS0') (byProvider.get(p) || byProvider.set(p, []).get(p)).push(a.customer);
  }
  for (const v of byProvider.values()) v.sort((x, y) => asNum(x) - asNum(y));
  const classified = History.classify(events);
  const eventsByCustomer = new Map(), eventsByProvider = new Map();
  for (const e of classified) {
    (eventsByCustomer.get(e.customer) || eventsByCustomer.set(e.customer, []).get(e.customer)).push(e);
    for (const p of new Set([...e.added, ...e.dropped])) {
      if (p === 'AS0') continue;
      (eventsByProvider.get(p) || eventsByProvider.set(p, []).get(p)).push(e);
    }
    // a removed ASPA drops all its providers; a new one adds them: both are in added/dropped already
  }
  const findings = new Map();
  for (const f of Quality.check([...byCustomer.values()], { unseen })) {
    (findings.get(f.customer) || findings.set(f.customer, []).get(f.customer)).push(f);
  }
  return { byCustomer, byProvider, eventsByCustomer, eventsByProvider, findings, unseen, generated };
}

// every AS that needs files of its own
export function subjects(ctx) {
  return [...new Set([...ctx.byCustomer.keys(), ...ctx.byProvider.keys(), ...ctx.eventsByCustomer.keys(), ...ctx.eventsByProvider.keys()])]
    .sort((a, b) => asNum(a) - asNum(b));
}

// ---------- main ----------

const getJson = async (url) => {
  if (!/^https?:/.test(url)) return JSON.parse(await readFile(url, 'utf8'));
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'aspa-explorer-build-api' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: build-api.mjs OUT_DIR [--no-switch]'); process.exit(2); }
  const dataUrl = process.env.ASPA_DATA || 'http://127.0.0.1:8080/data/aspas.json';
  const branch = process.env.ASPA_BRANCH || 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files';
  const file = (name) => `${branch}/${name}/raw?ref=history`;
  const data = await getJson(dataUrl);
  if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('the ASPA data is empty: not publishing');
  const events = await getJson(branch.startsWith('http') ? file('events.json') : join(branch, 'events.json'));
  let unseen = null;
  try {
    const v = await getJson(branch.startsWith('http') ? file('visibility.json') : join(branch, 'visibility.json'));
    unseen = new Set(Array.isArray(v) ? v : v.unseen || []);
  } catch (err) { console.error(`visibility.json not read (${err.message}): BGP checks left out`); }
  const generated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const ctx = makeContext(data, events, unseen, generated);
  const ases = subjects(ctx);

  const stamp = generated.replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
  const dir = join(out, stamp);
  await rm(dir, { recursive: true, force: true });
  for (const d of ['api/v1/as', 'badge', 'feed']) await mkdir(join(dir, d), { recursive: true });
  let n = 0;
  for (const as of ases) {
    const doc = describe(as, ctx);
    const num = asNum(as);
    await writeFile(join(dir, 'api/v1/as', `${num}.json`), JSON.stringify(doc) + '\n');
    await writeFile(join(dir, 'badge', `${as}.svg`), badgeFor(doc));
    await writeFile(join(dir, 'feed', `${as}.atom`), feed(as, doc, ctx));
    n++;
  }
  const list = aspaRows(ctx);
  await writeFile(join(dir, 'api/v1/aspas.json'), JSON.stringify(list) + '\n');
  await writeFile(join(dir, 'api/v1/aspas.csv'), toCsv(list));
  await writeFile(join(dir, 'api/v1/meta.json'), JSON.stringify({ generated, aspas: ctx.byCustomer.size, ases: n, events: events.length }) + '\n');

  if (!process.argv.includes('--no-switch')) {
    // switch atomically: a new symlink renamed over the old one
    const tmp = join(out, `.current-${process.pid}`);
    await rm(tmp, { force: true });
    await symlink(stamp, tmp);
    await rename(tmp, join(out, 'current'));
    const builds = (await readdir(out)).filter((x) => /^\d{8}-\d{6}$/.test(x)).sort();
    for (const old of builds.slice(0, -KEEP_BUILDS)) await rm(join(out, old), { recursive: true, force: true });
  }
  console.log(`${generated}: ${ctx.byCustomer.size} ASPAs, ${n} ASes, ${events.length} events -> ${dir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
