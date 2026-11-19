#!/bin/sh
# The history of the incidents of the collectors that have no recorder: their days are read from the archive of RIPE RIS by
# tools/backfill/backfill.py, on this host or elsewhere, and this job builds /api/v1/incidents-history-<collector>.json and the
# file of each day for them, as step 5 of run-incidents.sh does for the collector of the recorder. Then it writes the list
# of the collectors (/api/v1/incidents-collectors.json), which the Incidents page offers.
# A collector is a directory $BASE/collectors/<collector>/ whose entries are links to the working directories of its backfill
# (each with archive/, days.jsonl and cache/ with the CAIDA files of its months). Run it as the user of the builders, after the
# hourly job, under its own lock:
#   40 * * * * /usr/bin/lockf -t 0 /var/db/aspa-data/collectors.lock /bin/sh -c '/bin/sh /usr/local/libexec/aspa-data/run-incidents-collectors.sh >/var/db/aspa-data/collectors.log 2>&1'
# At most INCIDENTS_COLLECTOR_FILES files (default 300) are read for each collector in a run: the first runs of a long
# history take a few hours in all, and the page has the days read so far.
set -eu
BASE=${INCIDENTS_BASE:-/var/db/aspa-data}
GEN=${INCIDENTS_GEN:-/var/db/aspa-gen}
SCRIPTS=${INCIDENTS_SCRIPTS:-/usr/local/libexec/aspa-gen/scripts}
NODE=${NODE:-/usr/local/bin/node}
MAX=${INCIDENTS_COLLECTOR_FILES:-300}
for c in "$BASE"/collectors/*/; do
  [ -d "$c" ] || continue
  name=$(basename "$c")
  case "$name" in *[!a-z0-9]*) echo "$name: not the name of a collector" >&2; continue;; esac
  blocks=""; caida="$GEN/cache"
  for d in "$c"*/; do
    [ -d "$d" ] || continue
    blocks="${blocks:+$blocks,}${d%/}"
    [ -d "${d}cache" ] && caida="$caida,${d}cache"
  done
  [ -n "$blocks" ] || continue
  "$NODE" "$SCRIPTS/build-incidents-history.mjs" "$GEN/incidents-history-$name.json" --blocks="$blocks" --caida="$caida" \
    --days="$BASE/days-cache/$name" --detail="$BASE/days/$name" --collector="$name" --max-files="$MAX" \
    || echo "$name: the history of the incidents could not be built" >&2
done
"$NODE" "$SCRIPTS/build-incidents-collectors.mjs" "$GEN/incidents-collectors.json" "$GEN"
