// Log a snapshot of the ASPA data as a run of a GitLab "model experiment".
//
// GitLab exposes an MLflow-compatible API for experiment tracking; here an
// "experiment" is the time series of the ASPA data and every run is one snapshot,
// so the project's Analyze > Model experiments page charts the adoption of ASPA
// over time. Plain HTTP calls, no MLflow client needed (Node.js 18+).
//
//   node scripts/log-snapshot.mjs --dry-run     print the metrics, send nothing
//   node scripts/log-snapshot.mjs --history-only   only bring the history branch up to date (the hourly job):
//                                               no model experiment run, no RIPEstat call; the coverage
//                                               figures of the day's row are kept
//
// In CI the job token authenticates the calls (CI_JOB_TOKEN, CI_API_V4_URL,
// CI_PROJECT_ID). Outside CI set MLFLOW_API (the .../ml/mlflow/api/2.0/mlflow URL)
// and MLFLOW_TOKEN.

import { createRequire } from 'node:module';

const { applyDay, classify } = createRequire(import.meta.url)('../site/history.js');

const SITE = process.env.ASPA_SITE || 'https://aspa.ping6.it';
const EXPERIMENT = process.env.ASPA_EXPERIMENT || 'aspa-adoption';
const DRY = process.argv.includes('--dry-run');
const HISTORY_ONLY = process.argv.includes('--history-only');
const API = process.env.MLFLOW_API ||
  `${process.env.CI_API_V4_URL}/projects/${process.env.CI_PROJECT_ID}/ml/mlflow/api/2.0/mlflow`;
const TOKEN = process.env.MLFLOW_TOKEN || process.env.CI_JOB_TOKEN;
const RIRS = ['afrinic', 'apnic', 'arin', 'lacnic', 'ripe'];

const getJson = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

// Same definitions as the page (site/app.js): customer ASes with a valid ASPA,
// distinct providers (AS0 excluded), median set size, AS0-only ASPAs, per trust anchor.
function summarise(data) {
  const aspas = data.aspas || [];
  const sizes = aspas.map((a) => a.providers.length).sort((x, y) => x - y);
  const providers = new Set();
  let zero = 0;
  const perRir = Object.fromEntries(RIRS.map((r) => [r, 0]));
  for (const a of aspas) {
    if (a.providers.length === 1 && a.providers[0] === 'AS0') zero++;
    for (const p of a.providers) if (p !== 'AS0') providers.add(p);
    const tal = (a.source && a.source[0] && a.source[0].tal) || a.ta;
    if (tal in perRir) perRir[tal]++;
  }
  return {
    aspas: aspas.length,
    provider_ases: providers.size,
    median_providers: sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : 0,
    largest_provider_set: sizes[sizes.length - 1] || 0,
    no_provider_aspas: zero,
    ...Object.fromEntries(RIRS.map((r) => [`aspas_${r}`, perRir[r]])),
  };
}

// GitLab accepts a personal/project access token as a bearer token, and a CI job token
// as the JOB-TOKEN header or as the password of the user gitlab-ci-token: find which one
// this instance accepts for the model experiments API.
const authStyles = [
  { name: 'bearer', headers: { Authorization: `Bearer ${TOKEN}` } },
  { name: 'job-token', headers: { 'JOB-TOKEN': TOKEN } },
  { name: 'basic', headers: { Authorization: `Basic ${Buffer.from(`gitlab-ci-token:${TOKEN}`).toString('base64')}` } },
];
let auth = authStyles[0];
const detectAuth = async () => {
  for (const style of authStyles) {
    const r = await fetch(`${API}/experiments/list`, { headers: style.headers });
    console.log(`auth ${style.name}: HTTP ${r.status}`);
    if (r.ok) { auth = style; return; }
  }
  throw new Error('the token is not accepted by the model experiments API');
};

const call = async (method, path, body) => {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return { status: r.status, json: text ? JSON.parse(text) : {} };
};

const [data, status] = await Promise.all([
  getJson(`${SITE}/data/aspas.json`),
  getJson(`${SITE}/data/status.json`).catch(() => null),
]);
const metrics = summarise(data);

