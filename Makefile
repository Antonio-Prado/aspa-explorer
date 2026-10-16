.PHONY: check js html nginx version lint-security secrets test

check: js html nginx version lint-security test

js:
	node --check site/app.js
	node --check site/footer.js
	node --check site/verify.js

html:
	npx --yes html-validate@9 site/index.html site/guide.html

# Validates the nginx configuration with a throwaway certificate.
nginx:
	sh scripts/check-nginx.sh

version:
	sh scripts/check-version.sh

# Static analysis of the browser code: no innerHTML, eval and similar sinks.
lint-security:
	npx --yes eslint@9 --no-config-lookup -c eslint.config.mjs site/app.js site/footer.js site/verify.js

# Secret scan of the whole git history (needs gitleaks: https://github.com/gitleaks/gitleaks).
secrets:
	gitleaks git --redact --no-banner .

# Unit tests of the ASPA path verification (no dependencies).
test:
	node scripts/test-verify.mjs
