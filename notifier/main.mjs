// The notifier: polls the ASPA data, announces confirmed changes to the subscribers (mail with DKIM,
// signed webhooks) and serves the subscription API on the loopback interface.
//
// Environment (defaults for the production host):
//   NOTIFY_DB        /var/db/aspa-notify/notify.db      SQLite file
//   NOTIFY_KEY       /var/db/aspa-notify/token.key      secret for the links (created when missing)
//   NOTIFY_DKIM_KEY  /var/db/aspa-notify/dkim.key       RSA private key (PEM); mails are not signed without it
//   NOTIFY_SELECTOR  aspa2026                            DKIM selector
//   NOTIFY_DOMAIN    aspa.ping6.it                       DKIM and mail domain
//   NOTIFY_FROM      notifications@aspa.ping6.it
//   NOTIFY_REPLY_TO  antonio.prado@dei.unipd.it
//   NOTIFY_SITE      https://aspa.ping6.it
//   ASPA_DATA        http://127.0.0.1:8080/data/aspas.json
//   LEAKS_BY_AS      http://127.0.0.1:8080/api/v1/leaks-by-as.json   places of valley of each AS (built once a day)
//   NOTIFY_PORT      8090 (127.0.0.1)
//   NOTIFY_POLL      600 seconds between polls
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { openStore } from './store.mjs';
import { stabilise, audience, describeEvent, stateOf, newPlaces, describePlace } from './changes.mjs';
import { compose, serialize, sendmail } from './mail.mjs';
import { post } from './webhook.mjs';
import { makeApi, httpHandler } from './server.mjs';

const env = (k, d) => process.env[k] || d;
const SITE = env('NOTIFY_SITE', 'https://aspa.ping6.it');
const DOMAIN = env('NOTIFY_DOMAIN', 'aspa.ping6.it');
const FROM = env('NOTIFY_FROM', 'notifications@aspa.ping6.it');
const REPLY_TO = env('NOTIFY_REPLY_TO', 'antonio.prado@dei.unipd.it');
const DATA = env('ASPA_DATA', 'http://127.0.0.1:8080/data/aspas.json');
const LEAKS = env('LEAKS_BY_AS', 'http://127.0.0.1:8080/api/v1/leaks-by-as.json');
const POLL = Number(env('NOTIFY_POLL', '600')) * 1000;
const MAX_FAILS = 5;
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

const store = openStore(env('NOTIFY_DB', '/var/db/aspa-notify/notify.db'));
const keyPath = env('NOTIFY_KEY', '/var/db/aspa-notify/token.key');
if (!existsSync(keyPath)) { writeFileSync(keyPath, randomBytes(32).toString('base64url'), { mode: 0o600 }); chmodSync(keyPath, 0o600); }
const key = readFileSync(keyPath, 'utf8').trim();
const dkimPath = env('NOTIFY_DKIM_KEY', '/var/db/aspa-notify/dkim.key');
const dkim = existsSync(dkimPath) ? { domain: DOMAIN, selector: env('NOTIFY_SELECTOR', 'aspa2026'), privateKey: readFileSync(dkimPath, 'utf8') } : null;
if (!dkim) log('no DKIM key: mails are sent unsigned');

const mailTo = (to, subject, text, unsubscribeUrl) =>
  sendmail(serialize(compose({ from: FROM, to, subject, text, unsubscribeUrl, replyTo: REPLY_TO, domain: DOMAIN }), dkim), FROM, to);

async function sendConfirmation({ to, asn, token, site, leaks }) {
  await mailTo(to, `Confirm: ASPA changes for ${asn}`, [
    `Somebody (probably you) asked ASPA Explorer to send a message to this address`,
    `whenever the ASPA of ${asn}, or a mention of ${asn} as a provider in other ASPAs, changes${leaks ? ', and when a new place of valley (a possible route leak) involves it' : ''}.`,
    '',
    'To start receiving these messages, open this link:',
    `${site}/subscription.html#confirm=${token}`,
    '',
    'If it was not you, ignore this message: nothing is sent unless you confirm,',
    'and the request is deleted after two days.',
    '',
    'ASPA Explorer, University of Padova - https://aspa.ping6.it/',
  ].join('\n'));
}

const api = makeApi({
  store, key, site: SITE, sendConfirmation, log,
  verifyWebhook: (url, payload, secret) => post(url, payload, { secret }),
});

async function notify(events) {
  const subs = store.allActive();
  for (const e of events) {
    for (const { sub, relation } of audience(e, subs)) {
      const line = describeEvent(e, sub.asn, relation);
      const unsub = api.unsubscribeUrl(sub.id);          // POST: List-Unsubscribe header and webhooks
      const unsubPage = api.unsubscribePage(sub.id);     // a page for people
      try {
        if (sub.kind === 'email') {
          await mailTo(sub.target, `ASPA ${relation === 'own' ? `of ${sub.asn}` : `change that names ${sub.asn}`}: ${e.kind}`, [
            line, '',
            `Page: ${SITE}/as/${sub.asn}`,
            `Feed: ${SITE}/feed/${sub.asn}.atom`, '',
            'You receive this because you subscribed on ASPA Explorer. To stop:',
            unsubPage, '',
            'The data is the output of the validator at rpki.ping6.it, checked every ten minutes.',
          ].join('\n'), unsub);
        } else {
          const r = await post(sub.target, {
            type: 'aspa.change', asn: sub.asn, relation, text: line, time: new Date().toISOString(),
            change: { customer: e.customer, kind: e.kind, providers: e.providers, added: e.added, dropped: e.dropped },
            page: `${SITE}/as/${sub.asn}`, unsubscribe: unsub,
          }, { secret: sub.secret });
          if (!(r.status >= 200 && r.status < 300)) throw new Error(`HTTP ${r.status}`);
        }
        store.sent(sub.id, Math.floor(Date.now() / 1000));
      } catch (err) {
        store.failed(sub.id);
        const now = store.get(sub.id);
        log(`delivery to subscription ${sub.id} (${sub.kind}) failed: ${err.message}`);
        if (now && now.fails >= MAX_FAILS) { store.disable(sub.id); log(`subscription ${sub.id} disabled after ${MAX_FAILS} failures`); }
      }
    }
  }
}

