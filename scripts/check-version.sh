#!/bin/sh
# The version shown in the page footer (site/version.json) must match the latest
# release in CHANGELOG.md, and the pages must request their assets with ?v=<version>
# (cache busting).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
changelog=$(sed -n 's/^## \[\([0-9][0-9.]*\)\].*/\1/p' "$root/CHANGELOG.md" | head -n 1)
shown=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$root/site/version.json")

if [ -z "$changelog" ] || [ "$changelog" != "$shown" ]; then
  echo "version mismatch: CHANGELOG.md says '$changelog', site/version.json says '$shown'" >&2
  exit 1
fi
for page in index guide api subscription statistics status examples; do
  for asset in style.css app.js evidence.js tromboning.js status-checks.js footer.js subscription.js adoption.js leaks.js stats.js status.js examples.js download.js; do
    if ! grep -q "$asset?v=$shown\"" "$root/site/$page.html" && grep -q "\"/$asset" "$root/site/$page.html"; then
      echo "site/$page.html: $asset is not requested with ?v=$shown" >&2
      exit 1
    fi
  done
done
echo "version $shown"
