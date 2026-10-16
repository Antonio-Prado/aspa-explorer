.PHONY: check js html nginx

check: js html nginx

js:
	node --check site/app.js

html:
	npx --yes html-validate@9 site/index.html

# Validates the nginx configuration with a throwaway certificate.
nginx:
	sh scripts/check-nginx.sh
