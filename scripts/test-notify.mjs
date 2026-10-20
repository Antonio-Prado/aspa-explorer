// Unit tests for the notifier (no dependencies). Run with: node scripts/test-notify.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { makeToken, readToken } from '../notifier/tokens.mjs';
import { stabilise, audience, describeEvent, newPlaces, describePlace } from '../notifier/changes.mjs';
import { pool } from '../notifier/pool.mjs';
import { makePulse } from '../notifier/pulse.mjs';
import { makeOutbox, RETRY, MAX_FAILS } from '../notifier/outbox.mjs';
import { isPublicIp, parseWebhookUrl, post, signature } from '../notifier/webhook.mjs';
import { sign, verify, relaxBody } from '../notifier/dkim.mjs';
import { compose, serialize, sendmail, EMAIL_RE } from '../notifier/mail.mjs';
import { openStore } from '../notifier/store.mjs';
import { makeApi, httpHandler, parseAsn, limiter } from '../notifier/server.mjs';
import { dueInvalid, describeInvalid, COOLDOWN } from '../notifier/invalid.mjs';
import { checkReport, shell, headTags, newId, ID_RE, LIMITS } from '../notifier/reports.mjs';
import { watchStatus, describeStatusEvent, statusSubject, MONITOR } from '../notifier/status.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

await test('tokens: genuine, wrong purpose, tampered, salted', () => {
  const k = 'secret';
  const t = makeToken(k, 'unsub', 7);
  assert.equal(readToken(k, 'unsub', t), 7);
  assert.equal(readToken(k, 'confirm', t), null);
  assert.equal(readToken(k, 'unsub', t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(readToken('other', 'unsub', t), null);
  const c = makeToken(k, 'confirm', 3, '100');
  assert.equal(readToken(k, 'confirm', c, () => '100'), 3);
  assert.equal(readToken(k, 'confirm', c, () => '101'), null);
  assert.equal(readToken(k, 'unsub', 'garbage'), null);
});

await test('tokens: nothing in them that a mail program leaves out of a link, and the old ones are still read', async () => {
  const { createHmac } = await import('node:crypto');
  for (let id = 1; id <= 300; id++) assert.match(makeToken('k', 'confirm', id, String(1792327991 + id)), /^\d+\.[0-9a-f]{32}$/);
  const old = `7.${createHmac('sha256', 'k').update('unsub:7:').digest('base64url').slice(0, 32)}`;   // as the mails sent before 1.34.0 have it
  assert.equal(readToken('k', 'unsub', old), 7);
  assert.equal(readToken('k', 'confirm', old), null);
});

await test('addresses: which webhook targets are public', () => {
  for (const ip of ['8.8.8.8', '193.0.0.1', '2001:67c:2e8::1', '2a00:1450:4001::1']) assert.equal(isPublicIp(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', 'not an ip']) assert.equal(isPublicIp(ip), false, ip);
  // the same network in every way of writing it, and the blocks the text comparison used to miss
  for (const ip of ['2001::1', '2001:0000::1', '2001:00::1', '2001:0:0:0:0:0:0:1', '2001:0001::1', '2001:1ff::1', '2001:db8::1', '2001:0DB8:0:0::1', '2002:c000:204::1', '3fff::1', '3fff:0fff::1', '3ffe::1', '5f00::1',
    '::ffff:7f00:1', '0:0:0:0:0:ffff:10.0.0.1', '64:ff9b::1', '100::1', '0::1', 'fe80::1%eth0']) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ['2001:200::1', '2001:4860:4860::8888', '2400:cb00::1', '2606:4700::1111', '::ffff:8.8.8.8', '3fef::1', '4000::1']) assert.equal(isPublicIp(ip), ip.startsWith('4') ? false : true, ip);
  assert.equal(isPublicIp('172.32.0.1'), true);
});

await test('webhook addresses: https, host name, port', () => {
  assert.ok(parseWebhookUrl('https://hooks.example.org/aspa'));
  assert.ok(parseWebhookUrl('https://hooks.example.org:8443/x?y=1'));
  for (const bad of ['http://hooks.example.org/', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://printer.local/', 'https://user:pw@hooks.example.org/',
    'https://hooks.example.org:22/', 'https://intranet/', 'ftp://x.example.org/', 'javascript:alert(1)', 'https://hooks.example.org/#frag', '']) assert.equal(parseWebhookUrl(bad), null, bad);
});

await test('webhook post: refuses a private resolution, pins the checked address, signs the body', async () => {
  await assert.rejects(() => post('https://evil.example.org/', {}, { lookup: async () => [{ address: '10.0.0.5', family: 4 }] }), /public/);
  await assert.rejects(() => post('https://evil.example.org/', {}, { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }), /public/);
  let seen;
  const fakeRequest = (opts, cb) => {
    seen = opts;
    const handlers = {};
    const res = { statusCode: 200, setEncoding() {}, on(e, f) { handlers[e] = f; return res; }, destroy() {} };
    return { on() { return this; }, end(body) { seen.body = body; setImmediate(() => { cb(res); handlers.data('ok'); handlers.end(); }); } };
  };
  const r = await post('https://hooks.example.org/a?b=1', { hello: 1 }, { secret: 's3', lookup: async () => [{ address: '93.184.216.34', family: 4 }], request: fakeRequest });
  assert.equal(r.status, 200);
  assert.equal(seen.host, '93.184.216.34');
  assert.equal(seen.servername, 'hooks.example.org');
  assert.equal(seen.headers.Host, 'hooks.example.org');
  assert.equal(seen.path, '/a?b=1');
  assert.equal(seen.headers['X-ASPA-Signature'], signature('s3', seen.headers['X-ASPA-Timestamp'], seen.body));
});

await test('changes: a change is announced when seen twice, a flap is not', () => {
  const m = (o) => new Map(Object.entries(o));
  const committed = m({ AS1: ['AS10'], AS2: ['AS20'] });
  const gone = m({ AS1: ['AS10'] });                          // AS2 disappears for one poll
  let r = stabilise(committed, gone, {});
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.pending, { AS2: 'null' });
  r = stabilise(r.committed, committed, r.pending);           // and comes back: nothing to say
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.pending, {});
  const changed = m({ AS1: ['AS10', 'AS11'], AS2: ['AS20'], AS3: ['AS30'] });
  r = stabilise(committed, changed, {});
  assert.equal(r.events.length, 0);
  r = stabilise(r.committed, changed, r.pending);
  assert.deepEqual(r.events.map((e) => [e.customer, e.kind, e.added, e.dropped]), [['AS1', 'changed', ['AS11'], []], ['AS3', 'new', ['AS30'], []]]);
  assert.deepEqual(r.committed.get('AS1'), ['AS10', 'AS11']);
  r = stabilise(r.committed, m({ AS1: ['AS10', 'AS11'], AS3: ['AS30'] }), {});
  r = stabilise(r.committed, m({ AS1: ['AS10', 'AS11'], AS3: ['AS30'] }), r.pending);
  assert.deepEqual(r.events.map((e) => [e.customer, e.kind, e.dropped]), [['AS2', 'removed', ['AS20']]]);
});

await test('audience and descriptions', () => {
  const e = { customer: 'AS1', kind: 'changed', providers: ['AS10', 'AS11'], added: ['AS11'], dropped: ['AS12'], before: ['AS10', 'AS12'] };
  const subs = [{ id: 1, asn: 'AS1' }, { id: 2, asn: 'AS11' }, { id: 3, asn: 'AS12' }, { id: 4, asn: 'AS10' }, { id: 5, asn: 'AS99' }];
  assert.deepEqual(audience(e, subs).map((a) => [a.sub.id, a.relation]), [[1, 'own'], [2, 'provider'], [3, 'provider']]);
  assert.match(describeEvent(e, 'AS1', 'own'), /added AS11 and dropped AS12/);
  assert.match(describeEvent(e, 'AS11', 'provider'), /AS1 now lists AS11/);
  assert.match(describeEvent(e, 'AS12', 'provider'), /no longer lists AS12/);
  assert.deepEqual(audience({ customer: 'AS5', kind: 'new', providers: ['AS0'], added: ['AS0'], dropped: [] }, [{ id: 1, asn: 'AS0' }]), []);
});

await test('DKIM: the signature verifies, and breaks when the body or a header changes', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' }), priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const msg = compose({ from: 'n@aspa.example.org', to: 'a@example.com', subject: 'Hello  world', text: 'line one  \nline two\n\n\n', domain: 'aspa.example.org', unsubscribeUrl: 'https://x.example.org/u?token=1' });
  const signature = sign({ domain: 'aspa.example.org', selector: 's1', privateKey: priv, headers: msg.headers, body: msg.body });
  assert.equal(verify({ signature, headers: msg.headers, body: msg.body, publicKey: pub }), true);
  assert.equal(verify({ signature, headers: msg.headers, body: msg.body + 'x\n', publicKey: pub }), false);
  const tampered = msg.headers.map(([n, v]) => (n === 'Subject' ? [n, 'Other'] : [n, v]));
  assert.equal(verify({ signature, headers: tampered, body: msg.body, publicKey: pub }), false);
  assert.equal(relaxBody('a  b \r\n\r\n\r\n'), 'a b\r\n');
  assert.equal(relaxBody(''), '');
  const text = serialize(msg, { domain: 'aspa.example.org', selector: 's1', privateKey: priv });
  assert.match(text, /^DKIM-Signature: v=1; a=rsa-sha256;/);
  assert.doesNotMatch(text, /\r/);
});

