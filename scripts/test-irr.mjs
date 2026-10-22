// Unit tests for site/irr.js (no dependencies). Run with: node scripts/test-irr.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { rules, roles, compare, say, threeWay } = createRequire(import.meta.url)('../site/irr.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };
const attrs = (...lines) => lines.map((l) => { const i = l.indexOf(': '); return { name: l.slice(0, i), value: l.slice(i + 2) }; });

// as the aut-num of a small ISP: sections in remarks, transits that are accepted from ANY, route servers also accepted from ANY, customers
const CONNESI = attrs(
  'remarks: ======================= TRANSITS =========================',
  'remarks: -- WARIAN --', 'mp-import: from AS56911 accept ANY', 'mp-export: to AS56911 announce AS15605:AS-CONNESI',
  'remarks: -- Zayo --', 'mp-import: from AS6461 accept ANY', 'mp-export: to AS6461 announce AS15605:AS-CONNESI',
  'remarks: -- Seeweb --', 'mp-import: from AS12637 accept ANY', 'mp-export: to AS12637 announce ANY',
  'remarks: ======================= IXP ==============================',
  'remarks: -- NaMeX Rome IXP --', 'remarks: -- Route Servers --', 'mp-import: from AS196959 accept ANY', 'mp-export: to AS196959 announce AS15605:AS-CONNESI',
  'remarks: -- Aruba --', 'mp-import: from AS31034 accept AS-ARUBAIT', 'mp-export: to AS31034 announce AS15605:AS-CONNESI',
  'remarks: ======================= CUSTOMERS ==============================',
  'mp-import: from AS39739 accept AS39739', 'mp-export: to AS39739 announce ANY',
);

test('the rules of an object: imports and exports with the section they are in', () => {
  const rs = rules(CONNESI);
  assert.equal(rs.length, 12);
  assert.deepEqual(rs.slice(0, 2).map((r) => [r.dir, r.as, r.filter, r.context]), [['import', 56911, 'ANY', 'transit'], ['export', 56911, 'AS15605:AS-CONNESI', 'transit']]);
  assert.equal(rs.find((r) => r.as === 196959).context, 'peer');
  assert.equal(rs.find((r) => r.as === 39739).context, 'customer');
});

test('transit, route servers, peers and customers are told apart by the section, not by "accept ANY" alone', () => {
  const r = roles(CONNESI);
  assert.deepEqual(r.transit, [6461, 12637, 56911]);
  assert.deepEqual(r.peer, [31034, 196959]);          // the route server is accepted from ANY too, and is not a provider
  assert.deepEqual(r.customer, [39739]);
  assert.deepEqual(r.candidate, []);
});

test('a section called customers does not make a customer of what comes after it without a new header (the object of a large ISP)', () => {
  const r = roles(attrs('remarks: Upstreams', 'import: from AS1299 accept ANY', 'export: to AS1299 announce AS5:AS-CUSTOMERS',
    'remarks: Customers', 'import: from AS64500 accept AS64500', 'export: to AS64500 announce ANY',
    'remarks: AMS-IX Amsterdam', 'import: from AS3223 accept AS-VOXILITY-SET', 'export: to AS3223 announce AS5:AS-CUSTOMERS',
    'remarks: 41327:100 localpref below normal customer route (backup)', 'import: from AS174 accept AS174:AS-COGENT', 'export: to AS174 announce AS5:AS-CUSTOMERS'));
  assert.deepEqual(r.customer, [64500]);
  assert.deepEqual(r.peer, [174, 3223]);          // the peering lines after "Customers" are peers: they announce a set, not ANY
  assert.deepEqual(r.transit, [1299]);
});

test('import-via and export-via name an exchange-point AS', () => {
  const r = roles(attrs('remarks: Upstreams', 'import: from AS1299 accept ANY', 'export: to AS1299 announce AS41327:AS-CUSTOMERS',
    'remarks: Private Network Interconnect', 'import: from AS6461 accept AS-MFNX', 'export: to AS6461 announce AS41327:AS-CUSTOMERS',
    'remarks: NETIX Sofia', 'import-via: AS57463 from AS-ANY accept ANY', 'export-via: AS57463 to AS-ANY announce AS41327:AS-CUSTOMERS',
    'import-via: afi ipv6.unicast AS44530 from AS44530:AS-MEMBERS accept AS-HOPUS'));
  assert.deepEqual(r.transit, [1299]);
  assert.deepEqual(r.peer, [6461]);
  assert.deepEqual(r.ixp, [44530, 57463]);
  assert.deepEqual(r.via, [44530, 57463]);
});

test('an AS with ordinary lines and a via line keeps its role and is also an intermediary', () => {
  const r = roles(attrs('remarks: Upstreams', 'import: from AS100 accept ANY', 'export: to AS100 announce AS5:AS-X',
    'remarks: Exchange points', 'import-via: AS100 from AS-ANY accept ANY', 'import-via: AS200 from AS-ANY accept ANY'));
  assert.deepEqual(r.transit, [100]);        // the ordinary session is not lost
  assert.deepEqual(r.via, [100, 200]);
  assert.deepEqual(r.ixp, [200]);            // only the one that appears only so is an intermediary
  assert.equal(say(r, 200), 'an intermediary AS (in practice the route server of an exchange point)');
  assert.equal(say(r, 100), 'a transit provider');
  assert.deepEqual(compare([200], r).onlyAspaIsVia, [200]);
});

