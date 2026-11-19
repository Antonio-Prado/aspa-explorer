// The contacts of the caches that other people run and let the site follow: who is told of the anomalies of which cache.
// A contact is a subscription whose topic names its caches (see rtr.mjs); it is made here by the operator of the site, after the
// contact agreed, and never from the public form. The service that is running sends the first message, and the messages after it.
//
//   node notifier/contact.mjs add noc@example.net cache_id [cache_id ...]     (--quiet: no first message)
//   node notifier/contact.mjs list
//   node notifier/contact.mjs remove noc@example.net
//
// As the user of the notifier, with NOTIFY_DB when the database is not /var/db/aspa-notify/notify.db.
import { openStore } from './store.mjs';
import { EMAIL_RE } from './mail.mjs';
import { contactTopic, contactCaches } from './rtr.mjs';

export function run(args, store, now = Math.floor(Date.now() / 1000)) {
  const [cmd, ...rest] = args;
  const contacts = () => store.allActive().filter((s) => contactCaches(s.asn));
  if (cmd === 'list') return contacts().map((s) => `${s.id}\t${s.target}\t${contactCaches(s.asn).join(' ')}`);
  if (cmd === 'add') {
    const quiet = rest.includes('--quiet');
    const [to, ...ids] = rest.filter((x) => x !== '--quiet');
    if (!to || !EMAIL_RE.test(to)) throw new Error('add: an e-mail address, then the ids of its caches');
    const topic = contactTopic(ids);
    if (contacts().some((s) => s.target === to)) throw new Error(`${to} is a contact already: remove it first to change its caches`);
    return store.transaction(() => {
      const id = store.insert('email', to, topic, null, now);
      store.activate(id, now);
      if (!quiet) store.outboxAdd(id, JSON.stringify({ type: 'rtr-welcome' }), now);
      return [`contact ${id}: ${to} for ${contactCaches(topic).join(', ')}${quiet ? '' : '; the first message is queued'}`];
    });
  }
  if (cmd === 'remove') {
    const mine = contacts().filter((s) => s.target === rest[0]);
    if (!mine.length) throw new Error(`remove: ${rest[0] || 'no address'} is not a contact`);
    for (const s of mine) { store.outboxDropSub(s.id); store.remove(s.id); }
    return [`removed ${mine.length} contact${mine.length === 1 ? '' : 's'} of ${rest[0]}`];
  }
  throw new Error('usage: contact.mjs add ADDRESS CACHE_ID... [--quiet] | list | remove ADDRESS');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const store = openStore(process.env.NOTIFY_DB || '/var/db/aspa-notify/notify.db');
  try { for (const line of run(process.argv.slice(2), store)) console.log(line); } catch (err) { console.error(err.message); process.exitCode = 1; } finally { store.close(); }
}
