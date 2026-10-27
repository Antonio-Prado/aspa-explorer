# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.53.1] - 2026-10-27

### Fixed
- The check of the probes asked PeeringDB for its five tables at every page load, and PeeringDB throttles an address that asks for them often (an hour of wait). The list of the exchanges, once made, is kept in the browser of the visitor for a day (about 190 kB), and when PeeringDB does not answer the result says that it limits how often an address can ask.

## [1.53.0] - 2026-10-27

### Added
- The tromboning test checks where each probe is. Globalping places a probe by the address it connects from, and a probe that is not in the country makes a trombone that is not there. A traceroute has its own reference points: a hop that answers from the LAN of an exchange point is on the other side of its switch, so the packet went at least to the nearest site of that exchange and came back. The page asks PeeringDB, from the browser and while the probes run, for the prefixes of the LANs and the coordinates of the facilities of the exchanges (the data are not copied to this site), and a probe whose round trip to such a hop is shorter than light in fibre (2/3 of c) allows from its place, with a margin of 100 km, is elsewhere: it is left out of the reading and marked in the table, with the figures under its row, over one family and in the comparison of IPv4 and IPv6. The same test as Izhikevich and others (IMC 2026) with the DNS root servers, which Globalping cannot ask which instance answers. The result says how many probes could be checked. `site/traceroute.js` (`ixpsFrom`, `ixpIndex`, `ixpOf`, `placeCheck`), with tests in `scripts/test-traceroute.mjs`; the content security policy lets the page ask `www.peeringdb.com`, and the guide says that PeeringDB sees the address of the visitor.

### Fixed
- `incident.py` counted the withdrawals, the flaps and the resets of a peer by its AS number alone, so a stream with several collectors (the Parquet files of RIS) would add up the sessions of one AS at two collectors (X-12). A peer is now a session, the collector and the peer AS: the mass withdrawals, the flaps of a session, the state of a session and the withdrawals that belong to an incident are by session, and the key of an ATR incident names the collector (`ATR_rrc00_34800`, with `collector` in its details); what counts independent views (the peers that see a prefix flap, the more specifics that two peers have, the churn seen from many peers) stays by AS. A state saved before is read as the sessions of `rrc00`. On 15 minutes of `rrc00` the incidents are the same, one for one; tests for two collectors and for the saved state.

## [1.52.3] - 2026-10-27

### Added
- The guide says where the probes of the tromboning test come from and why that matters: Globalping places a probe by the address it connects from, with five geolocation sources (ipinfo, IP2Location, MaxMind, RIPE IPmap and Fastly), and for RIPE Atlas Izhikevich and others (IMC 2026, doi:10.1145/3777912.3839804) found with the round trips to the DNS root servers that 2.4% of the probes could not be where they were said to be, about half of them more than 1,000 km away. A probe that is not in the country makes a trombone that is not there, so a long delay from one probe only is a lead to check against the others.

## [1.52.2] - 2026-10-27

### Added
- A10 of the survey replayed: on 11 February 2025 UPX Technologies (AS52863) leaked the routes of its provider EdgeUno (AS7195) through its sibling AS400282 to its US providers. The valley detector opens a candidate on AS7195–AS52863–AS400282 at 18:16:02, with the first leaked update: 10,087 prefixes, the first of all the 27,766 incidents of the window by updates, although CAIDA of the month calls the provider a peer and the sibling a provider. `rrc00` saw 10,090 of the 21,119 leaked routes that Kentik reports, from 46 peers, most of them gone by 18:31; the volume is above that of the half hour before in one minute only. The Incidents page (*Checked against five known incidents*), the README and `docs/validation-known-incidents.md` say it; `tools/replay/events.json` has the event and `analyse.py` the time profile of the routes through the leak.

## [1.52.1] - 2026-10-27

### Fixed
- The name of an AS came late: it was the title of the element, and the browser shows a title only after a second or more, and not at all when it is set while the pointer is already resting (the name arrives from RIPEstat after the pointer stops). It is now a small box of the page under the AS number, shown after a tenth of a second (at once for a name already asked), with the number while the name is on its way, also inside the summary of an AS and on the keyboard; Escape, a scroll or leaving the element close it. On the bars of the charts of the statistics, which have a tooltip of their own, the name is a third line of it instead of a second box. A title or an SVG title that a page sets itself is kept, and nothing is shown on touch screens. The place of the box, under the element or over it and inside the window, and the name without the number are tested in `scripts/test-asnames.mjs`.

## [1.52.0] - 2026-10-27

