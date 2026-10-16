// Create the release of the tag being built, with the notes of its CHANGELOG.md section,
// in this (internal) project and in the public mirror.
//
// The push mirror copies branches and tags only, so releases (and the wiki, see
// mirror-wiki.sh) are published to the public project through its API. Runs in the
// pipeline of a tag; needs CI_COMMIT_TAG and, for the public project, MIRROR_TOKEN.
import { readFileSync } from 'node:fs';

const tag = process.env.CI_COMMIT_TAG;
if (!tag) throw new Error('CI_COMMIT_TAG is not set: run this job in a tag pipeline');
const version = tag.replace(/^v/, '');
const PUBLIC = process.env.PUBLIC_PROJECT || 'Antonio-Prado/aspa-explorer';
const SERVER = process.env.CI_API_V4_URL || 'https://gitlab.dei.unipd.it/api/v4';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const m = changelog.match(new RegExp(`## \\[${esc(version)}\\][^\\n]*\\n([\\s\\S]*?)(?:\\n## \\[|\\n\\[Unreleased\\]:)`));
if (!m) throw new Error(`no section for ${version} in CHANGELOG.md`);
const notes = m[1].trim();

const call = async (method, url, headers, body) => {
  const r = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : {} };
};

async function release(label, base, headers, waitForTag) {
  if (waitForTag) {
    for (let i = 0; i < 16; i++) {   // the push mirror may take a moment to deliver the tag
      if ((await call('GET', `${base}/repository/tags/${encodeURIComponent(tag)}`, headers)).status === 200) break;
      if (i === 15) throw new Error(`${label}: tag ${tag} has not arrived`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  const existing = await call('GET', `${base}/releases/${encodeURIComponent(tag)}`, headers);
  if (existing.status === 200) { console.log(`${label}: release ${tag} already exists`); return; }
  const r = await call('POST', `${base}/releases`, headers, { tag_name: tag, name: `ASPA Explorer ${version}`, description: notes });
  if (r.status >= 300) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  console.log(`${label}: release ${tag} created`);
}

await release('internal', `${SERVER}/projects/${process.env.CI_PROJECT_ID}`, { 'JOB-TOKEN': process.env.CI_JOB_TOKEN });
if (process.env.MIRROR_TOKEN) {
  await release('public', `${SERVER}/projects/${encodeURIComponent(PUBLIC)}`, { 'PRIVATE-TOKEN': process.env.MIRROR_TOKEN }, true);
} else {
  console.log('MIRROR_TOKEN is not available (is the tag protected?): public release skipped');
  process.exitCode = 1;
}
