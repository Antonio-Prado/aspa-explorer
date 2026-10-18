'use strict';

// The list of dated snapshots on the API page: /datasets/index.json, written by scripts/build-dataset.mjs.
(function () {
  const rows = document.getElementById('ds-rows');
  if (!rows) return;
  const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
  const cell = (tag, text, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = text; return n; };
  async function main() {
    let doc;
    try {
      const r = await fetch('/datasets/index.json', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      doc = await r.json();
    } catch (err) {
      const td = cell('td', `The list is not available (${err.message}). A snapshot is made once a month.`);
      td.colSpan = 3;
      rows.replaceChildren(document.createElement('tr')); rows.firstChild.append(td);
      return;
    }
    rows.replaceChildren(...doc.snapshots.map((s) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row';
      const a = document.createElement('a'); a.href = `/datasets/${encodeURIComponent(s.name)}`; a.textContent = s.name;
      th.append(a);
      tr.append(th, cell('td', size(s.bytes), 'num'), cell('td', s.sha256, 'mono'));
      return tr;
    }));
    if (!doc.snapshots.length) { const td = cell('td', 'No snapshot yet.'); td.colSpan = 3; const tr = document.createElement('tr'); tr.append(td); rows.replaceChildren(tr); }
  }
  main();
})();
