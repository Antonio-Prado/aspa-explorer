#!/bin/sh
# Runs the accessibility and layout test (scripts/test-a11y.mjs) on a host that has Node.js and a Chromium.
# Exit status 3, which the CI treats as a warning, when there is no browser to run it with.
#   sh scripts/run-a11y.sh [page name...]      (CHROME=/path/to/chrome to choose the browser)
set -eu
chrome=${CHROME:-$(command -v chrome || command -v chromium || command -v chromium-browser || true)}
if [ -z "$chrome" ] || [ ! -x "$chrome" ]; then
  echo "no Chromium found (set CHROME, or on FreeBSD: pkg install chromium): the accessibility test was not run" >&2
  exit 3
fi
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The packages and a copy of the test go in a folder of their own (Node looks for packages next to the real file),
# so that no node_modules is left in the project; the site and the fixtures are the ones of the project.
(cd "$work" && npm install --no-save --no-audit --no-fund playwright-core axe-core >/dev/null)
mkdir -p "$work/scripts"
cp "$root/scripts/test-a11y.mjs" "$work/scripts/"
cp -R "$root/scripts/fixtures" "$work/scripts/fixtures"
ln -s "$root/site" "$work/site"
# PLAYWRIGHT_BROWSERS_PATH: on a platform that Playwright has no browser for (FreeBSD) it refuses to start without a folder for them
cd "$work" && PLAYWRIGHT_BROWSERS_PATH="$work/browsers" CHROME="$chrome" node scripts/test-a11y.mjs "$@"
