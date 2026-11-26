#!/bin/sh
# The valleys job of the day (cron, once a day, as the user of the builders):
#   1. the page of today (scripts/build-leaks.mjs): the latest table dump of each collector, the ASPAs of this moment;
#   2. the row of the day in the history (the same script with --day): the table dumps of 00:00 UTC of the collectors that
#      step 1 read, judged with the ASPAs known at 00:00 (the timeline of the ASPAs), as every other day of the history is.
#      The latest dump of a RIPE RIS collector is the one of 00:00 and is read from the cache; the others are fetched.
# When step 2 fails the row of the day stays the one that step 1 wrote (it has no `rule`), and the message is in the log.
#   scripts/run-leaks.sh [GEN_DIR]        (default /var/db/aspa-gen; its cache is GEN_DIR/cache)
set -u
GEN=${1:-/var/db/aspa-gen}
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
NODE=${NODE:-/usr/local/bin/node}
"$NODE" --max-old-space-size=4500 "$SCRIPTS/build-leaks.mjs" "$GEN/leaks.json" "$GEN/cache" || exit 1
day=$(date -u +%Y%m%d)
# the collectors that were read today, from a document that is of today
collectors=$("$NODE" -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (String(d.generated).slice(0, 10).replaceAll("-", "") !== process.argv[2]) process.exit(1);
const names = d.collectors.map((c) => c.collector);
if (!names.length || !names.every((n) => /^[a-z0-9.-]+$/.test(n))) process.exit(1);
console.log(names.join(","));' "$GEN/leaks.json" "$day") || { echo "the row of the day: the document of today is not of $day, the row stays as it is" >&2; exit 0; }
"$NODE" "$SCRIPTS/build-timeline.mjs" "$GEN/timeline.json" || echo "the timeline of the ASPAs could not be brought up to date" >&2
LEAKS_COLLECTORS="$collectors" "$NODE" --max-old-space-size=4500 "$SCRIPTS/build-leaks.mjs" "$GEN/leaks.json" "$GEN/cache" --day="$day" \
  || echo "the row of the day could not be made from the table dumps of 00:00 UTC: it stays the one of the latest dumps" >&2
