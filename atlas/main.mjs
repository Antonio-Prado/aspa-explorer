// The RIPE Atlas service of the tromboning test (atlas/api.mjs): an HTTP server on the loopback interface, behind nginx, which
// passes the address of the visitor in X-Real-IP. The key of the RIPE Atlas account (permission: schedule a new measurement) is
// read from a file that only the service user can read.
//   ATLAS_PORT       port on 127.0.0.1 (8095)
//   ATLAS_KEY_FILE   the key (/usr/local/etc/aspa-atlas/key)
//   ATLAS_SITE       the address of the site, the only origin whose pages may ask for a measurement (https://aspa.ping6.it)
//   ATLAS_SOCKET     a Unix socket to listen on instead of the port (the rc script sets it): only nginx and root can reach it
import { createServer } from 'node:http';
import { readFileSync, rmSync, chmodSync } from 'node:fs';
import { makeAtlasApi } from './api.mjs';

const PORT = Number(process.env.ATLAS_PORT || 8095);
const SITE = process.env.ATLAS_SITE || 'https://aspa.ping6.it';
const KEY = readFileSync(process.env.ATLAS_KEY_FILE || '/usr/local/etc/aspa-atlas/key', 'utf8').trim();
const UA = 'aspa-explorer (https://aspa.ping6.it)';
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
  return r.json();
}

async function createMeasurements(body) {
  const r = await fetch('https://atlas.ripe.net/api/v2/measurements/', {
    method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json', authorization: `Key ${KEY}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d.measurements)) throw new Error(`RIPE Atlas: HTTP ${r.status} ${JSON.stringify(d.error || d).slice(0, 300)}`);
  return d.measurements;
}

const api = makeAtlasApi({ getJson, createMeasurements });

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
  const url = new URL(req.url, 'http://localhost');
  // the route is the path exactly as sent (the URL parser would turn '\' into '/' and remove '..', unlike nginx, which chose the location by it)
  if (String(req.url).split('?')[0] !== url.pathname) return send(res, 400, { error: 'bad request path' });
  try {
    if (req.method === 'GET' && url.pathname === '/api/v1/atlas/anchors') {
      const r = await api.anchorsFor(Object.fromEntries(url.searchParams));
      return send(res, r.status, r.body);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/atlas/measure') {
      // a measurement costs credits of the account: only the pages of the site may ask for one. A page of another site can send a form or a
      // text/plain body without asking the browser first, so both the origin and the type of the body are checked (as in notifier/server.mjs)
      const origin = req.headers.origin;
      if (origin && origin !== SITE) return send(res, 403, { error: 'cross-origin requests are not accepted' });
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return send(res, 415, { error: 'send application/json' });
      let size = 0;
      const chunks = [];
      for await (const c of req) { size += c.length; if (size > 4096) return send(res, 413, { error: 'the request is too large' }); chunks.push(c); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString() || 'null'); } catch { return send(res, 400, { error: 'send a JSON object' }); }
      const r = await api.measure(body, ip);
      if (r.status === 200) log(`measure ${String(body.asn)} ${String(body.country)} ${Object.keys(r.body.traceroutes).join('+')}: ${Object.values(r.body.traceroutes).join(',')} and ${r.body.pings.length} pings, ${r.body.probes.length} probes`.replace(/\n|\r/g, ''));
      else log(`refused (${r.status}): ${r.body.error}`.replace(/\n|\r/g, ''));
      return send(res, r.status, r.body);
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    log(`error: ${String(err.message)}`.replace(/\n|\r/g, ''));
    send(res, 502, { error: 'RIPE Atlas or RIPEstat did not answer, try again later' });
  }
});
// on a Unix socket in a directory of the group of nginx (see notifier/main.mjs): no other local process can reach the service or choose X-Real-IP
const SOCKET = process.env.ATLAS_SOCKET || '';
if (SOCKET) {
  rmSync(SOCKET, { force: true });
  server.listen(SOCKET, () => { chmodSync(SOCKET, 0o660); log(`listening on ${SOCKET}`); });
} else server.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT}`));
