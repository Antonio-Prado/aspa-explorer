# Maintaining ASPA Explorer

For the people who run the project. Contributors only need [CONTRIBUTING.md](CONTRIBUTING.md).

## The copies of the repository

- **The private project** (`internet_routing_sec/aspa-explorer` on the GitLab of the Department of Information Engineering) is where the project is developed: the CI, the pipeline schedules, the wiki and the releases live there, and the site is deployed from it.
- **The public GitLab project** (`Antonio-Prado/aspa-explorer`) is a copy: a push mirror sends it `main` and the tags on every push (work-in-progress branches are not mirrored). The job `publish-release` (every `v*` tag, a protected tag) creates the release there, and `mirror-wiki` (daily, `SCHEDULE=wiki`) copies the wiki, to the public GitLab project and to the wiki of the GitHub copy (with the deploy key of `github-mirror`; the GitLab image sizes `{height=N}` are removed on the way). The links of the README point at the GitHub wiki, which is reachable from outside the department. Both use a project access token of the public project, kept as a masked and protected CI variable; it expires after one year, together with the one used in the URL of the push mirror: renew both.
- **GitHub** (`Antonio-Prado/aspa-explorer`) is the copy where outsiders open issues and send pull requests. The job `github-mirror` (`scripts/mirror-github.sh`) force-pushes `main` and each tag to it with a deploy key that can write to that repository only; the GitHub workflow `release.yml` makes a release for each tag, which Zenodo archives (the DOI is in the README). Its workflows (*Checks*, *Accessibility*, *CodeQL*) run on pushes to `main` and, the first two, on pull requests.

## Applying a pull request

A pull request cannot be merged on GitHub: its `main` is rewritten by the mirror at every push. So:

1. Read it on GitHub and talk to the author there. Ask for changes in the pull request itself.
2. When it is right, take it into the private repository keeping the author: `git fetch <github> pull/N/head`, `git format-patch main..FETCH_HEAD`, and `git am` the patches on a branch of the private project (fix a conflict by hand, not by rewriting the author).
3. Run `make check`, and `make a11y` for a page. Add the line of `CHANGELOG.md` if the author did not, and thank the author in it.
4. Open a merge request, wait for the pipeline, merge, release as usual.
5. Close the pull request on GitHub with a comment that links to the commit. The commit reaches the GitHub copy with the next push.

## Internal merge requests

Whoever has access to the private project: create a branch from `main`, keep one topic for each merge request, make sure the CI pipeline passes and fill in the merge request template.

## Services on the host

Besides the static page, the host that serves it runs a few things that the CI does not deploy, listed here and in the two paragraphs after: the builder of the per-AS API, badges and feeds (`scripts/build-api.mjs`, every 15 minutes), the builder of the adoption numbers and of the AS registry (`scripts/build-adoption.mjs`, once a day) and the notifier service (`notifier/`, started by `deploy/freebsd/aspa_notify`). They run as unprivileged users from `cron` and `rc`; the wiki page *Deployment* describes how to set them up. After changing a file that they use (`build-api.mjs`, `build-adoption.mjs`, `site/history.js`, `site/quality.js`, `notifier/*`) copy it to the host and, for the notifier, restart the service.

The pages read the history of the ASPAs (`history.json`, `events.json`, `visibility.json`) from `/api/v1/archive/`, not from GitLab, which is not reachable from the Internet: `scripts/fetch-archive.mjs` copies the three files from the `history` branch every ten minutes (cron, as `aspagen`, into `/var/db/aspa-gen/archive`), and nginx serves them. If the history stops, look at `/var/db/aspa-gen/archive.log` first.
The **Incidents** page has its own small pipeline on the host: the service `aspa_stream` (`deploy/freebsd/aspa_stream`, runs `tools/data_scripts/stream.py` as `aspagen`, one file for each UTC day in `/var/db/aspa-data/incoming`) and the daily job `scripts/run-incidents.sh` (cron, as `aspagen`: it runs `tools/data_scripts/incident.py` on the closed files and then `scripts/build-incidents.mjs`, which writes `/var/db/aspa-gen/incidents.json`). It needs `python3.12` and `py312-websocket-client`. Copy `stream.py`, `incident.py`, `extra_detectors.py` (imported by `incident.py`) and `run-incidents.sh` to `/usr/local/libexec/aspa-data/` when they change, and `build-incidents.mjs` (with `build-leaks.mjs`, which it imports) and `rib-links.mjs` (with `mrt.mjs`) to the `aspa-gen` scripts directory; restart `aspa_stream` after a change to `stream.py`. `extra_detectors.py` reads the delegation files of the adoption job (`run-incidents.sh` links them into the working directory), and every threshold of the detectors is a constant at the top of the file that applies it: `extra_detectors.py` for the extensions, `incident.py` for the flapping (`VOL_FO_*`), `build-incidents.mjs` for the full propagation and the persistent valleys (`FP_*`, `PERSISTENT_MIN_HOURS`). The data scripts are a corrected copy of `internet_routing_sec/data_scripts`, with the extensions of `extra_detectors.py` (documented in the `CROSS-CHECK.md` of that project): keep the common part in step.

When a page asset changes (script, style), change its `?v=` as well: the CDN in front of the site keeps assets by address, so the same address keeps serving the old file.

## Scheduled jobs

Four jobs run only from pipeline schedules (variable `SCHEDULE`), on the runner of the host that serves the page; the fourth, `mirror-wiki` (daily, `SCHEDULE=wiki`), is described above:

- `host-package-audit` (weekly, `SCHEDULE=audit`): `pkg audit` on the host, including the FreeBSD base system. The job fails, and GitLab sends the usual pipeline-failure email, when an installed package has a known vulnerability for which the repository already offers a fix; vulnerabilities without a fix yet only produce a warning. A daily root cron job refreshes the vulnerability database (`deploy/freebsd/`).
- `aspa-snapshot` (daily, `SCHEDULE=snapshot`): logs the number of ASPAs, provider ASes and the split per RIR as a run of the project's model experiment, so *Analyze > Model experiments* charts the adoption of ASPA over time (`scripts/log-snapshot.mjs`). The same run commits the day's row, events and Atom feed to the `history` branch and the visibility file.
- `history-refresh` (hourly, at minute 20, `SCHEDULE=history`): `scripts/log-snapshot.mjs --history-only` brings only the `history` branch up to date (the day's events and the Atom feed, replayed from the state of the day before), so that the history of an AS and the feed show a new ASPA within the hour and not the next morning. It makes no model experiment run and no RIPEstat call, keeps the coverage figures that the daily run wrote in the row of the day, and commits nothing when nothing changed. A change that appears and disappears between two runs leaves no event.

The snapshot and history jobs need a project access token kept as a masked and protected CI variable, because the model experiments API does not accept the CI job token. The token expires after one year: renew it. The history job needs the same token, because writing to the branch is not allowed to the job token either.

Each job can be started by hand from *Build > Pipelines > Run pipeline* by setting the variable `SCHEDULE` to `audit`, `snapshot`, `history` or `wiki`.

