'use strict';

// Site footer shared by all pages. Two rows:
//   1. source project, release, last commit, accessibility, visitor's address
//   2. credits: Powered by DEI, Served by FreeBSD, Made with vi
// The release comes from /version.json (same origin, always available). When the
// GitLab project can be read without signing in, the latest tag and the last
// commit are read from the GitLab API on every page load; otherwise the API
// answers with an error and the static information stays.
(() => {
  const HOST = 'https://gitlab.dei.unipd.it';
  const PATH = 'Antonio-Prado/aspa-explorer';
  const PROJECT = `${HOST}/${PATH}`;
  const API = `${HOST}/api/v4/projects/${encodeURIComponent(PATH)}`;
  const VERSION = /^v?\d+\.\d+\.\d+$/;

  const footer = document.querySelector('footer.foot');
  if (!footer) return;

  const el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    node.append(...children);
    return node;
  };
  const link = (href, ...children) => el('a', { href, rel: 'noopener' }, ...children);
  const logo = (src, alt, w, h) => el('img', { src, alt, width: w, height: h });

  // Row 1. Items other than the project link are separated by CSS; the ones that
  // depend on remote data stay hidden until their data is known.
  const item = (hidden, ...children) => {
    const span = el('span', { class: 'item' }, ...children);
    span.hidden = hidden;
    return span;
  };
  const releaseLink = link(PROJECT, '');
  releaseLink.className = 'ver';
  const commitLink = link(PROJECT, '');
  const ipValue = el('span', { class: 'ip' });
  const releaseItem = item(true, 'Release ', releaseLink);
  const commitItem = item(true, 'Last commit ', commitLink);
  const ipItem = item(true, 'Your IP: ', ipValue);
  const build = el('p', { class: 'build' },
    'Source: ', link(PROJECT, PATH),
    releaseItem, commitItem,
    item(false, link('/guide.html#accessibility', 'Accessibility')),
    ipItem);

  // Row 2. Logos are links; the vi icon is decorative (the text next to it says it all).
  const credits = el('ul', { class: 'credits', 'aria-label': 'Credits' },
    el('li', {}, 'Powered by ',
      link('https://www.dei.unipd.it', logo('/img/dei-logo.png?v=1', 'DEI, Department of Information Engineering, University of Padova', 111, 28))),
    el('li', {}, 'Served by ',
      link('https://www.freebsd.org', logo('/img/freebsd-logo.png?v=1', 'FreeBSD', 97, 28))),
    el('li', {}, logo('/img/vi-logo.svg?v=1', '', 28, 28), ' Made with vi ', el('code', {}, ':wq')));

  footer.append(build, credits);

  const showRelease = (tag, fromApi) => {
    if (showRelease.api && !fromApi) return;
    if (fromApi) showRelease.api = true;
    const v = tag.replace(/^v/, '');
    releaseLink.textContent = `v${v}`;
    releaseLink.href = `${PROJECT}/-/releases/v${v}`;
    releaseItem.hidden = false;
  };

  const getJson = async (url, opts) => {
    const r = await fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opts));
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };

  // Static release first: works even when the GitLab project is not public.
  getJson('/version.json', { cache: 'no-cache' })
    .then((d) => { if (d && VERSION.test('v' + d.version)) showRelease(String(d.version), false); })
    .catch(() => { /* no version file */ });

  // Latest tag (highest version) from GitLab, if reachable.
  getJson(`${API}/repository/tags?order_by=version&sort=desc&per_page=1`)
    .then((tags) => {
      const tag = tags && tags[0] && String(tags[0].name || '');
      if (tag && VERSION.test(tag)) showRelease(tag, true);
    })
    .catch(() => { /* project not readable without signing in, or GitLab unreachable */ });

  // Last commit on main, if reachable.
  getJson(`${API}/repository/commits/main`)
    .then((c) => {
      const sha = String((c && c.id) || '');
      if (!/^[0-9a-f]{40}$/.test(sha)) return;
      const day = c.committed_date ? ' · ' + String(c.committed_date).slice(0, 10) : '';
      commitLink.textContent = sha.slice(0, 7) + day;
      commitLink.href = `${PROJECT}/-/commit/${sha}`;
      commitItem.hidden = false;
    })
    .catch(() => { /* as above */ });

  // The visitor's own address as the server sees it; hidden if the request fails.
  getJson('/client-ip', { cache: 'no-store' })
    .then((d) => {
      const ip = String((d && d.ip) || '');
      if (!/^[0-9A-Fa-f.:]{2,45}$/.test(ip)) return;
      ipValue.textContent = ip;
      ipItem.hidden = false;
    })
    .catch(() => { /* endpoint not available */ });
})();
