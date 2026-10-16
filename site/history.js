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

  const api = { stateOf, replay, diff, applyDay, classify, sortProviders };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaHistory = api;
})(typeof self !== 'undefined' ? self : this);
