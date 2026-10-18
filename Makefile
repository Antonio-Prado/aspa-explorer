.PHONY: check js html nginx version lint-security secrets test a11y

check: js html nginx version lint-security test

js:
	node --check site/app.js
	node --check site/footer.js
	node --check site/verify.js
	node --check site/evidence.js
	node --check site/whatif.js
	node --check site/bulk.js
	node --check site/traceroute.js
	node --check site/graph.js
	node --check site/live.js
	node --check site/status-checks.js
	node --check scripts/build-api.mjs
	node --check scripts/build-adoption.mjs
	node --check scripts/mrt.mjs
	node --check scripts/build-leaks.mjs
	node --check scripts/build-validators.mjs
	node --check scripts/build-status.mjs
	node --check scripts/build-trends.mjs
	node --check scripts/build-dataset.mjs
	node --check scripts/build-resources.mjs
	node --check scripts/watch-invalid.mjs
	sh -n scripts/run-a11y.sh
	node --check scripts/test-a11y.mjs
	node --check scripts/record-fixtures.mjs
	for f in site/adoption.js site/leaks.js site/validators.js site/stats.js site/download.js site/status.js site/status-history.js site/ui.js site/resources.js site/coverage.js site/invalid.js site/trends.js site/datasets.js site/examples.js site/subscription.js site/share.js site/report.js; do node --check $$f; done
	for f in notifier/*.mjs; do node --check $$f; done

html:
	npx --yes html-validate@9 site/index.html site/guide.html site/guida.html site/api.html site/subscription.html site/statistics.html site/status.html site/examples.html site/embed.html site/report.html

# Validates the nginx configuration with a throwaway certificate.
nginx:
	sh scripts/check-nginx.sh

version:
	sh scripts/check-version.sh

# Static analysis of the browser code: no innerHTML, eval and similar sinks.
lint-security:
	npx --yes eslint@9 --no-config-lookup -c eslint.config.mjs site/app.js site/footer.js site/verify.js site/evidence.js site/whatif.js site/traceroute.js site/graph.js site/live.js site/status-checks.js site/adoption.js site/leaks.js site/validators.js site/stats.js site/download.js site/status.js site/status-history.js site/trends.js site/datasets.js site/ui.js site/resources.js site/coverage.js site/invalid.js site/examples.js site/subscription.js site/bulk.js site/share.js site/report.js

# Secret scan of the whole git history (needs gitleaks: https://github.com/gitleaks/gitleaks).
secrets:
	gitleaks git --redact --no-banner .

# Unit tests of the ASPA path verification (no dependencies).
test:
	node scripts/test-verify.mjs
	node scripts/test-api.mjs
	node scripts/test-adoption.mjs
	node scripts/test-leaks.mjs
	node scripts/test-validators.mjs
	node scripts/test-status-history.mjs
	node scripts/test-whatif.mjs
	node scripts/test-bulk.mjs
	node scripts/test-trends.mjs
	node scripts/test-dataset.mjs
	node scripts/test-resources.mjs
	node scripts/test-invalid.mjs
	node scripts/test-graph.mjs
	node scripts/test-compare.mjs
	node scripts/test-live.mjs
	node scripts/test-evidence.mjs
	node scripts/test-traceroute.mjs
	node scripts/test-status.mjs
	node --disable-warning=ExperimentalWarning scripts/test-notify.mjs

# Accessibility and 320 px check in a real browser (a Chromium on the machine; CHROME=/path/to/chrome to choose it)
a11y:
	sh scripts/run-a11y.sh
