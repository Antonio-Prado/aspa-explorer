// The HTTP side of the notifier, behind nginx on the loopback interface:
//   POST /api/v1/subscriptions               {kind: "email"|"webhook", target, asn, leaks?: true, invalid?: 5..100000}  or  {kind, target, topic: "status"}
//   POST /api/v1/subscriptions/confirm       {token}
//   POST /api/v1/subscriptions/unsubscribe   {token}   (also ?token= with a form body, for List-Unsubscribe-Post)
// Everything the handlers need from outside is passed in, so the tests can fake it.
import { randomBytes } from 'node:crypto';
import { makeToken, readToken } from './tokens.mjs';
import { EMAIL_RE } from './mail.mjs';
import { parseWebhookUrl } from './webhook.mjs';
import { MIN_THRESHOLD, MAX_THRESHOLD } from './invalid.mjs';
import { checkReport, newId, shell, ID_RE, TTL_DAYS } from './reports.mjs';

const MAX_AS = 4294967295;
export const STATUS = 'STATUS';
const HOUR = 3600;

export const parseAsn = (v) => {
  const m = /^(?:AS)?([1-9]\d{0,9})$/i.exec(String(v).trim());
  return m && Number(m[1]) <= MAX_AS ? 'AS' + Number(m[1]) : null;
};

// A sliding counter per key, in memory (restarting the service forgets it, which is harmless).
export function limiter(max, windowSec, now = () => Date.now() / 1000) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowSec);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    if (hits.size > 50000) hits.clear();
    return true;
  };
}

