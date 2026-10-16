# Contributing

Thanks for your interest in ASPA Explorer.

## Reporting problems and ideas

Development happens in a private repository of the Department of Information Engineering (group `internet_routing_sec`); the public repository is a read-only mirror of it, with issues and merge requests switched off. Send problems and ideas by email to antonio.prado@dei.unipd.it. For anything security-related, follow [SECURITY.md](SECURITY.md).

## Development

The site is plain HTML, CSS and JavaScript with no build step and no external dependencies. Keep it that way: no frameworks, no CDN assets, no inline scripts (the Content-Security-Policy forbids them).

Run the checks locally (needs Node.js 20+; the nginx check needs nginx and OpenSSL):

```
make check
```

To preview the page with real data, serve `site/` behind nginx with the configuration in `deploy/nginx/`, or point a local server at a Routinator instance that exposes `/jsonext` and `/api/v1/status`.

The pipeline also runs two security checks: `make lint-security` (ESLint rules that forbid `innerHTML`, `eval` and similar sinks in `site/*.js`) and `make secrets` (a [gitleaks](https://github.com/gitleaks/gitleaks) scan of the whole git history).

## Repositories and publication

- The internal project (`internet_routing_sec/aspa-explorer`) holds the development, the CI, the pipeline schedules, the wiki and the releases.
- A push mirror copies `main` and the tags to the public project (`Antonio-Prado/aspa-explorer`) on every push; work-in-progress branches are not mirrored.
- Releases and the wiki are not covered by the mirror. The job `publish-release` (every `v*` tag, which is a protected tag) creates the release in both projects, and `mirror-wiki` (daily schedule, `SCHEDULE=wiki`) copies the wiki. Both use `MIRROR_TOKEN`, a project access token of the public project (scopes `api` and `write_repository`, role Maintainer) stored as a masked and protected CI variable. It expires after one year, together with the token used inside the mirror's URL: renew both.

## Scheduled jobs

Two jobs run only from pipeline schedules (variable `SCHEDULE`), on the runner of the host that serves the page:

- `host-package-audit` (weekly, `SCHEDULE=audit`): `pkg audit` on the host, including the FreeBSD base system. The job fails, and GitLab sends the usual pipeline-failure email, when an installed package has a known vulnerability for which the repository already offers a fix; vulnerabilities without a fix yet only produce a warning. A daily root cron job refreshes the vulnerability database (`deploy/freebsd/`).
- `aspa-snapshot` (daily, `SCHEDULE=snapshot`): logs the number of ASPAs, provider ASes and the split per RIR as a run of the project's model experiment, so *Analyze > Model experiments* charts the adoption of ASPA over time (`scripts/log-snapshot.mjs`).

The snapshot job needs the CI variable `MLFLOW_TOKEN` (a project access token with the `api` scope, role Developer; masked and protected), because the model experiments API does not accept the CI job token. The token expires after one year.

Either job can be started by hand from *Build > Pipelines > Run pipeline* by setting the variable `SCHEDULE` to `audit` or `snapshot`.

## Guidelines

- Insert data into the DOM with `textContent` / DOM APIs only, never `innerHTML`, since all data comes from a remote service.
- Keep the page usable without a build step, in both light and dark mode, and on narrow screens.
- Update [CHANGELOG.md](CHANGELOG.md) under *Unreleased* for any user-visible change.

## Merge requests

1. Create a branch from `main`.
2. Keep changes focused; one topic per merge request.
3. Make sure the CI pipeline passes.
4. Fill in the merge request template.
