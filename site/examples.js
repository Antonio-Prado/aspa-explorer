'use strict';

// The checker of the examples page: looks at the list of providers that a network intends to publish.
(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_AS = 4294967295;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const asNum = (t) => { const m = /^(?:AS)?(\d{1,10})$/i.exec(String(t).trim()); return m && Number(m[1]) <= MAX_AS ? Number(m[1]) : null; };
  const reserved = (n) => n === 23456 || (n >= 64496 && n <= 131071) || n >= 4200000000;   // 65552-131071: reserved by IANA
  const documentation = (n) => (n >= 64496 && n <= 64511) || (n >= 65536 && n <= 65551);

  // Findings about a list: {level: 'error' | 'warning' | 'note', text}
  function review(own, tokens) {
    const out = [];
    const nums = [];
    for (const t of tokens) {
      const n = asNum(t);
      if (n === null) out.push({ level: 'error', text: `“${t}” is not an AS number.` }); else nums.push(n);
    }
    const unique = [...new Set(nums)].sort((a, b) => a - b);
    if (unique.length < nums.length) out.push({ level: 'note', text: 'Some providers were listed twice; the duplicates are dropped.' });
    if (unique.includes(0) && unique.length > 1) out.push({ level: 'error', text: 'AS0 means “no transit provider”: use it alone, or list the real providers without it.' });
    if (unique.includes(own)) out.push({ level: 'error', text: `AS${own} cannot be its own provider.` });
    const bad = unique.filter((n) => n !== 0 && reserved(n) && !documentation(n));
    if (bad.length) out.push({ level: 'error', text: `${bad.map((n) => 'AS' + n).join(', ')} ${bad.length === 1 ? 'is private or reserved and never appears' : 'are private or reserved and never appear'} in the global routing system.` });
    if (unique.some(documentation)) out.push({ level: 'note', text: 'Some numbers are reserved for documentation (as in the examples): fine to try, not to publish.' });
    if (unique.filter((n) => n !== 0).length >= 30) out.push({ level: 'warning', text: 'With so many providers almost any path through your AS is accepted, so the ASPA stops very little.' });
    if (unique.length === 1 && unique[0] !== 0 && !out.some((o) => o.level === 'error')) out.push({ level: 'note', text: 'A single provider: if you have a backup one, add it now, or the routes through it will be invalid.' });
    return { unique, out };
  }

  async function published(n) {
    const r = await fetch(`/api/v1/as/${n}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  $('builder').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = $('b-result');
    const own = asNum($('b-as').value);
    if (own === null || own === 0) { res.replaceChildren(el('p', { class: 'error', text: 'Enter your AS number, such as AS64501.' })); return; }
    const tokens = $('b-prov').value.split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) { res.replaceChildren(el('p', { class: 'error', text: 'Enter the providers, or AS0 if you have no transit provider.' })); return; }
    const { unique, out } = review(own, tokens);
    const errors = out.filter((o) => o.level === 'error').length;
    const kids = [];
    if (!errors) {
      kids.push(el('p', { text: 'The ASPA to create:' }), el('pre', {}, el('code', { text: `customer AS${own}\nproviders ${unique.map((n) => 'AS' + n).join(', ')}` })));
    }
    if (out.length) kids.push(el('ul', {}, ...out.map((o) => el('li', {}, el('span', { class: 'badge ' + (o.level === 'error' ? 'v-invalid' : o.level === 'warning' ? 'v-unknown' : 'v-valid'), text: o.level }), ' ', o.text))));
    else kids.push(el('p', { text: 'No problem found in the list itself.' }));
    const cmp = el('p', { class: 'hint', text: 'Comparing with the ASPA that is published now…' });
    kids.push(cmp);
    res.replaceChildren(...kids);
    try {
      const d = await published(own);
      const have = d.aspa.published ? d.aspa.providers.map((p) => Number(p.slice(2))) : [];
      const added = unique.filter((n) => !have.includes(n)), dropped = have.filter((n) => !unique.includes(n));
      const link = el('a', { href: `/as/AS${own}`, text: `AS${own}` });
      if (!d.aspa.published) cmp.replaceChildren(link, ' has no ASPA published yet.');
      else if (!added.length && !dropped.length) cmp.replaceChildren(link, ' already publishes exactly this list.');
      else cmp.replaceChildren(link, ` publishes ${have.map((n) => 'AS' + n).join(', ')}. Your list would add ${added.length ? added.map((n) => 'AS' + n).join(', ') : 'nothing'} and drop ${dropped.length ? dropped.map((n) => 'AS' + n).join(', ') : 'nothing'}.`);
    } catch (err) {
      cmp.textContent = `Could not read the published ASPA (${err.message}).`;
    }
  });
})();