test('without sections, ANY in and a set out is a probable provider, unless it is a known exchange-point AS', () => {
  const lines = attrs('import: from AS100 accept ANY', 'export: to AS100 announce AS5:AS-X', 'import: from AS200 accept ANY', 'export: to AS200 announce AS5:AS-X',
    'import: from AS300 accept AS300', 'export: to AS300 announce ANY');
  const r = roles(lines, new Set([200, 999]));
  assert.deepEqual(r.probable, [100]);
  assert.deepEqual(r.candidate, [100]);
  assert.deepEqual(r.ixp, [200]);                       // the route server of an exchange point looks the same, and is left out
  assert.deepEqual(r.transit, []);
  const c = compare([100, 400], r);
  assert.equal(c.comparable, true);
  assert.deepEqual(c.both, [100]);
  assert.equal(say(r, 100), 'probably a transit provider (accepted from ANY, not announced ANY to)');
  const tw = threeWay([400], r, [100, 400]);             // CAIDA says AS100 too, the ASPA does not list it
  assert.equal(tw.rows.find((x) => x.as === 100).irr, 'probable transit');
  assert.deepEqual(tw.aspaMissesWhatTheOthersSay, [100]);
  assert.deepEqual(roles(lines).probable, []);          // without the list of the exchange points it stays a candidate
});

test('without sections, "accept ANY" is only a candidate', () => {
  const r = roles(attrs('import: from AS100 accept ANY', 'export: to AS100 announce AS5:AS-X', 'import: from AS200 accept AS200', 'export: to AS200 announce AS5:AS-X',
    'import: from AS300 accept AS300', 'export: to AS300 announce ANY'));
  assert.deepEqual(r.candidate, [100]);
  assert.deepEqual(r.peer, [200]);
  assert.deepEqual(r.customer, [300]);
  assert.deepEqual(r.transit, []);
  assert.equal(compare([100], r).comparable, false);
});

test('the IRR against the ASPA: what is in both, what is only in one', () => {
  const c = compare([3356, 6762, 12637, 41327, 56911], roles(CONNESI));
  assert.deepEqual(c.both, [6762 === 6762 ? 12637 : 0, 56911].sort((a, b) => a - b).filter((n) => [12637, 56911].includes(n)));
  assert.deepEqual(c.onlyIrr, [6461]);                // Zayo: declared transit, missing from the ASPA
  assert.deepEqual(c.onlyAspa, [3356, 6762, 41327]);  // the ASPA has these, the object does not say transit for them
  assert.equal(c.comparable, true);
  // AS0 is not a provider
  assert.deepEqual(compare([0], roles(CONNESI)).onlyAspa, []);
  // a provider of the ASPA that the object calls a peer or an exchange point is said apart
  const p = compare([31034, 196959], roles(CONNESI));
  assert.deepEqual(p.onlyAspaIsPeerOrIxp, [31034, 196959]);
});

test('what the object says about one neighbour', () => {
  const r = roles(CONNESI);
  assert.equal(say(r, 6461), 'a transit provider');
  assert.equal(say(r, 39739), 'a customer');
  assert.equal(say(r, 196959), 'sets of prefixes only (a peer, a private link or a service)');
  assert.equal(say(r, 1), null);
});

test('an object with no policy at all (as in the registries that keep only the name) is empty, not wrong', () => {
  const r = roles(attrs('as-name: ZAYO', 'descr: Zayo', 'source: ARIN'));
  assert.equal(r.rules, 0);
  assert.equal(compare([1299], r).comparable, false);
  assert.deepEqual(rules([]), Object.assign([], { sections: 0 }));
});

test('the three sources side by side: who says what, and which one is the odd one out', () => {
  const r = roles(CONNESI);
  // a small ISP: the IRR and CAIDA agree on Zayo, Seeweb and Warian, CAIDA also has Sparkle, the ASPA has Zayo in less and Lumen, Sparkle and FT in more
  const t = threeWay([3356, 6762, 12637, 41327, 56911], r, [6461, 6762, 12637, 56911]);
  const by = Object.fromEntries(t.rows.map((x) => [x.as, x]));
  assert.deepEqual(by[6461].by, ['IRR', 'CAIDA']);
  assert.equal(by[6461].reading, 'IRR and CAIDA say it, the ASPA does not');
  assert.deepEqual(by[12637].by, ['IRR', 'CAIDA', 'ASPA']);
  assert.equal(by[12637].reading, 'all agree');
  assert.equal(by[6762].reading, 'the ASPA and CAIDA say it, the IRR does not');
  assert.equal(by[3356].reading, 'only ASPA says it');
  assert.equal(by[41327].reading, 'only ASPA says it');
  assert.deepEqual(t.aspaMissesWhatTheOthersSay, [6461]);
  assert.equal(t.rows[0].as, 6461);          // what the others agree on and the ASPA lacks comes first
  assert.equal(t.caidaAvailable, true);
  // without the file of CAIDA only two sources are compared
  const two = threeWay([6762], r, null);
  assert.equal(two.caidaAvailable, false);
  assert.equal(two.rows.find((x) => x.as === 6762).reading, 'only ASPA says it');
  assert.equal(two.rows.find((x) => x.as === 6461).caida, null);
  // a provider that the object calls an exchange point is described, not hidden
  const ix = threeWay([57463], roles(attrs('remarks: Upstreams', 'import: from AS1299 accept ANY', 'export: to AS1299 announce AS5:AS-X', 'remarks: IXP', 'import-via: AS57463 from AS-ANY accept ANY')), []);
  assert.match(ix.rows.find((x) => x.as === 57463).irr, /intermediary/);
});

console.log(`${passed} tests passed`);
