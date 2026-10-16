<p align="center">
  <img src="assets/logo.svg" alt="ASPA Explorer" height="96">
</p>

<p align="center">
  <strong>Browse the validated ASPA objects of the RPKI, in the browser.</strong><br>
  A small static page on top of a <a href="https://github.com/NLnetLabs/routinator" target="_blank" rel="noopener">Routinator</a> validator.
</p>

<p align="center">
  <a href="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/releases" target="_blank" rel="noopener"><img alt="latest release" src="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/badges/release.svg"></a>
</p>

<p align="center">
  <a href="https://aspa.ping6.it/" target="_blank" rel="noopener">Live site</a> ·
  <a href="https://rpki.ping6.it/" target="_blank" rel="noopener">Validator</a> ·
  <a href="https://aspa.ping6.it/guide.html" target="_blank" rel="noopener">Guide</a> ·
  <a href="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/home#" target="_blank" rel="noopener">Wiki</a> ·
  <a href="CHANGELOG.md" target="_blank" rel="noopener">Changelog</a> ·
  <a href="CONTRIBUTING.md" target="_blank" rel="noopener">Contributing</a>
</p>

<p align="center"><sub>This is the public, read-only mirror of the project's development repository. To report a problem or suggest a change, write to <a href="mailto:antonio.prado@dei.unipd.it">antonio.prado@dei.unipd.it</a>.</sub></p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/lookup-light.jpg" alt="Looking up AS680: its own ASPA and the ASPAs that name it as a provider"></td>
    <td width="50%"><img src="assets/screenshots/overview-dark.jpg" alt="Overview tiles and charts in the dark theme"></td>
  </tr>
  <tr>
    <td align="center"><sub>Look up an AS</sub></td>
    <td align="center"><sub>Overview, in the dark theme</sub></td>
  </tr>
</table>

## What is it

An **ASPA** (Autonomous System Provider Authorization) is a signed RPKI object in which a *customer* AS lists the ASes that may act as its upstream *providers*. Routers use these lists to detect route leaks and some forged AS paths.

ASPA Explorer shows every ASPA that the validator currently considers valid, so you can search it and see the big picture. It runs at <https://aspa.ping6.it/> (Department of Information Engineering, University of Padova).

