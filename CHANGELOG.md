# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://gitlab.dei.unipd.it/Antonio-Prado/aspa-explorer/-/compare/v1.3.0...main
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
