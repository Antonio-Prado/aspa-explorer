#!/bin/sh
# Starts the backfill workers of this machine that are not running: one for each line of ~/workers.conf, "COLLECTOR MEMLIMIT_KB".
# Run at boot by backfill-workers.service, and by hand after a line is added. A worker that is running keeps its lock, so a second
# one for the same collector ends at once; a worker whose list is done is left alone.
set -u
CONF=$HOME/workers.conf
[ -f "$CONF" ] || { echo "no $CONF"; exit 0; }
while read -r c mem rest; do
  case "$c" in ''|'#'*) continue ;; esac
  d=$HOME/backfill-$c
  if [ ! -d "$d/" ]; then echo "$c: no $d"; continue; fi
  if pgrep -f "worker.sh $d $c" >/dev/null; then echo "$c: running"; continue; fi
  if tail -n 1 "$d/log/$c.log" 2>/dev/null | grep -q "list done"; then echo "$c: list done"; continue; fi
  BACKFILL_CHUNK_HOURS=1 BACKFILL_MIN_FREE_MB=800 BACKFILL_DROP_DONE_WORK=1 sh "$HOME/rs-stage/setup.sh" "$c" "$mem" 2>&1 | head -n 1
  echo "$(date -u +%FT%TZ) started by start-workers.sh with BACKFILL_CHUNK_HOURS=1 BACKFILL_MIN_FREE_MB=800 BACKFILL_DROP_DONE_WORK=1 and $mem KB" >> "$d/log/RESTARTS.txt"
done < "$CONF"