### Added
- The name of an AS as a tooltip: when the pointer rests on an AS number (a chip, a link in a table or a path, a node of the graph, a bar of a chart) or the keyboard reaches it, the name that the registry of its RIR gives shows as its tooltip, for instance *AS41327: FIBERTELECOM-AS Fiber Telecom S.p.A.* The name is the `holder` of RIPEstat's as-overview, asked only for the ASes looked at (after a quarter of a second, so that moving the pointer across a table asks for nothing) and kept for the visit; the guide says that this sends the AS number to RIPEstat. A title that a page sets itself is kept. On the pages with AS numbers: home, statistics, examples, shared results, guide and API. `site/asnames.js`, with tests in `scripts/test-asnames.mjs`. Suggested by Leo Vegoda of PeeringDB: thank you.

## [1.51.5] - 2026-10-27

### Fixed
- `incident.py` stopped on a session reset: on 25 October at 12:34 UTC one peer of `rrc00` withdrew about 98,000 prefixes in two seconds, and the withdrawals of a peer in the last 10 s (the ATR count) were a list rebuilt at every withdrawal, so the cost grew with the square of the burst. The daily job of 26 October ran for more than a day without getting past it, and the next one did not start. The withdrawals are now counted by second, with the same count as the list also when the timestamps of a peer come out of order (a state saved with lists is converted): on those 150,000 updates the run takes 26 s instead of 328 s, with the same incidents and the same state.
- The saved state is no longer deep-copied when it is loaded (it doubled the memory and took more than a minute), and the deaggregation check keeps the covering prefixes of each prefix instead of computing them with `ipaddress` at every announcement (44% of the time of a run). On 1.5 million updates of the same day, with the state of the host: 149 s instead of 344 s, with the same 774 incidents.
- The more specifics that wait for their aggregate (`pending_specifics`, for DEG-MA) are kept for a day instead of 30: after three days of data they were 5.7 million entries, and with 30 days the state would not fit in the memory of the host. A more specific is compared with an aggregate that arrives up to a day later.
- The cron line of `run-incidents.sh` opens the log inside `lockf`: a run that found the lock taken emptied the log of the run that held it.
- Two tests of `tools/data_scripts` still expected one flapping incident for each peer, as before X-9; new tests for the count of the withdrawals, a reset of 100,000 prefixes and the day of the more specifics.

## [1.51.4] - 2026-10-23

### Fixed
- Documentation brought in step after a review of all of it: the route-server example named the wrong receiver of the path through a second exchange; the Incidents page did not name the line DEG-XS that DEG-CA and DEG-EX share, and said DEG-MA shared it too; the guide's list of the status checks lacked the comparison of the validators; the contents of the API page lacked *Shared results* and *Dated snapshots*; the README's repository layout lacked `tools/data_scripts`, `tools/replay`, `docs/` and the Incidents page; MAINTAINING and the copy of the scripts' README said that every threshold was in `extra_detectors.py` (the flapping ones are in `incident.py`, the propagation ones in `build-incidents.mjs`); that README also kept the project's rules for VOL, DEG and ASM instead of the copy's, did not list the delegation and link files among the inputs, linked a `CROSS-CHECK.md` that is not in the copy, and listed a "jump" beside excessive and flood (it counts as DEG-XS). The wiki (user guide, deployment, home) was the furthest behind: five cases instead of six, the detectors of 1.47, the history read from GitLab instead of `/api/v1/archive/`, no mention of the GitHub mirror, links to the Department's GitLab, which is not reachable from outside.

## [1.51.3] - 2026-10-23

### Removed
- The tile *Invalid, complete ASPAs* of the Incidents page: with the persistent valleys in the count it read 75%, a number that says what CAIDA says, not what the ASPAs would. The column *complete ASPAs* stays in the table by type, where each line can be read for what it is.

## [1.51.2] - 2026-10-23

### Changed
- A9 and A12 were replayed with the thresholds of 1.51.0 and the links of the table of the collector before each event: A9 goes from 128,290 incidents to 65,157 and A12 from 110,351 to 18,508, the real case of A9 is still the first of its type by updates (and opens a minute earlier), and A12 shows the same five mass withdrawals. The section *Checked against four known incidents* and `docs/validation-known-incidents.md` say it, with the numbers side by side; `tools/replay/run_event.sh` takes the links file and the `PYTHON` interpreter, and `events.json` names the `bview` of each event.

## [1.51.1] - 2026-10-23

### Changed
- The chart *If more networks published an ASPA* leaves out the persistent valleys (RLK-PV): with the first full day rebuilt, 51,753 of the 60,345 leak incidents were persistent (69 ASes in the valley all day, one of them 40,598 times), and the line *the biggest networks publish first* jumped to 58% at 10% only because complete ASPAs built from CAIDA prove a CAIDA error Invalid by construction. `incidents.json` has `adoption.base`, the incidents with a path that each curve is a share of; the table still counts the persistent valleys, under RLK.

