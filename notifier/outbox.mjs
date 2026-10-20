// The messages that are due, kept in the database until somebody has taken them: an event is written here (one row for each subscription that must hear
// about it) before the state that says "this was seen" is saved, and a row is deleted only when the message has gone. A crash, a restart or a webhook that
// is down for an hour therefore delays a message and does not lose it. Delivery is at least once: after a crash between the delivery and the delete a message
// can come twice.
//
// The rows of one subscription go out in order and one at a time (so that its counter of failures stays right), the subscriptions go out a few at a time.
import { pool } from './pool.mjs';

export const MAX_FAILS = 5;
export const MAX_AGE = 2 * 86400;                              // a message that is older than this is not worth sending any more
export const RETRY = [600, 1800, 3600, 7200, 14400];           // seconds to wait after the 1st, 2nd, ... failed attempt

export function makeOutbox({ store, send, log = () => {}, now = () => Math.floor(Date.now() / 1000), concurrency = 8 }) {
  let draining = false;

  // `job` is plain data (it goes to the database as JSON); `send(sub, job, row)` throws when the message did not go (`row.id` names the message, and stays
  // the same through every attempt).
  const enqueue = (subId, job) => store.outboxAdd(subId, JSON.stringify(job), now());

  async function oneSubscription(subId, rows) {
    for (const row of rows) {
      const sub = store.get(subId);
      if (!sub || sub.status !== 'active') { store.outboxDone(row.id); continue; }     // unsubscribed or disabled meanwhile
      if (now() - row.created > MAX_AGE) { store.outboxDone(row.id); log(`message ${row.id} for subscription ${subId} dropped: older than two days`); continue; }
      try {
        await send(sub, JSON.parse(row.job), row);
        store.sent(subId, now());
        store.outboxDone(row.id);
      } catch (err) {
        store.failed(subId);
        const fails = (store.get(subId) || {}).fails || 0;
        log(`delivery to subscription ${subId} (${sub.kind}) failed: ${err.message}`);
        if (fails >= MAX_FAILS) { store.disable(subId, now()); store.outboxDropSub(subId); log(`subscription ${subId} disabled after ${MAX_FAILS} failures`); }
        else store.outboxRetry(row.id, subId, now() + RETRY[Math.min(row.attempts, RETRY.length - 1)]);
        return;                                                                         // the next ones of this subscription wait: the order is kept
      }
    }
  }

  // Sends what is due. Safe to call at any time; a call while another one runs does nothing.
  async function drain() {
    if (draining) return 0;
    draining = true;
    try {
      const rows = store.outboxDue(now());
      const bySub = new Map();
      for (const r of rows) { if (!bySub.has(r.sub_id)) bySub.set(r.sub_id, []); bySub.get(r.sub_id).push(r); }
      // a failure of a recipient is dealt with inside oneSubscription (retry, counter); what reaches the pool is the queue itself failing (the database)
      const broken = [];
      await pool([...bySub].map(([id, list]) => () => oneSubscription(id, list)), concurrency, (err) => { broken.push(err); log(`delivery failed: ${err.message}`); });
      if (broken.length) throw new Error(`${broken.length} subscription(s) could not be processed: ${broken[0].message}`);
      return rows.length;
    } finally { draining = false; }
  }

  return { enqueue, drain };
}
