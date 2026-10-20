// Shared results ("reports"): a result of the page (a path check, many paths, a simulation, a measurement) that somebody
// froze into a link /r/<id>. The page builds the report as plain data, the service checks it, keeps it for 30 days and serves it
// back; the viewer (site/report.js) draws it with textContent only, so nothing that is stored can become markup.
//
//   {kind, title, source?, sections: [{heading, text?, table?: {columns: [..], rows: [[cell, ..], ..]}}]}
//
// A cell is a string, or [string, class] with a class from CELL_CLASSES (it colours the cell).
import { randomBytes } from 'node:crypto';

export const KINDS = ['path', 'bulk', 'routes', 'whatif', 'tromboning', 'other'];
export const CELL_CLASSES = ['valid', 'unknown', 'invalid', 'provider', 'not-provider', 'none'];
export const LIMITS = { title: 140, source: 600, sections: 12, heading: 120, text: 2000, columns: 8, column: 60, rows: 500, cell: 240, bytes: 200 * 1024 };
export const TTL_DAYS = 30;
export const ID_RE = /^[0-9a-f]{12}$/;

const plain = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max) : null);

// The report as it will be kept, or {error}. Anything that is not understood is dropped, not kept.
export function checkReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'send a JSON object' };
  if (!KINDS.includes(body.kind)) return { error: `kind must be one of ${KINDS.join(', ')}` };
  const title = plain(body.title, LIMITS.title);
  if (!title) return { error: 'a report needs a title' };
  let source = null;
  if (body.source !== undefined && body.source !== null) {
    source = plain(body.source, LIMITS.source);
    if (!source || !/^\/[^\s/\\]?[^\s\\]*$/.test(source) || source.startsWith('//')) return { error: 'source must be an address on this site, starting with /' };
  }
  if (!Array.isArray(body.sections) || !body.sections.length || body.sections.length > LIMITS.sections) return { error: `sections must be a list of 1 to ${LIMITS.sections}` };
  const sections = [];
  for (const s of body.sections) {
    if (!s || typeof s !== 'object') return { error: 'a section is not an object' };
    const out = {};
    const heading = plain(s.heading, LIMITS.heading);
    if (heading) out.heading = heading;
    const text = plain(s.text, LIMITS.text);
    if (text) out.text = text;
    if (s.table !== undefined && s.table !== null) {
      const t = s.table;
      if (!t || !Array.isArray(t.columns) || !t.columns.length || t.columns.length > LIMITS.columns || !Array.isArray(t.rows) || t.rows.length > LIMITS.rows) return { error: `a table needs 1 to ${LIMITS.columns} columns and at most ${LIMITS.rows} rows` };
      const columns = t.columns.map((c) => plain(c, LIMITS.column));
      if (columns.some((c) => c === null)) return { error: 'a column name is not text' };
      const rows = [];
      for (const r of t.rows) {
        if (!Array.isArray(r) || r.length !== columns.length) return { error: 'every row must have as many cells as the table has columns' };
        const cells = [];
        for (const c of r) {
          const [value, cls] = Array.isArray(c) ? c : [c, null];
          const v = plain(typeof value === 'number' ? String(value) : value, LIMITS.cell);
          if (v === null) return { error: 'a cell is not text' };
          if (cls !== null && cls !== undefined && !CELL_CLASSES.includes(cls)) return { error: `a cell class must be one of ${CELL_CLASSES.join(', ')}` };
          cells.push(cls ? [v, cls] : v);
        }
        rows.push(cells);
      }
      out.table = { columns, rows };
    }
    if (!out.heading && !out.text && !out.table) return { error: 'an empty section' };
    sections.push(out);
  }
  const report = { kind: body.kind, title, ...(source ? { source } : {}), sections };
  if (Buffer.byteLength(JSON.stringify(report)) > LIMITS.bytes) return { error: `the report is larger than ${LIMITS.bytes / 1024} KB` };
  return { report };
}

export const newId = () => randomBytes(6).toString('hex');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The head tags of the page of a report (title and the preview of a link), put between the markers of site/report.html.
export function headTags(id, report, site) {
  const first = report.sections.find((s) => s.text);
  // what a link preview shows is also what a visitor wrote, so it says so
  const desc = esc(`Unverified report shared by a visitor. ${first ? first.text : report.title}`.slice(0, 200));
  const title = esc(`Unverified report: ${report.title} · ASPA Explorer`);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="ASPA Explorer">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${esc(site)}/r/${id}">`,
    `<meta property="og:image" content="${esc(site)}/og.png">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');
}

// The shell of the page with the tags of this report in place of the ones between <!--og--> and <!--/og-->.
export const shell = (template, id, report, site) => template.replace(/<!--og-->[\s\S]*?<!--\/og-->/, () => `<!--og-->\n${headTags(id, report, site)}\n<!--/og-->`);
