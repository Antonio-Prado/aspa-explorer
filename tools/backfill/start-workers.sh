#!/bin/sh
# Starts the backfill workers of this machine that are not running: one for each line of ~/workers.conf, "COLLECTOR MEMLIMIT_KB",
# or "COLLECTOR MEMLIMIT_KB live" for the worker that follows the collector live (backfill.py --follow: the list
# ~/backfill-COLLECTOR/blocks-COLLECTOR-live.txt has its one block, "FROM open --collector COLLECTOR --follow").
# Run at boot by backfill-workers.service, and by hand after a line is added. A worker that is running keeps its lock, so a second
# one for the same list ends at once; a worker whose list is done is left alone. The live workers run their detector one at a
# time, three at most (~/live-detector.lock.N; LIVE_DETECTOR_SLOTS) and at a better priority than the backfill (nice 15 against 19).
set -u
CONF=$HOME/workers.conf
[ -f "$CONF" ] || { echo "no $CONF"; exit 0; }
while read -r c mem kind rest; do
  case "$c" in ''|'#'*) continue ;; esac
  d=$HOME/backfill-$c
  if [ ! -d "$d/" ]; then echo "$c: no $d"; continue; fi
  if [ "$kind" = live ]; then
    n=$c-live
    [ -f "$d/blocks-$n.txt" ] || { echo "$n: no $d/blocks-$n.txt"; continue; }
    if pgrep -f "worker.sh $d $n\$" >/dev/null; then echo "$n: running"; continue; fi
    ( cd "$d" && ulimit -v "$mem" && BACKFILL_CHUNK_HOURS=1 BACKFILL_MIN_FREE_MB=800 BACKFILL_DETECTOR_LOCK=$HOME/live-detector.lock BACKFILL_DETECTOR_SLOTS=${LIVE_DETECTOR_SLOTS:-3} \
      nohup setsid flock -n log/live.lock sh code/worker.sh "$d" "$n" >/dev/null 2>&1 & )
    sleep 2; pgrep -f "worker.sh $d $n\$" >/dev/null && echo "worker $n started"
    echo "$(date -u +%FT%TZ) $n started by start-workers.sh with BACKFILL_CHUNK_HOURS=1 BACKFILL_MIN_FREE_MB=800 BACKFILL_DETECTOR_LOCK and $mem KB" >> "$d/log/RESTARTS.txt"
    continue
  fi
  if pgrep -f "worker.sh $d $c\$" >/dev/null; then echo "$c: running"; continue; fi     # $: not the live worker, $c-live
  if tail -n 1 "$d/log/$c.log" 2>/dev/null | grep -q "list done"; then echo "$c: list done"; continue; fi
  BACKFILL_CHUNK_HOURS=1 BACKFILL_MIN_FREE_MB=800 BACKFILL_DROP_DONE_WORK=1 sh "$HOME/rs-stage/setup.sh" "$c" "$mem" 2>&1 | head -n 1
  echo "$(date -u +%FT%TZ) started by start-workers.sh with BACKFILL_CHUNK_HOURS=1 BACKFILL_MIN_FREE_MB=800 BACKFILL_DROP_DONE_WORK=1 and $mem KB" >> "$d/log/RESTARTS.txt"
done < "$CONF"
