<p align="center">
  <img src="assets/logo.svg" alt="ASPA Explorer" height="96">
</p>

<p align="center">
  <strong>Explore, check and follow the ASPA objects of the RPKI.</strong><br>
  A web page, a small API and a notification service on top of a <a href="https://github.com/NLnetLabs/routinator" target="_blank" rel="noopener">Routinator</a> validator: lookups, AS path and route checks, statistics, feeds, badges and notifications.
</p>

<p align="center">
  <a href="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/releases" target="_blank" rel="noopener"><img alt="latest release" src="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/badges/release.svg"></a>
  <a href="https://doi.org/10.5281/zenodo.23450622" target="_blank" rel="noopener"><img alt="DOI" src="https://zenodo.org/badge/DOI/10.5281/zenodo.23450622.svg"></a>
</p>

<p align="center">
  <a href="https://aspa.ping6.it/" target="_blank" rel="noopener">Live site</a> ·
  <a href="https://rpki.ping6.it/" target="_blank" rel="noopener">Validator</a> ·
  <a href="https://aspa.ping6.it/guide.html" target="_blank" rel="noopener">Guide</a> ·
  <a href="https://aspa.ping6.it/api.html" target="_blank" rel="noopener">API</a> ·
  <a href="https://aspa.ping6.it/statistics.html" target="_blank" rel="noopener">Statistics</a> ·
  <a href="https://aspa.ping6.it/status.html" target="_blank" rel="noopener">Status</a> ·
  <a href="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/home#" target="_blank" rel="noopener">Wiki</a> ·
  <a href="CHANGELOG.md" target="_blank" rel="noopener">Changelog</a> ·
  <a href="CONTRIBUTING.md" target="_blank" rel="noopener">Contributing</a>
</p>

