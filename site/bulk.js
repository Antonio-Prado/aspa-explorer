'use strict';

// Many AS paths at once: one per line, as a router prints them (neighbour first, origin last), optionally with the prefix in front.
// Pure functions over a lookup of ASPA records, so that they can be tried without a browser (scripts/test-bulk.mjs).
(function (root) {
  const MAX_LINES = 5000;
  const PREFIX_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+:[0-9a-f:]*\/\d{1,3})$/i;

  // A line, split into the prefix (when the first word is one) and the path text; blank lines and comments are left out by the caller.
  function splitLine(line) {
    const words = line.trim().split(/\s+/);
    if (words.length > 1 && PREFIX_RE.test(words[0])) return { prefix: words[0], text: words.slice(1).join(' ') };
    return { prefix: '', text: line.trim() };
  }

  // Why a verdict, in a few words.
  function note(v, aspas) {
    if (v.N <= 1) return 'a single AS: nothing to check';
    if (v.result === 'Valid') return v.direction === 'up' ? 'every hop is attested' : 'up-ramp and down-ramp cover the path';
    if (v.result === 'Invalid') {
      return v.direction === 'up'
        ? `${v.path[v.maxUp - 1]} does not list ${v.path[v.maxUp]}`
        : `a valley: the up-ramp (${v.maxUp}) and the down-ramp (${v.maxDown}) do not meet in ${v.N} ASes`;
    }
    const read = v.direction === 'up' ? v.path.slice(0, -1) : v.path;   // going up, the ASPA of the neighbour is not read
    const missing = [...new Set(read.filter((as) => !aspas.has(as)))];
    return `no ASPA for ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}`;
  }

  // text: the lines; direction: 'up' or 'down'; api: AspaVerify. Returns {rows, counts, skipped, truncated}.
  function checkMany(aspas, text, direction, api) {
    const rows = [], counts = { Valid: 0, Unknown: 0, Invalid: 0, Error: 0 };
    let skipped = 0, truncated = false;
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith('#')) { skipped++; continue; }
      if (rows.length >= MAX_LINES) { truncated = true; break; }
      const { prefix, text: pathText } = splitLine(raw);
      const parsed = api.parsePath(pathText);
      if (parsed.error) { counts.Error++; rows.push({ line: i + 1, prefix, input: pathText, path: null, result: 'Error', note: parsed.asSet ? 'AS_SET or confederation segment' : parsed.error.replace(/^"(.*?)" is not an AS number\..*$/, 'not an AS number: $1') }); continue; }
      const v = api.verify(aspas, parsed.path, direction);
      counts[v.result]++;
      rows.push({ line: i + 1, prefix, input: pathText, path: v.path.slice().reverse().map((a) => a.slice(2)).join(' '), result: v.result, note: note(v, aspas) });
    }
    return { rows, counts, skipped, truncated };
  }

  // A cell for a CSV file: quoted when needed, and a leading = + - @ made harmless (a spreadsheet would run it as a formula).
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => ['line,prefix,path,verdict,note', ...rows.map((r) => [r.line, r.prefix, r.path || r.input, r.result, r.note].map(csvCell).join(','))].join('\n') + '\n';

  const api = { MAX_LINES, splitLine, checkMany, toCsv, csvCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaBulk = api;
})(typeof self !== 'undefined' ? self : this);
