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
