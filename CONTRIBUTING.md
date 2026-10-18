# Contributing

Thanks for your interest in ASPA Explorer.

## Reporting problems and ideas

Development happens in a private repository of the Department of Information Engineering (group `internet_routing_sec`); the public repository is a read-only mirror of it, with issues and merge requests switched off. Send problems and ideas by email to antonio.prado@dei.unipd.it. For anything security-related, follow [SECURITY.md](SECURITY.md) (the contact is also in [`/.well-known/security.txt`](https://aspa.ping6.it/.well-known/security.txt)). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

The site is plain HTML, CSS and JavaScript with no build step and no external dependencies. Keep it that way: no frameworks, no CDN assets, no inline scripts (the Content-Security-Policy forbids them).

Run the checks locally (needs Node.js 22+, because the notifier uses the built-in `node:sqlite`; the nginx check needs nginx and OpenSSL):

```
make check
```

To preview the page with real data, serve `site/` behind nginx with the configuration in `deploy/nginx/`, or point a local server at a Routinator instance that exposes `/jsonext` and `/api/v1/status`.

The ASPA path verification (`site/verify.js`) is a pure module with unit tests (`make test`, `scripts/test-verify.mjs`); the tests include the worked examples of the paper that the procedure is based on. Change the procedure only together with its tests. The other readings of the data are pure modules too, each with its tests: the quality checks (`site/quality.js`), who is the provider of an origin (`site/evidence.js`), traceroutes of the tromboning (`site/traceroute.js`), the checks of the status page (`site/status-checks.js`), the builders of the per-AS API and of the adoption numbers (`scripts/build-api.mjs`, `scripts/build-adoption.mjs`) and the notifier (`notifier/`, `scripts/test-notify.mjs`).

The pipeline also runs two security checks: `make lint-security` (ESLint rules that forbid `innerHTML`, `eval` and similar sinks in `site/*.js`) and `make secrets` (a [gitleaks](https://github.com/gitleaks/gitleaks) scan of the whole git history).

## Repositories and publication

- The internal project (`internet_routing_sec/aspa-explorer`) holds the development, the CI, the pipeline schedules, the wiki and the releases.
- A push mirror copies `main` and the tags to the public project (`Antonio-Prado/aspa-explorer`) on every push; work-in-progress branches are not mirrored.
- Releases and the wiki are not covered by the mirror. The job `publish-release` (every `v*` tag, which is a protected tag) creates the release in both projects, and `mirror-wiki` (daily schedule, `SCHEDULE=wiki`) copies the wiki. Both use `MIRROR_TOKEN`, a project access token of the public project (scopes `api` and `write_repository`, role Maintainer) stored as a masked and protected CI variable. It expires after one year, together with the token used inside the mirror's URL: renew both.

## Services on the host

Besides the static page, the host that serves it runs three things that the CI does not deploy: the builder of the per-AS API, badges and feeds (`scripts/build-api.mjs`, every 15 minutes), the builder of the adoption numbers and of the AS registry (`scripts/build-adoption.mjs`, once a day) and the notifier service (`notifier/`, started by `deploy/freebsd/aspa_notify`). They run as unprivileged users from `cron` and `rc`; the wiki page *Deployment* describes how to set them up. After changing a file that they use (`build-api.mjs`, `build-adoption.mjs`, `site/history.js`, `site/quality.js`, `notifier/*`) copy it to the host and, for the notifier, restart the service.

When a page asset changes (script, style), change its `?v=` as well: the CDN in front of the site keeps assets by address, so the same address keeps serving the old file.

## Scheduled jobs

Three jobs run only from pipeline schedules (variable `SCHEDULE`), on the runner of the host that serves the page; the third, `mirror-wiki` (daily, `SCHEDULE=wiki`), is described above:

- `host-package-audit` (weekly, `SCHEDULE=audit`): `pkg audit` on the host, including the FreeBSD base system. The job fails, and GitLab sends the usual pipeline-failure email, when an installed package has a known vulnerability for which the repository already offers a fix; vulnerabilities without a fix yet only produce a warning. A daily root cron job refreshes the vulnerability database (`deploy/freebsd/`).
- `aspa-snapshot` (daily, `SCHEDULE=snapshot`): logs the number of ASPAs, provider ASes and the split per RIR as a run of the project's model experiment, so *Analyze > Model experiments* charts the adoption of ASPA over time (`scripts/log-snapshot.mjs`).

The snapshot job needs the CI variable `MLFLOW_TOKEN` (a project access token with the `api` scope, role Developer; masked and protected), because the model experiments API does not accept the CI job token. The token expires after one year.

Each job can be started by hand from *Build > Pipelines > Run pipeline* by setting the variable `SCHEDULE` to `audit`, `snapshot` or `wiki`.

## Guidelines

- Insert data into the DOM with `textContent` / DOM APIs only, never `innerHTML`, since all data comes from a remote service.
- Keep the page usable without a build step, in both light and dark mode, and on narrow screens.
- `site/guida.html` is the Italian translation of `site/guide.html`: when you change the guide, change both (same ids and structure).
- After a change to a page, run `make a11y` (or look at the result of the *Accessibility* workflow on the GitHub copy): every page must pass axe-core at desktop width and at 320 px, in both themes, and not scroll sideways. The data it uses are the small files of `scripts/fixtures/a11y`, recorded with `scripts/record-fixtures.mjs`.
- Update [CHANGELOG.md](CHANGELOG.md) under *Unreleased* for any user-visible change.

## Merge requests

1. Create a branch from `main`.
2. Keep changes focused; one topic per merge request.
3. Make sure the CI pipeline passes.
4. Fill in the merge request template.
