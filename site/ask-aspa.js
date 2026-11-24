'use strict';

// "Ask ASx to publish one": for a network with no ASPA, a button that opens the mail program of the visitor with a short
// message to the contact that the network publishes on PeeringDB (its NOC, or else its technical or policy contact).
// The site sends nothing and keeps nothing: PeeringDB is asked from the browser, and only when the button is pressed.
// The pure parts (the choice of the contact, the mailto: address) are tested by scripts/test-ask-aspa.mjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AspaAsk = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PEERINGDB = 'https://www.peeringdb.com/api/net';
  const ROLES = ['NOC', 'Technical', 'Policy'];
  const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

  // The contact to write to, from the answer of PeeringDB to /api/net?asn=N&depth=2: the first role of ROLES that has a
  // well-formed address; null when there is none.
  function pickContact(answer) {
    const net = answer && Array.isArray(answer.data) ? answer.data[0] : null;
    const pocs = net && Array.isArray(net.poc_set) ? net.poc_set : [];
    for (const role of ROLES) {
      const p = pocs.find((x) => x && x.role === role && typeof x.email === 'string' && EMAIL.test(x.email.trim()));
      if (p) return { email: p.email.trim(), role, network: typeof net.name === 'string' ? net.name : '' };
    }
    return null;
  }

  const subject = (as) => `An ASPA for ${as}?`;
  const body = (as) => [
    'Hello,',
    '',
    `I looked up ${as} on ASPA Explorer and saw that it has not published an ASPA yet:`,
    `https://aspa.ping6.it/as/${as}`,
    '',
    'An ASPA (Autonomous System Provider Authorisation) is an RPKI object in which a network lists its upstream providers. Networks that check ASPAs can then reject route leaks and forged AS paths that involve your prefixes, which ROAs alone do not catch. You create it in the RPKI portal of your RIR (or in your own CA, if you run one), like a ROA, and it only takes a few minutes.',
    '',
    `The page above lists the providers that ${as} seems to use in BGP today, as a starting point, and these examples show how to write one:`,
    'https://aspa.ping6.it/examples.html',
    '',
    'Best regards,',
    '',
  ].join('\n');

  // The mailto: address of the message to `email` about `as` ("AS64500"); null for an address or an AS that is not one.
  function mailto(email, as) {
    if (!EMAIL.test(String(email || '')) || !/^AS\d{1,10}$/.test(String(as || ''))) return null;
    return `mailto:${email}?subject=${encodeURIComponent(subject(as))}&body=${encodeURIComponent(body(as))}`;
  }

  // The button and the line under it, for the page; `as` is "AS64500". The line says what happened after a press.
  function button(as) {
    const n = Number(String(as).slice(2));
    const wrap = document.createElement('span');
    wrap.className = 'ask-aspa';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkish';
    b.textContent = `Ask ${as} to publish one`;
    const note = document.createElement('span');
    note.className = 'ask-note';
    note.setAttribute('role', 'status');
    b.addEventListener('click', async () => {
      b.disabled = true;
      note.textContent = 'Looking for its contact on PeeringDB…';
      let c = null;
      try {
        const r = await fetch(`${PEERINGDB}?asn=${n}&depth=2`, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(String(r.status));
        c = pickContact(await r.json());
      } catch {
        note.textContent = 'PeeringDB did not answer (it limits how often an address can ask). Try again in a while.';
        b.disabled = false;
        return;
      }
      const link = c && mailto(c.email, as);
      if (!link) {
        note.textContent = `${as} publishes no NOC, technical or policy contact on PeeringDB, so there is nobody to write to from here.`;
        return;
      }
      note.textContent = `Your mail program opens with a short message to the ${c.role} contact of ${as} on PeeringDB (${c.email}), for you to read and send. This site sends nothing.`;
      b.disabled = false;
      location.href = link;
    });
    wrap.append(b, note);
    return wrap;
  }

  return { pickContact, mailto, subject, body, button, ROLES };
});
