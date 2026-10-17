# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.10.0] - 2026-10-17

### Added
- **Adoption page** (`adoption.html`): the networks seen in BGP that have an ASPA, by size of the network (customer cone, from the CAIDA AS Relationships dataset), by RIR and by country (from the delegation files of the five RIRs), and the 100 largest transit networks with a filter for those without an ASPA. The numbers come from `scripts/build-adoption.mjs`, run once a day, and are also served as `/api/v1/adoption.json`. `scripts/test-adoption.mjs` tests it.
- **Status page** (`status.html`, linked from the footer): when the validator, the per-AS API files, the daily history, the BGP visibility file, the adoption numbers and the notifier were last updated, judged against how often each should change. The notifier answers `GET /api/v1/subscriptions/health` for it.
- **Examples page** (`examples.html`): the rules for writing an ASPA, five cases (one upstream, several providers with a backup, a transit network, no provider, an IXP member), the common mistakes, and a checker that reviews a list of providers and compares it with the ASPA that is published.
- Navigation: Adoption, Examples, API and Guide at the top.

## [1.9.0] - 2026-10-17

### Added
- **Notifications by e-mail and webhook** for any AS: the *Get notified* form under a lookup, a new `notifier/` service (Node.js, SQLite) that checks the validator every ten minutes, announces a change when two checks in a row show it, and sends it to the subscribers. E-mail needs a confirmation link and carries `List-Unsubscribe`; mails are DKIM-signed and go out through the local mailer. Webhooks must answer a challenge, are signed with HMAC-SHA256 (`X-ASPA-Signature`) and are called only on public https addresses (no private networks, no redirects). Limits per visitor, per address and per AS; unconfirmed requests are deleted after two days.
- `subscription.html` to confirm or cancel from the links in the mails; `deploy/freebsd/aspa_notify` rc script; nginx location for `/api/v1/subscriptions`; guide and API page describe the service and what is kept.
- `scripts/test-notify.mjs`, 18 tests.

### Fixed
- A new lookup made on the page of an AS (`/as/AS3333`) did nothing: the code that turns the address back into `/#AS680` called `history.replaceState`, but `history` is the name of the daily series in `app.js`. It now calls `window.history`.

### Changed
- The definition of an ASPA moved from the page footer to the top, under the title.

## [1.8.0] - 2026-10-17

### Added
- **Origin validation (ROAs)** in *Check the routes seen in BGP*: every distinct prefix and origin of the routes is checked against the ROAs of the validator (valid, not found, invalid with the reason), above the ASPA verification of the paths. At most 200 pairs per request. nginx exposes Routinator's validity check at `/data/validity/AS<n>/<prefix>`.
- **A page for every AS**: `/as/AS3333` (or `/as/3333`) is the same page already showing that AS. Looking up an AS has a *Share and follow* block with the links, a badge and the Markdown and HTML to paste.
- **Badge** `/badge/AS3333.svg`: the number of providers in the ASPA of the AS, *none*, *no providers (AS0)* or *published, with errors*.
- **Atom feed per AS** `/feed/AS3333.atom`: the latest 100 changes of its own ASPA and of the ASPAs that add or drop it as a provider.
- **Public API** `/api/v1/as/3333`: the ASPA, the ASPAs that name it, BGP visibility, quality findings and history, as JSON (CORS open), with an `api.html` page and an OpenAPI 3.1 description at `/api/openapi.json`.
- `scripts/build-api.mjs` builds the files of the API, the badges and the feeds from the validator data and the `history` branch; the host runs it every 15 minutes. `scripts/test-api.mjs` tests it.

## [1.7.3] - 2026-10-17

