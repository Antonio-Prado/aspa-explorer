#!/bin/sh
# Fill the history of the leaks backwards: one run of build-leaks.mjs for each of the last DAYS days that has no file yet
# (the table dumps of 00:00 UTC of the day, the ASPAs as they were at its start). Slow: about ten minutes a day.
#   scripts/backfill-leaks.sh DAYS OUT_FILE [CACHE_DIR]
# With FORCE=1 the days that already have a file are built again (after a change of the collectors, for instance).
set -eu
days=${1:?usage: backfill-leaks.sh DAYS OUT_FILE [CACHE_DIR]}
out=${2:?usage: backfill-leaks.sh DAYS OUT_FILE [CACHE_DIR]}
cache=${3:-$(dirname "$out")/cache}
here=$(cd "$(dirname "$0")" && pwd)
node=${NODE:-node}
i=1
while [ "$i" -le "$days" ]; do
  d=$(date -u -v-"${i}"d +%Y%m%d 2>/dev/null || date -u -d "-$i day" +%Y%m%d)
  if [ -z "${FORCE:-}" ] && [ -f "$(dirname "$out")/leaks-days/$d.json" ]; then echo "$d: already there"; else
    echo "$d: building"
    "$node" --max-old-space-size=3000 "$here/build-leaks.mjs" "$out" "$cache" --day="$d" || echo "$d: failed, going on"
  fi
  i=$((i + 1))
done
