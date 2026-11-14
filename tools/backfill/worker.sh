#!/bin/sh
# usage: worker.sh BASE NAME      (BASE/blocks-NAME.txt: a block for each line, "FROM TO [--until YYYY-MM-DDTHH:MM]")
# Reads the blocks of its list in order with backfill.py, at low priority; a block that stops (a download that fails, a
# server that does not answer) is tried again after 15 minutes. One worker for each list: a second one ends at once.
#   daemon -f /usr/bin/lockf -t 0 BASE/log/NAME.lock /bin/sh BASE/code/worker.sh BASE NAME
set -u
BASE=$1; NAME=$2
PATH=/usr/local/bin:/usr/bin:/bin:$PATH; export PATH
mkdir -p "$BASE/log"
while read -r from to rest; do
  [ -n "$from" ] || continue
  n=0
  until nice -n 15 "$BASE/venv/bin/python" "$BASE/code/backfill.py" "$BASE" "$from" "$to" $rest >> "$BASE/log/$NAME.log" 2>&1 < /dev/null; do
    n=$((n + 1)); [ "$n" -ge 200 ] && break
    sleep 900
  done
  [ -e "$BASE/STOP" ] && exit 0
done < "$BASE/blocks-$NAME.txt"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) worker $NAME: list done" >> "$BASE/log/$NAME.log"
