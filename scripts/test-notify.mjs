// Unit tests for the notifier (no dependencies). Run with: node scripts/test-notify.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { makeToken, readToken } from '../notifier/tokens.mjs';
import { stabilise, audience, describeEvent, newPlaces, describePlace } from '../notifier/changes.mjs';
import { isPublicIp, parseWebhookUrl, post, signature } from '../notifier/webhook.mjs';
import { sign, verify, relaxBody } from '../notifier/dkim.mjs';
import { compose, serialize, sendmail, EMAIL_RE } from '../notifier/mail.mjs';
import { openStore } from '../notifier/store.mjs';
import { makeApi, httpHandler, parseAsn, limiter } from '../notifier/server.mjs';

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

await test('addresses: which webhook targets are public', () => {
  for (const ip of ['8.8.8.8', '193.0.0.1', '2001:67c:2e8::1', '2a00:1450:4001::1']) assert.equal(isPublicIp(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', 'not an ip']) assert.equal(isPublicIp(ip), false, ip);
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

console.log(`${passed} tests passed`);
