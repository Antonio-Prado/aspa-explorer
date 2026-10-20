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
//   STATUS_HISTORY   http://127.0.0.1:8080/api/v1/status-history.json   the states of the parts of the service (every 15 minutes)
//   NOTIFY_SITE_DIR  /usr/local/www/aspa                           where site/report.html is (the shell of the pages /r/<id>)
//   INVALID_LAST     http://127.0.0.1:8080/api/v1/invalid-last.json     what the last run of watch-invalid saw, by origin (every ten minutes)
//   NOTIFY_PORT      8090 (127.0.0.1)
//   NOTIFY_POLL      600 seconds between polls
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { openStore } from './store.mjs';
import { stabilise, audience, describeEvent, stateOf, newPlaces, describePlace } from './changes.mjs';
import { compose, serialize, sendmail } from './mail.mjs';
import { post } from './webhook.mjs';
import { makeOutbox } from './outbox.mjs';
import { makePulse } from './pulse.mjs';
import { TTL_DAYS } from './reports.mjs';
import { dueInvalid, describeInvalid } from './invalid.mjs';
import { watchStatus, describeStatusEvent, statusSubject } from './status.mjs';
import { makeApi, httpHandler, STATUS } from './server.mjs';

const env = (k, d) => process.env[k] || d;
const SITE = env('NOTIFY_SITE', 'https://aspa.ping6.it');
const DOMAIN = env('NOTIFY_DOMAIN', 'aspa.ping6.it');
const FROM = env('NOTIFY_FROM', 'notifications@aspa.ping6.it');
const REPLY_TO = env('NOTIFY_REPLY_TO', 'antonio.prado@dei.unipd.it');
const DATA = env('ASPA_DATA', 'http://127.0.0.1:8080/data/aspas.json');
const LEAKS = env('LEAKS_BY_AS', 'http://127.0.0.1:8080/api/v1/leaks-by-as.json');
const STATUS_FILE = env('STATUS_HISTORY', 'http://127.0.0.1:8080/api/v1/status-history.json');
const INVALID_FILE = env('INVALID_LAST', 'http://127.0.0.1:8080/api/v1/invalid-last.json');
const SITE_DIR = env('NOTIFY_SITE_DIR', '/usr/local/www/aspa');
const POLL = Number(env('NOTIFY_POLL', '600')) * 1000;
const PRIVACY = 'https://www.unipd.it/en/privacy';
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

