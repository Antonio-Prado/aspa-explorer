'use strict';

// The download of the whole list of ASPAs (API page): the file /api/v1/aspas.json, cut to one RIR if asked,
// handed to the browser as CSV or JSON. Nothing is sent anywhere.
(function () {
  const $ = (id) => document.getElementById(id);
  const RIRS = { ripe: 'RIPE NCC', arin: 'ARIN', apnic: 'APNIC', lacnic: 'LACNIC', afrinic: 'AFRINIC' };
  const COLS = ['customer', 'providers', 'rir', 'valid_from', 'valid_until'];
  let rows = null;

  const cell = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = (list) => [COLS.join(','), ...list.map((r) => COLS.map((c) => cell(c === 'providers' ? r.providers.join(' ') : r[c])).join(','))].join('\n') + '\n';

  function selected() {
    const rir = $('dl-rir').value;
    return rir ? rows.filter((r) => r.rir === rir) : rows;
  }
  function count() {
    const n = selected().length;
    $('dl-count').textContent = `${n.toLocaleString('en-US')} ASPA${n === 1 ? '' : 's'}`;
  }
  function save(kind) {
    const list = selected();
    const name = `aspas${$('dl-rir').value ? '-' + $('dl-rir').value : ''}.${kind}`;
    const url = URL.createObjectURL(new Blob([kind === 'csv' ? csv(list) : JSON.stringify(list, null, 1) + '\n'], { type: kind === 'csv' ? 'text/csv' : 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function main() {
    const form = $('dl-form');
    if (!form) return;
    try {
      const r = await fetch('/api/v1/aspas.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      rows = await r.json();
    } catch (err) {
      $('dl-count').textContent = `The list is not available (${err.message}).`;
      return;
    }
    for (const [k, v] of Object.entries(RIRS)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = v;
      $('dl-rir').append(o);
    }
    count();
    $('dl-rir').addEventListener('change', count);
    form.addEventListener('submit', (e) => { e.preventDefault(); save('csv'); });
    $('dl-json').addEventListener('click', () => save('json'));
    for (const b of [$('dl-csv'), $('dl-json')]) b.disabled = false;
  }
  main();
})();
