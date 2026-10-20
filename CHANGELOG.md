# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.46.3] - 2026-10-20

### Security
- The quota of the reports counts bytes: SQLite's `LENGTH()` of a text counts characters, so reports full of emoji weighed a quarter of what they take. The size of the report that arrives is added before it is kept.
- The preview of a link to a report (title and description of the page, `og:` tags) says *Unverified report* as well, because it shows what a visitor wrote.
- The sample nginx configuration verifies the certificate of GitLab when it fetches the Atom feed of the changes (`proxy_ssl_verify on`, as the proxy to Routinator already did).

## [1.46.2] - 2026-10-20

### Security
- Shared reports say what they are: the page now reads *Shared by a visitor ... this site has not checked that the content is true*, and the note below it says that anybody can create a report. The old note claimed that the site had computed everything in it, which the service cannot guarantee.
- The reports kept are limited by the bytes stored (512 MiB) and not only by their number, and the global rate of new reports is 300 an hour instead of 600.
- The clean-up of expired reports and unconfirmed requests runs on its own, every hour, and no longer waits for the ASPA data to be read: if the upstream fails for days, the old ones still go.
- The Content-Security-Policy has an explicit `object-src 'none'`, and `/data/validity/` (which asks Routinator) has a rate limit per address in the sample nginx configuration (300 a minute, burst 100).

## [1.46.1] - 2026-10-20

### Changed
- User guide: the *Links and keyboard use* section describes the back-to-the-top button.

## [1.46.0] - 2026-10-20

### Added
- Every page but the embeddable chart: a round button, bottom right, that goes back to the top of a long page. It appears after the reader has scrolled down a screen, has a name for screen readers (*Back to the top of the page*), is 44 px wide, clear of the safe areas of phones, hidden when printing, scrolls without animation for people who ask for less motion, and moves the focus to the top so that the next Tab reaches the skip link. It lives in `footer.js`, which every page already loads; the accessibility test scrolls the guide, checks that the button appears, that axe finds nothing with it shown, and that it takes the reader to the top.

## [1.45.1] - 2026-10-20

### Changed
- Statistics page and guide: the section *Route leaks today* is now *Valleys today (possible route leaks)*, as the table of the routes check was renamed in 1.43.12: a valley is a candidate, which a leak makes but an ASPA that misses a provider makes too, and the title should not accuse. The text of the section already said so. README likewise.

## [1.45.0] - 2026-10-20

### Changed
- Routes seen in BGP, *Neighbours of the origin in these routes*: a button reads the IRR object of the origin and CAIDA (one request) and rewrites the Evidence column for every neighbour: *confirmed* (listed in the ASPA and said to be a provider by the registry, CAIDA or the routes), *only the ASPA* (listed, and nobody else says it), *probably missing* (not listed, and the IRR object declares it as transit, or three sources agree), *maybe missing* (one source says it), *not a provider?* (not listed, and the object describes it as a peer, a customer or an exchange point). The sources and the objections are written under the label, and a sentence says which providers the ASPA seems to miss. Before the button the column shows what the routes alone say, as before. The *Invalid* column is gone: those routes are the places of valley above, with their *why?*. `neighbourReading` in `site/valley.js`, with tests.

## [1.44.0] - 2026-10-20