<p align="center"><sub>This is the public, read-only mirror of the project's development repository (it is copied to <a href="https://github.com/Antonio-Prado/aspa-explorer" target="_blank" rel="noopener">GitHub</a> as well). To report a problem or suggest a change, write to <a href="mailto:antonio.prado@dei.unipd.it">antonio.prado@dei.unipd.it</a>.</sub></p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/lookup-light.jpg" alt="Looking up AS680: its own ASPA and the ASPAs that name it as a provider, with its history and the AS path check below"></td>
    <td width="50%"><img src="assets/screenshots/statistics-dark.jpg" alt="The statistics page in the dark theme: ASPAs over time, stacked by RIR, and the other charts"></td>
  </tr>
  <tr>
    <td align="center"><sub>Look up an AS, with its history</sub></td>
    <td align="center"><sub>Statistics, in the dark theme</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/pathcheck-dark.jpg" alt="Checking the AS path 3356 1299 680: the verdict and the hop-by-hop table"></td>
    <td width="50%"><img src="assets/screenshots/routes-dark.jpg" alt="The routes seen in BGP for AS3333: its prefixes checked against the ROAs (two invalid, longer than the ROA allows), then the distinct AS paths checked against the ASPAs"></td>
  </tr>
  <tr>
    <td align="center"><sub>AS path check: verdict and hop-by-hop reasons</sub></td>
    <td align="center"><sub>Routes seen in BGP: ROAs for the prefixes, ASPAs for the paths</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/quality-dark.jpg" alt="The ASPA quality section: errors, warnings and notes, with the ASPAs of each check"></td>
    <td width="50%"><img src="assets/screenshots/share-light.jpg" alt="Share and follow: links to the page, feed and JSON of an AS, the form to be notified by e-mail or webhook, and the badge with the Markdown and HTML to paste"></td>
  </tr>
  <tr>
    <td align="center"><sub>ASPA quality: what looks wrong in the ASPAs</sub></td>
    <td align="center"><sub>Share and follow: feed, notifications, badge, API</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/adoption-dark.jpg" alt="The adoption page: the largest transit networks without an ASPA, with their customer cone and country"></td>
    <td width="50%"><img src="assets/screenshots/examples-light.jpg" alt="The examples page: a checker that reviews a list of providers and compares it with the published ASPA"><br><img src="assets/screenshots/status-light.jpg" alt="The status page: each part of the service with its state and the time of its last update"></td>
  </tr>
  <tr>
    <td align="center"><sub>Adoption: by size, RIR and country, and the largest transit networks</sub></td>
    <td align="center"><sub>Examples with a checker, and the status page</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="assets/screenshots/evidence-dark.jpg" width="60%" alt="The neighbours of AS12779 in the routes seen in BGP: which are in its ASPA, which look like providers from the routes, and the note that AS60798 seems to be a provider its ASPA does not list"><br><sub>Neighbours of an origin: the evidence of who its providers are</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/graph-dark.jpg" alt="The neighbourhood graph of AS12779: the providers of its ASPA above, the ASes that name it below, and on the right the neighbours that the routes show, with AS60798 marked as a likely provider"></td>
    <td width="50%"><img src="assets/screenshots/live-dark.jpg" alt="The live updates of RIPE RIS Live going through AS9002, each announcement with its ASPA verdict"></td>
  </tr>
  <tr>
    <td align="center"><sub>Neighbourhood graph, with the neighbours that the routes show</sub></td>
    <td align="center"><sub>Live updates from RIS Live, checked as they arrive</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/leaks-dark.jpg" alt="Route leaks today: the invalid routes of the collectors, grouped by the place of the valley, with the ASes inside it"></td>
    <td width="50%"><img src="assets/screenshots/validators-dark.jpg" alt="Validators compared: the customers whose providers differ between Routinator, rpki-client and the rpki-client of Cloudflare"></td>
  </tr>
  <tr>
    <td align="center"><sub>Route leaks seen today in the table dumps</sub></td>
    <td align="center"><sub>Validators compared</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/suggest-dark.jpg" alt="A starting point for the ASPA of AS12779: the providers already listed and seen, AS60798 seen but not listed, the ones not seen, and a list to copy"></td>
    <td width="50%"><img src="assets/screenshots/compare-dark.jpg" alt="Compare two dates for AS12779: the providers its ASPA added and the ASPAs that began to name it"></td>
  </tr>
  <tr>
    <td align="center"><sub>A starting point for an ASPA, from the evidence of the routes</sub></td>
    <td align="center"><sub>Compare two dates for an AS</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="assets/screenshots/collectors-dark.jpg" width="70%" alt="Collectors compared: a bar for each of the 30 collectors of RIPE RIS and RouteViews with the places of valley it sees, and the same places told apart by who sees them"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub>The collectors compared, and RIPE RIS against RouteViews on the same places</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/whatif-dark.jpg" alt="What if the ASPA of AS12779 listed the proposed providers: the routes valid, unknown and invalid before and after, and the paths whose verdict changes"></td>
    <td width="50%"><img src="assets/screenshots/trends-dark.jpg" alt="Networks with an ASPA over time for Italy, with the HTML to embed the chart in another page"></td>
  </tr>
  <tr>
    <td align="center"><sub>What if the ASPA listed other providers</sub></td>
    <td align="center"><sub>Networks with an ASPA over time, by RIR or country, with an embeddable chart</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/resources-dark.jpg" alt="From allocation to ASPA: the AS numbers allocated, advertised and with an ASPA, by RIR"></td>
    <td width="50%"><img src="assets/screenshots/coverage-dark.jpg" alt="Valid routes by address space and by length of the AS path, with a bar of the three verdicts for each length"></td>
  </tr>
  <tr>
    <td align="center"><sub>From allocation to ASPA, by RIR</sub></td>
    <td align="center"><sub>Verdicts by address space and by length of the path</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="assets/screenshots/tromboning-dark.jpg" width="60%" alt="Tromboning of AS41327: a table with the median of the round trips of twelve probes in Italy, and a row for each probe with the networks on the way and the reading"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub>Tromboning, measured: twelve probes in the country, the median first</sub></td>
  </tr>
</table>

## What is it

An **ASPA** (Autonomous System Provider Authorization) is a signed RPKI object in which a *customer* AS lists the ASes that may act as its upstream *providers*. Routers use these lists to detect route leaks and some forged AS paths.

ASPA Explorer shows every ASPA that the validator currently considers valid, so you can search it, check AS paths and the routes seen in BGP against it, follow its changes and see the big picture. It runs at <https://aspa.ping6.it/> (Department of Information Engineering, University of Padova).