// Coverage: of the ASes seen by the RIPE RIS route collectors (RIPEstat, ris-asns), how many have an
// ASPA. Left out, with a message, when RIPEstat does not answer.
let visibility = null;   // the ASes of the ASPAs that the collectors do not see, for the quality checks
if (!HISTORY_ONLY) try {
  const seen = (await getJson('https://stat.ripe.net/data/ris-asns/data.json?list_asns=true')).data.asns;
  const customers = new Set((data.aspas || []).map((a) => a.customer));
  metrics.bgp_ases = seen.length;
  metrics.aspa_in_bgp = seen.filter((n) => customers.has(`AS${n}`)).length;
  const seenSet = new Set(seen.map((n) => `AS${n}`));
  const named = new Set((data.aspas || []).flatMap((a) => [a.customer, ...a.providers]));
  named.delete('AS0');
  visibility = { seen: seen.length, unseen: [...named].filter((as) => !seenSet.has(as)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))) };
} catch (e) {
  console.error(`coverage not computed: ${e.message}`);
}
const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const params = {
  source: SITE,
  validator: (status && status.version) || 'unknown',
  last_validation: (status && status.lastUpdateDone) || 'unknown',
};
console.log(`${day}`, metrics, params, visibility ? `${visibility.unseen.length} ASes of the ASPAs not seen in BGP` : 'no visibility data');
if (!metrics.aspas) throw new Error('no ASPAs in the data: not logging an empty snapshot');
if (DRY) process.exit(0);
if (!TOKEN) throw new Error('no token: set CI_JOB_TOKEN or MLFLOW_TOKEN');
if (!HISTORY_ONLY) await detectAuth();