### Added
- Routes seen in BGP: each place of valley has a *why?* button. It reads, for the hops that the ASPAs refuse, the IRR objects of the two ASes (the RIPE database and its mirrors), CAIDA and the paths that RIPEstat sees before the customer of the hop, and says what they make of it: *probably a gap in an ASPA* (the IRR object of the customer declares the provider as transit, or the provider's object calls the customer its own, with CAIDA or RIPEstat agreeing), *possibly* (some evidence, with the objection said), *an exchange-point AS in the valley*, *nothing read here explains it* (not an accusation: it can still be an ASPA that misses an undeclared provider, a leak or a forged path), or *not enough data*. It tries the ASPA of the customer with the provider added and tells whether the path would stop being a valley, names who to ask, says when the valley sits next to the AS that reports the path to the collector (which only listens), and lists every hop with what the ASPAs, the IRR objects and CAIDA say. It is a reading with its evidence, not a verdict. `site/valley.js` (pure, tested in `scripts/test-valley.mjs` with the valleys of AS41327 of 2026-10-20: Connesi and Zayo, RASCOM and Rostelecom, FNXTEC and Hurricane Electric, NetIX, Hopus), and a page of the accessibility test with a valley in its routes.

## [1.43.12] - 2026-10-20

### Changed
- Routes seen in BGP: the table of the valleys is now titled *Valleys seen now (possible route leaks)*, it was *Route leaks (valleys) seen now*. A valley is a place where the ASPAs cannot explain the path, which a leak produces but an ASPA that misses a real provider produces too (the first valleys of AS41327 on 2026-10-20 all went away when the neighbours published a complete ASPA), so the title should not accuse. The guide uses the same name.

## [1.43.11] - 2026-10-19

### Added
- Routes seen in BGP: when *Compare with the looking glass* finds routes of the snapshot that the looking glass no longer holds, it says so in plain words ("1 route of the snapshot is gone from the looking glass: 0.0.0.0/0 (AS41327). It was withdrawn after the snapshot, so the verdicts below still count it") and the yellow notice above changes to say that some of the routes have been withdrawn since. A default route of AS41327, withdrawn at 13:00 UTC, was still in the RIPEstat snapshot of 15:59. `withdrawn()` in `site/live.js`, with a unit test.

## [1.43.10] - 2026-10-19

### Added
- Routes seen in BGP: the age of the snapshot. The line above the verdicts says how long ago RIPEstat read the routes ("as of 19 Oct 2026, 09:59 UTC (3 h 39 min ago)"), and a notice appears when the snapshot is more than an hour old: a route announced or withdrawn since then is not in it. The snapshot can be hours old, and a default route that the owner had already withdrawn was still shown.
- Routes seen in BGP: *Compare with the looking glass*. A button reads, from RIPEstat, what the peers of the RIPE RIS collectors hold now for the shortest 24 prefixes of the snapshot (four requests at a time, only when pressed) and lists the prefixes whose origins changed (a default route has dozens of origins: the six busiest are shown, and how many more): *no longer announced by AS…* or *now also by AS…*, with the number of routes in the snapshot and of peers in the looking glass. Pure helpers in `site/live.js`, with unit tests.

## [1.43.8] - 2026-10-19

### Changed
- The history of the ASPAs (the changes of the last 14 days, the History box of an AS and the Atom feed) is brought up to date every hour, not once a day: a new job `history-refresh` (`SCHEDULE=history`, `scripts/log-snapshot.mjs --history-only`) commits to the `history` branch only when something changed. The daily snapshot still logs the model experiment run and the coverage figures, which the hourly job keeps in the row of the day. The note added in 1.43.7 now says "in the validated list now, but newer than the archive, which is updated every hour".

## [1.43.7] - 2026-10-19

### Fixed
- The History box of an AS said "has never published an ASPA" for an AS whose ASPA had appeared after the daily snapshot of the archive (AS6762 published its ASPA on 19 October), next to a valid ASPA shown in the box beside it. When the validated list has an ASPA, or an ASPA naming the AS as a provider, that the archive does not know yet, the box now says that it is newer than the archive and will appear the next day.

## [1.43.6] - 2026-10-19

### Changed
- The summary tiles (ASPAs, Provider ASes, Median providers, ...) are smaller: less padding, smaller label, value and note.

## [1.43.5] - 2026-10-19

### Changed
- The page footer text is two points smaller (12 px instead of 14 px).

## [1.43.4] - 2026-10-19

### Changed
- The commit link in the page footer now reads "Source <sha>@<date>" instead of "Last commit <sha>@<date>", and "Contribute on GitHub" is shortened to "Contribute".

## [1.43.3] - 2026-10-18

### Fixed
- In the table of the three sources the word *provider* broke into *provide* and *r* in the CAIDA and ASPA columns, squeezed by the long text of the IRR column. Those two columns do not wrap now, and the accessibility test checks it.

## [1.43.2] - 2026-10-18

### Fixed
- The routing registry box called *a peer* every neighbour that the object declares with sets of prefixes in both directions. That is only the form of the policy: a peer, a private interconnect or a service that is bought (the DDoS scrubbing of Voxility in the object of Fiber Telecom) are written the same way. It now says *sets of prefixes only (a peer, a private link or a service)* and does not claim a relationship that the object does not state.

## [1.43.1] - 2026-10-18

### Fixed
- In the routing registry box, an AS that came after a section called *Customers* in a large object (Voxility in the object of Fiber Telecom) was read as a customer, because the sections after it do not always say that they have begun. A customer is now one that the AS announces ANY to, not one that is in a section with that name; and a header of a section is at most four words, so that the long remarks that document communities no longer open a section.

## [1.43.0] - 2026-10-18

### Added
- **The three sources side by side**: in the routing registry box of an AS, a table with the providers of the AS according to the IRR object, to CAIDA and to the ASPA, and a reading for each (all agree, IRR and CAIDA say it and the ASPA does not, only one source says it…), with a line when the ASPA is the odd one out. CAIDA is read from a new compact file, `/api/v1/relations.json` (the providers that CAIDA infers for each AS, from the same file as the adoption numbers, written by `scripts/build-adoption.mjs` once a day); without it the table compares the two others. `providersOf` in `scripts/build-adoption.mjs`, `threeWay` in `site/irr.js`.

## [1.42.0] - 2026-10-18

### Added
- **The routing registry (IRR) next to the ASPA**: on the page of an AS, a button reads the `aut-num` object from the RIPE database (and the mirrors of the other registries that it serves) and compares what its owner declared with the ASPA: the neighbours that the object calls transit providers (accepted from ANY, in a part called transit, upstream or provider) against the providers of the ASPA, with the customers, the peers and the intermediaries (`import-via`, in practice route servers of exchange points) told apart. It shows what the IRR has and the ASPA misses, and the other way round, says when an object has no policy (ARIN keeps only the name) and never guesses without the sections of the remarks (`site/irr.js`; asked from the browser only when the button is pressed; `rest.db.ripe.net` added to the content security policy).

## [1.41.0] - 2026-10-18

### Added
- When a path that is not Valid goes through an exchange-point AS (the CAIDA list), the table of the routes says so in its *Why* column, and the detail of the path (also in the AS path check and in the live updates) has a note: a route server should not put its own AS number in the AS path (RFC 7947, section 2.2.2.1: *SHOULD NOT*, a recommendation kept for compatibility with old clients), and where it does the ASPA verification meets a hop that nobody declared and the path is Invalid without any leak; but the same AS number can belong to a real network that peers and sells transit, as NetIX does, and then the valley may be real. The note does not decide; it says what to look at.

## [1.40.0] - 2026-10-18

### Added
- A link to the privacy information of the University of Padova (<https://www.unipd.it/en/privacy>) in the footer of every page, next to the form to be notified and the alerts of the status page, in the guide and in the confirmation mails.
- The logs of the web server (`access.log` and `error.log`, which hold the address of each visitor) are rotated every day, compressed and kept 365 days (`deploy/freebsd/newsyslog-nginx.conf`); before, they were never rotated.

### Changed
- The guide said that the visitor's address is not stored; the service itself only counts it in memory, but the web server writes it in its access log. The sections *What is kept* and *Sharing a result* now say so, with the 365 days.

## [1.39.5] - 2026-10-18

### Fixed
- The tiles of the ROA check that open a list of prefixes turned blue under the mouse and the text became unreadable: the style of a button (a blue background on hover) reached them. They keep the colours of their verdict, with a slight shading under the mouse.

## [1.39.4] - 2026-10-18

### Fixed
- In the form to be notified, the line of the threshold of invalid announcements ("Also tell me when ASn is the origin of [10 or more] invalid announcements…") broke into three lines; it is one row now, that wraps between its parts only when it must.

## [1.39.3] - 2026-10-18 (no tag: it went out with 1.39.4)

### Fixed
- The badge address in the README got a `?v=2`: Cloudflare, in front of the site, keeps the badges for a day for the browsers (a `max-age` of 86400, whatever the server says), so a badge that changed stayed old. The setting is in the Cloudflare dashboard (*Browser Cache TTL*: respect the existing headers).

### Added
- In *Routes seen in BGP*, the three tiles of the ROA check (*Valid*, *Not found*, *Invalid*) open the list of their prefixes when the check is over, with the origin and the number of routes of each (and the reason, for the invalid ones): so that "Not found, 1" says which prefix it is. The invalid ones are still listed at once when there are any.

## [1.39.2] - 2026-10-18

### Fixed
- In the tables of the tromboning the column of the probes was so narrow that a name broke inside its words ("Amsterd am · DELUXH OST"); it now keeps at least nine characters' width and wraps between words only.

## [1.39.1] - 2026-10-18

### Fixed
- The list *Recent checks* made the home page taller than a screen (it was a row of its own under the tools). It now sits in the corner of the tools card, in the row of the tabs, and opens over the page, so it takes no height; on a narrow screen, where there is no room next to the tabs, it goes under them. The accessibility test checks that the list adds no height.

## [1.39.0] - 2026-10-18

### Added
- **Contributing on GitHub**: a *Contribute on GitHub* link in the footer of every page, a paragraph in the guide, a rewritten README note and a section *Sending a pull request* in `CONTRIBUTING.md` that says how it works (the GitHub copy is made from the private repository, so a pull request is read there, applied by hand keeping the author, and closed with a link to the commit), forms for a bug and for a suggestion, a template for pull requests, and a file that points security problems to `SECURITY.md`.

### Removed
- The Italian guide (`/guida.html`) and every other translation: the site, the guide and the documents are in English only. The old address of the Italian guide redirects to the guide.

## [1.38.3] - 2026-10-18

### Changed
- What *AS0* means is said as the IETF drafts say it: the customer declares that it has **no transit providers** (an *AS0 ASPA*; draft-ietf-sidrops-aspa-verification, section 4, and draft-ietf-sidrops-aspa-profile, sections 1 and 3.3, which allows AS0 only as the single element of the list), not that it has no providers or no peers at all. The guides (English and Italian), the examples page, the chips, the tiles and the statistics, the badge (*no transit providers (AS0)*) and the messages of the tools now use that wording, and the guides cite the two drafts. The behaviour is the same.

## [1.38.2] - 2026-10-18

### Changed
- The badge of an AS says which AS it is about: *ASPA AS137: not configured yet*, *ASPA AS8283: 5 providers*. The grey badge of an AS with no data is made by nginx with the number in the address (its width follows the digits), no longer a single file that was the same for every AS.

## [1.38.1] - 2026-10-18

### Fixed
- The badge of an AS that has no ASPA and is named by none (`/badge/AS137.svg`) answered 404 instead of the grey "no ASPA" badge: the last argument of `try_files` is an address, which was looked for in the wrong web root. It is now a named location that serves `none.svg` from the right place. The grey badge now says *ASPA: not configured yet* instead of *none*, so that an AS that has not published its ASPA has a badge that tells it.

## [1.38.0] - 2026-10-18

### Changed
- The result of the comparison of IPv4 and IPv6 starts with the reading of the tromboning, for each family ("No trombone seen, over IPv4 or IPv6", "Trombone over IPv6 only"…), read on the probes that got into the AS; the comparison of the two families and who answered come after, as what goes with it, and a probe's round trip says when it is a trombone.

### Added
- **Alerts on invalid announcements, with a threshold**: a subscription to an AS can ask to be told when the AS is the origin of 5, 10, 50, 100, 500 or 1000 announcements that the ASPAs prove invalid in a ten-minute run of the live watcher, at most once every six hours (`notifier/invalid.mjs`; `scripts/watch-invalid.mjs` writes `invalid-last.json`, served as `/api/v1/invalid-last.json`; a column `invalid_min` in the subscriptions; `aspa.invalid` for webhooks).
- **Recent checks**: the page remembers, in the local storage of the browser only, the last twenty ASes and paths that were checked, says what changed when one is checked again (providers added or dropped, a verdict that moved) and lists them under the tools with what is different now; the list can be cleared (`site/recent.js`).
- **A quick look at any AS**: a click on the name of an AS opens a small window with its ASPA, the ASPAs that name it, whether it is seen in BGP, the findings on its ASPA and its last change; Ctrl, Cmd or Shift still go to its page (`site/peek.js`, a native `<dialog>`, on the home page and the statistics).

## [1.37.2] - 2026-10-18

### Added
- **Tromboning, IPv4 and IPv6 on the same probes**: a box in the tromboning panel runs the traceroute over IPv6 and then over IPv4 on the very same Globalping probes (the second measurement reuses the places of the first), and shows the median round trip of each family and their difference, the probes that are faster over each, those that answer on one family only, and the networks crossed over each (`pairProbes` and `comparePairs` in `site/traceroute.js`). The result can be shared like the others. A probe whose traceroute stops before the AS that is aimed at (the last router that answers is not in it) is not compared, because its round trip is the one of a router on the way: found trying it on AS137, where many IPv6 traceroutes stopped early and looked like "IPv6 faster". The two addresses can be changed (they must be inside prefixes that the AS announces): the first host of a prefix often does not answer, and then a traceroute stops before the AS; the page says so instead of comparing. (1.37.0 and 1.37.1 were on the site for a few minutes and have no tag.)

## [1.36.0] - 2026-10-18

### Added
- **Many paths at once**: under *Check an AS path*, a box that takes one path on each line (a prefix in front is kept), gives the verdict and the reason of each with the totals, and downloads the table as CSV (formula-safe) or JSON (`site/bulk.js`, up to 5000 lines).
- **Shared results**: *Share this result* under a path check or a list of paths makes a link `/r/<id>` (30 days) that shows the frozen result with the data it was computed with; the page of the link has its own title and summary for the preview in a chat or on a social network. `POST /api/v1/reports`, `GET /api/v1/reports/<id>`, `notifier/reports.mjs`, `site/share.js`, `site/report.html`; plain text only, validated by the service, drawn with `textContent`.
- `<meta name="author">` on the public pages.

## [1.35.0] - 2026-10-18

### Added
- The standard files that were missing: `/.well-known/security.txt` (RFC 9116, with the contact and the policy), `robots.txt`, `sitemap.xml`, the web app manifest with its icons (`/manifest.webmanifest`, 192 and 512 px, one maskable, and the Apple touch icon), and the preview image `og.png` (1200 x 630) with the Open Graph and Twitter tags on every page, so that a link pasted in a chat or a social network shows a title, a description and a picture. `hreflang` links join the English and the Italian guide. nginx serves the manifest with its own type.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), linked from `CONTRIBUTING.md`.

## [1.34.0] - 2026-10-18

### Fixed
- The link to confirm a subscription could fail: the token ended in `-` or `_` for one in thirty, and Gmail leaves that character out of the link, so the token arrived truncated and was refused ("this link is not valid any more"). The tokens are now hex; the links in the mails sent before still work.

### Added
- **Availability by month** on the status page: for each month and part, the share of the checks that found it OK (with late and down when they matter), and how many checks were recorded against a full month. The tallies are kept for good in `status-months.json` (`/api/v1/status-months.json`), written by `scripts/build-status.mjs` next to the history, which keeps 90 days; the first run counts the whole history.
- The alerts on the state of the service were tried with a real message: two parts that changed state together came in one mail.

## [1.33.0] - 2026-10-18

### Added
- **Alerts on the state of the service.** The status page has a form to subscribe an e-mail address or a webhook to the state of the parts of the service: a message when a part becomes late or down, and when it is back to OK. A change is announced when two samples of the status history, 15 minutes apart, show it, and the parts that changed together come in one message. The monitor is a part as well: when no sample has been recorded for 45 minutes, subscribers are told that nothing is being watched. The API takes `"topic": "status"` instead of an AS, a webhook gets `aspa.status` (`notifier/status.mjs`, tests in `scripts/test-notify.mjs`).
- The software is archived on Zenodo, DOI [10.5281/zenodo.23450622](https://doi.org/10.5281/zenodo.23450622) (the latest version; 1.32.1 is 10.5281/zenodo.23452070). Badge in the README, `doi` in `CITATION.cff`, and a line *Cite as* under the title of every page (`site/footer.js`) and next to the datasets on the API page.

### Fixed
- In the neighbourhood graph the link *Add the neighbours that the routes show* is gone once the neighbours are drawn; it stays when the routes could not be read, to try again.

## [1.32.1] - 2026-10-18

### Fixed
- The bars with the three verdicts, in the table of the valid routes by length of the path, were empty: their widths were set with a `style` attribute, which the content security policy blocks. They are set on the elements now.
- The region names in the table *From allocation to ASPA* no longer break inside a word.

## [1.32.0] - 2026-10-18

### Fixed
- **The count of valid routes was too high.** The leaks job counted as valid every route that had no hop attested as *not a provider*, including the routes with no ASPA at all along the path, which the procedure calls unknown (from three ASes up). The verdict of every route is now the one of the procedure (`classify` in `scripts/build-leaks.mjs`, tested against `verify()` on random paths), so the share of valid routes is much lower and the unknown one much higher than the numbers published before (for example 61% valid and 38% unknown on 17 October 2026 were in reality about 9% valid). The places of valley, the leaks and the gaps are not affected. The history of the leaks has been rebuilt.

### Added
- *From allocation to ASPA* on the statistics page, from `/api/v1/resources.json` (`scripts/build-resources.mjs`, daily): the AS numbers allocated, advertised and with an ASPA by RIR, region and economy, with reserved and available numbers, and the figures per million Internet users (World Bank open data); *By age of the AS number* (by year of allocation, 16-bit and 32-bit); *ASPAs that name AS numbers that should not be there* (customers and providers that are not allocated, reserved, private or documentation).
- *Valid routes by address space and by length of the path* and *IPv6 and IPv4 side by side*, from the new `families` of `/api/v1/leaks.json`: routes and address span (IPv6 in /48s) by verdict, by number of ASes in the path, origin ASes and average path length, also weighted by address space; the history file has the valid share of the address space of each family.
- *Invalid announcements, as they happen*: `scripts/watch-invalid.mjs` listens to the RIPE RIS Live stream for about nine minutes in every ten, checks every announcement and keeps 14 days of counts; `/api/v1/invalid.json` has the share of invalid announcements by hour, the profile and the origins and prefixes with the most.
- `scripts/mrt.mjs` passes the prefix length and the family to the callback; the snapshots of the data have `resources.json` and `invalid.json`.
- The manual `a11y` job of the GitLab pipeline can run the accessibility test on the runner now that a Chromium is installed there.

## [1.31.0] - 2026-10-18

### Added
- *What if the ASPA of ASn listed...* in the check of the routes of an AS: the routes checked again with another list of providers for that AS (the proposal by default, or the ones typed; AS0 alone for none), with the routes valid, unknown and invalid before and after and the paths whose verdict changes (`site/whatif.js`, `scripts/test-whatif.mjs`).
- Networks with an ASPA over time, by RIR and country: a chart on the statistics page, `/api/v1/trends.json` (built once a day by `scripts/build-trends.mjs`) and a page to embed the chart in another site (`/embed.html?country=IT`, `?rir=ripe`), with the iframe code to copy.
- Dated snapshots for research: `scripts/build-dataset.mjs` makes once a month a `.tar.gz` with the ASPAs, history, events, adoption, trends, leaks and validators, a `MANIFEST.json` (size and SHA-256) and a README, listed in `/datasets/index.json` and on the API page; `.zenodo.json` for a DOI.
- The *ASPAs over time* chart, its legend, tooltip and table now have AFRINIC, at zero, with its line along the axis.

### Changed
- The leaks job of the day and the rebuild of past days (also in 1.30.2) are all complete: the days of the history have the 30 collectors.

## [1.30.2] - 2026-10-18

### Fixed
- The route leaks job tries a download again (four attempts, with growing pauses) when the archive cuts it. A single cut ("terminated") ended the whole run, so the daily file was not written and, in the rebuild of past days, the old file stayed (that is why some days of the history had 18 collectors and others 30).

## [1.30.1] - 2026-10-18

### Added
- The status history can mark a period as assumed (`assumed` in `/api/v1/status-history.json`): the chart says that the states in it were not measured but taken as OK. It is used for 16-18 October 2026, before the job existed.

## [1.30.0] - 2026-10-18

### Added
- The status page has an *Over time* chart: one strip for each part of the service with its state in the last 24 hours, 7, 30 or 90 days (the worst state in each stretch; grey where nothing was recorded), the share of the checks that found it OK, the last problems and a table with the same figures. It reads from the keyboard (left and right arrows) as well as with the mouse.
- `scripts/build-status.mjs` runs the checks of the status page on the server every 15 minutes and keeps 90 days of results in `/api/v1/status-history.json` (a sample is the time and one letter for each check: `o`, `l`, `d`). The checks are now built by `makeChecks` in `site/status-checks.js`, with an `id` each, so the page and the job use the same code.
- `scripts/test-status-history.mjs` (the recorder and the helpers of the chart); `nginx` location for the new file.

## [1.29.1] - 2026-10-17

### Changed
- With the probes in another country than the one of the AS, the measurement gives the median and the range and no reading (normal, longer than it should be, trombone): the bands are for two points of one country, and from another country the delays are those of an international trip.

## [1.29.0] - 2026-10-17

### Added
- A menu next to the button of the measurement of the tromboning lets the visitor choose the country of the probes: the one where the AS is registered comes first, then about sixty others. The result says whether the probes are where the AS is registered or in the country that was chosen.

## [1.28.1] - 2026-10-17

### Changed
- The tromboning panel says that the probes are chosen in the country where the AS is registered, which is an approximation and sometimes a bold one (an AS can work elsewhere, or in several countries, and the address that is measured may not be in that country), and that then a long delay is the distance and not a trombone. The same is in the guides and the result of the measurement.

## [1.28.0] - 2026-10-17

### Added
- The routes check takes a single address, alone or as a /32 (IPv4) or /128 (IPv6): RIPEstat answers with the routes of the most specific prefix that covers it, and the page says which prefix that is. Before, `94.136.22.155/32` found no route because that exact prefix is not announced.

## [1.27.1] - 2026-10-17

### Removed
- The places and the countries of the hops of the measurement of the tromboning (RIPE IPmap): the estimates are not sure enough to be shown, and the page does not use `ipmap-api.ripe.net` any more. The measurement says what the delays say, the networks on the way and where the delay rises.

## [1.27.0] - 2026-10-17

### Changed
- The route leaks are read from 30 collectors instead of 18: sixteen of RIPE RIS (rrc00, 01, 03, 04, 05, 06, 07, 10, 11, 12, 14, 15, 16, 19, 21 and 23) and fourteen of RouteViews (Oregon, route-views3 and 4, London, Palo Alto, Tokyo, New York, Perth, Atlanta, Singapore, Johannesburg, Sao Paulo, Sydney and Equinix). The history of the leaks is rebuilt with them, so the numbers before and after are comparable only once the rebuild is done.

## [1.26.2] - 2026-10-17

### Changed
- The countries of the measurement of the tromboning are written with their names (Tunisia, not TN). The versions 1.26.0 and 1.26.1 were deployed and then folded into this one: they have no tag.

## [1.26.1] - 2026-10-17

### Changed
- The result of the measurement says that the places of the hops are estimates of RIPE IPmap, and that a place that looks odd is more likely a wrong estimate than a detour; the link *hops* of the table of the probes no longer breaks over two lines.

## [1.26.0] - 2026-10-17

### Added
- The hops of the measurement of the tromboning are placed with RIPE IPmap (the best candidate that the delay allows, since a packet covers about 100 km each way in a millisecond of round trip): each hop has its place, each probe the countries on the way and whether it goes through another country, and the result says how many probes do, and where. The connection to `ipmap-api.ripe.net` is allowed by the content security policy.

## [1.25.1] - 2026-10-17

### Changed
- The result of the measurement of the tromboning is a headline (*No trombone seen*, *No trombone on most paths*, *Longer than it should be*, *Trombone*) in a box, with the median, the range and the bands under it, and what the measurement cannot tell: a short detour inside Europe cannot be told apart from a far target inside the country. When almost no probe gets within 10 ms of the target, it says so.

## [1.25.0] - 2026-10-17

### Removed
- The table *Possible tromboning* (the networks registered in another country that the domestic routes go through, from the routes that the collectors see) and `site/tromboning.js` with its tests: it depended on the country where an AS is registered, which says little about where it works. The panel is now *Tromboning of ASx*: the measurement from twelve probes in the country, with the median first. The country of the AS only chooses where the probes are.

## [1.24.10] - 2026-10-17

### Removed
- The line on RIPE Atlas (the number of probes and the command to run) under the possible-tromboning table: the measurement is now made by the page, and the connection to `atlas.ripe.net` is no longer allowed by the content security policy.

## [1.24.9] - 2026-10-17

### Changed
- In the table of the probes the two round trips are called *net* (from the first public address, the one that is read) and *total* (to the end).

## [1.24.8] - 2026-10-17

### Changed
- The probes of the measurement of the tromboning are in a table, the slowest first, with the median in the first row: the networks on the way, the round trip from the first public address and to the end, and a reading (normal, longer than it should be, trombone); the hops of each probe open under its row.

## [1.24.7] - 2026-10-17

### Changed
- The band of the round trip that is normal inside a country goes up to 50 ms instead of 40, as in the LACNIC 2022 Connectivity Study, and the guide says where the figures come from (LACNIC, Shah and others, Edmundson and others).

## [1.24.6] - 2026-10-17

### Changed
- The measurement of the tromboning uses up to twelve probes instead of three, and says the median round trip of all of them (from the first public address), the range and how many are normal, longer than they should be, or a trombone; the probes are listed under it, the slowest first. The test uses twelve of the 250 measurements an hour that Globalping allows to an address, and the page says so.

## [1.24.5] - 2026-10-17

### Changed
- A trombone is now told by its delay: from the first public address to the end, the round trip is normal up to 40 ms, longer than it should be above that, and a trombone at 100 ms or more (a packet that crosses an ocean or goes round Europe twice), supposing that the target is in the country of the probes.

## [1.24.4] - 2026-10-17

### Changed
- The measurement of the tromboning says nothing about kilometres, and nothing about the country where a network is registered: it gives the networks on the way, the delay of each hop, where the delay rises and stays up, and when the round trip is long. The country is only used to choose where the probes are.

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
