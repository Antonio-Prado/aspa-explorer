# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.24.3] - 2026-10-17

### Fixed
- The reading of the delays of a traceroute was too bold: a rise of the delay is now a jump only when it stays up to the end of the path (a slow answer of one router is not), not when it comes out of a private address (the access network of the probe: a tunnel, a mobile network), and the round trip is called long counting from the first public address, with a note when the probe already has a long delay there. The text also says that the delay is an upper bound of a distance, not a distance.

## [1.24.2] - 2026-10-17

### Fixed
- The measurement of the tromboning chose the default route (`0.0.0.0/0`) as the prefix of an AS that has one in its routes, and Globalping refused the target `0.0.0.1`. The target is now taken from the prefixes of a usual length (12 to 24 for IPv4, 24 to 48 for IPv6), leaving out a default route, very short prefixes and private addresses.

## [1.24.1] - 2026-10-17

### Fixed
- In the table *Route leaks (valleys) seen now* of the routes check the ASes in the valley were shown as a web address instead of AS numbers (the same fault as in the statistics page, in 1.18.2): a list of nodes is now always taken as a list of children.
- The measurement of the tromboning no longer counts the network of the probe itself as a foreign network.

## [1.24.0] - 2026-10-17

### Added
- *Measure it now* in the possible-tromboning panel: a traceroute from up to three probes in the country of the AS, through Globalping, towards an address of one of its prefixes; each hop is mapped to its network by RIPEstat and shown with its country and delay, with the networks on the way, the first foreign one, the biggest jump of the delay and a note when the round trip is long for two points of one country. It starts only when the visitor presses the button, and the page says who sees what. The connection to `api.globalping.io` is allowed by the content security policy.
- In the tables of the paths, the ASes, the feeder and the prefix are links (to the page of the AS and to the routes of the prefix), and each announcement of the live updates has *details*, the hop-by-hop check of its path, as in the table of the routes.

## [1.23.4] - 2026-10-17

### Fixed
- Two points flagged by CodeQL: the secret of the links of the notifier is created with an exclusive flag (no gap between checking for the file and writing it), and the page that confirms or cancels a subscription chooses its address from two fixed ones instead of building it from the link. The other alerts are by design (the builders write to files the data that they fetch, the release job sends the notes of the CHANGELOG) or false positives (an id looked up in the tabs).

## [1.23.3] - 2026-10-17

### Added
- CodeQL on the GitHub copy (`.github/workflows/codeql.yml`): static analysis of the JavaScript on each push to the main branch and once a week, with the alerts in the Security tab of that repository.

### Fixed
- The tables of the new charts, kept for screen readers, made the statistics page scroll sideways at 320 px (found by the accessibility check on the GitHub copy): they are now inside a hidden block, as a table cannot be clipped by itself.

## [1.23.1] - 2026-10-17

### Added
- *Collectors compared* on the statistics page: one bar for each of the 18 collectors, coloured by project, for the figure chosen in the menu (places of valley seen, places that only that collector sees, invalid routes as a share of its routes, feeder networks, routes read).
- *RIS and RouteViews on the same places*: the same places of valley told apart by who sees them (RIS only, both, RouteViews only), for all of them, for the possible leaks, for the gaps in ASPAs and for the ones seen by three feeders or more, with the feeder networks of each project.
- `leaks.json` has, for each collector, the routes, the invalid routes, the feeders, the places it sees and the ones that only it sees, and the comparison of the two projects.

## [1.22.0] - 2026-10-17

### Added
- More numbers under the title of the statistics page, in two small lines: the changes to ASPAs recorded since 12 October 2023; the share of valid, unknown and invalid routes; the number of feeder networks; and the routes checked in all the days of the history. The builder of the leaks counts the feeder networks and keeps them in the history.

## [1.21.1] - 2026-10-17

### Added
- The numbers of the project in one small line under the title of the statistics page: the networks that have an ASPA, the routes of the collectors checked today, how many are valid, unknown and invalid, and the places of valley. The README has them too, with a date.

## [1.21.0] - 2026-10-17

