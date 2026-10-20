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

// The 16 bytes of an IPv6 address in any of its written forms (leading zeros, "::", a dotted IPv4 tail), or null.
function v6bytes(ip) {
  if (!net.isIPv6(ip)) return null;
  let text = ip.split('%')[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) { const q = v4(dotted[1]); text = text.slice(0, dotted.index) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16); }
  const [head, tail] = text.split('::');
  const a = head ? head.split(':') : [], b = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}
const inV6 = (bytes, base, bits) => {
  const b = v6bytes(base);
  for (let i = 0; i < 16 && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 255 : (255 << (8 - bits)) & 255;
    if ((bytes[i] & mask) !== (b[i] & mask)) return false;
  }
  return true;
};
// What is inside 2000::/3 and is not for the public Internet (IANA special-purpose registry): the Teredo, benchmarking, ORCHID and documentation
// space of 2001::/23 and 2001:db8::/32, 6to4, the old 6bone block 3ffe::/16, SRv6 SIDs, and the documentation block 3fff::/20. Compared on the 128 bits, not on the text.
const V6_BLOCKED = [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20], ['5f00::', 16]];

// true only for a unicast address on the public Internet
export function isPublicIp(ip) {
  if (net.isIPv4(ip)) { const n = v4(ip); return !V4_BLOCKED.some(([base, bits]) => inV4(n, base, bits)); }
  const x = v6bytes(ip);
  if (!x) return false;
  if (x.slice(0, 10).every((v) => v === 0) && x[10] === 255 && x[11] === 255) return isPublicIp(x.slice(12).join('.'));   // ::ffff:a.b.c.d
  if ((x[0] & 0xe0) !== 0x20) return false;                // global unicast 2000::/3 only: not ::, ::1, fc00::/7, fe80::/10, ff00::/8, 64:ff9b::/96, 100::/64
  return !V6_BLOCKED.some(([base, bits]) => inV6(x, base, bits));
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