await test('mail: addresses, headers cannot be injected, ASCII only', () => {
  assert.ok(EMAIL_RE.test('a.b+c@example.co.uk'));
  for (const bad of ['a@b', 'a b@example.com', 'a@example.com\nBcc: x@y.zz', '@example.com', 'a@@example.com', '<a@example.com>']) assert.equal(EMAIL_RE.test(bad), false, bad);
  assert.throws(() => compose({ from: 'n@x.org', to: 'a@example.com\nBcc: z@example.com', subject: 's', text: 't', domain: 'x.org' }));
  const m = compose({ from: 'n@x.org', to: 'a@example.com', subject: 'café\r\nBcc: z@example.com', text: 'ok → here\n', domain: 'x.org' });
  assert.equal(m.headers.find(([n]) => n === 'Subject')[1].includes('\n'), false);
  assert.match(m.body, /^ok \? here\n$/);
});

await test('mail: sendmail gets the envelope and the message', async () => {
  let args, written = '';
  const run = (cmd, a) => {
    args = [cmd, ...a];
    const handlers = {};
    return { stderr: { on() {} }, on(e, f) { handlers[e] = f; }, stdin: { end(m) { written = m; setImmediate(() => handlers.close(0)); } } };
  };
  await sendmail('hello', 'n@x.org', 'a@example.com', { command: '/usr/sbin/sendmail', run });
  assert.deepEqual(args, ['/usr/sbin/sendmail', '-i', '-f', 'n@x.org', '--', 'a@example.com']);
  assert.equal(written, 'hello');
});

await test('limiter: a window per key', () => {
  let t = 0;
  const l = limiter(2, 10, () => t);
  assert.deepEqual([l('a'), l('a'), l('a'), l('b')], [true, true, false, true]);
  t = 11;
  assert.equal(l('a'), true);
});

await test('AS numbers', () => {
  assert.equal(parseAsn('as3333'), 'AS3333');
  assert.equal(parseAsn('4294967295'), 'AS4294967295');
  for (const bad of ['0', '4294967296', 'AS', '-1', '12a', '', 'AS 3333x']) assert.equal(parseAsn(bad), null, bad);
});

// ---- the API with faked mail and webhook ----
const setup = (extra = {}) => {
  const store = openStore(':memory:');
  const mails = [], hooks = [];
  let clock = 1000;
  const api = makeApi({
    store, key: 'k', site: 'https://aspa.example.org', now: () => clock,
    sendConfirmation: async (m) => { mails.push(m); },
    verifyWebhook: async (url, payload, secret) => { hooks.push({ url, payload, secret }); return extra.hook ? extra.hook(payload) : { status: 200, body: JSON.stringify({ challenge: payload.challenge }) }; },
    ...extra,
  });
  return { store, api, mails, hooks, tick: (s) => { clock += s; } };
};

