// DKIM signing (RFC 6376), rsa-sha256 with relaxed/relaxed canonicalisation.
import { createHash, createSign, createVerify } from 'node:crypto';

const relaxHeader = (name, value) => `${name.toLowerCase()}:${value.replace(/\r?\n[ \t]+/g, ' ').replace(/[ \t]+/g, ' ').trim()}\r\n`;

// body: text with \n or \r\n line ends
export function relaxBody(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/[ \t]+/g, ' '));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? lines.join('\r\n') + '\r\n' : '';
}

// headers: [[name, value], ...] in the order they appear in the message; sign lists the ones to sign.
export function sign({ domain, selector, privateKey, headers, body, now = Math.floor(Date.now() / 1000) }) {
  const names = headers.map(([n]) => n);
  const chosen = [];
  for (const n of ['From', 'To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type', 'List-Unsubscribe', 'List-Unsubscribe-Post']) {
    const i = names.findLastIndex((x) => x.toLowerCase() === n.toLowerCase());
    if (i >= 0) chosen.push(headers[i]);
  }
  const bh = createHash('sha256').update(relaxBody(body)).digest('base64');
  const base = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; t=${now}; h=${chosen.map(([n]) => n.toLowerCase()).join(':')}; bh=${bh}; b=`;
  const data = chosen.map(([n, v]) => relaxHeader(n, v)).join('') + relaxHeader('DKIM-Signature', base).replace(/\r\n$/, '');
  const b = createSign('RSA-SHA256').update(data).sign(privateKey, 'base64');
  return `DKIM-Signature: ${base}${b.match(/.{1,70}/g).join('\r\n\t')}`;
}

// For the tests: checks the signature of a message against the public key.
export function verify({ signature, headers, body, publicKey }) {
  const tags = Object.fromEntries(signature.replace(/^DKIM-Signature:\s*/i, '').replace(/\r?\n[ \t]+/g, '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  if (createHash('sha256').update(relaxBody(body)).digest('base64') !== tags.bh) return false;
  const chosen = tags.h.split(':').map((n) => headers.findLast(([x]) => x.toLowerCase() === n));
  const base = signature.replace(/\r?\n[ \t]+/g, '').replace(/^DKIM-Signature:\s*/i, '').replace(/b=[^;]*$/, 'b=');
  const data = chosen.map(([n, v]) => relaxHeader(n, v)).join('') + relaxHeader('DKIM-Signature', base).replace(/\r\n$/, '');
  return createVerify('RSA-SHA256').update(data).verify(publicKey, tags.b.replace(/\s+/g, ''), 'base64');
}