// One message for a subscription (mail or webhook); a failure is counted and disables the subscription after MAX_FAILS.
async function deliver(sub, { subject, line, type, extra }) {
  const unsub = api.unsubscribeUrl(sub.id);
  const unsubPage = api.unsubscribePage(sub.id);
  try {
    if (sub.kind === 'email') {
      await mailTo(sub.target, subject, [
        line, '',
        `Page: ${SITE}/as/${sub.asn}`, '',
        'You receive this because you subscribed on ASPA Explorer. To stop:',
        unsubPage, '',
        'The places of valley are read once a day from the table dumps of collectors of RIPE RIS and RouteViews. A place is a candidate, not a verdict.',
      ].join('\n'), unsub);
    } else {
      const r = await post(sub.target, { type, asn: sub.asn, text: line, time: new Date().toISOString(), ...extra, page: `${SITE}/as/${sub.asn}`, unsubscribe: unsub }, { secret: sub.secret });
      if (!(r.status >= 200 && r.status < 300)) throw new Error(`HTTP ${r.status}`);
    }
    store.sent(sub.id, Math.floor(Date.now() / 1000));
  } catch (err) {
    store.failed(sub.id);
    const now = store.get(sub.id);
    log(`delivery to subscription ${sub.id} (${sub.kind}) failed: ${err.message}`);
    if (now && now.fails >= MAX_FAILS) { store.disable(sub.id); log(`subscription ${sub.id} disabled after ${MAX_FAILS} failures`); }
  }
}

// The places of valley (leaks-by-as.json, built once a day): the subscriptions that asked for them are told about the
// places that are new since the previous build. Nothing happens until the file changes.
async function pollLeaks() {
  const r = await fetch(LEAKS, { headers: { Accept: 'application/json', 'User-Agent': 'aspa-explorer-notifier' } });
  if (!r.ok) throw new Error(`leaks: HTTP ${r.status}`);
  const doc = await r.json();
  if (!doc || typeof doc.as !== 'object' || !doc.generated) throw new Error('leaks: unexpected file, ignored');
  const saved = store.getState('leaks') || { generated: null, seen: {} };
  if (saved.generated === doc.generated) return;
  const subs = store.allActive().filter((s) => s.leaks);
  const out = newPlaces(doc.as, subs.map((s) => s.asn), saved.seen);
  store.setState('leaks', { generated: doc.generated, seen: out.seen });
  if (out.events.length) log(`${out.events.length} new place(s) of valley for the subscriptions`);
  for (const e of out.events) {
    const line = describePlace(e);
    for (const sub of subs.filter((s) => s.asn === e.asn)) {
      await deliver(sub, { subject: `Route leak or valley that involves ${e.asn}`, line, type: 'aspa.leak', extra: { place: { role: e.role, kind: e.kind, from: e.from, to: e.to, between: e.between, feeders: e.feeders, routes: e.routes } } });
    }
  }
}

// what /api/v1/subscriptions/health says: when the data was last read, and whether the last reads worked
const pulse = { lastOk: null, lastTry: null, failures: 0 };
const health = () => ({
  ok: pulse.lastOk !== null && pulse.failures < 3 && Date.now() - pulse.lastOk < 3 * POLL,
  last_poll: pulse.lastOk && new Date(pulse.lastOk).toISOString(),
  failures_in_a_row: pulse.failures,
  poll_seconds: POLL / 1000,
});

let busy = false;
async function poll() {
  if (busy) return;
  busy = true;
  pulse.lastTry = Date.now();
  try {
    const r = await fetch(DATA, { headers: { Accept: 'application/json', 'User-Agent': 'aspa-explorer-notifier' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data.aspas) || !data.aspas.length) throw new Error('empty ASPA data, ignored');
    const current = stateOf(data.aspas);
    const saved = store.getState('committed');
    pulse.lastOk = Date.now(); pulse.failures = 0;
    if (!saved) { store.setState('committed', [...current]); store.setState('pending', {}); log(`first run: ${current.size} ASPAs taken as the starting point`); return; }
    const out = stabilise(new Map(saved), current, store.getState('pending') || {});
    store.setState('committed', [...out.committed]);
    store.setState('pending', out.pending);
    if (out.events.length) { log(`${out.events.length} change(s) confirmed`); await notify(out.events); }
    try { await pollLeaks(); } catch (err) { log(`leaks not read: ${err.message}`); }
    const purged = store.purge(Math.floor(Date.now() / 1000) - 2 * 86400);
    if (purged) log(`${purged} unconfirmed request(s) deleted`);
  } catch (err) { pulse.failures++; log(`poll failed: ${err.message}`); } finally { busy = false; }
}

const server = http.createServer(httpHandler(api, { site: SITE, health }));
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(Number(env('NOTIFY_PORT', '8090')), '127.0.0.1', () => log(`listening on 127.0.0.1:${env('NOTIFY_PORT', '8090')}`));
poll();
setInterval(poll, POLL);
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { server.close(); store.close(); process.exit(0); });