await test('API: e-mail subscription needs confirmation, then unsubscribe is idempotent', async () => {
  const { store, api, mails, tick } = setup();
  let r = await api.subscribe({ kind: 'email', target: 'Me@Example.com', asn: 'AS3333' }, '1.1.1.1');
  assert.equal(r.status, 202);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'me@example.com');
  assert.equal(store.allActive().length, 0);
  // the same request within the hour sends nothing new
  await api.subscribe({ kind: 'email', target: 'me@example.com', asn: 'AS3333' }, '1.1.1.1');
  assert.equal(mails.length, 1);
  assert.equal(api.confirm({ token: 'nope' }).status, 404);
  r = api.confirm({ token: mails[0].token });
  assert.deepEqual(r.body, { status: 'active', asn: 'AS3333', kind: 'email' });
  assert.equal(store.allActive().length, 1);
  // an active subscription looks exactly like a new one from outside
  tick(7200);
  r = await api.subscribe({ kind: 'email', target: 'me@example.com', asn: 'AS3333' }, '1.1.1.1');
  assert.equal(r.status, 202);
  assert.equal(mails.length, 1);
  const id = store.allActive()[0].id;
  const tok = api.unsubscribeToken(id);
  assert.equal(api.unsubscribe(tok).body.status, 'unsubscribed');
  assert.equal(store.allActive().length, 0);
  assert.equal(api.unsubscribe(tok).status, 200);
});

await test('API: a new confirmation invalidates the previous link', async () => {
  const { api, mails, tick } = setup();
  await api.subscribe({ kind: 'email', target: 'a@example.com', asn: '3333' }, '1.1.1.1');
  tick(4000);
  await api.subscribe({ kind: 'email', target: 'a@example.com', asn: '3333' }, '1.1.1.1');
  assert.equal(mails.length, 2);
  assert.equal(api.confirm({ token: mails[0].token }).status, 404);
  assert.equal(api.confirm({ token: mails[1].token }).status, 200);
});

await test('API: validation, honeypot and limits', async () => {
  const { api, mails } = setup({ perIp: limiter(3, 3600), maxPerAsn: 3 });
  assert.equal((await api.subscribe(null, 'ip')).status, 400);
  assert.equal((await api.subscribe({ kind: 'email', target: 'a@example.com', asn: 'x' }, 'ip')).status, 400);
  assert.equal((await api.subscribe({ kind: 'sms', target: '1', asn: 'AS1' }, 'ip2')).status, 400);
  assert.equal((await api.subscribe({ kind: 'email', target: 'not an address', asn: 'AS1' }, 'ip3')).status, 400);
  assert.equal((await api.subscribe({ kind: 'email', target: 'a@example.com', asn: 'AS1', website: 'http://spam' }, 'ip4')).status, 202);
  assert.equal(mails.length, 0);
  assert.equal((await api.subscribe({ kind: 'email', target: 'a@example.com', asn: 'AS9' }, 'ipx')).status, 202);
  assert.equal((await api.subscribe({ kind: 'email', target: 'b@example.com', asn: 'AS9' }, 'ipx')).status, 202);
  assert.equal((await api.subscribe({ kind: 'email', target: 'c@example.com', asn: 'AS9' }, 'ipx')).status, 202);
  assert.equal((await api.subscribe({ kind: 'email', target: 'd@example.com', asn: 'AS9' }, 'ipx')).status, 429);   // per IP: 3 an hour
  for (const m of mails) api.confirm({ token: m.token });                                                            // the limit of an AS is on the working ones
  assert.equal((await api.subscribe({ kind: 'email', target: 'd@example.com', asn: 'AS9' }, 'ipy')).status, 429);   // per AS: 3
});

await test('API: webhook is active only after it repeats the challenge', async () => {
  const { store, api, hooks } = setup();
  let r = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.2');
  assert.equal(r.status, 201);
  assert.match(r.body.secret, /^whsec_[0-9a-f]{48}$/);
  assert.equal(hooks[0].payload.type, 'verification');
  assert.equal(store.allActive().length, 1);
  assert.equal(store.allActive()[0].secret, r.body.secret);
  r = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.2');
  assert.equal(r.status, 409);
  assert.equal((await api.subscribe({ kind: 'webhook', target: 'http://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.2')).status, 400);
  assert.equal((await api.subscribe({ kind: 'webhook', target: 'https://10.0.0.1/in', asn: 'AS3333' }, '2.2.2.2')).status, 400);
});

await test('API: a webhook that does not answer the challenge is not kept', async () => {
  const { store, api } = setup({ hook: async () => ({ status: 200, body: 'thanks' }) });
  const r = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '3.3.3.3');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /challenge/);
  assert.equal(store.counts().length, 0);
  const down = setup({ hook: async () => { throw new Error('timeout'); } });
  assert.equal((await down.api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '3.3.3.3')).status, 400);
  assert.equal(down.store.counts().length, 0);
});

await test('store: unconfirmed requests are purged, failures counted', () => {
  const s = openStore(':memory:');
  const a = s.insert('email', 'a@example.com', 'AS1', null, 100);
  const b = s.insert('email', 'b@example.com', 'AS1', null, 1000);
  s.activate(b, 1001);
  assert.equal(s.purge(500), 1);
  assert.equal(s.get(a), null);
  s.failed(b); s.failed(b);
  assert.equal(s.get(b).fails, 2);
  s.sent(b, 2000);
  assert.equal(s.get(b).fails, 0);
  s.setState('x', { a: [1, 2] });
  assert.deepEqual(s.getState('x'), { a: [1, 2] });
  assert.equal(s.getState('missing'), null);
});

