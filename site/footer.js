'use strict';

// Site footer shared by all pages. Two rows:
//   1. release, last commit, accessibility, visitor's address
//   2. credits: Powered by DEI, Served by FreeBSD, Made with vi
// The release comes from /version.json and the commit the running page was built
// from comes from /build.json (written at deploy time by scripts/build-info.sh);
// both are same-origin and available even when the GitLab project is private.
// When the project can be read without signing in, the latest tag and the last
// commit are also read from the GitLab API on every page load and take precedence;
// otherwise the API answers with an error and the static information stays.
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

  // Row 1, as in the other sites of the family: release, last commit, accessibility,
  // visitor's address. The release and the commit are links (the commit always goes to
  // the project). Items that depend on remote data stay hidden until their data is known;
  // separators are drawn by CSS, and the first visible item gets no leading separator.
  const item = (hidden, ...children) => {
    const span = el('span', { class: 'item' }, ...children);
    span.hidden = hidden;
    return span;
  };
  const versionText = el('strong', { class: 'ver' }, '');
  const releaseLink = link(`${PROJECT}/-/releases`, 'Release ', versionText);
  const commitLink = link(PROJECT, '');
  const ipValue = el('span', { class: 'ip' });
  const releaseItem = item(true, releaseLink);
  const commitItem = item(true, commitLink);
  const ipItem = item(true, 'Your IP: ', ipValue);
  const items = [releaseItem, commitItem, item(false, link('/guide.html#accessibility', 'Accessibility')), ipItem];
  const build = el('p', { class: 'build' }, ...items);
  const refresh = () => {
    let first = true;
    for (const it of items) {
      it.classList.toggle('first', first && !it.hidden);
      if (!it.hidden) first = false;
    }
  };

  // Row 2. Logos are links; the vi icon is decorative (the text next to it says it all).
  const credits = el('ul', { class: 'credits', 'aria-label': 'Credits' },
    el('li', {}, 'Powered by ',
      link('https://www.dei.unipd.it', logo('/img/dei-logo.png?v=1', 'DEI, Department of Information Engineering, University of Padova', 111, 28))),
    el('li', {}, 'Served by ',
      link('https://www.freebsd.org', logo('/img/freebsd-logo.png?v=1', 'FreeBSD', 97, 28))),
    el('li', {}, logo('/img/vi-logo.svg?v=1', '', 28, 28), ' Made with vi ', el('code', {}, ':wq')));

  footer.append(build, credits);
  refresh();

  const showRelease = (tag, fromApi) => {
    if (showRelease.api && !fromApi) return;
    if (fromApi) showRelease.api = true;
    const v = tag.replace(/^v/, '');
    versionText.textContent = `v${v}`;
    releaseLink.href = `${PROJECT}/-/releases/v${v}`;
    releaseItem.hidden = false;
    refresh();
  };

  // Commit date and time as YYYYMMDDhhmmss, in Italian time
  const stamp = (d) => {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).forEach((x) => { parts[x.type] = x.value; });
    return parts.year + parts.month + parts.day + parts.hour + parts.minute + parts.second;
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

  const showCommit = (sha, iso, fromApi) => {
    if (!/^[0-9a-f]{40}$/.test(sha)) return;
    if (showCommit.api && !fromApi) return;
    if (fromApi) showCommit.api = true;
    const when = iso ? new Date(iso) : null;
    commitLink.textContent = 'Last commit ' + sha.slice(0, 7) + (when && !isNaN(when) ? '@' + stamp(when) : '');
    commitLink.href = PROJECT;
    commitItem.hidden = false;
    refresh();
  };

  // Commit the running page was built from.
  getJson('/build.json', { cache: 'no-cache' })
    .then((d) => { if (d) showCommit(String(d.commit || ''), d.date, false); })
    .catch(() => { /* no build file */ });

  // Last commit on main from GitLab, if reachable.
  getJson(`${API}/repository/commits/main`)
    .then((c) => { if (c) showCommit(String(c.id || ''), c.committed_date, true); })
    .catch(() => { /* as above */ });

  // The visitor's own address as the server sees it; hidden if the request fails.
  getJson('/client-ip', { cache: 'no-store' })
    .then((d) => {
      const ip = String((d && d.ip) || '');
      if (!/^[0-9A-Fa-f.:]{2,45}$/.test(ip)) return;
      ipValue.textContent = ip;
      ipItem.hidden = false;
      refresh();
    })
    .catch(() => { /* endpoint not available */ });
})();