<sub>In numbers, on 18 October 2026: 3,229 of 88,221 networks seen in BGP have an ASPA (3.66%); 607 M routes of 30 collectors are checked every day: 59 M valid (9.8%), 547 M with no ASPA to say about some hop and 691 k invalid; 10,011 places of valley, 16 days of history. The [statistics page](https://aspa.ping6.it/statistics.html) has the numbers of today.</sub>

The validator is a [Routinator](https://github.com/NLnetLabs/routinator) instance run at **[rpki.ping6.it](https://rpki.ping6.it/)**, which also publishes its own web UI (<https://rpki.ping6.it/ui/>) and the raw ASPA data (<https://rpki.ping6.it/jsonext?exclude=routeOrigins,routerKeys>).

## Features

**Look up and check**

- **Lookup:** type `AS680`, `as 680` or `680` to see the AS's own ASPA, every ASPA that names it as a provider, its history and the quality findings about its ASPA. Each AS has a page of its own (`/as/AS680`) and a shareable address (`/#AS680`).
- **AS path check:** paste a path as your router shows it (neighbour first, origin last) and see whether it passes the ASPA verification procedure of the IETF draft (upstream or downstream), hop by hop, with the reason for a *Valid*, *Unknown* or *Invalid* verdict. It runs in the browser on the ASPA objects listed on the page, and a result can be shared with a link.
- **Routes seen in BGP:** for a prefix or an AS, the routes that the RIPE RIS collectors see (through RIPEstat; this box sends the prefix or the AS to RIPEstat, and the guide says so). It gives, on one page:
  - *origin validation*: every prefix and origin checked against the ROAs of the validator (valid, not found, invalid with the reason), asked of the page's own server;
  - *the AS paths* checked with the downstream procedure (valid, unknown, invalid);
  - *route leaks*: the valleys that the ASPAs prove, grouped by place, with the feeders that see them;
  - *the neighbours of the origin*, with an evidence column that says which of them look like its providers because its routes go on through them to a Tier-1 network, and which of them its ASPA does not list;
  - *tromboning*: a traceroute from twelve probes in the country of the origin (Globalping), with the median round trip and a row for each probe, to tell a route that goes far away (100 ms or more inside a country) from a normal one.

  Evidence and tromboning are readings, with their limits stated in the page, not verdicts.
- **Live and graph:** under the routes of an AS, the updates that RIPE RIS Live hands out as they arrive, each one checked with the ASPAs (a leak shows up here while it happens); in the lookup, the neighbourhood of an AS drawn as a graph (`site/graph.js`).
- **Writing your ASPA:** an examples page with the rules, five cases, the common mistakes and a checker that reviews a list of providers and compares it with the published ASPA.

**Follow**

- **Changes:** the ASPAs that appeared, changed or disappeared in the last 14 days, an Atom feed of them (`/changes.atom`), and the history of one AS. The series is rebuilt from the RIPE NCC RPKI archive (`tools/backfill-history.py`) and extended every day by the `aspa-snapshot` job.
- **A feed and a badge for every AS:** `/feed/AS3333.atom` lists the changes of its ASPA and of the ASPAs that add or drop it as a provider; `/badge/AS3333.svg` is a badge with its number of providers (Markdown and HTML to paste are in the lookup).
- **Notifications:** subscribe an e-mail address (confirmed through a link, DKIM-signed mails with a one-click unsubscribe) or a webhook (verified by a challenge, signed with HMAC-SHA256, public https addresses only) to the changes of an AS, or to the state of the service (a part of it becoming late or down, and back). The service is `notifier/`, a small Node.js program with SQLite.

**Numbers**

- **Overview:** summary tiles on the home page, with the coverage (the share of the ASes seen in BGP that have an ASPA).
- **Statistics:** the charts of the ASPAs (over time since October 2023 by RIR, provider ASes, median providers, no-provider ASPAs or coverage, over any period, with a logarithmic scale and CSV/JSON download; per RIR; providers per ASPA; most-named providers) and the adoption: who has an ASPA by size of the network, RIR and country, and the 100 largest transit networks.
- **Route leaks today:** every route of 30 collectors, sixteen of RIPE RIS (rrc00, 01, 03, 04, 05, 06, 07, 10, 11, 12, 14, 15, 16, 19, 21 and 23) and fourteen of RouteViews (Oregon, route-views3 and 4, London, Palo Alto, Tokyo, New York, Perth, Atlanta, Singapore, Johannesburg, Sao Paulo, Sydney and Equinix), on five continents, checked with the downstream ASPA verification once a day (`scripts/build-leaks.mjs`, a small MRT reader in `scripts/mrt.mjs`), the places of valley grouped and told apart with the CAIDA relationships into possible leaks and ASPAs that seem to miss a provider, also as `/api/v1/leaks.json`.
- **Collectors compared:** a bar for each of the 30 collectors (places of valley seen, places that only it sees, invalid routes, feeders, routes read) and the same places told apart by who sees them, RIPE RIS only, both projects or RouteViews only (`comparison` and the figures of each collector in `/api/v1/leaks.json`).
- **Leaks over time, alerts and comparison:** the daily totals of the leaks (`/api/v1/leaks-history.json`, a chart on the statistics page), the places of valley that involve each AS (`/api/v1/leaks-by-as.json`, and one file for each of the last 60 days), an opt-in alert for the new places that involve a subscribed AS, and *Compare two dates* on the page of an AS (providers added and dropped, the ASPAs that began or stopped naming it, its places of valley).
- **A starting point for an ASPA:** from the evidence about the neighbours of an origin, the providers to list, the ones already declared and the weak leads, with a list ready to copy.
- **Validators compared:** the ASPAs of this site's Routinator and of two rpki-client validators (the project's console and Cloudflare's), side by side every hour (`scripts/build-validators.mjs`), with the ASPAs on which they differ, also as `/api/v1/validators.json`.
- **Quality:** checks on every ASPA (AS0 mixed with other providers, a private or reserved provider, two ASes listing each other, providers no collector sees in BGP, expiring objects, very large provider sets) with counts and lists, a *Quality* block in the lookup and a *check now* link on the ASes that list each other.
- **What if:** for an AS, the routes the collectors see checked again as if its ASPA had other providers (the proposal, or the ones you type), with the routes that would become valid, unknown or invalid and the paths that change (`site/whatif.js`, pure functions with tests).
- **Over time, by RIR and country:** the networks with an ASPA month by month for all, each RIR (AFRINIC at zero is drawn too) or country (`scripts/build-trends.mjs`, `/api/v1/trends.json`), with a chart that other sites can embed (`/embed.html?country=IT`).
- **From allocation to ASPA:** the AS numbers allocated, advertised and with an ASPA by RIR, region and economy, with the figures per million Internet users, by year of allocation and width of the number, and the ASPAs that name numbers that are not allocated (`scripts/build-resources.mjs`, `/api/v1/resources.json`).
- **Valid routes by address space, IPv6 against IPv4:** the verdicts of the routes of 30 collectors weighted by the addresses they cover, by length of the AS path and by family, in a table with the ratio IPv6 / IPv4 (the `families` of `/api/v1/leaks.json`).
- **Invalid announcements, as they happen:** a sample of the RIPE RIS Live stream checked with ASPA, by hour, origin AS and prefix for 14 days, with the origins and prefixes that have most (`scripts/watch-invalid.mjs`, `/api/v1/invalid.json`).
- **Dated snapshots for research:** once a month a `.tar.gz` of the ASPAs, history, events, adoption, trends, leaks and validators with a manifest of SHA-256 sums (`scripts/build-dataset.mjs`, `/datasets/index.json`, CC BY 4.0); `.zenodo.json` has the metadata of the archive on Zenodo ([10.5281/zenodo.23450622](https://doi.org/10.5281/zenodo.23450622), always the latest version; every release of the GitHub copy gets its own DOI).
- **Status:** a page and a dot in the menu that say how fresh each piece of data is (validator, API files, daily history, BGP visibility, adoption numbers, notifications), a chart of the state of each part over the last 24 hours to 90 days, the availability of each part by month, kept for good, and alerts by e-mail or webhook when a part becomes late or down (`scripts/build-status.mjs` runs the checks every 15 minutes; the file is `/api/v1/status-history.json`).
- **Download:** the whole list of ASPAs as CSV or JSON, for one RIR or all.

**Open data**

- **Public API:** `/api/v1/as/3333` returns the ASPA, the ASPAs that name it, BGP visibility, quality findings and history as JSON (CORS open), next to `/api/v1/adoption.json`, `/api/v1/asn-registry.json`, `/api/v1/aspas.csv` and `/api/v1/aspas.json`; see `site/api.html` and the OpenAPI description in `site/api/openapi.json`.

**The project**

- **Built-in guide** in English and Italian (<a href="https://aspa.ping6.it/guida.html" target="_blank" rel="noopener">guida</a>), with an accessibility statement: <a href="https://aspa.ping6.it/guide.html" target="_blank" rel="noopener">read it on the site</a> (source: <a href="site/guide.html" target="_blank" rel="noopener"><code>site/guide.html</code></a>).
- **Accessible:** keyboard operable (tabs included), visible focus, skip link, light and dark themes, reduced-motion aware. Checked with axe-core in both themes (WCAG 2.2 AA rules) with no issues reported.
- **Plain code, no dependencies, no cookies.** The page is static JavaScript with no build step; the services behind the API, the adoption numbers and the notifications are small Node.js programs that use no package. Strict Content-Security-Policy; remote data goes into the page only through `textContent`.

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor V as Visitor
    participant B as :Browser
    participant N as aspa.ping6.it :nginx
    participant R as rpki.ping6.it :Routinator
    participant T as :RPKI repositories

    V->>B: open the page
    B->>+N: GET / (page, scripts, styles)
    N-->>-B: static files

    par ASPA objects
        B->>+N: GET /data/aspas.json
        alt response in the cache (less than 2 minutes old)
            N-->>B: cached JSON
        else cache miss
            N->>+R: GET /jsonext?exclude=routeOrigins,routerKeys
            R-->>-N: valid ASPA objects (JSON)
            N-->>B: JSON, stored in the cache
        end
        deactivate N
    and validator status
        B->>+N: GET /data/status.json
        N->>+R: GET /api/v1/status
        R-->>-N: status (JSON)
        N-->>-B: status (JSON)
    end

    B->>B: render the overview, the lookup and the path check

    loop about every 10 minutes
        R->>+T: fetch the repositories of the five RIRs
        T-->>-R: signed RPKI objects
        R->>R: validate, keep the valid ASPAs
    end
```

The diagram above is a UML sequence diagram of the data of the home page: the visitor's browser gets the static page from nginx and then the data, which nginx serves from its 2-minute cache or fetches from Routinator, while Routinator validates the RPKI repositories on its own schedule. Mermaid does not make the parts of a sequence diagram clickable, so here are their links: the browser is described in [Features](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer#features) and the [User guide](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/User-guide), nginx and its 2-minute cache in [Deployment](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#what-the-nginx-configuration-does), Routinator at [rpki.ping6.it](https://rpki.ping6.it/) and in the [NLnet Labs documentation](https://routinator.docs.nlnetlabs.nl/), and the RPKI repositories in [Where the data comes from](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/User-guide#where-the-data-comes-from). Around it there are a few more pieces, which the wiki describes in *Deployment*; in the next diagram the boxes are links:

```mermaid
flowchart LR
    V["Visitor's browser"] -->|"page, /data/*, /api/v1/*"| N["nginx<br>aspa.ping6.it"]
    N -->|"/jsonext, status,<br>validity"| R["Routinator<br>rpki.ping6.it"]
    N -->|"per-AS files, lists"| F[("JSON files<br>built by the jobs")]
    N -->|"/api/v1/subscriptions"| S["notifier<br>Node.js + SQLite"]
    S -->|"mail, webhooks"| U["subscribers"]
    R -.->|"fetch, validate"| T["RPKI repositories<br>of the five RIRs"]
    V -->|"routes"| P["RIPEstat"]
    V -->|"history, events"| H["history branch<br>of the public project"]
    click V "https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer#features"
    click N "https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#what-the-nginx-configuration-does"
    click F "https://aspa.ping6.it/api.html"
    click S "https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#notifications-optional"
    click H "https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#rebuilding-the-history"
```

In a browser that allows it (GitLab does) the boxes of the diagram are links to the part of this README or of the wiki that explains them; the table below has the same links for everywhere else.

| Part | Where it is explained |
|---|---|
| The page, the lookup, the path check, the routes, the leaks | [Features](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer#features) here, and the [User guide](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/User-guide) of the wiki |
| nginx: cache, headers, proxy | [Deployment, what the nginx configuration does](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#what-the-nginx-configuration-does) |
| `build-api` (per-AS files, badges, feeds) | [Deployment, the per-AS API](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#the-per-as-api-badges-and-feeds) |
| `build-adoption` | [Deployment, the adoption numbers](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#the-adoption-numbers) |
| `build-leaks`, `build-validators` | [Deployment, the route-leak and validator builders](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#the-route-leak-and-validator-builders) |
| `build-status` and the chart of the status page | [Deployment, the status history](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#the-status-history) and [User guide, Status](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/User-guide#status) |
| The notifier | [Deployment, notifications](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#notifications-optional) and [User guide](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/User-guide#notifications-by-e-mail-and-webhook) |
| The history branch and the daily job | [Deployment, rebuilding the history](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#rebuilding-the-history) and [scheduled jobs](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#scheduled-jobs) |
| Behind Cloudflare or another proxy | [Deployment](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#behind-a-reverse-proxy-or-a-cdn) |

The same-origin endpoints:

| Page path | What it is |
|---|---|
| `/data/aspas.json`, `/data/status.json` | Routinator's `/jsonext?exclude=routeOrigins,routerKeys` and `/api/v1/status`, proxied and cached for 2 minutes |
| `/data/validity/AS<n>/<prefix>` | Routinator's origin validation of one route |
| `/api/v1/as/<n>`, `/badge/AS<n>.svg`, `/feed/AS<n>.atom` | files built every 15 minutes for each AS; any other AS gets a generic answer |
| `/api/v1/aspas.json`, `/api/v1/aspas.csv`, `/api/v1/meta.json` | the whole list, and when it was built |
| `/api/v1/adoption.json`, `/api/v1/asn-registry.json` | numbers built once a day |
| `/api/v1/subscriptions…` | subscriptions, confirmations, unsubscribe and health, served by the notifier |
| `/changes.atom` | the Atom feed of the changes, proxied from the history branch |

More diagrams are in the wiki: the [jobs that build the files](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#the-jobs-at-a-glance), with their sources; the [notifier](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/Deployment#notifications-optional), as a sequence diagram of a subscription and of the announcement of a change; and the [status history](https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/User-guide#status), as a sequence diagram of the job and of the chart. (GitLab draws the first few thousand characters of diagrams on a page and asks for a click before drawing more, which is why they are not all here.)

## Repository layout

```
site/                          the web root: the pages (index, guide, api, statistics, examples, status,
                               subscription), their scripts and style.css, version.json, api/openapi.json,
                               paper/ and img/
notifier/                      the notification service (subscriptions, mail with DKIM, webhooks)
scripts/                       the builders of the per-AS API (build-api.mjs) and of the adoption numbers
                               (build-adoption.mjs), the daily snapshot, release and wiki publishing, the CI
                               helpers and the unit tests (test-*.mjs)
tools/                         backfill-history.py rebuilds the history from the RIPE NCC RPKI archive
deploy/nginx/                  server blocks and proxy cache zone (aspa.conf), the proxy settings shared by
                               the data endpoints (rpki-proxy.conf) and the security headers
deploy/freebsd/                rc script of the notifier, daily refresh of the pkg vulnerability database
assets/                        logo, screenshots and credit logos used in this README
.gitlab/, .gitlab-ci.yml       issue and merge request templates, and the CI pipeline
eslint.config.mjs              security rules for the browser code (no innerHTML, eval, ...)
```

## Deploy

1. Copy `site/*` to the web root (for example `/usr/local/www/aspa`).
2. Copy `deploy/nginx/aspa.conf` into nginx's `conf.d/`, and `deploy/nginx/rpki-proxy.conf` and `deploy/nginx/security-headers.conf` next to `nginx.conf`. Adjust the listen IP, server name, TLS certificate paths and the Routinator host in `rpki-proxy.conf`.
3. Write the build information shown in the footer next to `index.html`: `sh scripts/build-info.sh > build.json`.
4. For the per-AS API, badges and feeds, run `node scripts/build-api.mjs /var/db/aspa-gen` (Node.js 18+, with `site/history.js` and `site/quality.js` next to its `../site`) every 15 minutes as an unprivileged user; it builds into a new directory and switches a `current` symlink that nginx serves. Without it the AS endpoints still answer, with "no ASPA".
5. Notifications (optional): run `notifier/main.mjs` as an unprivileged user with the `deploy/freebsd/aspa_notify` rc script (Node.js 22 with `node:sqlite`; the environment variables are listed at the top of the file), route `/api/v1/subscriptions` to it as in `deploy/nginx/aspa.conf`, and publish SPF and DKIM records for the sending domain; see the wiki, Deployment.
6. Adoption numbers (optional): run `node scripts/build-adoption.mjs /var/db/aspa-gen/adoption.json` once a day (Node.js 18+ and `bunzip2`; it downloads the RIR delegation files and the CAIDA relationships into a cache next to the output).
7. Make sure the Routinator HTTP(S) port is reachable from the web server (it must expose `/jsonext`, `/api/v1/status` and `/api/v1/validity`), then `nginx -t && nginx -s reload`.

## Development

No build step and no dependencies. `make check` runs the same checks as the CI pipeline: JavaScript syntax, HTML validation, nginx configuration test, version consistency, a security lint of the browser code and the unit tests (`make test`: the ASPA path verification, the API and adoption builders, the evidence and traceroute readings, the status checks and the notifier). The pipeline also scans the git history for secrets (`make secrets`). Scheduled jobs audit the packages of the host weekly, log a daily snapshot of the ASPA data to the project's *Model experiments* and copy the wiki to the public mirror; the builders and the notifier run on the host itself. See [CONTRIBUTING.md](CONTRIBUTING.md).

Releases follow [Semantic Versioning](https://semver.org/); the version shown in the footer lives in <a href="site/version.json" target="_blank" rel="noopener"><code>site/version.json</code></a> and must match the latest entry of the <a href="CHANGELOG.md" target="_blank" rel="noopener">changelog</a>.

## Project documents

| | |
|---|---|
| <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG.md</a> | release history |
| <a href="CONTRIBUTING.md" target="_blank" rel="noopener">CONTRIBUTING.md</a> | how to contribute |
| <a href="SECURITY.md" target="_blank" rel="noopener">SECURITY.md</a> | how to report a vulnerability |
| <a href="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/home#" target="_blank" rel="noopener">Wiki</a> | user guide, accessibility, deployment |
| <a href="LICENSE" target="_blank" rel="noopener">LICENSE</a> | MIT |

## Citation

The downstream verification implemented by the path check is analysed in the following paper (proceedings forthcoming in IEEE Xplore); the <a href="site/paper/prado-centenaro-vangelista-cscn2026.pdf" target="_blank" rel="noopener">author's accepted version (PDF)</a> is in the repository and at <a href="https://aspa.ping6.it/paper/prado-centenaro-vangelista-cscn2026.pdf" target="_blank" rel="noopener">aspa.ping6.it</a> (© 2026 IEEE; copyright may be transferred without notice, after which this version may no longer be accessible); the repository also provides a <a href="CITATION.cff" target="_blank" rel="noopener"><code>CITATION.cff</code></a>.

```bibtex
@inproceedings{prado2026aspa,
  author    = {Prado, Antonio and Centenaro, Marco and Vangelista, Lorenzo},
  title     = {Securing Multi-domain 5G/6G Routing: Towards Path Verification with {ASPA}},
  booktitle = {Proc. IEEE Conference on Standards for Communications and Networking (CSCN)},
  address   = {London, UK},
  month     = sep,
  year      = {2026},
  note      = {Proceedings forthcoming in IEEE Xplore}
}
```

## License

Released under the <a href="LICENSE" target="_blank" rel="noopener">MIT License</a>.

<p align="center">
  <a href="https://www.dei.unipd.it" target="_blank" rel="noopener"><img src="assets/credits/dei-logo.png" alt="Powered by DEI, Department of Information Engineering, University of Padova" title="Powered by DEI, Department of Information Engineering, University of Padova" height="40"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://www.freebsd.org" target="_blank" rel="noopener"><img src="assets/credits/freebsd-logo.png" alt="Served by FreeBSD" title="Served by FreeBSD" height="40"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://nlnetlabs.nl/projects/routinator/" target="_blank" rel="noopener"><img src="assets/credits/routinator-avatar.png" alt="Validated by Routinator, by NLnet Labs" title="Validated by Routinator, by NLnet Labs" height="40"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://en.wikipedia.org/wiki/Vi_(text_editor)" target="_blank" rel="noopener"><img src="assets/credits/vi-logo.svg" alt="Made with vi, the text editor" title="Made with vi, the text editor" height="32"></a>
  &nbsp;&nbsp;&nbsp;
  <span role="img" aria-label="Inspired by passion" title="Inspired by passion">❤️</span>
</p>