await test('HTTP: methods, content types, origin, one-click unsubscribe', async () => {
  const { store, api, mails } = setup();
  const server = http.createServer(httpHandler(api, { site: 'https://aspa.example.org' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, opts = {}) => { const r = await fetch(base + path, opts); return [r.status, await r.json()]; };
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await call('/api/v1/subscriptions'))[0], 405);
  assert.equal((await call('/api/v1/subscriptions/health'))[0], 405);   // no health function given: not exposed
  assert.equal((await call('/api/v1/subscriptions', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }))[0], 415);
  assert.equal((await call('/api/v1/subscriptions', { method: 'POST', headers: json, body: '{bad' }))[0], 400);
  assert.equal((await call('/api/v1/subscriptions', { method: 'POST', headers: { ...json, Origin: 'https://evil.example.com' }, body: '{}' }))[0], 403);
  assert.equal((await call('/api/v1/subscriptions', { method: 'POST', headers: json, body: 'x'.repeat(5000) }))[0], 413);
  assert.equal((await call('/api/v1/nothing', { method: 'POST', headers: json, body: '{}' }))[0], 404);
  const [st] = await call('/api/v1/subscriptions', { method: 'POST', headers: { ...json, Origin: 'https://aspa.example.org' }, body: JSON.stringify({ kind: 'email', target: 'z@example.com', asn: 'AS1' }) });
  assert.equal(st, 202);
  assert.equal((await call('/api/v1/subscriptions/confirm', { method: 'POST', headers: json, body: JSON.stringify({ token: mails[0].token }) }))[0], 200);
  const id = store.allActive()[0].id;
  const [s2, b2] = await call(`/api/v1/subscriptions/unsubscribe?token=${api.unsubscribeToken(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  assert.equal(s2, 200);
  assert.equal(b2.status, 'unsubscribed');
  assert.equal(store.allActive().length, 0);
  await new Promise((r) => server.close(r));
});

await test('HTTP: the health answer, when a function is given', async () => {
  const { api } = setup();
  const server = http.createServer(httpHandler(api, { site: 'https://aspa.example.org', health: () => ({ ok: true, last_poll: 'x' }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/subscriptions/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, last_poll: 'x' });
  await new Promise((res) => server.close(res));
});

await test('places of valley: a baseline first, then only the new ones, only for the ASes asked', () => {
  const place = (from, between, feeders = 5) => ({ role: 'valley', kind: 'leak', from, to: 'AS9', between, feeders, routes: 10 });
  const doc1 = { AS2: [place('AS1', ['AS2'])], AS7: [place('AS1', ['AS7'])] };
  let r = newPlaces(doc1, ['AS2', 'AS3'], null);
  assert.deepEqual(r.events, []);                                    // the first build only sets the baseline
  assert.deepEqual(Object.keys(r.seen).sort(), ['AS2', 'AS3']);      // nothing kept for AS7: nobody asked
  const doc2 = { AS2: [place('AS1', ['AS2']), place('AS4', ['AS2', 'AS5'])], AS3: [place('AS1', ['AS3'])] };
  r = newPlaces(doc2, ['AS2', 'AS3'], r.seen);
  assert.deepEqual(r.events.map((e) => [e.asn, e.from]), [['AS2', 'AS4'], ['AS3', 'AS1']]);
  assert.equal(newPlaces(doc2, ['AS2', 'AS3'], r.seen).events.length, 0);   // the same build again says nothing
  assert.equal(newPlaces(doc2, ['AS8'], r.seen).events.length, 0);          // an AS that is new to the list gets a baseline
});

await test('places of valley: the descriptions say leak or gap in plain words', () => {
  const v = describePlace({ asn: 'AS2', role: 'valley', kind: 'leak', from: 'AS1', to: 'AS9', between: ['AS2', 'AS3'], feeders: 5, routes: 10 });
  assert.match(v, /AS2 sits inside a valley between AS1 and AS9/);
  assert.match(v, /peer or a customer/);
  const g = describePlace({ asn: 'AS1', role: 'gap', kind: 'gap', from: 'AS1', to: 'AS9', between: ['AS4'], feeders: 4, routes: 8 });
  assert.match(g, /does not seem to list AS4/);
  assert.match(describePlace({ asn: 'AS2', role: 'valley', kind: 'gap', from: 'AS1', to: 'AS9', between: ['AS2'], feeders: 3, routes: 3 }), /misses a provider/);
});

await test('API: the request for places of valley is kept, only as an explicit true', async () => {
  const { store, api, mails } = setup();
  await api.subscribe({ kind: 'email', target: 'a@example.com', asn: 'AS1', leaks: true }, '1.1.1.1');
  await api.subscribe({ kind: 'email', target: 'b@example.com', asn: 'AS1', leaks: 'yes' }, '1.1.1.2');
  assert.equal(mails[0].leaks, true);
  assert.equal(mails[1].leaks, false);
  assert.equal(store.find('email', 'a@example.com', 'AS1').leaks, 1);
  assert.equal(store.find('email', 'b@example.com', 'AS1').leaks, 0);
  await api.subscribe({ kind: 'email', target: 'b@example.com', asn: 'AS1', leaks: true }, '1.1.1.3');   // a pending request can change its mind (not within the hour: ignored)
  const w = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/x', asn: 'AS2', leaks: true }, '1.1.1.4');
  assert.equal(w.body.leaks, true);
});

// ---- the alerts on the state of the service ----
const T0 = 1_000_000;
const hist = (rows) => ({
  interval: 900,
  checks: [{ id: 'validator', name: 'Validator', expected: 'every 10 minutes' }, { id: 'leaks', name: 'Leaks', expected: 'every day' }],
  samples: rows.map((r, i) => [T0 + 900 * i, r]),
});
const run = (doc, saved, now = doc.samples[doc.samples.length - 1][0] + 60) => watchStatus(doc, saved, now);

await test('status alerts: the first run only takes note', () => {
  const r = run(hist(['od', 'od', 'ol']), null);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.saved.committed, { validator: 'o', leaks: 'l', monitor: 'o' });
});

await test('status alerts: a change counts after two samples in a row, once', () => {
  let r = run(hist(['oo']), null);
  r = run(hist(['oo', 'lo']), r.saved);                       // seen once: not yet
  assert.deepEqual(r.events, []);
  r = run(hist(['oo', 'lo', 'lo']), r.saved);                 // seen twice: announced
  assert.equal(r.events.length, 1);
  assert.deepEqual([r.events[0].id, r.events[0].from, r.events[0].to, r.events[0].at], ['validator', 'o', 'l', T0 + 1800]);
  r = run(hist(['oo', 'lo', 'lo', 'lo']), r.saved);           // still late: nothing more
  assert.deepEqual(r.events, []);
});

await test('status alerts: a single bad sample is not announced, and the way back is', () => {
  let r = run(hist(['oo']), null);
  r = run(hist(['oo', 'do', 'oo', 'oo']), r.saved);
  assert.deepEqual(r.events, []);
  r = run(hist(['oo', 'do', 'oo', 'oo', 'dd', 'dd']), r.saved);
  assert.deepEqual(r.events.map((e) => [e.id, e.to]), [['validator', 'd'], ['leaks', 'd']]);
  r = run(hist(['oo', 'do', 'oo', 'oo', 'dd', 'dd', 'od', 'od']), r.saved);
  assert.deepEqual(r.events.map((e) => [e.id, e.from, e.to]), [['validator', 'd', 'o']]);
  assert.equal(r.events[0].since, T0 + 3600 + 900);           // down since the moment it was announced
});

await test('status alerts: the same samples are not read twice, a part that is not checked is ignored', () => {
  let r = run(hist(['oo']), null);
  r = run(hist(['oo', 'l-', 'l-']), r.saved);
  assert.deepEqual(r.events.map((e) => e.id), ['validator']);
  r = run(hist(['oo', 'l-', 'l-']), r.saved);
  assert.deepEqual(r.events, []);
  assert.equal(r.saved.committed.leaks, 'o');
});

await test('status alerts: a monitor that stopped writing is told, twice in a row like the rest', () => {
  const doc = hist(['oo', 'oo']);
  let r = run(doc, null);
  r = watchStatus(doc, r.saved, T0 + 900 + 3 * 900 + 10);      // 45 minutes and some without a sample: first sight
  assert.deepEqual(r.events, []);
  r = watchStatus(doc, r.saved, T0 + 900 + 3 * 900 + 610);
  assert.deepEqual(r.events.map((e) => [e.id, e.to]), [[MONITOR.id, 'd']]);
  assert.match(describeStatusEvent(r.events[0]), /not being watched/);
  r = watchStatus(hist(['oo', 'oo', 'oo']), r.saved, T0 + 1800 + 60);
  assert.deepEqual(r.events, []);                              // one good reading is not enough yet
  r = watchStatus(hist(['oo', 'oo', 'oo']), r.saved, T0 + 1800 + 660);
  assert.deepEqual(r.events.map((e) => [e.id, e.to]), [[MONITOR.id, 'o']]);
});

await test('status alerts: words and subject', () => {
  const down = { id: 'leaks', name: 'Leaks', expected: 'every day', from: 'o', to: 'd', at: 1_700_000_000, since: null };
  assert.match(describeStatusEvent(down), /^Leaks: now down \(was OK\) since 2023-11-14 22:13:20 UTC\. It should be updated every day\.$/);
  const back = { ...down, from: 'd', to: 'o', since: 1_700_000_000 - 4500 };
  assert.match(describeStatusEvent(back), /^Leaks: back to OK after 75 minutes \(/);
  assert.equal(statusSubject([down]), 'ASPA Explorer status: Leaks down');
  assert.equal(statusSubject([back]), 'ASPA Explorer: Leaks is back to OK');
  assert.equal(statusSubject([down, { ...down, id: 'api', name: 'API', to: 'l' }]), 'ASPA Explorer status: Leaks down');
});

await test('API: a subscription to the status alerts, not to an AS', async () => {
  const { store, api, mails } = setup();
  const r = await api.subscribe({ kind: 'email', target: 'ops@example.com', topic: 'status', leaks: true }, '3.3.3.3');
  assert.equal(r.status, 202);
  assert.equal(mails[0].asn, 'STATUS');
  const row = store.find('email', 'ops@example.com', 'STATUS');
  assert.equal(row.leaks, 0);
  assert.equal((await api.subscribe({ kind: 'email', target: 'ops@example.com', asn: 'STATUS' }, '3.3.3.4')).status, 400);   // "STATUS" is not an AS number
  const w = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/s', topic: 'status' }, '3.3.3.5');
  assert.equal(w.status, 201);
  assert.equal(w.body.asn, 'STATUS');
});

// ---- shared results ----
const goodReport = () => ({ kind: 'path', title: 'AS path 3356 1299 680: Valid', source: '/#path=3356+1299+680&from=down', sections: [{ heading: 'Verdict', text: 'Valid.' }, { heading: 'Hops', table: { columns: ['Hop', 'Check'], rows: [['AS680 → AS1299', ['AS680 lists AS1299', 'provider']], ['AS1299 → AS3356', 'ok']] } }] });

await test('reports: a good one is kept as it is, with the classes of its cells', () => {
  const c = checkReport(goodReport());
  assert.equal(c.error, undefined);
  assert.deepEqual(c.report.sections[1].table.rows[0], ['AS680 → AS1299', ['AS680 lists AS1299', 'provider']]);
  assert.equal(c.report.source, '/#path=3356+1299+680&from=down');
});

await test('reports: what is not understood is refused or dropped', () => {
  const bad = (f, re) => { const r = goodReport(); f(r); assert.match(checkReport(r).error, re); };
  assert.match(checkReport(null).error, /JSON object/);
  bad((r) => { r.kind = 'script'; }, /kind must be/);
  bad((r) => { r.title = '   '; }, /title/);
  bad((r) => { r.sections = []; }, /sections/);
  bad((r) => { r.source = 'https://evil.example/'; }, /on this site/);
  bad((r) => { r.source = '//evil.example/x'; }, /on this site/);
  bad((r) => { r.sections[1].table.rows[0] = ['one cell only']; }, /as many cells/);
  bad((r) => { r.sections[1].table.rows[0][1] = ['x', 'blink']; }, /class/);
  bad((r) => { r.sections[1].table.rows = Array.from({ length: LIMITS.rows + 1 }, () => ['a', 'b']); }, /rows/);
  const long = goodReport(); long.title = 'x'.repeat(500); long.sections[0].text = '<b>hi</b>\u202e';
  const c = checkReport(long);
  assert.equal(c.report.title.length, LIMITS.title);
  assert.equal(c.report.sections[0].text, '<b>hi</b>');                     // kept as text (the viewer never reads it as markup), without the control character
  const big = goodReport(); big.sections = Array.from({ length: 12 }, () => ({ text: 'y'.repeat(LIMITS.text) })); big.sections.push(...[]);
  assert.equal(checkReport(big).error, undefined);
});

await test('reports: the tags of the head are escaped and replace the ones between the markers', () => {
  const r = goodReport(); r.title = 'A "quoted" <title>'; r.sections[0].text = 'Valid & sound';
  const out = shell('<head><!--og-->\n<title>x</title>\n<!--/og-->\n<meta name="robots" content="noindex"></head>', 'abcdef012345', checkReport(r).report, 'https://aspa.example.org');
  assert.match(out, /<title>Unverified report: A &quot;quoted&quot; &lt;title&gt; · ASPA Explorer<\/title>/);
  assert.match(out, /og:description" content="Unverified report shared by a visitor. Valid &amp; sound"/);
  assert.match(out, /og:url" content="https:\/\/aspa.example.org\/r\/abcdef012345"/);
  assert.match(out, /<meta name="robots" content="noindex">/);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.match(newId(), ID_RE);
});

await test('API: a report is made, read back and refused when it is bad; the limits hold', async () => {
  const { api, tick, store } = setup({ perIpReport: limiter(2, 3600, () => 0) });
  const made = api.createReport(goodReport(), '1.1.1.1');
  assert.equal(made.status, 201);
  assert.match(made.body.id, ID_RE);
  assert.equal(made.body.url, `https://aspa.example.org/r/${made.body.id}`);
  const got = api.getReport(made.body.id);
  assert.equal(got.status, 200);
  assert.equal(got.body.title, 'AS path 3356 1299 680: Valid');
  assert.equal(got.body.expires.slice(0, 4), '1970');
  assert.equal(api.getReport('nothex').status, 404);
  assert.equal(api.getReport('0123456789ab').status, 404);
  assert.equal(api.createReport({ kind: 'path' }, '1.1.1.1').status, 400);
  assert.equal(api.createReport(goodReport(), '1.1.1.1').status, 201);
  assert.equal(api.createReport(goodReport(), '1.1.1.1').status, 429);      // two an hour from one address
  assert.equal(store.purgeReports(5000), 2);                                 // purged when old enough
  assert.equal(api.getReport(made.body.id).status, 404);
  const { api: small } = setup({ maxReports: 1 });
  assert.equal(small.createReport(goodReport(), '2.2.2.2').status, 201);
  assert.equal(small.createReport(goodReport(), '2.2.2.3').status, 503);
  const one = Buffer.byteLength(JSON.stringify(checkReport(goodReport()).report));
  const { api: tiny, store: tinyStore } = setup({ maxReportBytes: one + 10 });
  assert.equal(tiny.createReport(goodReport(), '3.3.3.3').status, 201);
  assert.ok(tinyStore.reportBytes() > 0);
  assert.equal(tiny.createReport(goodReport(), '3.3.3.4').status, 503);      // the bytes kept count, not only the number
  // bytes, not characters: 100 emoji are 100 characters and 400 bytes
  const wide = openStore(':memory:'); wide.addReport('aaaaaaaaaaaa', 1, 'path', 't', '😀'.repeat(100));
  assert.equal(wide.reportBytes(), 400);
  const { api: room, store: roomStore } = setup({ maxReportBytes: 600 });
  assert.equal(room.createReport(goodReport(), '4.4.4.4').status, 201);
  roomStore.addReport('bbbbbbbbbbbb', 1, 'path', 't', 'x'.repeat(Math.max(0, 550 - roomStore.reportBytes())));
  assert.equal(room.createReport(goodReport(), '4.4.4.5').status, 503);      // the one that arrives counts too
});