// The same snapshot goes to the `history` branch, which the page reads through the mirror on the public
// project (see site/history.js for the events): the day's row in history.json, the day's changes in
// events.json and the Atom feed of the recent changes, in one commit. Needs a token that can write to
// the repository: the project access token (MLFLOW_TOKEN) can, the job token cannot. A failure here
// must not hide the model experiment run below, so it is reported at the end.
const HISTORY_BRANCH = process.env.ASPA_HISTORY_BRANCH || 'history';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function atomFeed(events) {
  const kinds = classify(events);
  const days = [...new Set(kinds.map((e) => e.date))].sort().reverse().slice(0, 30);
  const entries = days.map((d) => {
    const ev = kinds.filter((e) => e.date === d);
    const n = (k) => ev.filter((e) => e.kind === k).length;
    const what = (e) => (e.kind === 'new' ? `new, providers ${e.providers.join(', ')}`
      : e.kind === 'removed' ? 'removed'
        : `providers ${[...e.added.map((p) => `+${p}`), ...e.dropped.map((p) => `-${p}`)].join(' ')}`);
    const items = ev.slice(0, 200).map((e) => `<li><a href="${SITE}/#${e.customer}">${e.customer}</a>: ${esc(what(e))}</li>`).join('');
    const more = ev.length > 200 ? `<p>and ${ev.length - 200} more</p>` : '';
    return `  <entry>
    <id>tag:aspa.ping6.it,${d}:changes</id>
    <title>${d}: ${n('new')} new, ${n('removed')} removed, ${n('changed')} changed</title>
    <updated>${d}T06:30:00Z</updated>
    <link rel="alternate" href="${SITE}/"/>
    <content type="html">${esc(`<ul>${items}</ul>${more}`)}</content>
  </entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:aspa.ping6.it,2026:changes</id>
  <title>ASPA Explorer: changes</title>
  <subtitle>ASPAs that appeared, changed their providers or disappeared, day by day</subtitle>
  <link rel="self" href="${SITE}/changes.atom"/>
  <link rel="alternate" href="${SITE}/"/>
  <updated>${days.length ? `${days[0]}T06:30:00Z` : new Date(now).toISOString()}</updated>
${entries.join('\n')}
</feed>
`;
}

let historyError = null;
try {
  const project = API.replace(/\/ml\/mlflow\/api\/2\.0\/mlflow$/, '');
  const headers = { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json' };
  const read = async (name) => {
    const r = await fetch(`${project}/repository/files/${encodeURIComponent(name)}/raw?ref=${HISTORY_BRANCH}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`reading ${name}: HTTP ${r.status}`);
    return r.text();
  };
  const [historyText, eventsText, feedText] = await Promise.all([read('history.json'), read('events.json'), read('changes.atom')]);
  if (!historyText) throw new Error('history.json not found on the history branch');
  const oldRows = JSON.parse(historyText);
  const rows = oldRows.filter((r) => r.date !== day);
  // the row of the day keeps what an earlier run added (the coverage figures) and takes the new counts
  rows.push({ ...oldRows.find((r) => r.date === day), date: day, ...metrics, src: 'aspa' });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const oldEvents = eventsText ? JSON.parse(eventsText) : [];
  const events = applyDay(oldEvents, data.aspas || [], day);
  const eventsJson = JSON.stringify(events);
  const eventsChanged = eventsJson !== JSON.stringify(oldEvents);
  const rowsJson = JSON.stringify(rows);
  if (HISTORY_ONLY && rowsJson === historyText.trim() && !eventsChanged && eventsText !== null) {
    console.log(`history: nothing changed on ${day}`);
    process.exit(0);
  }
  const actions = [{ action: 'update', file_path: 'history.json', content: rowsJson }];
  if (eventsChanged || eventsText === null) actions.push({ action: eventsText === null ? 'create' : 'update', file_path: 'events.json', content: eventsJson });
  if (eventsChanged || feedText === null) actions.push({ action: feedText === null ? 'create' : 'update', file_path: 'changes.atom', content: atomFeed(events) });
  if (visibility) {
    const visText = await read('visibility.json');
    actions.push({ action: visText === null ? 'create' : 'update', file_path: 'visibility.json', content: JSON.stringify({ date: day, ...visibility }) });
  }
  const todays = events.filter((e) => e[0] === day).length;
  const put = await fetch(`${project}/repository/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      branch: HISTORY_BRANCH,
      commit_message: `Snapshot ${day}: ${metrics.aspas} ASPAs, ${todays} change${todays === 1 ? '' : 's'}`,
      author_name: 'Antonio Prado',
      author_email: 'antonio.prado@dei.unipd.it',
      actions,
    }),
  });
  if (!put.ok) throw new Error(`committing: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
  console.log(`history: ${rows.length} rows, ${todays} changes on ${day}, ${actions.length} files`);
} catch (e) {
  historyError = e;
  console.error(`history not updated: ${e.message}`);
}

if (HISTORY_ONLY) {
  if (historyError) throw historyError;
  process.exit(0);
}

// Find or create the experiment.
let exp = await call('GET', `experiments/get-by-name?experiment_name=${encodeURIComponent(EXPERIMENT)}`);
let experimentId = exp.status === 200 ? exp.json.experiment.experiment_id : null;
if (!experimentId) experimentId = (await call('POST', 'experiments/create', { name: EXPERIMENT })).json.experiment_id;

// One run per snapshot.
const tags = [{ key: 'mlflow.runName', value: `${day} ${new Date(now).toISOString().slice(11, 16)}Z` }];
if (process.env.CI_COMMIT_SHA) tags.push({ key: 'commit', value: process.env.CI_COMMIT_SHA });
if (process.env.CI_PIPELINE_URL) tags.push({ key: 'pipeline', value: process.env.CI_PIPELINE_URL });
const run = (await call('POST', 'runs/create', { experiment_id: experimentId, start_time: now, tags })).json.run;
const runId = run.info.run_id;
await call('POST', 'runs/log-batch', {
  run_id: runId,
  metrics: Object.entries(metrics).map(([key, value]) => ({ key, value, timestamp: now, step: 0 })),
  params: Object.entries(params).map(([key, value]) => ({ key, value: String(value) })),
});
await call('POST', 'runs/update', { run_id: runId, status: 'FINISHED', end_time: Date.now() });
console.log(`logged run ${runId} in experiment ${EXPERIMENT} (${experimentId})`);
if (historyError) throw historyError;
