// Mails: composed here, signed with DKIM and handed to the local mailer (dma on FreeBSD), which delivers them.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { sign } from './dkim.mjs';

// plain ASCII only, one line: no way to inject a header
const safe = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\r\n]/g, ' ');
export const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function compose({ from, fromName = 'ASPA Explorer', to, subject, text, unsubscribeUrl, replyTo, domain, now = new Date() }) {
  if (!EMAIL_RE.test(to) || to.length > 254) throw new Error('bad recipient');
  const headers = [
    ['From', `${fromName} <${from}>`],
    ['To', to],
    ['Subject', safe(subject)],
    ['Date', now.toUTCString().replace('GMT', '+0000')],
    ['Message-ID', `<${randomBytes(12).toString('hex')}@${domain}>`],
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/plain; charset=us-ascii'],
    ['Content-Transfer-Encoding', '7bit'],
    ['Auto-Submitted', 'auto-generated'],
  ];
  if (replyTo) headers.splice(2, 0, ['Reply-To', replyTo]);
  if (unsubscribeUrl) {
    headers.push(['List-Unsubscribe', `<${unsubscribeUrl}>`], ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click']);
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
export function sendmail(message, envelopeFrom, recipient, { command = '/usr/sbin/sendmail', run = spawn, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = run(command, ['-i', '-f', envelopeFrom, '--', recipient], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    // a mailer that hangs must not hold the queue of the notifications: it is killed, and the message is tried again later
    const timer = setTimeout(() => { reject(new Error('sendmail did not finish in time')); try { p.kill('SIGKILL'); } catch { /* gone already */ } }, timeoutMs);
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`sendmail exited ${code}: ${err.trim().slice(0, 200)}`));
    });
    p.stdin.end(message);
  });
}