await test('HTTP: POST /api/v1/reports, GET as JSON and as a page', async () => {
  const { api } = setup();
  const server = http.createServer(httpHandler(api, { site: 'https://aspa.example.org', template: () => '<head><!--og-->\n<title>x</title>\n<!--/og--></head><body>shell</body>' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/api/v1/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const r = await post(goodReport());
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const j = await fetch(`${base}/api/v1/reports/${id}`);
  assert.equal(j.status, 200);
  assert.match(j.headers.get('cache-control'), /max-age/);
  assert.equal((await j.json()).kind, 'path');
  const page = await fetch(`${base}/r/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex');
  assert.match(await page.text(), /<title>Unverified report: AS path 3356 1299 680: Valid · ASPA Explorer<\/title>[\s\S]*shell/);
  assert.equal((await fetch(`${base}/r/ffffffffffff`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/reports/ffffffffffff`)).status, 404);
  assert.equal((await post(goodReport(), { Origin: 'https://evil.example' })).status, 403);
  server.close();
});

await test('pool: runs a few jobs at a time, finishes all of them, and a job that throws does not stop the rest', async () => {
  let running = 0, peak = 0, done = 0; const errors = [];
  const jobs = Array.from({ length: 20 }, (_, i) => async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--; done++;
    if (i === 3) throw new Error('boom');
  });
  await pool(jobs, 4, (e) => errors.push(e.message));
  assert.equal(done, 20);
  assert.equal(peak, 4);
  assert.deepEqual(errors, ['boom']);
  await pool([], 4);
});

