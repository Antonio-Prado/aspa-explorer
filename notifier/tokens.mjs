// Stateless tokens for the links in the mails and the webhooks: "<subscription id>.<MAC>", where the MAC
// is an HMAC of a purpose and the id (and a salt, so a new confirmation invalidates the old one).
import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (key, purpose, id, salt) => createHmac('sha256', key).update(`${purpose}:${id}:${salt}`).digest('base64url').slice(0, 32);

export const makeToken = (key, purpose, id, salt = '') => `${id}.${mac(key, purpose, id, salt)}`;

// The subscription id when the token is genuine for that purpose, else null. `saltOf(id)` gives the salt.
export function readToken(key, purpose, token, saltOf = () => '') {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{32})$/.exec(String(token));
  if (!m) return null;
  const want = Buffer.from(mac(key, purpose, m[1], saltOf(Number(m[1]))));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? Number(m[1]) : null;
}
