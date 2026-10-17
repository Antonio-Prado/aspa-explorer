// Turning two states of the ASPA data into events worth a notification.
//
// The validator sometimes drops an ASPA for a moment (a repository that does not answer) and brings
// it back. A change is therefore announced only when it has been seen in two polls in a row.
import { createRequire } from 'node:module';

const History = createRequire(import.meta.url)('../site/history.js');
const { stateOf, diff, sortProviders } = History;
export { stateOf, sortProviders };

const sig = (providers) => JSON.stringify(providers);

// committed: Map customer -> providers (what was last announced); current: the same for now;
// pending: {customer: signature} of the changes seen in the previous poll.
// Returns the changes now confirmed, the new committed state and the new pending set.
export function stabilise(committed, current, pending) {
  const next = new Map(committed);
  const nextPending = {};
  const events = [];
  for (const [, customer, providers] of diff(committed, current, '')) {
    const s = sig(providers);
    if (pending[customer] === s) {
      const before = committed.get(customer) || [];
      if (providers) next.set(customer, providers); else next.delete(customer);
      events.push({
        customer, providers: providers || [], before,
        kind: !providers ? 'removed' : (committed.has(customer) ? 'changed' : 'new'),
        added: (providers || []).filter((p) => !before.includes(p)),
        dropped: before.filter((p) => !(providers || []).includes(p)),
      });
    } else nextPending[customer] = s;
  }
  return { events, committed: next, pending: nextPending };
}

// The subscriptions an event concerns: those for the customer itself (relation "own") and those for
// an AS that the event added or dropped as a provider (relation "provider").
export function audience(event, subs) {
  const out = [];
  const providers = new Set([...event.added, ...event.dropped].filter((p) => p !== 'AS0'));
  for (const s of subs) {
    if (s.asn === event.customer) out.push({ sub: s, relation: 'own' });
    else if (providers.has(s.asn)) out.push({ sub: s, relation: 'provider' });
  }
  return out;
}

// A one-line description, shared by the mail and the webhook.
export function describeEvent(e, asn, relation) {
  const list = (ps) => ps.join(', ');
  if (relation === 'provider') {
    const added = e.added.includes(asn);
    return `${e.customer} ${added ? 'now lists' : 'no longer lists'} ${asn} as a provider${e.kind === 'removed' ? ' (its ASPA was removed)' : ''}.`;
  }
  if (e.kind === 'new') return `${asn} published an ASPA with ${e.providers.length} provider${e.providers.length === 1 ? '' : 's'}: ${list(e.providers)}.`;
  if (e.kind === 'removed') return `The ASPA of ${asn} is gone; its routes are back to "unknown".`;
  const bits = [];
  if (e.added.length) bits.push(`added ${list(e.added)}`);
  if (e.dropped.length) bits.push(`dropped ${list(e.dropped)}`);
  return `The ASPA of ${asn} ${bits.join(' and ')}. It now lists ${e.providers.length} provider${e.providers.length === 1 ? '' : 's'}: ${list(e.providers)}.`;
}

// ---- the places of valley that involve an AS (1.19.0), for the subscriptions that ask for them

const placeKey = (p) => `${p.role}|${p.from}|${p.to}|${p.between.join(' ')}`;

// byAs: the "as" object of leaks-by-as.json; asns: the ASes with a subscription that asks for leaks;
// seen: {AS: [keys]} of the previous build, only for those ASes. An AS that was not in `seen` gets a baseline
// (what is there now is not announced), so a new subscription does not start with a flood.
// Returns the places that are new since the previous build and the new `seen`.
export function newPlaces(byAs, asns, seen) {
  const next = {}, events = [];
  for (const asn of new Set(asns)) {
    const places = (byAs && byAs[asn]) || [];
    next[asn] = places.map(placeKey);
    if (!seen || !(asn in seen)) continue;
    const before = new Set(seen[asn]);
    for (const p of places) if (!before.has(placeKey(p))) events.push({ asn, ...p });
  }
  return { events, seen: next };
}

export function describePlace(e) {
  const chain = e.between.join(' ');
  if (e.role === 'gap') {
    return `The ASPA of ${e.asn} does not seem to list ${e.between[0]}, which routes show as a provider of ${e.asn}: paths through it look like a valley (${e.feeders} feeders, ${e.routes} routes). It is most likely an ASPA that misses a provider, not a leak.`;
  }
  const what = e.kind === 'leak'
    ? 'The relationships data says that the AS after the climb is a peer or a customer, so it passed on up a route that it should not have.'
    : 'The AS after the climb is a provider of the one before it, which more likely means an ASPA that misses a provider than a leak.';
  return `${e.asn} sits inside a valley between ${e.from} and ${e.to} (ASes in the valley: ${chain}), seen by ${e.feeders} feeders in ${e.routes} routes. ${what}`;
}
