// Accessibility and layout check of the pages, in a real browser (Chromium through Playwright), with axe-core:
// every page, at a desktop width and at 320 px, in the light and in the dark theme, must have no axe violation
// (WCAG 2.0/2.1 A and AA and the best practices) and must not scroll sideways.
//
// The site is served from site/ with the data files of scripts/fixtures/a11y (see scripts/record-fixtures.mjs);
// anything else outside the site is blocked, so the result does not depend on the network.
//   npm install --no-save playwright-core axe-core && CHROME=/path/to/chrome node scripts/test-a11y.mjs [page name...]
// CHROME is a Chromium or Chrome that is already installed (on FreeBSD, where Playwright has no browser of its own: pkg install chromium);
// without it Playwright uses the one that `npx playwright-core install chromium` downloads.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const axeSource = require('axe-core').source;
const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '..', 'site');
const FIX = join(here, 'fixtures', 'a11y');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };
const FIXTURE_OF = (p) => {
  if (p === '/data/aspas.json' || p === '/data/status.json') return p.slice(1);
  if (/^\/api\/v1\/(adoption|leaks|validators|meta|leaks-history|status-history|trends|resources|invalid|status-months)\.json$/.test(p)) return p.slice(1);
  if (/^\/api\/v1\/as\/\d+$/.test(p)) return 'api/v1/as.json';
  if (/^\/api\/v1\/reports\/[0-9a-f]{12}$/.test(p)) return 'api/v1/report.json';
  if (p === '/api/v1/subscriptions/health') return 'api/v1/health.json';
  if (p === '/datasets/index.json') return 'datasets/index.json';
  return null;
};
const GITLAB_FIXTURE = (url) => {
  const m = /\/repository\/files\/(events|history|visibility)\.json\/raw/.exec(url);
  return m ? `gitlab/${m[1]}.json` : null;
};

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  try {
    const fx = FIXTURE_OF(p);
    if (fx) { try { return send(200, 'application/json', await readFile(join(FIX, fx))); } catch { return send(404, 'application/json', '{}'); } }
    if (p === '/client-ip') return send(200, 'application/json', '{"ip":"192.0.2.1"}');
    if (/^\/r\/[0-9a-f]{12}$/.test(p)) return send(200, TYPES['.html'], await readFile(join(SITE, 'report.html')));
    if (/^\/as\/(AS)?\d+\/?$/.test(p)) return send(200, TYPES['.html'], await readFile(join(SITE, 'index.html')));
    const file = join(SITE, p === '/' ? 'index.html' : p);
    if (!file.startsWith(SITE)) return send(403, 'text/plain', 'no');
    return send(200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch { return send(404, 'text/plain', 'not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const PAGES = [
  ['home', '/'], ['as', '/#AS12779'], ['path', '/#path=3356+12779&from=up'], ['changes', '/#changes'], ['quality', '/#quality'],
  ['statistics', '/statistics.html'], ['guide', '/guide.html'], ['guida', '/guida.html'], ['api', '/api.html'],
  ['examples', '/examples.html'], ['embed', '/embed.html?country=IT'], ['status', '/status.html'], ['subscription', '/subscription.html#confirm=abc'],
  ['bulk', '/#path=3356+12779&from=up'], ['peek', '/#AS12779'], ['recent', '/#AS12779'], ['report', '/r/0123456789ab'],
];
const VIEWPORTS = [['desktop', { width: 1280, height: 800 }], ['narrow', { width: 320, height: 640 }]];
const SCHEMES = ['light', 'dark'];
const only = process.argv.slice(2);

const browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const failures = [];
let checked = 0;
for (const [name, path] of PAGES) {
  if (only.length && !only.includes(name)) continue;
  for (const [vname, viewport] of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.route((url) => url.origin !== base, async (route) => {
        const fx = GITLAB_FIXTURE(route.request().url());
        if (fx) return route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(join(FIX, fx)) });
        return route.abort();
      });
      const label = `${name} ${vname} ${scheme}`;
      try {
        await page.goto(base + path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);
        if (name === 'as') {
          await page.evaluate(() => { const d = document.getElementById('as-graph'); if (d) d.open = true; });
          await page.waitForTimeout(300);
        }
        const extra = [];
        if (name === 'bulk') {
          // many paths at once: open the box, check a few lines, and expect a table, the files and the button to share
          await page.evaluate(() => { document.getElementById('bulk').open = true; });
          await page.fill('#bulktext', '3356 1299 12779\n193.0.0.0/21 3333 12779\n# a comment\n1299 99 3356 680\nnot a path');
          await page.click('#bulkform button[type=submit]');
          await page.waitForTimeout(300);
          const rows = await page.locator('#bulkresult tbody tr').count();
          if (rows !== 4) extra.push(`bulk: ${rows} rows, expected 4`);
          if (!(await page.locator('#bulkresult .share-result button').count())) extra.push('bulk: no button to share');
        }
        if (name === 'peek') {
          // the quick look: a click on the name of an AS opens a window with rows, and it can be closed
          await page.locator('a.chip').first().click();
          await page.waitForTimeout(500);
          const rows = await page.locator('dialog.peek[open] .peek-row').count();
          if (rows < 2) extra.push(`peek: ${rows} rows in the window, expected at least 2`);
        }
        if (name === 'recent') {
          // the checks of this browser: look at another AS and come back; the note and the list must be there
          await page.evaluate(() => { location.hash = '#AS680'; });
          await page.waitForTimeout(400);
          await page.evaluate(() => { location.hash = '#AS12779'; });
          await page.waitForTimeout(400);
          if (!(await page.locator('.recent-note').count())) extra.push('recent: no note about the earlier look');
          if (await page.locator('#recent').isHidden()) extra.push('recent: the list is hidden');
          else if (await page.locator('#recent-list li').count() < 2) extra.push('recent: fewer than 2 entries');
        }
        if (name === 'report') {
          const rows = await page.locator('#rp-body tbody tr').count();
          if (rows !== 6) extra.push(`report: ${rows} table rows, expected 6`);
          if (!(await page.textContent('#rp-title')).includes('3 AS paths')) extra.push('report: the title is not there');
        }
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }));
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const notes = extra.concat(result.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')} -- ${v.help}`));
        if (over > 1) {
          // name the elements that stick out (not those inside a scrollable table), to find what to fix
          const wide = await page.evaluate(() => [...document.body.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.table-wrap, svg, pre'))
            .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`));
          notes.push(`scrolls sideways by ${over}px${wide.length ? ` (${wide.join(', ')})` : ''}`);
        }
        checked++;
        if (notes.length) { failures.push(label); console.log(`FAIL ${label}`); for (const n of notes) console.log(`     ${n}`); } else console.log(`ok   ${label}`);
      } catch (err) { failures.push(label); console.log(`FAIL ${label}: ${err.message}`); }
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
console.log(`${checked - failures.length} of ${checked} checks passed`);
if (failures.length) process.exit(1);
