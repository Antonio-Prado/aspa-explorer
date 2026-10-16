# Contributing

Thanks for your interest in ASPA Explorer.

## Reporting problems and ideas

Open an issue using one of the templates. For anything security-related, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development

The site is plain HTML, CSS and JavaScript with no build step and no external dependencies. Keep it that way: no frameworks, no CDN assets, no inline scripts (the Content-Security-Policy forbids them).

Run the checks locally (needs Node.js 20+; the nginx check needs nginx and OpenSSL):

```
make check
```

To preview the page with real data, serve `site/` behind nginx with the configuration in `deploy/nginx/`, or point a local server at a Routinator instance that exposes `/jsonext` and `/api/v1/status`.

The pipeline also runs two security checks: `make lint-security` (ESLint rules that forbid `innerHTML`, `eval` and similar sinks in `site/*.js`) and `make secrets` (a [gitleaks](https://github.com/gitleaks/gitleaks) scan of the whole git history).

## Scheduled jobs

Two jobs run only from pipeline schedules (variable `SCHEDULE`), on the runner of the host that serves the page:

- `host-package-audit` (weekly, `SCHEDULE=audit`): `pkg audit` on the host, including the FreeBSD base system. The job fails, and GitLab sends the usual pipeline-failure email, when an installed package has a known vulnerability. A daily root cron job refreshes the vulnerability database (`deploy/freebsd/`).
- `aspa-snapshot` (daily, `SCHEDULE=snapshot`): logs the number of ASPAs, provider ASes and the split per RIR as a run of the project's model experiment, so *Analyze > Model experiments* charts the adoption of ASPA over time (`scripts/log-snapshot.mjs`).

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
