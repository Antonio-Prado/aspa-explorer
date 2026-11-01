// Mails: composed here, signed with DKIM and handed to the local mailer (dma on FreeBSD), which delivers them.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import { sign } from './dkim.mjs';
import { isPublicIp } from './webhook.mjs';

// plain ASCII only, one line: no way to inject a header
const safe = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\r\n]/g, ' ');
export const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

// Can the domain of an address receive mail on the public Internet? The mailer connects to its mail servers (MX), or to the domain itself when it
// has none: every one of them must resolve, and only to public addresses, or a visitor could aim the server at a host of a private network on port 25.
// A domain that says it takes no mail (null MX, ".") or that does not answer in time is refused as well.
export async function mailDomainOk(domain, { resolveMx = dns.resolveMx, lookup = dns.lookup, timeoutMs = 5000 } = {}) {
  const check = async () => {
    let hosts;
    try { hosts = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange); } catch (err) {
      if (err.code !== 'ENODATA') return false;                                           // no such domain, or the name servers fail
      hosts = [domain];                                                                    // no MX: the mail goes to the domain itself
    }
    if (!hosts.length || hosts.some((h) => !h || h === '.')) return false;
    for (const h of hosts.slice(0, 10)) {
      let addrs;
      try { addrs = await lookup(h, { all: true }); } catch { return false; }
      if (!addrs.length || !addrs.every((a) => isPublicIp(a.address))) return false;
    }
    return true;
  };
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try { return await Promise.race([check(), late]); } catch { return false; } finally { clearTimeout(timer); }
}

export function compose({ from, fromName = 'ASPA Explorer', to, subject, text, unsubscribeUrl, replyTo, domain, now = new Date() }) {
  if (!EMAIL_RE.test(to) || to.length > 254) throw new Error('bad recipient');
  const headers = [
    ['From', `${safe(fromName)} <${safe(from)}>`],
    ['To', to],
    ['Subject', safe(subject)],
    ['Date', now.toUTCString().replace('GMT', '+0000')],
    ['Message-ID', `<${randomBytes(12).toString('hex')}@${domain}>`],
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/plain; charset=us-ascii'],
    ['Content-Transfer-Encoding', '7bit'],
    ['Auto-Submitted', 'auto-generated'],
  ];
  if (replyTo) headers.splice(2, 0, ['Reply-To', safe(replyTo)]);
  if (unsubscribeUrl) {
    headers.push(['List-Unsubscribe', `<${safe(unsubscribeUrl)}>`], ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click']);
  }
  const body = text.split('\n').map((l) => safe(l)).join('\n').replace(/\n*$/, '\n');
  return { headers, body };
}

// The message as text with \n line ends (the mailer turns them into CRLF), DKIM-signed when a key is given.
export function serialize({ headers, body }, dkim) {
  const all = dkim ? [['DKIM-Signature', sign({ ...dkim, headers, body }).replace(/^DKIM-Signature: /, '').replace(/\r\n\t/g, '\n\t')], ...headers] : headers;
  return all.map(([n, v]) => `${n}: ${v}`).join('\n') + '\n\n' + body;
}

// Hand a serialized message to sendmail(8). Resolves when it is queued.
export function sendmail(message, envelopeFrom, recipient, { command = '/usr/sbin/sendmail', run = spawn, timeoutMs = 15000 } = {}) {      // less than the 20 s that the web server waits for the answer of a subscription
  return new Promise((resolve, reject) => {
    const p = run(command, ['-i', '-f', envelopeFrom, '--', recipient], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '', over = false;
    const end = (fn, value) => { if (over) return; over = true; clearTimeout(timer); fn(value); };       // the first outcome counts
    // a mailer that hangs must not hold the queue of the notifications: it is killed, and the message is tried again later (a confirmation is not: the request says it could not be sent)
    const timer = setTimeout(() => { end(reject, new Error('sendmail did not finish in time')); try { p.kill('SIGKILL'); } catch { /* gone already */ } }, timeoutMs);
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => end(reject, e));
    // a mailer that exits before it has read the message closes the pipe (EPIPE): without a handler that error ends the whole process
    p.stdin.on('error', (e) => end(reject, new Error(`sendmail did not take the message: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? end(resolve) : end(reject, new Error(`sendmail exited ${code}: ${err.trim().slice(0, 200)}`))));
    p.stdin.end(message);
  });
}
