'use strict';

// Confirms or cancels a subscription from the link in a mail: the token is in the address after #,
// so it is never sent to the server by the page load, only by the button below.
(function () {
  const $ = (id) => document.getElementById(id);
  const m = /^#(confirm|unsubscribe)=([A-Za-z0-9._-]{1,80})$/.exec(location.hash);
  const status = $('status');
  const then = $('then');
  if (!m) {
    status.textContent = 'This link is not complete. Open the link from the message again, or subscribe from the page of an AS.';
    return;
  }
  const [, action, token] = m;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = action === 'confirm' ? 'Confirm the subscription' : 'Stop the notifications';
  status.textContent = action === 'confirm'
    ? 'Press the button to start receiving notifications.'
    : 'Press the button to stop receiving notifications.';
  status.after(button);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const r = await fetch(action === 'confirm' ? '/api/v1/subscriptions/confirm' : '/api/v1/subscriptions/unsubscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      button.remove();
      const what = body.asn === 'STATUS' ? ' of the status' : body.asn ? ` for ${body.asn}` : '';
      status.textContent = action === 'confirm' ? `Done: you will be told when something changes${what}.` : `Done: no more notifications${what}.`;
      if (body.asn) {
        then.hidden = false;
        const a = document.createElement('a');
        const status = body.asn === 'STATUS';
        a.href = status ? '/status.html' : `/as/${body.asn}`;
        a.textContent = status ? 'Go to the status page' : `Go to the page of ${body.asn}`;
        then.replaceChildren(a);
      }
    } catch (err) {
      button.disabled = false;
      status.textContent = `It did not work: ${err.message}.`;
    }
  });
})();