The validator is a [Routinator](https://github.com/NLnetLabs/routinator) instance run at **[rpki.ping6.it](https://rpki.ping6.it/)**, which also publishes its own web UI (<https://rpki.ping6.it/ui/>) and the raw ASPA data (<https://rpki.ping6.it/jsonext?exclude=routeOrigins,routerKeys>).

## Features

- **Lookup:** type `AS680`, `as 680` or `680` to see the AS's own ASPA and every ASPA that names it as a provider. Each lookup has a shareable address (`/#AS680`).
- **AS path check:** paste a path as your router shows it (neighbour first, origin last) and see whether it passes the ASPA verification procedure of the IETF draft (upstream or downstream), hop by hop, with the reason for a *Valid*, *Unknown* or *Invalid* verdict. It runs in the browser on the ASPA objects listed on the page, and a result can be shared with a link.
- **Overview:** summary tiles and three charts: ASPAs per RIR, providers per ASPA, most-named providers.
- **Table:** all ASPAs, filterable by AS number and RIR, 100 rows at a time.
- **Built-in guide** in English, with an accessibility statement: <a href="https://aspa.ping6.it/guide.html" target="_blank" rel="noopener">read it on the site</a> (source: <a href="site/guide.html" target="_blank" rel="noopener"><code>site/guide.html</code></a>).
- **Accessible:** keyboard operable, visible focus, skip link, light and dark themes, reduced-motion aware. Checked with axe-core in both themes (WCAG 2.2 AA rules) with no issues reported.
- **No build step, no dependencies, no cookies.** Strict Content-Security-Policy; remote data goes into the page only through `textContent`.

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

    B->>B: render overview, table, lookup and path check

    loop about every 10 minutes
        R->>+T: fetch the repositories of the five RIRs
        T-->>-R: signed RPKI objects
        R->>R: validate, keep the valid ASPAs
    end
```

The diagram above is a UML sequence diagram: the visitor's browser gets the static page from nginx and then the data, which nginx serves from its 2-minute cache or fetches from Routinator, while Routinator validates the RPKI repositories on its own schedule.

The page fetches two same-origin JSON files, which nginx proxies to Routinator and caches:

| Page path | Routinator endpoint |
|---|---|
| `/data/aspas.json` | `/jsonext?exclude=routeOrigins,routerKeys` |
| `/data/status.json` | `/api/v1/status` |

## Repository layout

```
site/                          the web root: index.html, guide.html, style.css, app.js,
                               footer.js, verify.js, version.json, favicon.svg, img/
assets/                        logo (SVG), screenshots and credit logos used in this README
deploy/nginx/aspa.conf         nginx server blocks and proxy cache zone
deploy/nginx/rpki-proxy.conf   proxy settings shared by the data endpoints
deploy/nginx/security-headers.conf   security headers (server block and /client-ip)
scripts/                       CI helpers and jobs: nginx check, version check, unit tests of the
                               path verification, build info, package audit, ASPA snapshot,
                               release and wiki publishing
.gitlab-ci.yml                 the CI pipeline (checks, security, scheduled and publishing jobs)
deploy/freebsd/                daily refresh of the pkg vulnerability database
eslint.config.mjs              security rules for the browser code (no innerHTML, eval, ...)
```

## Deploy

1. Copy `site/*` to the web root (for example `/usr/local/www/aspa`).
2. Copy `deploy/nginx/aspa.conf` into nginx's `conf.d/`, and `deploy/nginx/rpki-proxy.conf` and `deploy/nginx/security-headers.conf` next to `nginx.conf`. Adjust the listen IP, server name, TLS certificate paths and the Routinator host in `rpki-proxy.conf`.
3. Write the build information shown in the footer next to `index.html`: `sh scripts/build-info.sh > build.json`.
4. Make sure the Routinator HTTP(S) port is reachable from the web server, then `nginx -t && nginx -s reload`.

## Development

No build step and no dependencies. `make check` runs the same checks as the CI pipeline: JavaScript syntax, HTML validation, nginx configuration test, version consistency, a security lint of the browser code and the unit tests of the ASPA path verification (`make test`). The pipeline also scans the git history for secrets (`make secrets`). Scheduled jobs audit the packages of the host weekly and log a daily snapshot of the ASPA data to the project's *Model experiments* (adoption over time); see [CONTRIBUTING.md](CONTRIBUTING.md). Details in <a href="CONTRIBUTING.md" target="_blank" rel="noopener">CONTRIBUTING.md</a>.

Releases follow [Semantic Versioning](https://semver.org/); the version shown in the footer lives in <a href="site/version.json" target="_blank" rel="noopener"><code>site/version.json</code></a> and must match the latest entry of the <a href="CHANGELOG.md" target="_blank" rel="noopener">changelog</a>.

## Project documents

| | |
|---|---|
| <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG.md</a> | release history |
| <a href="CONTRIBUTING.md" target="_blank" rel="noopener">CONTRIBUTING.md</a> | how to contribute |
| <a href="SECURITY.md" target="_blank" rel="noopener">SECURITY.md</a> | how to report a vulnerability |
| <a href="https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/wikis/home#" target="_blank" rel="noopener">Wiki</a> | user guide, accessibility, deployment |
| <a href="LICENSE" target="_blank" rel="noopener">LICENSE</a> | MIT |

## License

Released under the <a href="LICENSE" target="_blank" rel="noopener">MIT License</a>.

<p align="center">
  <a href="https://www.dei.unipd.it" target="_blank" rel="noopener"><img src="assets/credits/dei-logo.png" alt="DEI, Department of Information Engineering, University of Padova" height="40"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://www.freebsd.org" target="_blank" rel="noopener"><img src="assets/credits/freebsd-logo.png" alt="FreeBSD" height="40"></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://nlnetlabs.nl/projects/routinator/" target="_blank" rel="noopener"><img src="assets/credits/routinator-avatar.png" alt="Routinator, by NLnet Labs" height="40"></a>
  &nbsp;&nbsp;&nbsp;
  <img src="assets/credits/vi-logo.svg" alt="vi" height="32">
</p>
