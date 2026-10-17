// Delivery of webhooks, built so that a subscriber cannot aim the server at its own network:
// https only, no address literals, every address the name resolves to must be public, the connection
// goes to the address that was checked (the name is used only for TLS), no redirects, short timeouts,
// and a small cap on the answer that is read.
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { createHmac } from 'node:crypto';

const v4 = (ip) => ip.split('.').map(Number);
const inV4 = (n, base, bits) => {
  const x = (n[0] * 2 ** 24) + (n[1] << 16) + (n[2] << 8) + n[3];
  const b = (base[0] * 2 ** 24) + (base[1] << 16) + (base[2] << 8) + base[3];
  const size = 2 ** (32 - bits);
  return Math.floor(x / size) === Math.floor(b / size);
};
const V4_BLOCKED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]].map(([a, b]) => [v4(a), b]);

// true only for a unicast address on the public Internet
export function isPublicIp(ip) {
  if (net.isIPv4(ip)) { const n = v4(ip); return !V4_BLOCKED.some(([base, bits]) => inV4(n, base, bits)); }
  if (!net.isIPv6(ip)) return false;
  const l = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
  if (mapped) return isPublicIp(mapped[1]);
  if (l === '::' || l === '::1') return false;
  const first = parseInt(l.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false;          // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false;          // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return false;          // multicast
  if (l.startsWith('2001:db8:') || l.startsWith('2001:0db8:')) return false;   // documentation
  if (l.startsWith('64:ff9b:') || l.startsWith('100:') || first === 0x2002 || l.startsWith('2001:0:') || l.startsWith('2001::')) return false;   // NAT64, discard, 6to4, Teredo
  return (first & 0xe000) === 0x2000;                     // global unicast 2000::/3 only
}

// A webhook address we are willing to call, as a URL, or null.
export function parseWebhookUrl(text) {
  let u;
  try { u = new URL(String(text)); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || String(text).length > 500) return null;
  if (u.port && !['443', '8443'].includes(u.port)) return null;
  const h = u.hostname;
  if (!h.includes('.') || net.isIP(h) || h.startsWith('[') || /\.(local|internal|localhost|lan|home|corp)$/i.test(h)) return null;
  return u;
}

export const signature = (secret, timestamp, body) => 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

// POST a JSON body. Returns {status, body} (body at most 2 KB) or throws.
export async function post(url, payload, { secret, headers = {}, lookup = dns.lookup, request = https.request, timeoutMs = 5000 } = {}) {
  const u = parseWebhookUrl(url);
  if (!u) throw new Error('not an acceptable https address');
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || !addrs.every((a) => isPublicIp(a.address))) throw new Error('the name does not resolve to public addresses only');
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const h = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'aspa-explorer-notifier', 'X-ASPA-Timestamp': ts, ...headers };
  if (secret) h['X-ASPA-Signature'] = signature(secret, ts, body);
  return new Promise((resolve, reject) => {
    const req = request({
      host: addrs[0].address, family: addrs[0].family, port: u.port || 443, path: u.pathname + u.search, method: 'POST', servername: u.hostname,
      headers: { ...h, Host: u.host }, timeout: timeoutMs, agent: false,
    }, (res) => {
      let got = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { got += c; if (got.length > 2048) { got = got.slice(0, 2048); res.destroy(); } });
      res.on('end', () => resolve({ status: res.statusCode, body: got }));
      res.on('close', () => resolve({ status: res.statusCode, body: got }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