### Added
- The route leaks are read from RouteViews as well, the other large collection project, whose collectors have other peers than RIPE RIS: eight collectors (Oregon, route-views3 and 4, Singapore, Johannesburg, Sao Paulo, Sydney, Equinix) next to the ten of RIS, 18 in all. The files are bzip2 (read with the system's `bzip2`) and the newest RIB is found in the listing of the month; `FORCE=1 scripts/backfill-leaks.sh` rebuilds the history of the past days with them.
- The MRT reader understands the tables with a path identifier (RIB entries with ADD-PATH).

### Changed
- A feeder is now a network (an AS) that sends its routes to a collector, counted once however many collectors it feeds; before, the same network at two collectors counted twice. The history of the leaks is rebuilt with the 18 collectors and this definition, so the numbers before and after are comparable only once the rebuild is done.
- The copy on GitHub is pushed from GitLab: the job `github-mirror` (`scripts/mirror-github.sh`) pushes the commit of each pipeline of the main branch and each tag, with a deploy key that can write to that repository only (the protected variable `GITHUB_DEPLOY_KEY`). It replaces the workflow that copied the project every 30 minutes (GitHub did not start it). On GitHub, `.github/workflows/release.yml` makes a release for each tag and `accessibility.yml` runs the accessibility check after each push.
- Version numbers that were never tagged because they were deployed and then folded into the next one: 1.13.0, 1.14.0, 1.16.0, 1.17.0, 1.18.3, 1.20.1 and 1.20.2. Their changes are in 1.13.1, 1.15.0, 1.16.1, 1.17.1, 1.18.4 and 1.20.3. The release 1.15.0 was tagged afterwards, on its own commit.

## [1.20.3] - 2026-10-17

### Added
- A sign of activity wherever a click is followed by a wait (reading the routes, fetching them from RIPEstat, loading the data, sending a subscription): three dots that appear one at a time after the text (nothing moves, so it is kept for people who ask for less motion too).

## [1.20.0] - 2026-10-17

### Changed
- The route leaks are read from ten RIPE RIS collectors (rrc00, 01, 03, 04, 10, 11, 12, 15, 19 and 23: Europe, North and South America, Africa and Asia) instead of three.
- The history of the leaks is filled in backwards: `build-leaks.mjs --day=YYYYMMDD` rebuilds a past day from the table dumps of 00:00 UTC and the ASPAs as they were that day, and `scripts/backfill-leaks.sh` does it for the last days.
- An accessibility check (`scripts/test-a11y.mjs`, Chromium and axe-core): every page, at desktop width and at 320 px, in both themes, must have no axe violation and must not scroll sideways. It runs on the GitHub copy after each push to the main branch (`.github/workflows/accessibility.yml`; the GitLab runner is a FreeBSD shell executor, where Playwright does not run), and `make a11y` runs it locally.

### Added
- A read-only mirror on GitHub: the commit or the tag of each pipeline of the main branch is pushed by the job `github-mirror` (`scripts/mirror-github.sh`, with a deploy key that can write to that repository only), and GitHub makes a release for each tag (`.github/workflows/release.yml`).

### Fixed
- The neighbourhood graph is a group of links, no longer an image with links inside (an axe violation, *nested-interactive*, found by the new check).


## [1.19.0] - 2026-10-17

### Added
- *A starting point for the ASPA* after the neighbours table of the routes check: the providers with strong evidence, the ones already declared, weak leads, and a list ready to copy.
- The history of the leaks: `leaks-history.json` (one row of totals a day), the chart *Over time* on the statistics page, and the by-AS files `leaks-by-as.json` and one for each of the last 60 days.
- Alerts for places of valley, opt-in at subscription (`leaks: true`): once a day, the new places that involve the AS, by mail or as an `aspa.leak` webhook. The places present at subscription are not announced.
- *Compare two dates* on the page of an AS: providers added and dropped, the ASPAs that began or stopped naming it, and the places of valley that involve it.

## [1.18.4] - 2026-10-17

### Changed
- An AS whose routes are too many to load (AS6762, for example) no longer ends in an error, in the routes check and in the neighbourhood graph: the view is limited to the routes of a sample of its prefixes (the 24 shortest) and the page says so.

## [1.18.3] - 2026-10-17

### Changed
- The neighbourhood graph says when it draws only part of the providers or of the ASes that name the AS as a provider.

## [1.18.2] - 2026-10-17

### Fixed
- The *ASes in the valley* column of the route-leaks table showed a list of web addresses instead of AS numbers.

## [1.18.1] - 2026-10-17

### Added
- The guide in Italian (`/guida.html`), linked from the English guide and the reverse; the English text stays the reference.

### Fixed
- The neighbourhood graph said that neighbours were "drawn on the right" even when every neighbour seen in the routes was already in the graph; it now says what was added, or that there is nothing to add.

## [1.18.0] - 2026-10-17

### Added
- **Validators compared** on the statistics page: every hour `scripts/build-validators.mjs` reads the ASPAs of this site's Routinator and of two rpki-client validators (the project's console, `console.rpki-client.org`, and Cloudflare's, `rpki.cloudflare.com`), taking only the head and the tail of their 100 MB exports, and compares them. The section shows the counts and the build time of each, how many customers have the same providers in all of them, and the ASPAs on which they differ with a possible reason (the AS0 next to other providers that the profile forbids, a different moment, an object that fails in one of them), and `/api/v1/validators.json`. On the first run 3,585 of 3,592 ASPAs were identical. A check in the status page.
- **Watch the updates live** under the routes of an AS: a WebSocket from the browser to RIPE RIS Live (`site/live.js`), every announcement checked with the ASPAs as it arrives (the last fifteen, with totals), for the updates announced by the AS or going through it; it stops after five minutes or 300 announcements. The Content-Security-Policy allows `wss://ris-live.ripe.net`.
- **The neighbourhood as a graph** in the lookup (`site/graph.js`): providers above, the ASPAs that name the AS below, two ASes that list each other as one red box, and on request the neighbours that the routes show, with their evidence. Every box links to the lookup of that AS.
- **RIPE Atlas** in the possible-tromboning table: how many probes are connected in the country and in the AS, and the `ripe-atlas measure traceroute` command to confirm a candidate with a measurement. The Content-Security-Policy allows `https://atlas.ripe.net`.
- Tests: `scripts/test-validators.mjs`, `scripts/test-graph.mjs`, `scripts/test-live.mjs`.

## [1.17.1] - 2026-10-17

### Fixed
- The leaks file keeps the most seen places of each kind (leaks, gaps, unclear) and not the first 150 overall, which left only a few possible leaks in it; the notes in the tiles of invalid and unknown have enough contrast on their background.

## [1.17.0] - 2026-10-17

### Added
- **Route leaks today** on the statistics page: once a day `scripts/build-leaks.mjs` reads the table dumps of three RIPE RIS collectors (`rrc00`, `rrc01`, `rrc03`, with the small MRT reader `scripts/mrt.mjs`), checks every route with the downstream ASPA verification and groups the paths that the ASPAs prove to have a valley by the place of the valley. A place is told apart by what the CAIDA relationships say of the first AS after the climb: a peer or a customer means a *possible leak*, a provider means that the ASPA of the AS before it *seems to miss a provider*, no relation leaves it *unclear*. Two tables (possible route leaks, ASPAs that seem to miss a provider), the totals, and `/api/v1/leaks.json`. About 55 million routes take 75 seconds and 340 MB per collector. `scripts/test-leaks.mjs` tests the reader and the grouping.
- A check of the freshness of the leaks in the status page and in its dot.

## [1.16.2] - 2026-10-17

### Fixed
- The details of a path under its row (the verdict and the hop-by-hop table) no longer make the table wider than the screen: the row inherited the rule that keeps the first column on one line, so its text did not wrap and the table had to be scrolled to the right.

### Changed
- Documentation brought up to date with the project: the README (features grouped, a second diagram with all the pieces, the list of endpoints, the repository layout, the checks), `CONTRIBUTING.md` (Node.js 22, the services of the host, the third scheduled job, the cache of assets), `SECURITY.md` (the notification service, the webhooks and the API are in scope) and `CITATION.cff` (abstract and keywords).

## [1.16.1] - 2026-10-17

### Changed
- The text of the route-leaks table says that many valleys can be the fault of an ASPA that forgets one of its providers, and points to the evidence table.

## [1.16.0] - 2026-10-17

### Added
- **Route leaks (valleys) seen now** in *Routes seen in BGP*: the paths that the ASPAs prove to have a valley, grouped by the place of the valley (the two ASes it lies between and the ASes inside it), with paths, routes and feeders, and a link to the path check. Valleys are route leaks, not tromboning.
- **Possible tromboning** in *Routes seen in BGP*: of the routes that collectors fed by networks of the origin's own country see for it, how many go through a network registered in another country or another RIR region, and which ones. It is a candidate only, shown when three networks of the country feed the collectors, with the reasons why (the registration country is not where a network works) and the way to confirm (a traceroute from a probe in the country). The definition follows the literature (Edmundson et al.), which measures it with traceroutes. New `site/tromboning.js` with tests (`scripts/test-tromboning.mjs`).
- `/api/v1/asn-registry.json`: the country and registry of every AS seen in BGP, built with the adoption numbers (`asn-registry.json` next to `adoption.json`).

## [1.15.4] - 2026-10-17

### Changed
- **The home page fits one screen** (757 px high on a laptop) without scrolling: less space around the header, the intro text and the footer, a 32 px logo, tighter tiles with shorter notes, a shorter pointer to the statistics page. Nothing was removed.
- In the README and the wiki, where the credits are icons without words, the heart stands alone, without *Inspired by passion*.

## [1.15.3] - 2026-10-17

### Fixed
- The README credits, the wiki and the guide now carry *Inspired by passion* and the heart too, not only the footer of the site.

## [1.15.2] - 2026-10-17

### Added
- The footer ends with *Inspired by passion* and a heart, after *Made with vi :wq*.

## [1.15.1] - 2026-10-17

### Fixed
- The download form on the API page has a real submit button (*Download CSV*), as the HTML check asks; pressing Enter in the form now downloads the CSV.

## [1.15.0] - 2026-10-17

### Added
- **A dot next to *Status* in the menu of every page**: green when all the checks of the status page are green, red when all are red, orange otherwise (a late check counts as not green). It has a text for screen readers and a tooltip, and the result is kept for a minute so that moving between pages does not repeat the checks. The checks moved to the new `site/status-checks.js`, shared with the status page (`scripts/test-status.mjs`).
- **Evidence of who is the provider** in the neighbours table of *Routes seen in BGP*: a neighbour whose route to the origin goes on up to a Tier-1 (path `T1 N origin`) is a provider of the origin, because a peer or a provider that is not asked to carry it upwards would not pass it up. Labels *provider* (at least three feeders and a fifth of the informative paths), *weak*, or none; paths of two ASes are ignored and exchange-point ASes are left out. The table says when the ASPA of the origin does not list a neighbour that is a provider with strong evidence, or, with no ASPA, which are the ones to list. The new `site/evidence.js` has tests (`scripts/test-evidence.mjs`).
- The daily adoption numbers carry the Tier-1 clique and the exchange-point ASes, read from the header of the CAIDA file.
- *Mutual* findings of the quality checks link to a *check now* that opens the routes of the ASes involved.

### Changed
- The neighbours table comes before the long table of paths in the routes result.
- The README tagline and the descriptions of the projects no longer say that the site is only a small static page.

## [1.13.1] - 2026-10-17

### Changed
- *Status* is now the last item of the menu at the top, and no longer in the footer, where the longer line wrapped inside *Your IP*.

### Changed
- **The *All ASPAs* tab is gone from the home page**: a table of 3,593 rows read 20 at a time duplicated the lookup, and whoever wants the list wants the file. The home page keeps *Overview*, *Recent changes* and *ASPA quality*. An old `#all` link goes to the new download.

### Added
- **Download the whole list** on the API page: one RIR or all, as CSV or JSON, made in the browser from `/api/v1/aspas.json`. The files `/api/v1/aspas.json` (one object per ASPA: customer, providers, rir, valid_from, valid_until) and `/api/v1/aspas.csv` are built every 15 minutes with the per-AS files and are in the OpenAPI description.

## [1.12.0] - 2026-10-17

### Changed
- **The charts moved to a statistics page.** ASPAs over time, ASPAs by RIR, providers per ASPA and the most-named providers are now on `statistics.html`, together with the adoption numbers (the page that was `adoption.html`, which redirects there). The home page keeps the overview tiles and links to it. The chart code is in the new `site/stats.js`; the coverage tile on the home page now comes from the daily adoption numbers. The navigation says *Statistics* instead of *Adoption*.

## [1.11.0] - 2026-10-17

### Changed
- **The home page is less dense.** The three tools (look up an AS, check an AS path, routes seen in BGP) share one card with three tabs, one tool at a time; the overview with its charts, the recent changes, the ASPA quality and the table of all ASPAs share a second set of tabs, with the overview open. Nothing was removed: every address (`#AS680`, `#path=…`, `#routes=…`) still opens its tool, and `#overview`, `#changes`, `#quality` and `#all` open the data tabs. The tabs follow the ARIA tabs pattern (arrow keys, Home and End). The README and wiki screenshots were retaken.

## [1.10.2] - 2026-10-17

### Added
- A *Home* item at the start of the navigation on every page (it is marked on the home page).

## [1.10.1] - 2026-10-17

### Fixed
- The navigation at the top (Adoption, Examples, API, Guide) was only on the home page; it is now on every page, with the current page marked.

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
