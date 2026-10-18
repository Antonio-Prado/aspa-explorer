# Contributing

Thanks for your interest in ASPA Explorer.

## Reporting problems and ideas

The place for everybody is the copy of the project on GitHub, <https://github.com/Antonio-Prado/aspa-explorer>: open an **issue** for a problem or an idea (there are two forms, one for a bug and one for a suggestion), or send a **pull request**. You can also write to antonio.prado@dei.unipd.it. For anything security-related do not open an issue: follow [SECURITY.md](SECURITY.md) (the contact is also in [`/.well-known/security.txt`](https://aspa.ping6.it/.well-known/security.txt)). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Sending a pull request

1. Fork the repository on GitHub and make your change on a branch; keep it small and about one thing.
2. Run `make check` (see below). A change to a page must pass `make a11y` too, and a change that shows in the page is better with a line in `CHANGELOG.md` under `[Unreleased]`. Both checks also run on your pull request on GitHub (the workflows *Checks*, which is `make check` without the check of the nginx configuration, and *Accessibility*); a red one is worth a look before you ask for a review.
3. Open the pull request and say what it changes and why, how you tried it, and, for a change that people see, what it looks like. The template asks for exactly this.

**What happens next.** Development happens in a private repository of the Department of Information Engineering (group `internet_routing_sec`): that is where the checks run and where the site is deployed from. The GitHub copy is made from it, and its `main` is rewritten at every push, so a pull request cannot be merged on GitHub itself. A maintainer reads it there, discusses it with you in the pull request, applies it to the private repository keeping you as the author of the commit, and closes the pull request with a link to the commit that contains it. It will appear in the GitHub copy with the next push. Expect a reply within a few working days; a pull request that is not answered is not refused, write to the address above.

**Your data.** A commit carries the name and the e-mail address that you set in git, and the history of the project is public: use an address that you are happy to see there. On GitHub, issues and pull requests are handled under the privacy statement of GitHub; the privacy information for the site is that of the University of Padova, <https://www.unipd.it/en/privacy>.

## Development

The site is plain HTML, CSS and JavaScript with no build step and no external dependencies. Keep it that way: no frameworks, no CDN assets, no inline scripts (the Content-Security-Policy forbids them).

Run the checks locally (needs Node.js 22+, because the notifier uses the built-in `node:sqlite`; the nginx check needs nginx and OpenSSL):

```
make check
```

To preview the page with real data, serve `site/` behind nginx with the configuration in `deploy/nginx/`, or point a local server at a Routinator instance that exposes `/jsonext` and `/api/v1/status`.

The ASPA path verification (`site/verify.js`) is a pure module with unit tests (`make test`, `scripts/test-verify.mjs`); the tests include the worked examples of the paper that the procedure is based on. Change the procedure only together with its tests. The other readings of the data are pure modules too, each with its tests: the quality checks (`site/quality.js`), who is the provider of an origin (`site/evidence.js`), traceroutes of the tromboning (`site/traceroute.js`), the checks of the status page (`site/status-checks.js`), the builders of the per-AS API and of the adoption numbers (`scripts/build-api.mjs`, `scripts/build-adoption.mjs`) and the notifier (`notifier/`, `scripts/test-notify.mjs`).

The checks of the project also include two security checks: `make lint-security` (ESLint rules that forbid `innerHTML`, `eval` and similar sinks in `site/*.js`) and `make secrets` (a [gitleaks](https://github.com/gitleaks/gitleaks) scan of the whole git history).

## Guidelines

- Insert data into the DOM with `textContent` / DOM APIs only, never `innerHTML`, since all data comes from a remote service.
- Keep the page usable without a build step, in both light and dark mode, and on narrow screens.
- Everything is in English: the pages, the guide and the documents. There is no translation to keep in step.
- After a change to a page, run `make a11y` (or look at the result of the *Accessibility* workflow on your pull request): every page must pass axe-core at desktop width and at 320 px, in both themes, and not scroll sideways. The data it uses are the small files of `scripts/fixtures/a11y`, recorded with `scripts/record-fixtures.mjs`.
- Update [CHANGELOG.md](CHANGELOG.md) under *Unreleased* for any user-visible change.

## Maintainers

How the copies of the repository, the services on the host and the scheduled jobs work, and how a pull request is applied, is in [MAINTAINING.md](MAINTAINING.md).
