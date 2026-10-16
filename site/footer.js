'use strict';

// Build line in the page footer: link to the GitLab project with the version number.
// The version comes from /version.json (same origin, always available). When the
// project is readable without signing in, the latest tag and the last commit are
// read from the GitLab API on every page load and replace/extend it; otherwise
// the API answers with an error and the static information stays.
(() => {
  const HOST = 'https://gitlab.dei.unipd.it';
  const PATH = 'Antonio-Prado/aspa-explorer';
  const PROJECT = `${HOST}/${PATH}`;
  const API = `${HOST}/api/v4/projects/${encodeURIComponent(PATH)}`;
  const VERSION = /^v?\d+\.\d+\.\d+$/;

  const footer = document.querySelector('footer.foot');
  if (!footer) return;

  const p = document.createElement('p');
  p.className = 'build';
  const link = (href) => {
    const a = document.createElement('a');
    a.rel = 'noopener';
    if (href) a.href = href;
    return a;
  };
  // Items that appear only when their data is known; the separator is drawn by CSS.
  const item = () => {
    const span = document.createElement('span');
    span.className = 'item';
    span.hidden = true;
    return span;
  };
  const project = link(PROJECT);
  project.textContent = PATH;
  const version = link();
  version.className = 'ver';
  const commit = link();
  const versionItem = item();
  const commitItem = item();
  versionItem.append(version);
  commitItem.append(commit);
  p.append('Source: ', project, versionItem, commitItem);
  footer.append(p);

  const show = (node, text, href) => {
    node.textContent = text;
    node.href = href;
    node.parentNode.hidden = false;
  };
  let fromApi = false; // the GitLab answer wins over the static file whatever arrives first
  const setVersion = (tag, api) => {
    if (fromApi && !api) return;
    if (api) fromApi = true;
    const v = tag.replace(/^v/, '');
    show(version, `v${v}`, `${PROJECT}/-/tags/v${v}`);
  };

  const getJson = async (url, opts) => {
    const r = await fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opts));
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };

  // Static version first: works even when the GitLab project is not public.
  getJson('/version.json', { cache: 'no-cache' })
    .then((d) => { if (d && VERSION.test('v' + d.version)) setVersion(String(d.version)); })
    .catch(() => { /* no version file */ });

  // Latest tag (highest version) from GitLab, if reachable.
  getJson(`${API}/repository/tags?order_by=version&sort=desc&per_page=1`)
    .then((tags) => {
      const tag = tags && tags[0] && String(tags[0].name || '');
      if (tag && VERSION.test(tag)) setVersion(tag, true);
    })
    .catch(() => { /* project not readable without signing in, or GitLab unreachable */ });

  // Last commit on main, if reachable.
  getJson(`${API}/repository/commits/main`)
    .then((c) => {
      const sha = String((c && c.id) || '');
      if (!/^[0-9a-f]{40}$/.test(sha)) return;
      const day = c.committed_date ? ' · ' + String(c.committed_date).slice(0, 10) : '';
      show(commit, `commit ${sha.slice(0, 7)}${day}`, `${PROJECT}/-/commit/${sha}`);
    })
    .catch(() => { /* as above */ });
})();