export function makeApi(deps) {
  const { store, key, site, sendConfirmation, verifyWebhook, now = () => Math.floor(Date.now() / 1000) } = deps;
  const perIp = deps.perIp || limiter(10, HOUR);
  const global = deps.global || limiter(400, HOUR);
  const MAX_PER_TARGET = deps.maxPerTarget || 20, MAX_PER_ASN = deps.maxPerAsn || 500;
  const verifying = new Set();
  const MAX_PENDING_PER_ASN = deps.maxPendingPerAsn || 100, MAX_PENDING = deps.maxPending || 5000;

  const confirmSalt = (id) => { const r = store.get(id); return r ? String(r.attempted) : ''; };
  const confirmToken = (row) => makeToken(key, 'confirm', row.id, String(row.attempted));
  const unsubscribeToken = (id) => makeToken(key, 'unsub', id);
  const unsubscribeUrl = (id) => `${site}/api/v1/subscriptions/unsubscribe?token=${unsubscribeToken(id)}`;

  const reply = (status, body) => ({ status, body });
  const bad = (msg, status = 400) => reply(status, { error: msg });

  async function subscribe(body, ip) {
    if (!body || typeof body !== 'object') return bad('send a JSON object');
    if (body.website) return reply(202, { status: 'pending' });                       // honeypot field: bots fill it
    // topic "status": the state of the parts of the service, kept as a subscription for the made-up AS "STATUS"
    const status = body.topic === 'status';
    const asn = status ? STATUS : parseAsn(body.asn);
    if (!asn) return bad('asn must be an AS number such as AS3333 (1 to 4294967295), or topic "status"');
    if (!perIp(ip) ) return bad('too many requests from this address, try again later', 429);
    const kind = body.kind;
    const leaks = body.leaks === true && !status ? 1 : 0;                                         // opt-in: also the places of valley that involve the AS
    // opt-in: also an alert when the AS is the origin of at least this many invalid announcements in ten minutes
    let invalid = 0;
    if (body.invalid !== undefined && body.invalid !== null && body.invalid !== false) {
      if (status || !Number.isInteger(body.invalid) || body.invalid < MIN_THRESHOLD || body.invalid > MAX_THRESHOLD) return bad(`invalid must be a whole number from ${MIN_THRESHOLD} to ${MAX_THRESHOLD}, and needs an AS`);
      invalid = body.invalid;
    }
    if (kind !== 'email' && kind !== 'webhook') return bad('kind must be "email" or "webhook"');
    const t = now();
    if (store.countAsn(asn) >= MAX_PER_ASN) return bad('this AS has reached the limit of subscriptions', 429);

    if (kind === 'email') {
      const target = String(body.target || '').trim().toLowerCase();
      if (!EMAIL_RE.test(target) || target.length > 254) return bad('that does not look like an e-mail address');
      const accepted = reply(202, { status: 'pending', message: 'If the address is valid, a confirmation message is on its way. Follow the link in it to start receiving notifications.' });
      let row = store.find('email', target, asn);
      if (row && row.status === 'active') return accepted;                              // do not tell whether it exists
      if (row && t - row.attempted < HOUR) return accepted;                             // one confirmation per hour per subscription
      if (!row && store.countTarget('email', target) >= MAX_PER_TARGET) return accepted;
      if (!global('mail')) return bad('the service is busy, try again later', 503);
      // requests that nobody has confirmed yet are limited too, for each AS and in all: they cannot take the places of the working subscriptions
      if (!row && (store.countPendingAsn(asn) >= MAX_PENDING_PER_ASN || store.countPending() >= MAX_PENDING)) return bad('the service is busy, try again later', 503);
      if (row) { store.repend(row.id); store.attempt(row.id, t); store.setLeaks(row.id, leaks); store.setInvalid(row.id, invalid); } else row = { id: store.insert('email', target, asn, null, t, leaks, invalid), attempted: t };
      row = store.get(row.id);
      try { await sendConfirmation({ to: target, asn, token: confirmToken(row), site, leaks: !!leaks, invalid }); } catch (err) { deps.log && deps.log(`confirmation not sent: ${err.message}`); store.remove(row.id); return bad('the confirmation message could not be sent', 502); }
      return accepted;
    }

    // webhook: the owner of the address must answer a challenge before anything is sent
    const url = parseWebhookUrl(body.target);
    if (!url) return bad('the webhook must be an https address with a public host name (port 443 or 8443)');
    const target = url.href;
    let row = store.find('webhook', target, asn);
    if (row && row.status === 'active') return bad('this webhook is already subscribed to this AS', 409);
    if (!row && store.countTarget('webhook', target) >= MAX_PER_TARGET) return bad('too many subscriptions for this webhook', 429);
    if (!global('webhook')) return bad('the service is busy, try again later', 503);
    // one verification at a time for the same address and AS: a second request would change the secret, or delete the record, under the first one
    const vkey = `${target} ${asn}`;
    if (verifying.has(vkey)) return bad('this webhook is being verified already, try again in a minute', 409);
    verifying.add(vkey);
    try {
      const secret = 'whsec_' + randomBytes(24).toString('hex');
      const id = row ? row.id : store.insert('webhook', target, asn, secret, t, leaks, invalid);
      if (row) { store.repend(id); store.attempt(id, t, secret); store.setLeaks(id, leaks); store.setInvalid(id, invalid); }
      const challenge = randomBytes(16).toString('hex');
      try {
        const r = await verifyWebhook(target, { type: 'verification', challenge, asn, unsubscribe: unsubscribeUrl(id) }, secret);
        if (!(r.status >= 200 && r.status < 300) || !String(r.body).includes(challenge)) throw new Error(`the address answered HTTP ${r.status} without repeating the challenge`);
      } catch (err) {
        store.remove(id);
        return bad(`verification failed: ${err.message}`, 400);
      }
      if (store.countAsn(asn) >= MAX_PER_ASN) { store.remove(id); return bad('this AS has reached the limit of subscriptions', 429); }     // other requests may have taken the place while the address answered
      store.activate(id, t);
      return reply(201, { status: 'active', asn, leaks: !!leaks, invalid, secret, unsubscribe: unsubscribeUrl(id), message: 'Subscribed. The secret is shown only now: use it to check the X-ASPA-Signature header of each delivery.' });
    } finally { verifying.delete(vkey); }
  }

  function confirm(body) {
    const id = readToken(key, 'confirm', body && body.token, confirmSalt);
    const row = id && store.get(id);
    if (!row) return bad('this link is not valid any more; subscribe again', 404);
    if (row.status === 'pending') {
      if (store.countAsn(row.asn) >= MAX_PER_ASN) return bad('this AS has reached the limit of subscriptions', 429);      // the limit is checked again when it starts to count
      store.activate(id, now());
    }
    return reply(200, { status: 'active', asn: row.asn, kind: row.kind });
  }

  function unsubscribe(token) {
    const id = readToken(key, 'unsub', token);
    const row = id && store.get(id);
    if (!row) return reply(200, { status: 'unsubscribed' });                          // idempotent: a second click is not an error
    store.remove(id);
    return reply(200, { status: 'unsubscribed', asn: row.asn, kind: row.kind });
  }

  // shared results: kept TTL_DAYS days (the service purges them), at most MAX_REPORTS at a time
  const perIpReport = deps.perIpReport || limiter(20, HOUR);
  const perIpReportDay = deps.perIpReportDay || limiter(100, 24 * HOUR);     // one address cannot take the room over several hours
  const globalReport = deps.globalReport || limiter(300, HOUR);
  const MAX_REPORTS = deps.maxReports || 20000;
  const MAX_REPORT_BYTES = deps.maxReportBytes || 512 * 1024 * 1024;     // what is stored, not what could be: the count alone lets 20000 big ones fill the disk
  function createReport(body, ip) {
    const c = checkReport(body);
    if (c.error) return bad(c.error);
    if (!perIpReport(ip) || !perIpReportDay(ip)) return bad('too many reports from this address, try again later', 429);
    if (!globalReport('all') || store.countReports() >= MAX_REPORTS || store.reportBytes() + Buffer.byteLength(JSON.stringify(c.report)) > MAX_REPORT_BYTES) return bad('the service is busy, try again later', 503);
    const id = newId();
    store.addReport(id, now(), c.report.kind, c.report.title, JSON.stringify(c.report));
    return reply(201, { id, url: `${site}/r/${id}`, expires_days: TTL_DAYS });
  }
  // a report that has expired is not served, whether the hourly clean-up has deleted it yet or not
  const readable = (id) => { const r = ID_RE.test(id) && store.getReport(id); return r && r.created + TTL_DAYS * 86400 > now() ? r : null; };
  function getReport(id) {
    const r = readable(id);
    if (!r) return bad('this report does not exist or has expired', 404);
    return reply(200, { id: r.id, created: new Date(r.created * 1000).toISOString(), expires: new Date((r.created + TTL_DAYS * 86400) * 1000).toISOString(), ...r.body });
  }
  const reportPage = (id, template) => { const r = readable(id); return r ? shell(template, id, r.body, site) : null; };

  const unsubscribePage = (id) => `${site}/subscription.html#unsubscribe=${unsubscribeToken(id)}`;
  return { subscribe, confirm, unsubscribe, unsubscribeUrl, unsubscribePage, unsubscribeToken, createReport, getReport, reportPage };
}

