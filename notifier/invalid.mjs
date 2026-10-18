// Alerts on invalid announcements, for the subscriptions that asked for a threshold: scripts/watch-invalid.mjs writes, every ten minutes,
// invalid-last.json with what the RIPE RIS collectors showed in that run, by origin; a subscription to an AS with a threshold is told when that
// AS was the origin of at least that many announcements that the ASPAs prove invalid, and not again for six hours.
export const COOLDOWN = 6 * 3600;
export const MIN_THRESHOLD = 5, MAX_THRESHOLD = 100000;

// doc: invalid-last.json; subs: the active subscriptions; alerts: {subscription id: seconds of the last alert}; now: seconds.
// Returns the alerts to send ({sub, asn, invalid, announcements, prefixes, from, to}) and the new `alerts`.
export function dueInvalid(doc, subs, alerts, now) {
  const next = {};
  for (const [id, t] of Object.entries(alerts || {})) if (now - t < 2 * COOLDOWN) next[id] = t;
  const events = [];
  if (!doc || typeof doc.origins !== 'object' || !doc.generated) return { events, alerts: next };
  for (const sub of subs) {
    if (!(sub.invalid_min >= MIN_THRESHOLD)) continue;
    const o = doc.origins[sub.asn];
    if (!o || o.invalid < sub.invalid_min) continue;
    if (next[sub.id] !== undefined && now - next[sub.id] < COOLDOWN) continue;
    next[sub.id] = now;
    events.push({ sub, asn: sub.asn, invalid: o.invalid, announcements: o.announcements, prefixes: o.prefixes || [], from: doc.from, to: doc.to });
  }
  return { events, alerts: next };
}

export function describeInvalid(e) {
  const share = e.announcements ? ` (${Math.round((1000 * e.invalid) / e.announcements) / 10}% of its ${e.announcements})` : '';
  const top = e.prefixes.slice(0, 3).map((p) => `${p.prefix} (${p.invalid})`).join(', ');
  return `${e.asn} was the origin of ${e.invalid} announcements that the ASPAs prove invalid${share}, seen by the RIPE RIS collectors between ${e.from} and ${e.to}.${top ? ` The prefixes with most: ${top}.` : ''} Invalid means a valley in the AS path: a route leak, a forged path, or an ASPA that misses a provider.`;
}