await test('API: a disabled e-mail subscription is asked again, and it works only after the new confirmation', async () => {
  const { store, api, mails, tick } = setup();
  await api.subscribe({ kind: 'email', target: 'me@example.com', asn: 'AS3333' }, '1.1.1.1');
  api.confirm({ token: mails[0].token });
  const id = store.allActive()[0].id;
  store.disable(id);
  assert.equal(store.get(id).status, 'disabled');
  tick(7200);
  assert.equal((await api.subscribe({ kind: 'email', target: 'me@example.com', asn: 'AS3333' }, '1.1.1.2')).status, 202);
  assert.equal(store.get(id).status, 'pending');                  // asked again, not working yet
  assert.equal(store.allActive().length, 0);
  assert.equal(api.confirm({ token: mails[1].token }).status, 200);
  assert.equal(store.get(id).status, 'active');
  assert.equal(store.get(id).fails, 0);
});

await test('API: the limit of an AS counts the working subscriptions, and the unconfirmed ones have limits of their own', async () => {
  const { store, api } = setup({ maxPerAsn: 2, maxPendingPerAsn: 3, maxPending: 4, perIp: () => true, global: () => true });
  for (let i = 0; i < 3; i++) assert.equal((await api.subscribe({ kind: 'email', target: `p${i}@example.com`, asn: 'AS3333' }, `9.9.9.${i}`)).status, 202);
  assert.equal(store.countAsn('AS3333'), 0);                       // three waiting, none working
  assert.equal((await api.subscribe({ kind: 'email', target: 'p3@example.com', asn: 'AS3333' }, '9.9.9.9')).status, 503);   // too many waiting for this AS
  assert.equal((await api.subscribe({ kind: 'email', target: 'q0@example.com', asn: 'AS3334' }, '9.9.8.1')).status, 202);
  assert.equal((await api.subscribe({ kind: 'email', target: 'q1@example.com', asn: 'AS3335' }, '9.9.8.2')).status, 503);   // too many waiting in all
  const ids = store.allActive();
  assert.equal(ids.length, 0);
});

