// Stateless tokens for the links in the mails and the webhooks: "<subscription id>.<MAC>", where the MAC
// is an HMAC of a purpose and the id (and a salt, so a new confirmation invalidates the old one).
// The MAC is written in hex: a link in a mail ends where the mail program decides, and base64url ended
// in "-" or "_" for one token in thirty, which Gmail leaves out of the link (1.34.0). The links of the
// mails sent before, with the MAC in base64url, are still read.
import { createHmac, timingSafeEqual } from 'node:crypto';

const digest = (key, purpose, id, salt) => createHmac('sha256', key).update(`${purpose}:${id}:${salt}`);
const mac = (key, purpose, id, salt) => digest(key, purpose, id, salt).digest('hex').slice(0, 32);
const oldMac = (key, purpose, id, salt) => digest(key, purpose, id, salt).digest('base64url').slice(0, 32);

export const makeToken = (key, purpose, id, salt = '') => `${id}.${mac(key, purpose, id, salt)}`;

// The subscription id when the token is genuine for that purpose, else null. `saltOf(id)` gives the salt.
export function readToken(key, purpose, token, saltOf = () => '') {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{32})$/.exec(String(token));
  if (!m) return null;
  const salt = saltOf(Number(m[1]));
  const got = Buffer.from(m[2]);
  const same = (want) => { const w = Buffer.from(want); return w.length === got.length && timingSafeEqual(w, got); };
  return same(mac(key, purpose, m[1], salt)) || same(oldMac(key, purpose, m[1], salt)) ? Number(m[1]) : null;
}
