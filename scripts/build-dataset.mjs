// A dated snapshot of the data behind the site, for research that has to be repeated: the ASPAs as they are now, their
// history and events, the adoption numbers, the route leaks and the status of the validators, with a manifest (size and
// SHA-256 of each file) and a README, in one .tar.gz, plus an index of all the snapshots (served under /datasets/).
// Run it once a month (cron) as an unprivileged user.
//
//   node scripts/build-dataset.mjs OUT_DIR [SITE_URL]
//
// The files come from the public site (default https://aspa.ping6.it) and from the history branch of the public project.
import { mkdir, mkdtemp, writeFile, readFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'aspa-explorer dataset (https://aspa.ping6.it; antonio.prado@dei.unipd.it)';
const GITLAB = 'https://gitlab.dei.unipd.it/api/v4/projects/5246/repository/files';
export const LICENSE = 'CC BY 4.0';

// name in the archive -> where it comes from (a path of the site, or a file of the history branch)
export const FILES = (site) => [
  ['aspas.csv', `${site}/api/v1/aspas.csv`, 'the validated ASPAs now: customer AS and its providers'],
  ['aspas.json', `${site}/api/v1/aspas.json`, 'the same, as JSON'],
  ['history.json', `${GITLAB}/history.json/raw?ref=history`, 'one row a day since 12 October 2023: ASPAs in total and per RIR, provider ASes, coverage'],
  ['events.json', `${GITLAB}/events.json/raw?ref=history`, 'every change of an ASPA since 12 October 2023: [date, customer, providers or null]'],
  ['visibility.json', `${GITLAB}/visibility.json/raw?ref=history`, 'the ASes with an ASPA that the RIPE RIS collectors do not see, with the day'],
  ['adoption.json', `${site}/api/v1/adoption.json`, 'networks seen in BGP with an ASPA: by RIR, country and size, the largest transit networks'],
  ['trends.json', `${site}/api/v1/trends.json`, 'networks with an ASPA, month by month, for each RIR and country'],
  ['leaks.json', `${site}/api/v1/leaks.json`, 'places of valley in the routes of the 30 collectors of RIPE RIS and RouteViews, today'],
  ['leaks-history.json', `${site}/api/v1/leaks-history.json`, 'one row a day of the totals of the leaks'],
  ['validators.json', `${site}/api/v1/validators.json`, 'the ASPAs of three validators compared'],
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The manifest of a snapshot. files: [{ name, about, data: Buffer }]
export function manifestOf(files, date, version) {
  return {
    name: 'ASPA Explorer data',
    date,
    version,
    license: LICENSE,
    source: 'https://aspa.ping6.it',
    cite: 'Prado, A., Centenaro, M., Vangelista, L., ASPA Explorer (https://aspa.ping6.it); see CITATION.cff in https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer',
    files: files.map((f) => ({ name: f.name, about: f.about, bytes: f.data.length, sha256: sha256(f.data) })),
  };
}

export function readmeOf(manifest) {
  return [
    `ASPA Explorer data, snapshot of ${manifest.date}`,
    '',
    `License: ${manifest.license}. Source: ${manifest.source}. How to cite: ${manifest.cite}`,
    '',
    'Files (size and SHA-256 are in MANIFEST.json):',
    ...manifest.files.map((f) => `  ${f.name.padEnd(20)} ${f.about}`),
    '',
    'The ASPAs are the objects validated by Routinator (rpki.ping6.it); the history before 16 October 2026 was rebuilt from the RIPE NCC RPKI archive,',
    'and since then it comes from that validator. Countries and registries are those of the delegation files of the five RIRs, the customer cones',
    'those of the CAIDA AS Relationships dataset. The documentation of each file is on https://aspa.ping6.it/api.html and in the wiki of the project.',
    '',
  ].join('\n');
}

// The index of the snapshots in a folder: [{ name, date, bytes, sha256 }], newest first.
export function addToIndex(index, entry) {
  return index.filter((e) => e.name !== entry.name).concat(entry).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/build-dataset.mjs OUT_DIR [SITE_URL]'); process.exit(2); }
  const site = (process.argv[3] || 'https://aspa.ping6.it').replace(/\/$/, '');
  const date = new Date().toISOString().slice(0, 10);
  const get = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const files = [];
  for (const [name, url, about] of FILES(site)) files.push({ name, about, data: await get(url) });
  let version = 'unknown';
  try { version = JSON.parse(await get(`${site}/version.json`)).version; } catch { /* the version is only a note */ }
  const manifest = manifestOf(files, date, version);
  const base = `aspa-explorer-data-${date}`;
  const stage = await mkdtemp(join(tmpdir(), 'aspa-dataset-'));
  try {
    const dir = join(stage, base);
    await mkdir(dir);
    for (const f of files) await writeFile(join(dir, f.name), f.data);
    await writeFile(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(dir, 'README.txt'), readmeOf(manifest));
    await mkdir(out, { recursive: true });
    const archive = join(out, `${base}.tar.gz`);
    await promisify(execFile)('tar', ['-czf', `${archive}.tmp`, '-C', stage, base]);
    await rename(`${archive}.tmp`, archive);
    const data = await readFile(archive);
    let index = [];
    try { index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8')).snapshots; } catch { /* the first snapshot */ }
    index = addToIndex(index, { name: `${base}.tar.gz`, date, bytes: (await stat(archive)).size, sha256: sha256(data), license: LICENSE });
    await writeFile(join(out, 'index.json.tmp'), JSON.stringify({ generated: new Date().toISOString(), snapshots: index }, null, 2) + '\n');
    await rename(join(out, 'index.json.tmp'), join(out, 'index.json'));
    console.log(`${base}.tar.gz: ${files.length} files, ${(data.length / 1e6).toFixed(1)} MB, ${index.length} snapshot${index.length === 1 ? '' : 's'}; the folder has ${(await readdir(out)).length} entries`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