const outboxSetup = (send) => {
  const store = openStore(':memory:');
  let clock = 1000;
  const logs = [];
  const id = store.insert('webhook', 'https://hook.example.org/x', 'AS3333', 's', clock, 0, 0); store.activate(id, clock);
  const outbox = makeOutbox({ store, send, log: (m) => logs.push(m), now: () => clock });
  return { store, outbox, id, logs, tick: (n) => { clock += n; } };
};

await test('outbox: a message that went is deleted, and the messages of one subscription go out in order', async () => {
  const seen = [];
  const { store, outbox, id } = outboxSetup(async (sub, job) => { seen.push(job.n); });
  for (const n of [1, 2, 3]) outbox.enqueue(id, { n });
  assert.equal(store.outboxCount(), 3);
  await outbox.drain();
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(store.outboxCount(), 0);
  assert.equal(store.get(id).last_sent, 1000);
});

await test('outbox: a failure keeps the message, waits, tries again, and the ones behind it wait too', async () => {
  let up = false; const seen = [];
  const { store, outbox, id, tick } = outboxSetup(async (sub, job) => { if (!up) throw new Error('down'); seen.push(job.n); });
  outbox.enqueue(id, { n: 1 }); outbox.enqueue(id, { n: 2 });
  await outbox.drain();
  assert.equal(store.outboxCount(), 2);                            // nothing lost
  assert.equal(store.get(id).fails, 1);
  await outbox.drain();                                            // too early: not tried again
  assert.equal(store.get(id).fails, 1);
  up = true; tick(RETRY[0] + 1);
  await outbox.drain();
  assert.deepEqual(seen, [1, 2]);                                  // in order, after the retry
  assert.equal(store.outboxCount(), 0);
  assert.equal(store.get(id).fails, 0);                            // a delivery that works clears the count
  assert.equal(store.get(id).status, 'active');
});

await test('outbox: a new message does not overtake one that is waiting to be tried again', async () => {
  const delivered = []; let first = true;
  const { outbox, id, tick } = outboxSetup(async (sub, job) => { if (job.n === 1 && first) { first = false; throw new Error('temporary'); } delivered.push(job.n); });
  outbox.enqueue(id, { n: 1 });
  await outbox.drain();
  tick(1);
  outbox.enqueue(id, { n: 2 });
  await outbox.drain();
  assert.deepEqual(delivered, []);                                 // 2 waits for 1
  tick(RETRY[0]);
  await outbox.drain();
  assert.deepEqual(delivered, [1, 2]);
});

