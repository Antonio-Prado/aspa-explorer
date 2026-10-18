'use strict';

// "Share this result": freezes a result of the page into a link /r/<id> (the service keeps it 30 days) and offers the files to download.
// The page builds the report as plain data (see notifier/reports.mjs); nothing here sends anything until the button is pressed.
(function (root) {
  const SHARE_API = '/api/v1/reports';
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === undefined || v === null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const c of kids) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  // The button and, once it worked, the link with a Copy button. `build()` returns the report; it is called when the button is pressed,
  // so that what is shared is what is on the screen then.
  function button(build, label = 'Share this result') {
    const btn = el('button', { type: 'button', text: label });
    const out = el('div', { class: 'hint', 'aria-live': 'polite' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.replaceChildren(el('span', { class: 'busy', text: 'Making the link' }));
      try {
        const r = await fetch(SHARE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(build()) });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        const input = el('input', { type: 'text', readonly: '', value: body.url, 'aria-label': 'Link to the shared result', class: 'copy-field', spellcheck: 'false' });
        input.addEventListener('focus', () => input.select());
        const copy = el('button', { type: 'button', class: 'linkish', text: 'Copy', 'aria-label': 'Copy the link' });
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(body.url); copy.textContent = 'Copied'; } catch { input.select(); copy.textContent = 'Press Ctrl+C'; }
          setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
        });
        out.replaceChildren(el('p', { text: `The link works for ${body.expires_days} days. Anybody who has it can read the result; nothing else is shared.` }),
          el('div', { class: 'copy-row' }, el('span', { class: 'copy-label', text: 'Link' }), input, copy, el('a', { href: body.url, target: '_blank', rel: 'noopener' }, 'Open', el('span', { class: 'sr-only', text: ' (opens in a new tab)' }))));
      } catch (err) {
        out.replaceChildren(el('p', { class: 'error', text: `Could not make the link (${err.message}).` }));
      } finally { btn.disabled = false; }
    });
    return el('div', { class: 'share-result' }, btn, out);
  }

  // A file made in the page and offered for download (no request is made).
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  root.AspaShare = { button, download };
})(typeof self !== 'undefined' ? self : this);
