#!/bin/sh
# Sends the finished incident archives of every backfill worker of this machine to aspa, with what the history builder needs next
# to them (days.jsonl and the CAIDA files of each month). From cron, every half hour. The key can only write there, into
# ~/ring-archive/<collector>/ and ~/ring-blocks/<collector>/ (forced command ~/ring-in/receive.py on aspa).
# An archive is sent when it is older than 15 minutes; it is first moved to ship/ next to archive/, then rsync removes it from
# here once aspa has it whole (rsync checks every file it transfers). A transfer that fails leaves the files in ship/ for the next run.
set -u
DEST=thinker@147.162.96.157
RSH="ssh -p 65022 -i $HOME/.ssh/aspa_ship -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 -o LogLevel=ERROR"
LOG=$HOME/ship-to-aspa.log
for d in /data/backfill-rrc*/; do
  c=$(basename "$d"); c=${c#backfill-}
  [ -d "$d/archive" ] || continue
  mkdir -p "$d/ship"
  find "$d/archive" -maxdepth 1 -type f -mmin +15 -exec mv {} "$d/ship/" \;
  n=$(ls "$d/ship" | wc -l)
  # the CAIDA files and the list of the days first: the builder must never meet an archive without them
  if [ -d "$d/cache" ]; then
    rsync -rt -e "$RSH" --include='*as-rel2*' --exclude='*' "$d/cache/" "$DEST:ring-blocks/$c/cache/" 2>>"$LOG" || { echo "$(date -u +%FT%TZ) $c: cache not sent" >> "$LOG"; continue; }
  fi
  [ -f "$d/days.jsonl" ] && { rsync -rt -e "$RSH" "$d/days.jsonl" "$DEST:ring-blocks/$c/" 2>>"$LOG" || { echo "$(date -u +%FT%TZ) $c: days.jsonl not sent" >> "$LOG"; continue; }; }
  [ "$n" -gt 0 ] || continue
  if rsync -rt --remove-source-files -e "$RSH" "$d/ship/" "$DEST:ring-archive/$c/" 2>>"$LOG"; then
    echo "$(date -u +%FT%TZ) $c: $n files sent" >> "$LOG"
  else
    echo "$(date -u +%FT%TZ) $c: archives not sent, $(ls "$d/ship" | wc -l) wait in ship/" >> "$LOG"
  fi
done
