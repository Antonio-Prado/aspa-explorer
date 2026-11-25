// The aggregate of classify.mjs that the page /false-positives.html shows (site/data/false-positives.json): counts by class in
// three units, how soon the operators fixed their ASPAs, which evidence goes with a fix, how the rules compare with the fixes,
// and the route leaks of the detector. No AS number.
//
//   node summary.mjs OUT_DIR OUT_FILE COLLECTORS
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const [out, file, collectors] = process.argv.slice(2);
if (!out || !file) { console.error('usage: summary.mjs OUT_DIR OUT_FILE COLLECTORS'); process.exit(2); }
const P = JSON.parse(await readFile(join(out, 'classified-places.json'), 'utf8'));
const I = JSON.parse(await readFile(join(out, 'classified-incidents.json'), 'utf8'));
const CLS = ['1a', '1b', '1c', '4', '3', '2', '5'];
const rank = (c) => CLS.indexOf(c);
const count = (rows, w = () => 1) => Object.fromEntries(CLS.map((c) => [c, rows.filter((r) => r.cls === c).reduce((s, r) => s + w(r), 0)]));
const full = P.rows.filter((r) => r.full_window);

// the failing pairs (customer, the AS its ASPA misses), each with the best class of its places
const pairs = new Map();
for (const r of full) for (const e of r.evidence) { const k = `${e.c}>${e.p}`; const had = pairs.get(k); if (!had || rank(r.cls) < rank(had.cls)) pairs.set(k, { cls: r.cls }); }

const c1a = full.filter((r) => r.cls === '1a');
const lag = c1a.map((r) => r.fix.after).sort((a, b) => a - b);
const q = (x) => (lag.length ? lag[Math.floor(x * (lag.length - 1))] : null);
const byDay = Array.from({ length: P.window }, (_, i) => lag.filter((d) => d === i + 1).length);
const routes = full.reduce((s, r) => s + r.routes, 0);
const biggest = [...full].sort((a, b) => b.routes - a.routes)[0];

const feat = [
  ['all', 'All the places', () => true],
  ['caida_provider', 'CAIDA has the missing AS as a provider of the customer', (r) => r.evidence[0].caida === 'provider'],
  ['caida_none', 'CAIDA has a peer or a customer at both ends', (r) => r.evidence.every((e) => e.caida === 'peer' || e.caida === 'customer')],
  ['irr_transit', 'The IRR says transit at a failing pair', (r) => r.evidence.some((e) => e.irr_transit)],
  ['short', 'Seen on one or two days', (r) => r.days <= 2 && !r.censored],
  ['long', 'Seen on more than seven days', (r) => r.days > 7],
  ['many_feeders', 'Seen by three or more feeders on a day', (r) => r.max_feeders >= 3],
  ['one_feeder', 'Seen by a single feeder', (r) => r.single_feeder],
  ['at_feeder', 'The ASPA that misses the provider is the feeder\'s own', (r) => r.at_feeder],
  ['new_aspa', 'The ASPA was at most seven days old', (r) => r.age_up !== null && r.age_up <= 7],
  ['old_aspa', 'The ASPA was more than 90 days old', (r) => r.age_up !== null && r.age_up > 90],
].map(([id, name, f]) => { const rs = full.filter(f); return { id, name, places: rs.length, fixed: rs.filter((r) => r.cls === '1a').length }; });

const w2 = full.filter((r) => r.would2), w3 = full.filter((r) => r.would3);
const alone = I.rows.filter((r) => r.alone), fullI = alone.filter((r) => r.full_window);
const bySub = {};
for (const st of ['RLK-UL', 'RLK-LL', 'RLK-FP', 'RLK-PV']) {
  const rs = fullI.filter((r) => r.subtype === st);
  if (rs.length) bySub[st] = { incidents: rs.length, ...count(rs) };
}
const days = I.rows.map((r) => r.day).sort();

const doc = {
  generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  collectors: (collectors || '').split(',').filter(Boolean),
  period: P.period, window: P.window, history_to: P.last_event,
  routes_read: P.days.reduce((s, d) => s + d.total.routes, 0),
  invalid_routes: P.days.reduce((s, d) => s + d.total.invalid, 0),
  places: full.length,
  classes: { places: count(full), pairs: count([...pairs.values()]), routes: count(full, (r) => r.routes) },
  totals: { places: full.length, pairs: pairs.size, routes },
  biggest_place: biggest ? { routes: biggest.routes, cls: biggest.cls, at_feeder: biggest.at_feeder } : null,
  feeder_routes: { at_feeder: c1a.filter((r) => r.at_feeder).reduce((s, r) => s + r.routes, 0), of: c1a.reduce((s, r) => s + r.routes, 0) },
  fix: { places: c1a.length, median: q(0.5), q1: q(0.25), q3: q(0.75), by_day: byDay,
    up: c1a.filter((r) => r.fix.added.some((a) => a.startsWith('up:'))).length, down: c1a.filter((r) => r.fix.added.some((a) => a.startsWith('down:'))).length },
  evidence: feat,
  rules: {
    probable_fp: { picks: w2.length, fixed: w2.filter((r) => r.cls === '1a').length, of_fixed: c1a.filter((r) => r.would2).length },
    short_no_evidence: { picks: w3.length, fixed: w3.filter((r) => r.cls === '1a').length },
  },
  incidents: { total: I.rows.length, alone: alone.length, full_window: fullI.length, from: days[0] || null, to: days.at(-1) || null, by_subtype: bySub },
};
await writeFile(`${file}.tmp`, JSON.stringify(doc, null, 1) + '\n');
await rename(`${file}.tmp`, file);
console.log(`${file}: ${doc.places} places, ${doc.classes.places['1a']} fixed by the operator`);
