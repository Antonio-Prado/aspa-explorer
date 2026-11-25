// The aggregate of classify.mjs that the page /false-positives.html shows (site/data/false-positives.json): counts by class in
// places and routes, what the operators corrected, how soon, which evidence goes with a fix, and how the rules compare with
// the fixes. No AS number.
//
//   node summary.mjs OUT_DIR OUT_FILE COLLECTORS
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const [out, file, collectors] = process.argv.slice(2);
if (!out || !file) { console.error('usage: summary.mjs OUT_DIR OUT_FILE COLLECTORS'); process.exit(2); }
const P = JSON.parse(await readFile(join(out, 'classified-places.json'), 'utf8'));
const CLS = ['1a', '1b', '1c', '4', '3', '2', '5'];
const count = (rows, w = () => 1) => Object.fromEntries(CLS.map((c) => [c, rows.filter((r) => r.cls === c).reduce((s, r) => s + w(r), 0)]));
const full = P.rows.filter((r) => r.full_window);

const c1a = full.filter((r) => r.cls === '1a');
// what the operators did: the pairs (customer, AS added to its ASPA) behind the fixed places, each counted once, and the customers.
// A place has two candidate pairs, one at each end, and one missing provider makes many places: the pairs added are the corrections.
const added = new Set(), customers = new Set();
for (const r of c1a) for (const a of r.fix.added) { const [c, p] = a.split(':')[1].split('+'); added.add(`${c}>${p}`); customers.add(c); }
// how soon: only the places first seen after the first day of the period (the others may be older than the period)
const timed = c1a.filter((r) => !r.left_cut);
const lag = timed.map((r) => r.fix.after).sort((a, b) => a - b);
const q = (x) => (lag.length ? lag[Math.floor(x * (lag.length - 1))] : null);
const byDay = Array.from({ length: P.window }, (_, i) => lag.filter((d) => d === i + 1).length);
// the same by the source of the state of the day the place was first seen: the daily archive, or the hourly job of the site
const bySrc = Object.fromEntries(['ripe', 'aspa'].map((s) => { const rs = timed.filter((r) => r.src === s); return [s, { places_seen: full.filter((r) => r.src === s && !r.left_cut).length, fixed: rs.length, day1: rs.filter((r) => r.fix.after === 1).length }]; }));
const routes = full.reduce((s, r) => s + r.routes, 0);
const biggest = [...full].sort((a, b) => b.routes - a.routes)[0];

const feat = [
  ['all', 'All the places', () => true],
  ['caida_provider', 'CAIDA has the missing AS as a provider of the customer', (r) => r.evidence[0].caida === 'provider'],
  ['caida_none', 'CAIDA has a peer or a customer at both ends', (r) => r.evidence.every((e) => e.caida === 'peer' || e.caida === 'customer')],
  ['irr_transit', 'The IRR says transit at one of the two ends', (r) => r.evidence.some((e) => e.irr_transit)],
  ['short', 'Seen on one or two days', (r) => r.days <= 2 && !r.censored],
  ['long', 'Seen on more than seven days', (r) => r.days > 7],
  ['many_feeders', 'Seen by three or more feeders on a day', (r) => r.max_feeders >= 3],
  ['one_feeder', 'Seen by a single feeder', (r) => r.single_feeder],
  ['new_aspa', 'The ASPA was at most seven days old', (r) => r.age_up !== null && r.age_up <= 7],
  ['old_aspa', 'The ASPA was more than 90 days old', (r) => r.age_up !== null && r.age_up > 90],
].map(([id, name, f]) => { const rs = full.filter(f); return { id, name, places: rs.length, fixed: rs.filter((r) => r.cls === '1a').length }; });

const w2 = full.filter((r) => r.would2), w3 = full.filter((r) => r.would3);
const doc = {
  generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  collectors: (collectors || '').split(',').filter(Boolean),
  period: P.period, window: P.window, history_to: P.last_event,
  routes_read: P.days.reduce((s, d) => s + d.total.routes, 0),
  invalid_routes: P.days.reduce((s, d) => s + d.total.invalid, 0),
  places: full.length,
  classes: { places: count(full), routes: count(full, (r) => r.routes) },
  totals: { places: full.length, routes },
  corrections: { pairs: added.size, customers: customers.size },
  biggest_place: biggest ? { routes: biggest.routes, cls: biggest.cls, feeder_fix: Boolean(biggest.feeder_fix) } : null,
  feeder_fixes: { places: c1a.filter((r) => r.feeder_fix).length, routes: c1a.filter((r) => r.feeder_fix).reduce((s, r) => s + r.routes, 0), of_routes: c1a.reduce((s, r) => s + r.routes, 0) },
  // the places that were already there on the first day of the period (how old they are is not known) and the ones that appeared later
  already: { places: full.filter((r) => r.left_cut).length, fixed: c1a.filter((r) => r.left_cut).length },
  appeared: { places: full.filter((r) => !r.left_cut).length, fixed: timed.length },
  fix: { places: c1a.length, timed: timed.length, median: q(0.5), q1: q(0.25), q3: q(0.75), by_day: byDay, by_source: bySrc,
    up: c1a.filter((r) => r.fix.added.some((a) => a.startsWith('up:'))).length, down: c1a.filter((r) => r.fix.added.some((a) => a.startsWith('down:'))).length },
  evidence: feat,
  rules: {
    probable_fp: { picks: w2.length, fixed: w2.filter((r) => r.cls === '1a').length, of_fixed: c1a.filter((r) => r.would2).length },
    short_no_evidence: { picks: w3.length, fixed: w3.filter((r) => r.cls === '1a').length },
  },
};
await writeFile(`${file}.tmp`, JSON.stringify(doc, null, 1) + '\n');
await rename(`${file}.tmp`, file);
console.log(`${file}: ${doc.places} places, ${doc.classes.places['1a']} fixed by the operator`);