const readBody = (req, limit = 2048) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  let failed = false;
  req.on('data', (c) => { size += c.length; if (size > limit) { if (!failed) { failed = true; reject(new Error('too large')); } } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

// node:http request handler around makeApi
export function httpHandler(api, { site, perIpUnsub = limiter(60, HOUR), health = null, template = () => null } = {}) {
  return async (req, res) => {
    const send = ({ status, body }, cache = 'no-store') => {
      res.writeHead(status, { ...(status === 413 ? { Connection: 'close' } : {}), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body) + '\n');
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
      if (req.method === 'GET' && url.pathname === '/api/v1/subscriptions/health' && health) return send({ status: 200, body: health() });
      const rep = /^\/api\/v1\/reports\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && rep) { const r = api.getReport(rep[1]); return send(r, 'no-store'); }
      const page = /^\/r\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && page) {
        const tpl = template();
        const html = tpl && api.reportPage(page[1], tpl);
        res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' });
        return res.end(html || '<!doctype html><title>Not found</title><p>This report does not exist or has expired.</p>');
      }
      if (req.method !== 'POST') return send({ status: 405, body: { error: 'POST only' } });
      const origin = req.headers.origin;
      if (origin && origin !== site) return send({ status: 403, body: { error: 'cross-origin requests are not accepted' } });
      const raw = await readBody(req, url.pathname === '/api/v1/reports' ? 220 * 1024 : 2048);
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (url.pathname === '/api/v1/subscriptions/unsubscribe') {
        if (!perIpUnsub(ip)) return send({ status: 429, body: { error: 'too many requests' } });
        let token = url.searchParams.get('token');
        if (!token && type === 'application/json') { try { token = JSON.parse(raw).token; } catch { /* no token */ } }
        return send(api.unsubscribe(token));
      }
      if (type !== 'application/json') return send({ status: 415, body: { error: 'send application/json' } });
      let body;
      try { body = JSON.parse(raw); } catch { return send({ status: 400, body: { error: 'invalid JSON' } }); }
      if (url.pathname === '/api/v1/reports') return send(api.createReport(body, ip));
      if (url.pathname === '/api/v1/subscriptions') return send(await api.subscribe(body, ip));
      if (url.pathname === '/api/v1/subscriptions/confirm') {
        if (!perIpUnsub(ip)) return send({ status: 429, body: { error: 'too many requests' } });
        return send(api.confirm(body));
      }
      return send({ status: 404, body: { error: 'not found' } });
    } catch (err) {
      send({ status: err.message === 'too large' ? 413 : 500, body: { error: err.message === 'too large' ? 'request too large' : 'internal error' } });
    }
  };
}
