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
  if (/^\/api\/v1\/(adoption|leaks|validators|meta|leaks-history|status-history|trends|resources|invalid|status-months|relations|incidents)\.json$/.test(p)) return p.slice(1);
  const archive = /^\/api\/v1\/archive\/(events|history|visibility)\.json$/.exec(p);
  if (archive) return `gitlab/${archive[1]}.json`;
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
  ['statistics', '/statistics.html'], ['incidents', '/incidents.html'], ['guide', '/guide.html'], ['api', '/api.html'],
  ['examples', '/examples.html'], ['embed', '/embed.html?country=IT'], ['status', '/status.html'], ['subscription', '/subscription.html#confirm=abc'],
  ['bulk', '/#path=3356+12779&from=up'], ['peek', '/#AS12779'], ['irr', '/#AS12779'], ['valley', '/#routes=AS12779'], ['ixp', '/#path=12779+1200+24796&from=up'], ['recent', '/#AS12779'], ['report', '/r/0123456789ab'],
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
        const u = route.request().url();
        const irr = /^https:\/\/rest\.db\.ripe\.net\/search\.json\?query-string=AS(\d+)&/.exec(u);
        if (irr) { try { return route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(join(FIX, 'irr', `AS${irr[1]}.json`)) }); } catch { return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); } }
        if (name === 'valley') {
          // a valley in the routes of AS12779: AS174 has an AS0 ASPA, AS99999 is not a provider of AS24796, so the ramps do not meet
          if (/^https:\/\/stat\.ripe\.net\/data\/bgp-state\//.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', data: { timestamp: '2026-10-20T08:00:00', bgp_state: [{ target_prefix: '193.0.0.0/21', source_id: '10-217.29.66.120', path: [24796, 99999, 174, 12779] }, { target_prefix: '193.0.0.0/21', source_id: '00-94.247.111.254', path: [174, 12779] }] } }) });
          if (/^https:\/\/stat\.ripe\.net\/data\/asn-neighbours\//.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', data: { neighbours: [{ asn: 5394, type: 'left', power: 100 }] } }) });
        }
        const fx = GITLAB_FIXTURE(u);
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
        if (name === 'ixp') {
          // an exchange-point AS (1200 is in the list of the fixture) in a path that is not Valid: the note must be there, with the RFC
          const note = await page.locator('.ixp-note').count();
          if (note !== 1) extra.push(`ixp: ${note} notes about the exchange point, expected 1`);
          else if (!(await page.locator('.ixp-note a[href*="rfc7947"]').count())) extra.push('ixp: the note does not link RFC 7947');
        }
        if (name === 'valley') {
          // the table of the valleys, the button that explains one, and the reading that comes back (nothing in the fixtures explains it)
          const why = page.locator('button', { hasText: 'why?' }).first();
          if (!(await why.count())) extra.push('valley: no table of valleys, or no button to ask why');
          else {
            await why.click();
            await page.waitForSelector('.detailrow .verdict', { timeout: 8000 }).catch(() => {});
            const text = await page.locator('.detailrow').first().innerText().catch(() => '');
            if (!/Nothing read here explains|Possibly a gap|Probably a gap|Not enough data/i.test(text)) extra.push(`valley: no reading after the button (got: ${text.slice(0, 80)})`);
            if ((await page.locator('.detailrow tbody tr').count()) !== 3) extra.push('valley: the hops of the example path are not all in the table');
            if ((await why.getAttribute('aria-expanded')) !== 'true') extra.push('valley: aria-expanded is not true after opening');
            await why.click();
            if ((await why.getAttribute('aria-expanded')) !== 'false' || (await page.locator('.detailrow').first().isVisible())) extra.push('valley: the second press does not close it');
            await why.click();
          }
          // the neighbours of the origin, read against the registry
          const read = page.locator('button', { hasText: 'Read what the registry says' });
          if (!(await read.count())) extra.push('valley: no button to read the registry for the neighbours');
          else {
            await read.click();
            await page.waitForTimeout(800);
            const cell = await page.locator('section[aria-label^="Neighbours of"] tbody tr').first().locator('td').nth(3).innerText().catch(() => '');
            if (!/confirmed|only the ASPA|missing|not a provider/i.test(cell)) extra.push(`valley: the neighbours were not read against the registry (got: ${cell.slice(0, 60)})`);
            if ((await page.locator('section[aria-label^="Neighbours of"] thead th', { hasText: 'Invalid' }).count()) > 0) extra.push('valley: the neighbours table still has an Invalid column');
          }
        }
        if (name === 'guide') {
          // the button that goes back to the top: hidden at the top of the page, shown after a long scroll (and left so for axe to check its contrast)
          if (await page.locator('.totop').isVisible()) extra.push('totop: the button is shown at the top of the page');
          await page.evaluate(() => window.scrollTo(0, 3000));
          await page.waitForTimeout(300);
          if (!(await page.locator('.totop').isVisible())) extra.push('totop: no button after scrolling down');
        }
        if (name === 'irr') {
          // the IRR object against the ASPA: press the button, expect what the fixture says (AS6762 is transit in the object and not in the ASPA)
          await page.locator('#as-irr button').click();
          await page.waitForTimeout(500);
          const missing = await page.locator('#as-irr .irr-line', { hasText: 'not in the ASPA' }).first().innerText().catch(() => '');
          if (!/AS6762/.test(missing)) extra.push(`irr: the transit missing from the ASPA is not shown (got: ${missing.slice(0, 80)})`);
          const only = await page.locator('#as-irr .irr-line', { hasText: 'not said to be transit' }).first().innerText().catch(() => '');
          if (!/AS3223/.test(only) || !/AS200020/.test(only)) extra.push('irr: the providers of the ASPA that the object does not call transit are not shown');
          if (!(await page.locator('#as-irr .irr-line', { hasText: 'Intermediaries' }).count())) extra.push('irr: the intermediary AS (import-via) is not shown');
          // the three sources side by side: AS6762 is transit in the object and not in CAIDA nor the ASPA; AS200020 is only in the ASPA
          const rowsText = await page.locator('#as-irr tbody tr').allInnerTexts();
          const row = (n) => rowsText.find((t) => t.startsWith(`AS${n}`)) || '';
          if (!/only IRR says it/.test(row(6762))) extra.push(`irr: the row of AS6762 does not say that only the IRR has it (got: ${row(6762).replace(/\s+/g, ' ')})`);
          if (!/the IRR and CAIDA|IRR and CAIDA|all agree/.test(row(174))) extra.push(`irr: the row of AS174 is not read as agreed (got: ${row(174).replace(/\s+/g, ' ')})`);
          if (!/only ASPA says it/.test(row(200020))) extra.push('irr: the row of AS200020 does not say that only the ASPA has it');
          // the words of the CAIDA and ASPA columns stay on one line, whatever the width of the page (a word broken in two was seen at the width of a laptop)
          const broken = await page.evaluate(() => [...document.querySelectorAll('#as-irr tbody td.nowrap')].filter((td) => { const r = document.createRange(); r.selectNodeContents(td); return r.getClientRects().length > 1; }).length);
          if (broken) extra.push(`irr: ${broken} cells of the CAIDA and ASPA columns are broken on two lines`);
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
          // the list must take no height: the home page is made to fit a screen
          if (vname === 'desktop') {
            const [without, withList] = await page.evaluate(() => { const r = document.getElementById('recent'); r.hidden = true; const a = document.documentElement.scrollHeight; r.hidden = false; return [a, document.documentElement.scrollHeight]; });
            if (Math.abs(withList - without) > 1) extra.push(`recent: the list adds ${withList - without}px to the height of the page`);
          }
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
        if (name === 'guide' && (await page.locator('.totop').isVisible())) {
          await page.locator('.totop').click();
          await page.waitForFunction(() => window.scrollY < 2, null, { timeout: 5000 }).catch(() => {});
          if ((await page.evaluate(() => window.scrollY)) > 2) extra.push('totop: the button does not go to the top');
          if (await page.locator('.totop').isVisible()) extra.push('totop: the button stays after going to the top');
          if ((await page.evaluate(() => document.activeElement && document.activeElement.tagName)) !== 'BODY') extra.push('totop: the focus does not go to the top');
        }
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