process.umask(0o077);           // the database, its WAL and the keys are created readable by the service only, whatever the directory allows
const dbPath = env('NOTIFY_DB', '/var/db/aspa-notify/notify.db');
const store = openStore(dbPath);
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { chmodSync(f, 0o600); } catch (err) { if (err.code !== 'ENOENT') throw err; } }     // the files that were there before the umask above
const keyPath = env('NOTIFY_KEY', '/var/db/aspa-notify/token.key');
// the secret of the links is created once; the flag 'wx' makes a second creator fail instead of overwriting it
try { writeFileSync(keyPath, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' }); } catch (err) { if (err.code !== 'EEXIST') throw err; }
chmodSync(keyPath, 0o600);
const key = readFileSync(keyPath, 'utf8').trim();
const dkimPath = env('NOTIFY_DKIM_KEY', '/var/db/aspa-notify/dkim.key');
const dkim = existsSync(dkimPath) ? { domain: DOMAIN, selector: env('NOTIFY_SELECTOR', 'aspa2026'), privateKey: readFileSync(dkimPath, 'utf8') } : null;
if (!dkim) log('no DKIM key: mails are sent unsigned');

const mailTo = (to, subject, text, unsubscribeUrl) =>
  sendmail(serialize(compose({ from: FROM, to, subject, text, unsubscribeUrl, replyTo: REPLY_TO, domain: DOMAIN }), dkim), FROM, to);

async function sendConfirmation({ to, asn, token, site, leaks, invalid }) {
  if (asn === STATUS) {
    await mailTo(to, 'Confirm: status alerts of ASPA Explorer', [
      'Somebody (probably you) asked ASPA Explorer to send a message to this address',
      'whenever a part of the service (the validator, the daily jobs, the API) becomes late or down, and when it is back to OK.',
      '',
      'To start receiving these messages, open this link:',
      `${site}/subscription.html#confirm=${token}`,
      '',
      'If it was not you, ignore this message: nothing is sent unless you confirm,',
      'and the request is deleted after two days.',
      '',
      `Privacy information: ${PRIVACY}`,
    '',
    'ASPA Explorer, University of Padova - https://aspa.ping6.it/',
    ].join('\n'));
    return;
  }
  await mailTo(to, `Confirm: ASPA changes for ${asn}`, [
    `Somebody (probably you) asked ASPA Explorer to send a message to this address`,
    `whenever the ASPA of ${asn}, or a mention of ${asn} as a provider in other ASPAs, changes${leaks ? ', and when a new place of valley (a possible route leak) involves it' : ''}${invalid ? `, and when ${asn} is the origin of at least ${invalid} invalid announcements in ten minutes (at most one such message every six hours)` : ''}.`,
    '',
    'To start receiving these messages, open this link:',
    `${site}/subscription.html#confirm=${token}`,
    '',
    'If it was not you, ignore this message: nothing is sent unless you confirm,',
    'and the request is deleted after two days.',
    '',
    `Privacy information: ${PRIVACY}`,
    '',
    'ASPA Explorer, University of Padova - https://aspa.ping6.it/',
  ].join('\n'));
}

const api = makeApi({
  store, key, site: SITE, sendConfirmation, log,
  verifyWebhook: (url, payload, secret) => post(url, payload, { secret }),
});

// Sends one message that was queued (see outbox.mjs); it throws when the message did not go, and the outbox counts the failure and tries again later.
// `job` is plain data: {type: 'change', event, relation} for a change of ASPAs, {type: 'message', ...} for a place of valley or an alert on invalid
// announcements, {type: 'status', events} for the state of the service.
const FOOTER_LEAKS = 'The places of valley are read once a day from the table dumps of collectors of RIPE RIS and RouteViews. A place is a candidate, not a verdict.';
async function send(sub, job, row) {
  const event_id = `aspa-${row.id}`;                   // the same through every attempt: a receiver can drop the second copy of a message
  const unsub = api.unsubscribeUrl(sub.id);            // POST: List-Unsubscribe header and webhooks
  const unsubPage = api.unsubscribePage(sub.id);       // a page for people
  const ok = (r) => { if (!(r.status >= 200 && r.status < 300)) throw new Error(`HTTP ${r.status}`); };
  if (job.type === 'change') {
    const e = job.event, relation = job.relation;
    const line = describeEvent(e, sub.asn, relation);
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
      ok(await post(sub.target, {
        event_id, type: 'aspa.change', asn: sub.asn, relation, text: line, time: new Date().toISOString(),
        change: { customer: e.customer, kind: e.kind, providers: e.providers, added: e.added, dropped: e.dropped },
        page: `${SITE}/as/${sub.asn}`, unsubscribe: unsub,
      }, { secret: sub.secret }));
    }
  } else if (job.type === 'status') {
    const text = job.events.map(describeStatusEvent);
    if (sub.kind === 'email') {
      await mailTo(sub.target, statusSubject(job.events), [
        ...text, '',
        `Status: ${SITE}/status.html`, '',
        'You receive this because you subscribed to the status alerts of ASPA Explorer. To stop:',
        unsubPage, '',
        'A change is announced when two checks in a row (15 minutes apart) show it. If the server itself is down, no message can be sent.',
      ].join('\n'), unsub);
    } else {
      ok(await post(sub.target, { event_id, type: 'aspa.status', text: text.join(' '), time: new Date().toISOString(), changes: job.events.map((e) => ({ part: e.id, name: e.name, from: e.from, to: e.to, at: new Date(e.at * 1000).toISOString() })), page: `${SITE}/status.html`, unsubscribe: unsub }, { secret: sub.secret }));
    }
  } else {
    const { subject, line, type, extra, footer = FOOTER_LEAKS } = job;
    if (sub.kind === 'email') {
      await mailTo(sub.target, subject, [
        line, '',
        `Page: ${SITE}/as/${sub.asn}`, '',
        'You receive this because you subscribed on ASPA Explorer. To stop:',
        unsubPage, '',
        footer,
      ].join('\n'), unsub);
    } else {
      ok(await post(sub.target, { event_id, type, asn: sub.asn, text: line, time: new Date().toISOString(), ...extra, page: `${SITE}/as/${sub.asn}`, unsubscribe: unsub }, { secret: sub.secret }));
    }
  }
}

const outbox = makeOutbox({ store, send, log });

// What is queued here is sent by the next drain(): at once, and again every minute for the ones that have to be retried.
const queueChanges = (events) => {
  const subs = store.allActive();
  for (const e of events) for (const { sub, relation } of audience(e, subs)) outbox.enqueue(sub.id, { type: 'change', event: e, relation });
};

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
  if (out.events.length) log(`${out.events.length} new place(s) of valley for the subscriptions`);
  // queued first, and only then marked as seen: a crash in between sends a place twice, it does not lose it
  for (const e of out.events) {
    const line = describePlace(e);
    for (const sub of subs.filter((s) => s.asn === e.asn)) outbox.enqueue(sub.id, { subject: `Route leak or valley that involves ${e.asn}`, line, type: 'aspa.leak', extra: { place: { role: e.role, kind: e.kind, from: e.from, to: e.to, between: e.between, feeders: e.feeders, routes: e.routes } } });
  }
  store.setState('leaks', { generated: doc.generated, seen: out.seen });
}