### Added
- The paper can be downloaded: `site/paper/prado-centenaro-vangelista-cscn2026.pdf` (author's accepted version, with the IEEE notice), linked from the guide and the README.

## [1.7.2] - 2026-10-17

### Added
- The guide, the README and a new `CITATION.cff` cite the paper that analyses the downstream procedure: A. Prado, M. Centenaro and L. Vangelista, *Securing Multi-domain 5G/6G Routing: Towards Path Verification with ASPA*, IEEE CSCN 2026 (London, 7–9 September 2026; proceedings forthcoming).

## [1.7.1] - 2026-10-16

### Fixed
- *Open this path in the AS path check* (under a route) now scrolls the page up to the AS path box, where the result appears, instead of leaving the reader where they were; clicking it a second time works too. The same applies to any link that fills the AS path box or the routes box from elsewhere on the page.

## [1.7.0] - 2026-10-16

### Added
- ASPA quality: checks on every ASPA (AS0 together with other providers, an AS listed as its own provider, a private or reserved provider, two ASes listing each other, a provider not seen in BGP, an ASPA that expires within 30 days, a customer not seen in BGP, a provider set of 30 or more) with counts and lists in a new section, and a *Quality* block in the lookup. The checks are in `site/quality.js`, with tests.
- In the routes check, a table of the neighbours of the origin: the AS before the origin in each path, its routes, whether the ASPA of the origin lists it and how many of those routes are valid, unknown or invalid, with the providers that are listed but not seen.
- The daily job also writes `visibility.json` (the ASes of the ASPAs that the RIPE RIS collectors do not see) on the `history` branch.

## [1.6.2] - 2026-10-16

### Changed
- Routes seen in BGP: the *details* of a path now open right under the row that was clicked (and close again with *hide details*), instead of appearing in the AS path box at the top of the page. If the row is near the bottom of the screen the page scrolls just enough to show them, and a link opens the same path in the AS path check.

## [1.6.1] - 2026-10-16

### Changed
- The table of all ASPAs shows 20 rows at a time instead of 100; the button under it reads *Show 20 more*.

## [1.6.0] - 2026-10-16

### Added
- The chart of ASPAs over time can show the ASPAs by RIR, their total, the provider ASes, the median providers per ASPA, the no-provider ASPAs or the coverage (the share of the ASes seen by the RIPE RIS collectors that have an ASPA), over all the period, the last 12 months or the last 90 days, with an optional logarithmic scale. The daily data can be downloaded as CSV or JSON, and a new tile shows the coverage.
- Recent changes: the ASPAs that appeared, changed their providers or disappeared in the last 14 days, and an Atom feed (`/changes.atom`) of the same.
- The history of an AS in the lookup result: every change of its ASPA and the day an ASPA first named it as a provider. The events behind it were rebuilt from the RIPE NCC RPKI archive (`tools/backfill-history.py`) and the daily job adds the changes of each day.
- Check the routes seen in BGP: for a prefix or an AS, the routes that the RIPE RIS collectors see (RIPEstat) are checked with the downstream verification (feeders send full tables), with a count of valid, unknown and invalid routes and the distinct paths. This box sends the prefix or the AS to RIPEstat (the guide says so).
- `site/history.js` (events, replay and daily diff, with tests) and the Atom feed in `deploy/nginx/aspa.conf`; the content security policy allows `stat.ripe.net` for the routes.

### Fixed
- In the table view of the chart the numbers sit under their headings and the day is on the same line as its values.

## [1.5.0] - 2026-10-16

### Added
- A chart of the adoption of ASPA over time: ASPAs per day since 12 October 2023, stacked by RIR, with a tooltip, keyboard use and a table of month ends.
- The series lives in `history.json` on the protected `history` branch. It was filled from the daily output of the RIPE NCC RPKI repository archive (1098 days; two days with a missing or partial archive left out) and the `aspa-snapshot` job now appends one row per day. The page reads it from the public project through the GitLab API.

## [1.4.4] - 2026-10-16

### Changed
- The logo and the title in the page header now link to the home page: a click reloads it without any search or path check appended to the URL.

## [1.4.3] - 2026-10-16

### Fixed
- Footer: the vi icon, which already contains the word "vi", was followed by a second "vi" as link text. The icon alone is now the link (its text alternative is "vi").

## [1.4.2] - 2026-10-16

### Changed
- The vi icon in the footer is now a link, like the other credits, to the Wikipedia article on vi; the guide says so. Until now it was not clickable.
- README: a single logo, readable on both the light and the dark theme of GitLab (the two variants were both shown), and the vi logo links out like the other credit logos.
- Deployment notes for sites behind a reverse proxy or a CDN: comments in the nginx templates and a section in the wiki.

## [1.4.1] - 2026-10-16

### Changed
- The contact address in the security policy and in the accessibility statement is now the institutional one, as in the README and CONTRIBUTING.
- The guide documents the link of an AS-path check and says that path-check results are announced to screen readers; the accessibility statement says "text and controls" for the contrast.

### Changed
- README: the architecture diagram is now a UML sequence diagram (lifelines, activations, `par`, `alt` and `loop` fragments) instead of a flowchart.

## [1.4.0] - 2026-10-16

### Added
- **Check an AS path:** enter a path as a router shows it and see whether it passes the ASPA verification procedure (upstream or downstream) of draft-ietf-sidrops-aspa-verification, with the check of every hop, the ramps and the reason for a Valid, Unknown or Invalid verdict. It runs in the browser on the ASPA objects of the page; results can be shared with a link (`#path=3356+680&from=up`).
- `site/verify.js`, the verification as a pure module, with unit tests (`scripts/test-verify.mjs`, `make test`) based on the worked examples of the paper behind the procedure, and a `unit-tests` job in the CI.
- A section on the path check in the guide.

## [1.3.3] - 2026-10-16

### Changed
- Development moved to a private project of the group `internet_routing_sec`; the public repository is a read-only push mirror of it. README and CONTRIBUTING describe the new workflow.

### Added
- Jobs `publish-release` (releases of new tags, in both projects) and `mirror-wiki` (daily copy of the wiki to the public mirror).

### Added
- Scheduled `host-package-audit` job (`scripts/pkg-audit.sh`): fails when an installed package of the host has a known vulnerability that a package update fixes, and warns when no fix exists yet; the vulnerability database is refreshed daily (`deploy/freebsd/`).
- Scheduled `aspa-snapshot` job (`scripts/log-snapshot.mjs`): a daily snapshot of the ASPA data (ASPAs, providers, split per RIR) logged to the project's model experiment, to chart the adoption over time.
- The regular jobs no longer run in scheduled pipelines; job logs are visible to project members only.

## [1.3.2] - 2026-10-16

### Fixed
- Links to the validator (under the title, "jsonext" and "json" in the footer, and in the guide) pointed to a port that is not reachable from outside; they now use the public address `https://rpki.ping6.it/`.

### Changed
- README, guide and wiki mention the Routinator instance at rpki.ping6.it.

### Changed
- README and wiki: links to project files, releases and the wiki open in a new tab; the guide link points to the live guide.

### Added
- CI security checks: `js-security-lint` (ESLint rules against `innerHTML`, `eval` and similar sinks, `eslint.config.mjs`) and `secret-detection` (gitleaks over the whole git history). Also available locally as `make lint-security` and `make secrets`.

## [1.3.1] - 2026-10-16

### Changed
- All outside links in the pages now open in a new tab and announce it to screen readers, including the Routinator link under the title, the links in the guide and the bgp.tools / RIPEstat links of a lookup.
- The footer shows the Routinator avatar (the rocket used in the Routinator README) with its name, instead of the wordmark. README and wiki use the same logo.

## [1.3.0] - 2026-10-16

### Added
- The logo next to the title in the page header, and on top of the guide (where it links back to the main page).

## [1.2.7] - 2026-10-16

### Fixed
- Footer first row could overflow the viewport (horizontal scroll at 320 px wide) when the last commit was shown: the items had no break opportunity between them. Found by a re-audit; the page reflows again down to 320 px.

## [1.2.6] - 2026-10-16

### Changed
- The link to the guide moved from the footer and the line under the title to a "Guide" entry at the top right of the page header.

## [1.2.5] - 2026-10-16

### Changed
- The visitor's address in the footer links to RIPEstat (new tab). Nothing is sent to a third party unless the link is followed.

### Changed
- README and wiki: the credits section is replaced by a row of logos only.

## [1.2.4] - 2026-10-16

### Added
- "Validated by Routinator" with the Routinator logo in the footer credits, the guide, the README and the wiki.

## [1.2.3] - 2026-10-16

### Changed
- Footer links open in a new tab and announce it to screen readers ("opens in a new tab").
- README credits show the DEI, FreeBSD and vi logos, as in the page footer.

## [1.2.2] - 2026-10-16

### Added
- `scripts/build-info.sh` and `/build.json`: the footer now shows "Last commit <sha>@<date>" for the commit the running page was built from, even when the GitLab project is private. The GitLab API still takes precedence when the project is readable.

### Changed
- README redesigned: logo, badges, screenshots, architecture diagram, table of contents of the project documents.
- A project wiki with the user guide, the accessibility statement and deployment notes.

## [1.2.1] - 2026-10-16

### Changed
- Footer first row aligned with the other sites of the family: "Release vX.Y.Z", "Last commit <sha>@<YYYYMMDDhhmmss>" (Italian time, links to the project) and the accessibility link; the separate "Source" link is gone.

## [1.2.0] - 2026-10-16

### Added
- Two-row footer: source project, release, last commit, accessibility link and the visitor's address; below it the credits "Powered by DEI", "Served by FreeBSD" and "Made with vi :wq". The logos stay readable in the dark theme.
- `/client-ip` endpoint in the nginx configuration, used by the footer.
- Accessibility section and credits in the guide; skip-to-content link, table caption and support for reduced motion.

### Changed
- nginx security headers moved to `deploy/nginx/security-headers.conf`, included by every location that sets its own headers.
- Primary button colours chosen for WCAG AA contrast in the light and dark themes.

### Fixed
- Heading order on the main page and missing role on focusable chart items, found with axe-core.

## [1.1.1] - 2026-10-16

### Fixed
- Browsers that had cached the previous stylesheet showed the footer build line unstyled. Pages now request `style.css`, `app.js` and `footer.js` with a `?v=<version>` parameter, and CI checks that it matches the released version.

## [1.1.0] - 2026-10-16

### Added
- User guide in English (`site/guide.html`), linked from the page header and footer.
- Footer build line (`site/footer.js`): link to the GitLab project with the version number highlighted and, when the project can be read, the latest tag and last commit.
- `site/version.json` as the static source of the displayed version, with a CI check that it matches this changelog.
- Project logo (`assets/`), used in the README and as the site favicon.

### Changed
- Content-Security-Policy allows `connect-src https://gitlab.dei.unipd.it` for the footer.

### Fixed
- HTML validation errors: uppercase `DOCTYPE` and explicit `type` on the search input.
- CI nginx check no longer requires `apk`, so it also runs on shell runners, and uses unprivileged ports.

## [1.0.0] - 2026-10-16

### Added
- Static single-page ASPA Explorer: look up an AS to see its own ASPA and every ASPA that names it as a provider, with deep links (`#AS680`).
- Summary tiles and charts: ASPAs per RIR, providers per ASPA, most-named providers.
- Filterable, paginated table of all validated ASPAs.
- nginx configuration that proxies and caches the Routinator data endpoints (`/data/aspas.json`, `/data/status.json`) with TLS verification.
- Strict Content-Security-Policy and security headers; no external dependencies.
- Project documentation, MIT license, contribution and security policies.
- GitLab CI pipeline with JavaScript, HTML and nginx configuration checks.

[Unreleased]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.4.3...main
[1.4.3]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.4.2...v1.4.3
[1.4.2]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.4.1...v1.4.2
[1.4.1]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.4.0...v1.4.1
[1.4.0]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.3.3...v1.4.0
[1.3.3]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.3.2...v1.3.3
[1.3.2]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.3.1...v1.3.2
[1.3.1]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.3.0...v1.3.1
[1.3.0]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.7...v1.3.0
[1.2.7]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.6...v1.2.7
[1.2.6]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.5...v1.2.6
[1.2.5]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.4...v1.2.5
[1.2.4]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.3...v1.2.4
[1.2.3]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.2...v1.2.3
[1.2.2]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.1...v1.2.2
[1.2.1]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.2.0...v1.2.1
[1.2.0]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.1.1...v1.2.0
[1.1.1]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.1.0...v1.1.1
[1.1.0]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.0.0...v1.1.0
[1.0.0]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/tags/v1.0.0
