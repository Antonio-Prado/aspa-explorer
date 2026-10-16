.PHONY: check js html nginx version

check: js html nginx version

js:
	node --check site/app.js
	node --check site/footer.js

html:
	npx --yes html-validate@9 site/index.html site/guide.html

# Validates the nginx configuration with a throwaway certificate.
nginx:
	sh scripts/check-nginx.sh

version:
	sh scripts/check-version.sh
