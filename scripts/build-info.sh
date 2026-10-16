#!/bin/sh
# Print the build information shown in the page footer ("Last commit ...") as JSON.
# Run it on the commit being deployed and publish the output as build.json next to
# index.html:
#
#   sh scripts/build-info.sh > build.json
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
commit=$(git -C "$root" rev-parse HEAD)
date=$(git -C "$root" log -1 --format=%cI HEAD)
printf '{"commit":"%s","date":"%s"}\n' "$commit" "$date"