// The states of the parts of the service (status-history.json, a sample every 15 minutes): the subscriptions to the topic
// "status" get one message for all the parts that changed state since the previous poll. Nothing happens until a part changes.
async function pollStatus() {
  const r = await fetch(STATUS_FILE, { headers: { Accept: 'application/json', 'User-Agent': 'aspa-explorer-notifier' } });
  if (!r.ok) throw new Error(`status: HTTP ${r.status}`);
  const out = watchStatus(await r.json(), store.getState('status'), Math.floor(Date.now() / 1000));
  if (!out.events.length) { store.setState('status', out.saved); return; }
  log(`${out.events.length} change(s) of state of the service`);
  for (const sub of store.allActive().filter((s) => s.asn === STATUS)) outbox.enqueue(sub.id, { type: 'status', events: out.events });
  store.setState('status', out.saved);
}

// Invalid announcements (invalid-last.json, written every ten minutes by watch-invalid): the subscriptions with a threshold are told when
// their AS reached it, and not again for six hours.
async function pollInvalid() {
  const r = await fetch(INVALID_FILE, { headers: { Accept: 'application/json', 'User-Agent': 'aspa-explorer-notifier' } });
  if (!r.ok) throw new Error(`invalid: HTTP ${r.status}`);
  const doc = await r.json();
  const saved = store.getState('invalid') || { generated: null, alerts: {} };
  if (saved.generated === doc.generated) return;
  const subs = store.allActive().filter((s) => s.invalid_min > 0);
  const out = dueInvalid(doc, subs, saved.alerts, Math.floor(Date.now() / 1000));
  if (out.events.length) log(`${out.events.length} alert(s) on invalid announcements`);
  for (const e of out.events) outbox.enqueue(e.sub.id, { subject: `Invalid announcements of ${e.asn}: ${e.invalid} in ten minutes`, line: describeInvalid(e), type: 'aspa.invalid',
      extra: { invalid: { announcements: e.announcements, invalid: e.invalid, prefixes: e.prefixes, from: e.from, to: e.to } },
      footer: 'Read from the stream of RIPE RIS Live every ten minutes, and checked with the ASPAs of this site. You are told at most once every six hours.' });
  store.setState('invalid', { generated: doc.generated, alerts: out.alerts });
}

