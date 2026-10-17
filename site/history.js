'use strict';

// The history of the ASPA data as a list of events, with pure helpers shared by the page, the daily
// job and the tests.
//
// An event is [date, "AS123", ["AS1", "AS2"] | null]: on that day the ASPA of the customer AS became
// the given provider set (a new ASPA or a change), or null when it was removed. Events are sorted by
// date; replaying them gives the state of any day. A state is a Map from a customer to the sorted
// array of its providers.
(function (root) {
  const asNum = (as) => Number(as.slice(2));
  const sortProviders = (list) => [...new Set(list)].sort((a, b) => asNum(a) - asNum(b));

  // State from the "aspas" array of Routinator's JSON; several objects for one customer (for example
  // under two trust anchors) are merged.
  function stateOf(aspas) {
    const merged = new Map();
    for (const a of aspas) merged.set(a.customer, (merged.get(a.customer) || []).concat(a.providers));
    return new Map([...merged].map(([c, p]) => [c, sortProviders(p)]));
  }

  // State at the end of the day upTo (every event when omitted).
  function replay(events, upTo) {
    const state = new Map();
    for (const [date, customer, providers] of events) {
      if (upTo && date > upTo) break;
      if (providers) state.set(customer, providers); else state.delete(customer);
    }
    return state;
  }

  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // Events that turn the state prev into the state cur on the given day.
  function diff(prev, cur, day) {
    const out = [];
    const customers = [...new Set([...prev.keys(), ...cur.keys()])].sort((a, b) => asNum(a) - asNum(b));
    for (const c of customers) {
      const p = prev.get(c), n = cur.get(c);
      if (n && (!p || !same(p, n))) out.push([day, c, n]);
      else if (p && !n) out.push([day, c, null]);
    }
    return out;
  }

  // The events with the changes of the given day added. Events of that day or later are replaced, so
  // running the job twice on the same day does not duplicate anything.
  function applyDay(events, aspas, day) {
    const before = events.filter((e) => e[0] < day);
    return before.concat(diff(replay(before), stateOf(aspas), day));
  }

  // Each event with its kind: "new" (no ASPA before), "removed" or "changed", and for a change the
  // providers added and dropped.
  function classify(events) {
    const state = new Map();
    return events.map(([date, customer, providers]) => {
      const before = state.get(customer);
      if (providers) state.set(customer, providers); else state.delete(customer);
      if (!providers) return { date, customer, kind: 'removed', providers: [], added: [], dropped: before || [] };
      if (!before) return { date, customer, kind: 'new', providers, added: providers, dropped: [] };
      return {
        date, customer, kind: 'changed', providers,
        added: providers.filter((p) => !before.includes(p)), dropped: before.filter((p) => !providers.includes(p)),
      };
    });
  }

  // What changed for one AS between two days (from < to): its own providers and the ASPAs that name it as a provider.
  function compareAs(events, as, from, to) {
    const a = replay(events, from), b = replay(events, to);
    const own = (s) => s.get(as) || null;
    const namedBy = (s) => [...s].filter(([, ps]) => ps.includes(as)).map(([c]) => c).sort((x, y) => asNum(x) - asNum(y));
    const pa = own(a), pb = own(b), na = namedBy(a), nb = namedBy(b);
    return {
      as, from, to,
      own: { before: pa, after: pb, added: (pb || []).filter((x) => !(pa || []).includes(x)), dropped: (pa || []).filter((x) => !(pb || []).includes(x)) },
      named: { before: na.length, after: nb.length, added: nb.filter((c) => !na.includes(c)), dropped: na.filter((c) => !nb.includes(c)) },
    };
  }

  // The places of valley of one AS on two days (the "as" objects of the daily leaks-by-as files): new, gone and still there.
  function comparePlaces(before, after, as) {
    const key = (p) => `${p.role}|${p.from}|${p.to}|${p.between.join(' ')}`;
    const pa = (before && before[as]) || [], pb = (after && after[as]) || [];
    const ka = new Set(pa.map(key)), kb = new Set(pb.map(key));
    return { added: pb.filter((p) => !ka.has(key(p))), gone: pa.filter((p) => !kb.has(key(p))), kept: pb.filter((p) => ka.has(key(p))).length };
  }

  const api = { stateOf, replay, diff, applyDay, classify, sortProviders, compareAs, comparePlaces };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaHistory = api;
})(typeof self !== 'undefined' ? self : this);