## [1.51.0] - 2026-10-23

### Changed
- The thresholds of the incident detectors, after the first full day of data (534,660 incidents in twelve hours, most of them noise):
  - **flapping (VOL-FO)**: one incident for the prefix instead of one for each peer that sees it, ten flaps in five minutes instead of five, and three peers or more flapping it in the same window (a prefix that flaps for one peer alone is that peer's session). It was 379,000 incidents from 48 peers.
  - **full propagation (RLK-FP)**: ten different neighbours within one hour instead of three in the whole period, and a new line **RLK-PV, persistent valley**, for an AS whose leaks begin in twelve different hours or more of the period: a relationship that CAIDA gets wrong, not a leak, kept out of UL, LL and FP. One such AS was 40,598 of the 60,345 leaks.
  - **forged links (ASM-FI, ASM-PS)**: a link that was in the routing table of the collector at the start of the day is not a candidate, whether CAIDA knows it or not. `scripts/rib-links.mjs` writes the links of the table dump that the valley job keeps, `run-incidents.sh` runs it, `extra_detectors.load_links` reads them (`INCIDENTS_LINKS`, default `links/*.txt`). 89% of the FI candidates and 48% of the PS candidates of the first day were such links.
  - **deaggregation with another origin (DEG-MA)**: not a candidate when a ROA authorises the origin of the more specific, or when CAIDA knows a link between the two origins (a customer announcing its part of the provider's block). Three quarters of the first day.
  The coverage table and the lines of the table by type say the new rules. Every threshold is still a constant at the top of `incident.py` (`VOL_FO_*`), `extra_detectors.py` and `build-incidents.mjs` (`FP_*`, `PERSISTENT_MIN_HOURS`).

## [1.50.7] - 2026-10-23

### Fixed
- In the table of the Incidents page a number could break in two lines in a narrow column (27,157 came out as 27,15 and 7): the numbers never wrap now, only the percentage under them is a line of its own.

### Changed
- The README and the wiki have two screenshots of the Incidents page, with the first full day of data: the tiles and the table by type, and the chart of adoption.

## [1.50.6] - 2026-10-23

### Fixed
- The daily job of the Incidents page stopped at its last step on the first full day of data: `build-incidents.mjs` spread the incidents of a file into one call (`push(...)`), which overflows the call stack above a hundred thousand or so, and a day has half a million of them (the files are a quarter of a gigabyte each). The builder now reads the files line by line, plain or gzipped, and keeps of each incident only what the analysis reads (type, actor, times, details, the paths): a day of incidents takes 11 seconds and 1.1 GB of memory. The page of 23 October 2026 was rebuilt by hand.

## [1.50.5] - 2026-10-23

### Changed
- The Examples page explains the **route server of an exchange point**: what it does, and that what counts for ASPA is whether it puts its own AS number in the paths. A transparent one (RFC 7947, what most exchanges do) is not in the question and is never listed; a non-transparent one stands above its clients in the paths, and the verification draft (section 4) asks every client to list it together with its providers, or the routes sent through it come out Invalid with no leak anywhere; a client of a non-transparent route server cannot publish AS0; a bilateral peer at the exchange is never listed; the route server itself publishes AS0. The rules, the AS0 case and the mistake *Forgetting a provider* say it in one line each, and the note of the path check for an exchange-point AS in an Invalid path says the same instead of calling it a hop that nobody declared.

## [1.50.4] - 2026-10-22

### Added
- The detectors were run over the updates of `rrc00` during four known incidents of the survey (A9 Safe Host, A2 Rostelecom, A1 Twitter, A12 Prefix-SID), with the CAIDA relationships of the time. The Incidents page has a section *Checked against four known incidents* with what they saw (for A9, a path-shortening candidate on a link that CAIDA does not know, one minute after the start, the first of 15,802 by updates; the valley detector sees nothing), and `docs/validation-known-incidents.md` the method, the numbers, the limits and how to repeat it, with the tools in `tools/replay/` (`fetch.py`, `mrt2records.py`, `run_event.sh`, `analyse.py`, `events.json`).

## [1.50.3] - 2026-10-22

### Added
- The Examples page has the case of a **DDoS scrubbing center**: when it announces your routes with your AS number behind its own, it stands above you in the paths and belongs in the ASPA with the other providers (also when it is used only on demand, and before the first diversion); when it announces your prefixes with its own AS number as the origin (you authorise it in a ROA), it is the origin and not a provider. The first rule of the page and the mistake *Forgetting a provider* mention it.

## [1.50.2] - 2026-10-22

### Changed
- The routing registry (IRR) reading no longer needs a remark to see a provider. A neighbour that the object accepts ANY from and announces only a set of prefixes to (not ANY) is now shown as a **probable transit provider**, even with no part called transit, upstream or provider: that is how the policy of an upstream looks. An exchange-point route server looks the same, so the exchange-point ASes of CAIDA are left out (and are shown as intermediaries); without that list the neighbour stays a candidate as before. The probable providers take part in the comparison with the ASPA and in the three sources side by side (named as probable, and a declared one stays stronger), and the page says why. An object with a section called transit, upstream or provider is read as before.

## [1.50.1] - 2026-10-22

### Changed
- The chart *If more networks published an ASPA* is easier to read: both axes have a title (across, the networks that publish an ASPA; up, the incidents that are Invalid), the computed points are drawn as dots (the lines only join them), the lines say who publishes first (*the biggest networks*, *networks in random order*), and the text under the chart reads two points of it in words (10% and half of the networks) and, for a valley, says that the right end is always 100% because the detector and the ASPAs use the same CAIDA relationships. The text above it says in two lines what each axis is.

## [1.50.0] - 2026-10-22

### Added
- More kinds of incident in the copy of the scripts that runs here (`tools/data_scripts/extra_detectors.py`; items X-4 to X-7 of the `CROSS-CHECK.md` of the project `data_scripts`, which is not changed):
  - **PRH-AB**: a prefix that is not for the public Internet, or that the RIRs list as available or reserved (the delegation files of the adoption job; no ROA needed).
  - **ASM-PE and ASM-EX**: an AS that comes back in the path after another one, or an AS number that no registry has allocated (poisoning); a private AS number (extension).
  - **DEG-XS and DEG-FF**: the more specifics of one origin under a /16 (IPv4) or a /32 (IPv6), counted for a UTC day from two peers or more: 32 or more is an excessive deaggregation, 1,024 or more under a /32 (or 1,000 IPv4 of one origin) a flood; and a jump of an origin against the median of its last days. The thresholds are constants at the top of the module.
  - **VOL-DC and VOL-AC**: a prefix that keeps receiving updates for ten minutes without a pause of a minute (delayed convergence), and one origin with 3,000 updates in five minutes for 300 prefixes seen from 8 peers (amplified churn). The flapping of one prefix at one peer has its type, VOL-FO.
  - **ATR-EH and ATR-MA**: `stream.py` also records the NOTIFICATION messages and the changes of state of the sessions of the peers (records `N` and `S`, a few an hour); a session that ends with an UPDATE message error is an ATR incident, of the malformed-attribute type when the error is in an attribute. A mass withdrawal that follows a change of state of the session is marked.
- The table of the Incidents page shows these types under their class, and the table of coverage has 5 types detected, 15 partly (as candidates, or by a symptom) and 7 that cannot be observed. In a first sample of 23 minutes of `rrc00` (1.5 million updates) there were 2,136 candidates of forged origin and 469 of path shortening, many more than real attacks: most are links that CAIDA does not know, and the page says so.

### Changed
- `incident.py` is faster, three times on 1.5 million updates of `rrc00` (577 s before, 252 s after, on this host): the ROA check is remembered for each prefix and origin (the same announcement comes from many peers), a withdrawal finds the incidents of its prefix through an index instead of looking at every open one, and the events of a flapping prefix are kept in a queue instead of a list that was rebuilt for every update. The output is the same (12,297 incidents on the same updates before and after). A day of data is about 95 million updates, so a run should take about four and a half hours instead of twelve or more.
- `run-incidents.sh` links the delegation files of the adoption job into the working directory.

## [1.49.2] - 2026-10-22

### Changed
- The guide, read again. *Incidents and ASPA* says what the detectors look for now (the leak types, the candidates of forged origin and path shortening) without repeating the page, and points to the table of coverage. *Where the data comes from* names the source of the Incidents page and has its list punctuated. *Adoption* has back the paragraph on its numbers, which had ended up under *Validators compared*, and the definition of a feeder is given once. *About this page* says that the footer links to GitHub (it said GitLab since 1.48.2). The README has the new types in its feature list.

## [1.49.1] - 2026-10-22

### Changed
- The text of the Incidents page, without repetitions. The two tables of the detectors are one: in the table of coverage each class says what an ASPA can say about it (the table by class is gone). *How to read this* comes before the taxonomy, and says each thing once: what an incident is and what the counts are, the verdicts (and that an ASPA judges the path), the complete ASPAs, the time frame; what the chart does is in the text above it. The note under the table, the introduction of the taxonomy and the line of the sources are shorter, and the DOI of the survey is in its reference.

## [1.49.0] - 2026-10-22

### Added
- Three kinds of incident that the detectors did not tell apart, in the copy of the scripts that runs here (`tools/data_scripts/`, new module `extra_detectors.py`; the project `data_scripts` is not changed, the extensions are documented in its `CROSS-CHECK.md`, items X-1 to X-3):
  - **RLK-UL and RLK-LL**: the valley detector records the type of the leak (`rlk_type`, `learned_from`): a route sent to a provider is an upward leak, one sent to a peer a lateral one.
  - **RLK-FP**: when the page is built, a leaking AS that sent leaks to three or more different neighbours counts as a full propagation (a proxy of the definition of the survey, which needs the policy of that AS).
  - **ASM-FI and ASM-PS**: a link of the path that the CAIDA relationships do not know is a candidate of forged origin injection (the link to the origin) or path shortening (any other). They are candidates: CAIDA lacks real links too.
- `/api/v1/incidents.json` has `subtypes` (the same counts and verdicts as `by_type`), and the table of the Incidents page shows them under their class.

### Changed
- The table of coverage of the Incidents page: 5 types detected, 8 partly (the three above, PRH-AB, DEG-MA and the three ATR), 8 observable but not implemented, 6 not observable.

## [1.48.3] - 2026-10-22

### Added
- The Incidents page has a table of coverage that goes through the 27 types of the taxonomy of the survey and says, for each, whether the detectors of the project observe it: 5 are detected (PRH-CH, PRH-IH, VOL-FO, RLK-UL, RLK-LL), 5 only partly (PRH-AB, DEG-MA, ATR-EH, ATR-MA, ATR-VE), 11 are observable but not implemented (the four ASM types, VOL-AC, VOL-DC, DEG-CA, DEG-EX, DEG-FF, RLK-DL, RLK-FP) and 6 cannot be observed from the updates of a collector (PRH-MIT, VOL-DF and the four POL types). Under the table, the limits of one window on the Internet (a single collector, updates only, prefixes with ROAs only) and what the counts of the page do and do not measure.

## [1.48.2] - 2026-10-22

### Changed
- No page asks GitLab any more. The footer (shared by all the pages, the status page included) used to read the latest tag and the last commit from the GitLab API on every load, which from the Internet hangs until it fails, and its links *Release* and *Source* went to GitLab, which visitors outside the University cannot open. It now reads `/version.json` and `/build.json` only, and the links go to the public copy on GitHub (`/releases/tag/vX.Y.Z` and `/commit/<sha>`). The Content-Security-Policy no longer lists the GitLab of the Department in `connect-src`. The link to `CITATION.cff` in the API page goes to GitHub, and the guide and the API page name `/api/v1/archive/` as the place of the history files.

## [1.48.1] - 2026-10-22

### Added
- The Incidents page explains the whole taxonomy of routing incidents of our survey of Internet routing security (Servillo et al., *IEEE Communications Surveys & Tutorials*, vol. 28, 2026, Sec. III): the four macro-categories (route manipulation, routing consistency, policy violation, session-based), their micro-categories and types with the acronyms of the survey (PRH, ASM, VOL, DEG, RLK, POL, ATR), the documented incidents it cites, and a table of what each detector of the project sees and what an ASPA can say about it.

### Changed
- The Incidents page says the time frame exactly: the updates of the collector from one date and time to another (UTC), with its length (`period` of `/api/v1/incidents.json` has the time of the day), and that the page covers the last 30 days at most (`run-incidents.sh` drops the older incident files).
- The types in the table of the Incidents page have the names of the survey (*Routing leak*, *Prefix hijack*, *Prefix deaggregation*, *State volatility*, *Attribute-based session reset*), with how the detector sees them in brackets.

## [1.48.0] - 2026-10-22

### Added
- **Incidents**, a new page in the menu (`/incidents.html`): what the ASPAs say about the routing incidents that the detectors of the research project find in the updates of a RIPE RIS collector (`data_scripts`, `incident.py`). For each incident the AS paths it kept are checked with the downstream procedure with the ASPAs of the day it began (replayed from the history of changes), with complete ASPAs (the providers that CAIDA infers) and with a part of the networks publishing, from none to all, at random or the largest first. A table by type of incident and a chart; aggregates only, no AS number.
- `scripts/build-incidents.mjs` builds `/api/v1/incidents.json` from the incident files (`incidents_*.jsonl[.gz]`) and, with `--detail`, a file with the verdict of each incident that is not published; `scripts/test-incidents.mjs` tests it.
- `tools/data_scripts/`: the scripts of the research project (`record.py`, `stream.py`, `incident.py`) with the corrections of the cross-check of 2026-10-22 and their tests. On the host, the service `aspa_stream` (`deploy/freebsd/aspa_stream`) collects the updates of RIPE RIS Live and `scripts/run-incidents.sh` runs `incident.py` and the builder once a day.

## [1.47.12] - 2026-10-22

### Fixed
- The history of the ASPAs (the chart *ASPAs over time*, the recent changes, the quality checks, and the status page) was read from the GitLab of the Department in the browser of the visitor, and that GitLab is not reachable from the Internet: for visitors outside the University the chart and the changes came out empty and the status page said that *Daily history and changes* and *BGP visibility* were Down. The host now copies the three files (`history.json`, `events.json`, `visibility.json`) every ten minutes (`scripts/fetch-archive.mjs`) and serves them as `/api/v1/archive/<name>.json`; the pages read them from there. The builders, which run on the host, still read GitLab.

## [1.47.11] - 2026-10-22

### Changed
- The words "route leak" are not the label of what the statistics page counts any more. The section is *Valleys today* (and *Valleys seen now* in the lookup), without the parenthesis; the table that said *Possible route leaks* is *Valleys through a peer or a customer*, and its tile, the chart and the comparison say *Via peer or customer*. The hint says what a valley can be: a route passed on when it should not have been, or an ASPA or a relationship that is missing; the operators are the ones who know.
- The text under *Valleys seen now* does not point at the ASes in the valley any more: it says that a valley can be a leak, a forged path or, more often, a gap in the ASPAs, and asks to read the neighbours first.
- The e-mail of the notifier has the subject *New place of valley that involves ASx* (it was *Route leak or valley that involves ASx*), and the confirmation and the form do not say "possible route leak". The name of the check on the status page and the identifiers of the API (`leak`, `/api/v1/leaks.json`) are unchanged.

## [1.47.10] - 2026-10-22

### Fixed
- The summary line that `scripts/watch-invalid.mjs` writes at the end of a run is cleaned of line breaks too, like the message of a failed collection: code scanning followed the same flow to it.

## [1.47.9] - 2026-10-22

### Fixed
- The same line of `scripts/watch-invalid.mjs` is still reported by code scanning after 1.47.8, which cleaned only the error text: the whole message of a failed collection is now cleaned of line breaks before it is written.

## [1.47.8] - 2026-10-22

### Fixed
- `scripts/watch-invalid.mjs` wrote the error text of the RIS Live stream to the log as it came: a line break in it could have forged a line of the log (code scanning, `js/log-injection`). Line breaks are removed.

## [1.47.7] - 2026-10-22

### Fixed
- The home page stayed half faded (opacity 0.5 on the whole page) until the slow requests behind the overview (the BGP snapshot, the registry data) had finished, and went back to normal only after a query. The page is now dimmed only while the ASPA data itself is loading.

## [1.47.6] - 2026-10-21

### Fixed
- A shared report that had expired (30 days) was still served until the hourly clean-up deleted it, and for as long as the clean-up failed. `getReport()` and the page `/r/<id>` now answer 404 after the expiry; the clean-up only frees the room.
- The CI pipeline of GitLab checked fewer files than `make check`: `site/bulk.js`, `irr.js`, `valley.js`, `recent.js`, `peek.js`, `share.js`, `report.js` and several tests were not in its lists. The Makefile and the pipeline now call the same two scripts (`scripts/check-js.sh`, `scripts/run-tests.sh`) which take the files by pattern, and the security lint takes `site/*.js`; a new file is covered without anybody adding it to a list.
- The confirmation e-mail waited up to 60 seconds for `sendmail` while nginx gives up on a subscription after 20: the mailer now has 15 seconds.

### Changed
- The identifiers of the shared reports have 128 bits (32 characters) instead of 48. The ones made before are read until they expire. The nginx rule and `site/report.js` accept both.
- A report is not cached any more (`Cache-Control: no-store`, page and JSON): its address is its only key, and it has to disappear when it expires.
- An address can make at most 100 reports a day, besides the 20 an hour: the hourly limit alone let one address take the room over a few hours.
- `/api/v1/subscriptions/health` gives the number and the bytes of the shared reports (`reports`, `report_bytes`), to see the room fill before it is full.

## [1.47.5] - 2026-10-20

### Fixed
- A subscription with a long queue took the whole round of 2,000 messages and the others waited: the round now takes at most ten messages for each subscription (in order, with the retries as before), and a drain goes on in rounds until nothing is due.
- A run of `watch-invalid` that crossed midnight UTC put the announcements of the first minutes of the new day in the document of the day before. Each announcement now goes to the document of the day it arrived.
- `invalid-last.json` kept only the 300 busiest origins, so that an AS with exactly the threshold chosen by a subscriber was left out in a large incident, and nobody was told. The file now holds every origin that reached the minimum (up to 5,000; `omitted` says how many were cut, if any); only the busiest 300 carry their prefixes.
- The subscriptions to RIS Live are asked to be confirmed. The run is called partial (`collected.ok` false) when RIS Live answers `ris_error`, when a subscription is not confirmed, or when a collector that was asked for (`WATCH_HOSTS`) never spoke; the file says how many subscriptions were confirmed and how many collectors were heard. A socket that is silent for 30 seconds is closed and opened again.
- The health called a source `ok` when it was read well, although its data was days old (the web server keeps answering with the last file when the job that makes it stops). The notifier now looks at the date of the data of each source: ASPAs and state of the service one hour, invalid announcements 30 minutes, places of valley 36 hours; the health shows `data_generated` and `data_age_seconds`.
- An error of the database after a delivery that had gone (the answer of the webhook was fine, the write of the result failed) was counted as a failure of the recipient: five of them could switch off a subscription that works. The delivery of the network and the writes are now apart: only the first counts against the recipient, and the result of a delivery (`last_sent` and the removal from the queue) is written in one transaction. An error of the database reaches the caller and the health.
- A `drain()` that came while another one was running returned at once, and the health took it for a success. The second call now waits for the first and has its outcome.
- `scripts/pkg-audit.sh` took a failure of `pkg audit`, or of `pkg upgrade -n`, for "vulnerabilities without a fix" and ended with the status of a warning. A failure of pkg is now status 5, which fails the job.

## [1.47.4] - 2026-10-20

### Fixed
- A run of `watch-invalid` that could not listen to RIPE RIS Live wrote `invalid-last.json` like a quiet one: new time, no origin. The file now says how the run went (`collected`: connections, seconds listened, messages, announcements, error), and the seconds of the hours of `invalid.json` are only those in which the socket was open. The notifier does not take a file with `collected.ok` false, nor one that is more than an hour old: the source `invalid` of the health goes down after three such reads, and nobody is told that "nothing is invalid" when nothing could be seen.
- An error on the pipe to `sendmail` (`EPIPE`, when the mailer ends before it has read the message) was not handled and ended the whole notifier. It now fails that delivery only, once, together with the time limit and the exit of the process.
- The health said the delivery was fine when the queue itself failed (the database cannot be written): the errors of the pool were logged and not given back. `drain()` now fails when a subscription could not be processed; the failure of a recipient is still a normal retry.
- `scripts/mirror-wiki.sh` ended with the status of `sed`, so that a `git push` that failed still printed *published* and left the job green. The status of git is kept, the output is filtered afterwards, and the token is still hidden.

## [1.47.3] - 2026-10-20

### Fixed
- A webhook that had been switched off and was subscribed again kept its old choices: the answer said that the places of valley and the alert on invalid announcements were on, and the record had them off. The record goes back to *pending* first, as the e-mail ones do, and then takes what was asked.
- A message and the state that says "this was seen" were written one after the other: a crash between them queued the same event again, with another `event_id`. The two are now written in one transaction (ASPA changes, places of valley, state of the service, invalid announcements).
- A webhook answering a few bytes at a time was never cut: `timeout` of Node.js is for a silent socket, and the exchange could last for as long as the peer wanted while the other deliveries (and the next poll) waited. The whole exchange, from the name to the end of the answer, now has a limit of 15 seconds, and the socket is closed.
- `sendmail` had no limit of time either: a mailer that hangs is killed after a minute and the delivery is tried again later.
- A failure of the queue was cleared by the next successful read of the ASPAs, so that `failures_in_a_row` stayed at 1 and the health stayed `ok`. The delivery is now a source of its own in `sources` (`delivery`), and counts its failures by itself.
- The subscriptions that were switched off were deleted thirty days after their last message or confirmation, so that one confirmed long before was deleted the day it was switched off. The day is now kept (`disabled_at`); the ones that are off at the update count from that day.
- The AS path checker accepted AS0 (`0`, `AS0`, or inside a path) and answered *Valid*. AS0 cannot be in an AS_PATH (RFC 7607): the path is refused.

## [1.47.2] - 2026-10-20

### Fixed
- Two requests together to subscribe the same webhook to the same AS could work on one record: the second changed the secret and, when its check failed, deleted the record that the first had just activated, so that the first one was told *active* and had nothing. Only one check of an address and AS runs at a time; the other is answered with 409.
- The subscriptions that were switched off counted for the limit of 20 for an address (and were never deleted): an address that had lost 20 of them could not follow a new AS, and was answered *pending* without a mail. They no longer count, and are deleted after thirty days.
- The Atom feed of the changes said every day was updated at 06:30 UTC, even when the hourly run added changes to that day, so that a reader that goes by *id* and *updated* did not see them. An entry now takes the time of the run when its content changes and keeps its time when it does not (`scripts/feed.mjs`, with tests).
- `/api/v1/subscriptions/health` was `ok` when only the ASPAs were read: the places of valley, the state of the service and the invalid announcements could be unreadable for days. Each source now has its own last success and failures in a row (`sources`), and the answer is not `ok` if one of them has failed three times.

### Changed
- The queue is read with an index and with a limit (2,000 messages in a round), and a subscription is grouped in linear time: the query that picks the subscriptions whose oldest message is due grew with the square of their number.
- `scripts/mirror-wiki.sh` gives the tokens to git in its environment and no longer in the address and the arguments, which every user of the host can read with `ps`.
- `scripts/run-a11y.sh` installs exact versions of Playwright and axe-core, and without running their install scripts.

## [1.47.1] - 2026-10-20

### Fixed
- A new message of a subscription could go out before an older one that was waiting to be tried again. The queue now takes a subscription only when its oldest message is due, and sends its messages in order.
- The limit of subscriptions of an AS is checked again when a subscription starts to work (the confirmation of an address, the end of the check of a webhook), not only when it is asked for, so that many requests made together cannot go over it.
- The files of the notifier that already existed (the database and its journal) get permission 0600 at each start, not only the new ones.

### Added
- Every webhook delivery has an `event_id` (`aspa-<number>`) that is the same in all the attempts of a message, to drop the second copy after a crash. The API page says it, and corrects the line that said deliveries were not retried.
- `/api/v1/subscriptions/health` also says how many messages wait (`outbox_pending`), how old the oldest is (`oldest_pending_seconds`) and how many subscriptions were switched off (`disabled_subscriptions`); it is not `ok` when a message has waited more than twelve hours, which is more than all its retries take. No address is shown.

## [1.47.0] - 2026-10-20

### Changed
- Notifications are kept until they have gone. An event is written to a queue in the database, one row for each subscription that must hear about it, **before** the state that says it was seen is saved; a row is deleted only when the message has been delivered. A webhook that is down, a restart or a crash delays a notification and no longer loses it (it can come twice after a crash between the delivery and the delete). A failed message is tried again after 10 minutes, then 30 minutes, 1, 2 and 4 hours; the messages of one subscription go out in order and one at a time, the subscriptions eight at a time; after five failures in a row the subscription is switched off and its queue emptied; a message older than two days is dropped. The queue is read again at every start and every minute. It lives in `notifier/outbox.mjs` and the `outbox` table, with tests for the order, the retries, the five failures and the old messages.

### Fixed
- A subscription by e-mail that had been switched off was asked again, answered *active* after the confirmation, and stayed switched off, so that its owner believed to receive alerts that never came. Asking again now makes it pending, and the confirmation makes it active.
- The limit of 500 subscriptions of an AS counted the requests that nobody had confirmed, so that a few hundred of them could fill it. It counts the working subscriptions; the unconfirmed ones have their own limits (100 for each AS, 5,000 in all).
- Two deliveries to the same subscription could run at the same time, so that five quick failures disabled a subscription whose next message had gone. They are now one after the other.

### Security
- `3ffe::/16` (the old 6bone block) is refused as a webhook address.
- The notifier creates its files (the database, its journal, the keys) readable by its own user only, whatever the directory allows (`umask 077`).

## [1.46.4] - 2026-10-20

### Security
- The check that a webhook name resolves to public addresses only compares the 128 bits of an IPv6 address, not its text. The same network written another way (`2001:0000::1`, `2001:00::1`) used to pass as public, and the documentation block `3fff::/20` and the SRv6 block `5f00::/16` were missing. The special-purpose space of `2001::/23` is refused as a whole. The tests try the same networks in all their written forms.
- The sample nginx configuration logs the subscription endpoints without the query string, because the links to confirm and to unsubscribe carry a token in it.

### Changed
- Notifications are delivered eight at a time instead of one after the other (changes of ASPAs, places of valley, invalid announcements), so that a few webhooks that answer slowly do not hold up the others.

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