// what /api/v1/subscriptions/health says: when the data was last read, and whether the last reads worked
const pulse = { lastOk: null, lastTry: null, failures: 0 };
const sources = makePulse();      // the same for each file that is read: one that is down shows in the health even when the others work
const STUCK = 12 * 3600;      // the retries of a message last about eight hours and then the subscription is switched off: older than this, the delivery is stuck
const health = () => {
  const oldest = store.outboxOldest();
  const waiting = oldest ? Math.floor(Date.now() / 1000) - oldest : 0;
  return {
  ok: pulse.lastOk !== null && pulse.failures < 3 && Date.now() - pulse.lastOk < 3 * POLL && waiting < STUCK && Object.values(sources.summary(POLL)).every((x) => x.ok),
  outbox_pending: store.outboxCount(),
  oldest_pending_seconds: waiting,
  disabled_subscriptions: store.countDisabled(),
  sources: sources.summary(POLL),
  last_poll: pulse.lastOk && new Date(pulse.lastOk).toISOString(),
  failures_in_a_row: pulse.failures,
  poll_seconds: POLL / 1000,
  };
};

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
    pulse.lastOk = Date.now(); pulse.failures = 0; sources.ok('aspas');
    if (!saved) { store.setState('committed', [...current]); store.setState('pending', {}); log(`first run: ${current.size} ASPAs taken as the starting point`); return; }
    const out = stabilise(new Map(saved), current, store.getState('pending') || {});
    if (out.events.length) { log(`${out.events.length} change(s) confirmed`); queueChanges(out.events); }
    store.setState('committed', [...out.committed]);
    store.setState('pending', out.pending);
    try { await sources.track('leaks', pollLeaks); } catch (err) { log(`leaks not read: ${err.message}`); }
    try { await sources.track('status', pollStatus); } catch (err) { log(`status not read: ${err.message}`); }
    try { await sources.track('invalid', pollInvalid); } catch (err) { log(`invalid announcements not read: ${err.message}`); }
    await outbox.drain();
  } catch (err) { pulse.failures++; sources.fail('aspas'); log(`poll failed: ${err.message}`); } finally { busy = false; }
}

// the shell of the page of a report, read from the web root and kept a minute
let tpl = { at: 0, html: null };
const template = () => {
  if (Date.now() - tpl.at > 60000) { try { tpl = { at: Date.now(), html: readFileSync(`${SITE_DIR}/report.html`, 'utf8') }; } catch (err) { tpl = { at: Date.now(), html: null }; log(`report.html not read: ${err.message}`); } }
  return tpl.html;
};
const server = http.createServer(httpHandler(api, { site: SITE, health, template }));
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(Number(env('NOTIFY_PORT', '8090')), '127.0.0.1', () => log(`listening on 127.0.0.1:${env('NOTIFY_PORT', '8090')}`));
poll();
// the clean-up does not wait for the data: if the upstream fails for days, the expired requests and reports must still go
function housekeeping() {
  try {
    const purged = store.purge(Math.floor(Date.now() / 1000) - 2 * 86400);
    if (purged) log(`${purged} unconfirmed request(s) deleted`);
    const gone = store.purgeDisabled(Math.floor(Date.now() / 1000) - 30 * 86400);
    if (gone) log(`${gone} subscription(s) switched off for more than 30 days deleted`);
    const old = store.purgeReports(Math.floor(Date.now() / 1000) - TTL_DAYS * 86400);
    if (old) log(`${old} expired report(s) deleted`);
  } catch (err) { log(`clean-up failed: ${err.message}`); }
}
housekeeping();
setInterval(housekeeping, 3600 * 1000);
setInterval(poll, POLL);
setInterval(() => outbox.drain().catch((err) => log(`outbox: ${err.message}`)), 60 * 1000);      // the messages that have to be tried again
outbox.drain().catch((err) => log(`outbox: ${err.message}`));                                       // and the ones that a restart interrupted
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { server.close(); store.close(); process.exit(0); });
