<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="ASPA Explorer" height="96">
  </picture>
</p>

# ASPA Explorer

A small static web page to browse the validated **ASPA** (Autonomous System Provider Authorization) objects published in the RPKI, as seen by a [Routinator](https://github.com/NLnetLabs/routinator) validator.

Live instance: <https://aspa.ping6.it/> (DEI, University of Padova).

## Features

- Built-in [user guide](site/guide.html) (English) and a footer link to this project with the running version.
- Look up an AS: its own ASPA and every ASPA that names it as a provider (deep link `#AS680`).
- Summary tiles and charts: ASPAs per RIR, providers per ASPA, most-named providers.
- Filterable table of all ASPAs.
- No external dependencies, strict Content-Security-Policy, data written to the DOM only through `textContent`.

## Layout

```
assets/                logo (SVG)
site/                  static files (index.html, guide.html, style.css, app.js, footer.js, version.json, favicon.svg)
scripts/               CI helper scripts (nginx and version checks)
deploy/nginx/aspa.conf       nginx server blocks and proxy cache zone
deploy/nginx/rpki-proxy.conf proxy settings shared by the data endpoints
```

## How it works

The page fetches two same-origin JSON files, which nginx proxies to Routinator and caches for 2 minutes:

| Page path | Routinator endpoint |
|---|---|
| `/data/aspas.json` | `/jsonext?exclude=routeOrigins,routerKeys` |
| `/data/status.json` | `/api/v1/status` |

## Deploy

1. Copy `site/*` to the web root (e.g. `/usr/local/www/aspa`).
2. Copy `deploy/nginx/aspa.conf` into nginx's `conf.d/` and `deploy/nginx/rpki-proxy.conf` next to `nginx.conf`. Adjust the listen IP, server name, TLS certificate paths and the Routinator host in `rpki-proxy.conf`.
3. Make sure the Routinator HTTP(S) port is reachable from the web server, then `nginx -t && nginx -s reload`.

## Development

No build step, no dependencies. `make check` runs the same checks as the CI pipeline (JavaScript syntax, HTML validation, nginx configuration test). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Project documents

- [CHANGELOG.md](CHANGELOG.md): release history
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute
- [SECURITY.md](SECURITY.md): how to report a vulnerability
- [LICENSE](LICENSE): MIT

## License

Released under the [MIT License](LICENSE).
