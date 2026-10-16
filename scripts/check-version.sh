#!/bin/sh
# The version shown in the page footer (site/version.json) must match the latest
# release in CHANGELOG.md.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
changelog=$(sed -n 's/^## \[\([0-9][0-9.]*\)\].*/\1/p' "$root/CHANGELOG.md" | head -n 1)
shown=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$root/site/version.json")

if [ -z "$changelog" ] || [ "$changelog" != "$shown" ]; then
  echo "version mismatch: CHANGELOG.md says '$changelog', site/version.json says '$shown'" >&2
  exit 1
fi
echo "version $shown"
