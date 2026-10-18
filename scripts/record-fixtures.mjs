// Records, from the running site, the small data files that the accessibility test (scripts/test-a11y.mjs) serves
// instead of the real service, trimmed so that they stay small. Run it when the data files change shape:
//   node scripts/record-fixtures.mjs [SITE_URL]
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.argv[2] || 'https://aspa.ping6.it';
const GITLAB = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'a11y');
const UA = 'aspa-explorer fixtures (https://aspa.ping6.it)';
const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};
const save = async (name, value) => { await mkdir(dirname(join(OUT, name)), { recursive: true }); await writeFile(join(OUT, name), JSON.stringify(value) + '\n'); console.log(name); };

// ASPAs: those that involve the AS used by the tests, and the first ones
const data = await get(`${SITE}/data/aspas.json`);
const FOCUS = 'AS12779';
const involved = data.aspas.filter((a) => a.customer === FOCUS || a.providers.includes(FOCUS));
const providers = new Set(involved.flatMap((a) => [a.customer, ...a.providers]));
const rest = data.aspas.filter((a) => !involved.includes(a)).slice(0, 80);
const slim = (a) => ({ customer: a.customer, providers: a.providers, source: (a.source || []).slice(0, 1) });
await save('data/aspas.json', { metadata: data.metadata, aspas: [...involved, ...rest].map(slim) });

const status = await get(`${SITE}/data/status.json`);
await save('data/status.json', Object.fromEntries(Object.entries(status).filter(([, v]) => typeof v !== 'object' || v === null)));

for (const f of ['adoption', 'leaks', 'validators', 'meta', 'leaks-history']) {
  try { await save(`api/v1/${f}.json`, await get(`${SITE}/api/v1/${f}.json`)); } catch (err) { console.error(`skipped ${f}: ${err.message}`); }
}
try {
  const sh = await get(`${SITE}/api/v1/status-history.json`);
  const from = sh.samples.length ? sh.samples[sh.samples.length - 1][0] - 7 * 86400 : 0;
  await save('api/v1/status-history.json', { ...sh, samples: sh.samples.filter(([t]) => t >= from) });
} catch (err) { console.error(`skipped status-history: ${err.message}`); }
try { await save('api/v1/as.json', await get(`${SITE}/api/v1/as/${FOCUS.slice(2)}`)); } catch (err) { console.error(`skipped as: ${err.message}`); }

const file = (name) => get(`${GITLAB}/${name}.json/raw?ref=history`);
await save('gitlab/events.json', (await file('events')).slice(-300));
await save('gitlab/history.json', (await file('history')).slice(-60));
await save('gitlab/visibility.json', await file('visibility'));
console.log(`${providers.size} ASes around ${FOCUS}`);
