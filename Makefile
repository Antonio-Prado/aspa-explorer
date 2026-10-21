.PHONY: check js html nginx version lint-security secrets test a11y

check: js html nginx version lint-security test

js:
	sh scripts/check-js.sh

html:
	npx --yes html-validate@9 site/index.html site/guide.html site/api.html site/subscription.html site/statistics.html site/status.html site/examples.html site/embed.html site/report.html

# Validates the nginx configuration with a throwaway certificate.
nginx:
	sh scripts/check-nginx.sh

version:
	sh scripts/check-version.sh

# Static analysis of the browser code: no innerHTML, eval and similar sinks.
lint-security:
	npx --yes eslint@9 --no-config-lookup -c eslint.config.mjs site/*.js

# Secret scan of the whole git history (needs gitleaks: https://github.com/gitleaks/gitleaks).
secrets:
	gitleaks git --redact --no-banner .

# Unit tests of the ASPA path verification (no dependencies).
test:
	sh scripts/run-tests.sh

# Accessibility and 320 px check in a real browser (a Chromium on the machine; CHROME=/path/to/chrome to choose it)
a11y:
	sh scripts/run-a11y.sh
