'use strict';

// The status page: how old each piece of data is, judged against how often it should change.
(function () {
  const $ = (id) => document.getElementById(id);
  const { MIN, HOUR, DAY, dotState } = window.AspaStatus;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const c of kids) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const ago = (ms) => {
    const m = Math.round(ms / MIN);
    if (m < 2) return 'just now';
    if (m < 120) return `${m} minutes ago`;
    const h = Math.round(ms / HOUR);
    return h < 48 ? `${h} hours ago` : `${Math.round(ms / DAY)} days ago`;
  };
  const utc = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

  const LABEL = { ok: 'OK', late: 'Late', down: 'Down' };
  const CLASS = { ok: 'v-valid', late: 'v-unknown', down: 'v-invalid' };

  async function refresh() {
    const now = Date.now();
    const results = await window.AspaStatus.runAll(now);
    window.AspaStatus.paintDot(dotState(results));
    try { sessionStorage.setItem('aspa-status', JSON.stringify({ t: now, state: dotState(results) })); } catch { /* fine */ }
    $('rows').replaceChildren(...results.map(({ c, r }) => el('tr', {},
      el('th', { scope: 'row', text: c.name }),
      el('td', {}, el('span', { class: 'badge ' + CLASS[r.state], text: LABEL[r.state] })),
      el('td', { text: r.at ? `${r.day ? new Date(r.at).toISOString().slice(0, 10) : utc(r.at)}${r.day ? '' : ` (${ago(now - r.at)})`}${r.extra ? ` · ${r.extra}` : ''}` : (r.extra || 'unknown') }),
      el('td', { text: c.expected }))));
    const down = results.filter(({ r }) => r.state === 'down').length, late = results.filter(({ r }) => r.state === 'late').length;
    const msg = down ? `${down} part${down === 1 ? ' is' : 's are'} not working or very old.` : late ? `${late} part${late === 1 ? ' is' : 's are'} a little late.` : 'Everything is up to date.';
    $('summary').replaceChildren(el('p', {}, el('span', { class: 'badge ' + (down ? 'v-invalid' : late ? 'v-unknown' : 'v-valid'), text: down ? 'Problem' : late ? 'Late' : 'OK' }), ' ', msg));
    $('checked').textContent = `Checked ${utc(now)}; the page checks again every minute.`;
  }
  // alerts: the same subscription as for an AS (e-mail confirmed by a link, webhook by a challenge), for the topic "status"
  function alertsForm() {
    const kind = el('select', { id: 'al-kind', 'aria-label': 'How to be alerted' }, el('option', { value: 'email', text: 'E-mail' }), el('option', { value: 'webhook', text: 'Webhook' }));
    const target = el('input', { id: 'al-target', type: 'text', inputmode: 'email', spellcheck: 'false', autocomplete: 'email', placeholder: 'you@example.org', 'aria-label': 'E-mail address or webhook address', required: '' });
    const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'hp', 'aria-hidden': 'true' });
    const msg = el('div', { class: 'hint', 'aria-live': 'polite' });
    const btn = el('button', { type: 'submit', text: 'Subscribe' });
    kind.addEventListener('change', () => {
      const hook = kind.value === 'webhook';
      target.placeholder = hook ? 'https://example.org/hooks/aspa' : 'you@example.org';
      target.inputMode = hook ? 'url' : 'email';
      target.autocomplete = hook ? 'off' : 'email';
    });
    const form = el('form', { class: 'notify', autocomplete: 'off' }, kind, target, trap, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      msg.replaceChildren(el('span', { class: 'busy', text: 'Sending' }));
      try {
        const r = await fetch('/api/v1/subscriptions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: kind.value, target: target.value.trim(), topic: 'status', website: trap.value }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        if (body.secret) {
          const field = el('input', { type: 'text', readonly: '', value: body.secret, 'aria-label': 'Secret', class: 'copy-field', spellcheck: 'false' });
          field.addEventListener('focus', () => field.select());
          msg.replaceChildren(el('p', { text: 'Subscribed. Keep this secret: it is shown only now, and signs each delivery in the X-ASPA-Signature header.' }), field);
        } else msg.replaceChildren(el('p', { text: body.message || 'Check your mail.' }));
        target.value = '';
      } catch (err) {
        msg.replaceChildren(el('p', { class: 'error', text: err.message }));
      } finally { btn.disabled = false; }
    });
    $('alerts-form').replaceChildren(form, msg);
  }
  alertsForm();
  refresh();
  setInterval(refresh, MIN);
})();