await test('outbox: the row is given to the sender, and its id is the same in every attempt', async () => {
  const ids = []; let n = 0;
  const { outbox, id, tick } = outboxSetup(async (sub, job, row) => { ids.push(row.id); if (++n === 1) throw new Error('once'); });
  outbox.enqueue(id, { a: 1 });
  await outbox.drain(); tick(RETRY[0] + 1); await outbox.drain();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

await test('API: the limit of an AS is checked again at the confirmation', async () => {
  const { store, api, mails } = setup({ maxPerAsn: 1, perIp: () => true, global: () => true });
  await api.subscribe({ kind: 'email', target: 'a@example.com', asn: 'AS7' }, '1.1.1.1');
  await api.subscribe({ kind: 'email', target: 'b@example.com', asn: 'AS7' }, '1.1.1.2');
  assert.equal(api.confirm({ token: mails[0].token }).status, 200);
  assert.equal(api.confirm({ token: mails[1].token }).status, 429);          // the place was taken while it waited
  assert.equal(store.countAsn('AS7'), 1);
});

await test('API: the subscriptions that are switched off do not count for the limit of an address, and they are deleted after thirty days', async () => {
  const { store, api } = setup({ perIp: () => true, global: () => true });
  for (let i = 0; i < 20; i++) { const id = store.insert('email', 'me@example.com', `AS${100 + i}`, null, 1000, 0, 0); store.activate(id, 1000); store.disable(id); }
  assert.equal(store.countTarget('email', 'me@example.com'), 0);
  assert.equal((await api.subscribe({ kind: 'email', target: 'me@example.com', asn: 'AS3333' }, '1.1.1.1')).status, 202);
  assert.equal(store.countTarget('email', 'me@example.com'), 1);           // it is a new subscription: it was not refused for the 20 that do not work
  assert.equal(store.purgeDisabled(1000 + 30 * 86400 + 1), 20);
  assert.equal(store.countTarget('email', 'me@example.com'), 1);           // the one that is waiting stays
});

await test('API: two verifications of the same webhook and AS do not run together', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { store, api } = setup({ perIp: () => true, global: () => true, verifyWebhook: async (url, payload) => { await gate; return { status: 200, body: JSON.stringify({ challenge: payload.challenge }) }; } });
  const first = api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.2');
  const second = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.3');
  assert.equal(second.status, 409);                                        // the first one is still being checked
  release();
  const r = await first;
  assert.equal(r.status, 201);
  assert.equal(store.allActive().length, 1);
  // and a failed check removes only its own record, once it is over the same address can try again
  const { store: s2, api: a2 } = setup({ perIp: () => true, global: () => true, verifyWebhook: async () => ({ status: 500, body: '' }) });
  assert.equal((await a2.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.2')).status, 400);
  assert.equal((await a2.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/in', asn: 'AS3333' }, '2.2.2.3')).status, 400);
  assert.equal(s2.countAsn('AS3333'), 0);
});

await test('pulse: each source has its own count, and one that is down shows although the others work', () => {
  let t = 1000000;
  const p = makePulse(['aspas', 'invalid'], () => t);
  p.ok('aspas'); p.ok('invalid');
  assert.equal(p.summary(600000).invalid.ok, true);
  p.fail('invalid'); p.fail('invalid');
  assert.equal(p.summary(600000).invalid.ok, true);                        // two in a row is not yet down
  p.fail('invalid');
  const s = p.summary(600000);
  assert.equal(s.invalid.ok, false);
  assert.equal(s.invalid.failures_in_a_row, 3);
  assert.equal(s.aspas.ok, true);
  p.ok('invalid');
  assert.equal(p.summary(600000).invalid.ok, true);                        // read well again
  t += 3 * 600000 + 1;
  assert.equal(p.summary(600000).aspas.ok, false);                         // not read for three rounds
  assert.equal(makePulse(['x']).summary(1).x.ok, false);                   // never read
});

await test('pulse: track counts the failure and gives the error back', async () => {
  const p = makePulse(['leaks']);
  assert.equal(await p.track('leaks', async () => 7), 7);
  await assert.rejects(() => p.track('leaks', async () => { throw new Error('no file'); }), /no file/);
  assert.equal(p.get('leaks').failures, 1);
});

await test('outbox: after five failures the subscription is disabled and its messages are dropped; a message that arrives later does not wake it', async () => {
  const { store, outbox, id, tick } = outboxSetup(async () => { throw new Error('down'); });
  outbox.enqueue(id, { n: 1 });
  for (let i = 0; i < MAX_FAILS; i++) { await outbox.drain(); tick(RETRY[RETRY.length - 1] + 1); }
  assert.equal(store.get(id).status, 'disabled');
  assert.equal(store.outboxCount(), 0);
  outbox.enqueue(id, { n: 2 });
  await outbox.drain();
  assert.equal(store.outboxCount(), 0);                            // dropped, not sent
  assert.equal(store.get(id).status, 'disabled');
});

await test('outbox: old messages are dropped, an unsubscribed one is cleaned, and the subscriptions go on in parallel', async () => {
  const seen = []; let running = 0, peak = 0;
  const { store, outbox, id, tick } = outboxSetup(async (sub, job) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; seen.push([sub.id, job.n]); });
  outbox.enqueue(id, { n: 'old' });
  tick(2 * 86400 + 1);
  outbox.enqueue(id, { n: 'new' });
  const ids = [id];
  for (let i = 0; i < 5; i++) { const x = store.insert('webhook', `https://h${i}.example.org/x`, 'AS3333', 's', 1000, 0, 0); store.activate(x, 1000); ids.push(x); outbox.enqueue(x, { n: i }); }
  const gone = store.insert('webhook', 'https://gone.example.org/x', 'AS3333', 's', 1000, 0, 0); store.activate(gone, 1000); outbox.enqueue(gone, { n: 'x' }); store.remove(gone);
  await outbox.drain();
  assert.deepEqual(seen.filter(([i]) => i === id).map(([, n]) => n), ['new']);   // the old one was not sent
  assert.equal(seen.length, 6);
  assert.ok(peak > 1);
  assert.equal(store.outboxCount(), 0);
});

// ---- alerts on invalid announcements ----
const lastDoc = () => ({ generated: '2026-10-18T12:00:00Z', from: '2026-10-18T11:51:00Z', to: '2026-10-18T12:00:00Z', min: 5, origins: { AS100: { invalid: 30, announcements: 300, prefixes: [{ prefix: '192.0.2.0/24', invalid: 20 }, { prefix: '198.51.100.0/24', invalid: 10 }] }, AS200: { invalid: 6, announcements: 10, prefixes: [] } } });
const isub = (id, asn, min) => ({ id, asn, invalid_min: min });

await test('invalid alerts: sent when the threshold is reached, once for six hours, and only to those who asked', () => {
  const subs = [isub(1, 'AS100', 10), isub(2, 'AS100', 50), isub(3, 'AS200', 5), isub(4, 'AS200', 0), isub(5, 'AS300', 5)];
  let r = dueInvalid(lastDoc(), subs, {}, 10000);
  assert.deepEqual(r.events.map((e) => e.sub.id), [1, 3]);               // 2: 30 < 50, 4: no threshold, 5: not in the file
  assert.deepEqual(r.alerts, { 1: 10000, 3: 10000 });
  r = dueInvalid(lastDoc(), subs, r.alerts, 10000 + 600);
  assert.deepEqual(r.events, []);                                        // the next run, still there: not again
  r = dueInvalid(lastDoc(), subs, r.alerts, 10000 + COOLDOWN);
  assert.deepEqual(r.events.map((e) => e.sub.id), [1, 3]);               // six hours later, again
  assert.deepEqual(dueInvalid(lastDoc(), subs, { 9: 1 }, 10 * COOLDOWN).alerts, { 1: 10 * COOLDOWN, 3: 10 * COOLDOWN });   // old marks are forgotten
  assert.deepEqual(dueInvalid({}, subs, {}, 1).events, []);
  assert.deepEqual(dueInvalid(null, subs, {}, 1).events, []);
});

await test('invalid alerts: the words', () => {
  const [e] = dueInvalid(lastDoc(), [isub(1, 'AS100', 10)], {}, 1).events;
  const t = describeInvalid(e);
  assert.match(t, /^AS100 was the origin of 30 announcements that the ASPAs prove invalid \(10% of its 300\)/);
  assert.match(t, /192\.0\.2\.0\/24 \(20\), 198\.51\.100\.0\/24 \(10\)/);
  assert.match(describeInvalid({ asn: 'AS1', invalid: 5, announcements: 0, prefixes: [], from: 'a', to: 'b' }), /^AS1 was the origin of 5 announcements that the ASPAs prove invalid, seen/);
});

await test('API: the threshold is kept only as a whole number in range, for an AS', async () => {
  const { store, api, mails } = setup();
  await api.subscribe({ kind: 'email', target: 'a@example.com', asn: 'AS1', invalid: 50 }, '4.4.4.1');
  assert.equal(mails[0].invalid, 50);
  assert.equal(store.find('email', 'a@example.com', 'AS1').invalid_min, 50);
  for (const bad of [4, 100001, 7.5, '10', true]) assert.equal((await api.subscribe({ kind: 'email', target: 'b@example.com', asn: 'AS1', invalid: bad }, '4.4.4.2')).status, 400, String(bad));
  assert.equal((await api.subscribe({ kind: 'email', target: 'c@example.com', topic: 'status', invalid: 10 }, '4.4.4.3')).status, 400);
  await api.subscribe({ kind: 'email', target: 'd@example.com', asn: 'AS1' }, '4.4.4.4');
  assert.equal(store.find('email', 'd@example.com', 'AS1').invalid_min, 0);
  const w = await api.subscribe({ kind: 'webhook', target: 'https://hooks.example.org/i', asn: 'AS2', invalid: 5 }, '4.4.4.5');
  assert.equal(w.body.invalid, 5);
});

console.log(`${passed} tests passed`);
