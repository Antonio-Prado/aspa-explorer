#!/bin/sh
# The job of the Incidents page, run from cron every hour as the user of the builders (aspagen), a little after the end of the UTC hour:
#   1. takes the record files that stream.py has closed (one for each UTC hour: every one but the newest, which it is still writing);
#   2. refreshes the ROAs (Routinator, rpki.ping6.it) when they are older than ROAS_MAX_AGE minutes, and points the detector at the newest CAIDA relationships and at the delegation files of the adoption job;
#   3. runs incident-rs (tools/incident-rs), which keeps its state between runs and writes incidents_<file>.jsonl for each file;
#   4. builds /api/v1/incidents.json (scripts/build-incidents.mjs) and the file with the verdict of each incident (/api/v1/incidents-detail.jsonl).
#   5. builds /api/v1/incidents-history.json (scripts/build-incidents-history.mjs): every day that is archived, also the days that
#      tools/backfill/backfill.py reads from the archive of RIPE RIS, with a file of the incidents of each day in days/rrc00/.
#      The working directories of the backfill are the entries of $BASE/blocks (links, each with archive/, days.jsonl and cache/).
#      $BASE/live-from, when it is there, has the first day that the archive of the recorder covers in full (YYYY-MM-DD): the
#      days before it are taken from the backfill only.
# Step 3 is incident-rs ($INCIDENTS_RS, default $CODE/incident-rs) when work/ has its state (active_state.rs.bin), and
# incident.py, the detector it was ported from, otherwise. A state of incident.py is brought over once:
#   python3.12 export_state.py --code $CODE active_state.pkl state.jsonl && incident-rs import-state state.jsonl
# Everything is in $BASE: incoming/ (stream.py), work/ (the detector, with its state), archive/ (every incident file, compressed, kept for good), incidents-detail.jsonl.
#   5 * * * * /usr/bin/lockf -t 0 /var/db/aspa-data/run.lock /bin/sh -c '/bin/sh /usr/local/libexec/aspa-data/run-incidents.sh >/var/db/aspa-data/run.log 2>&1'
# (five minutes past the hour, when stream.py has closed the file of the hour before; lockf: two runs at once would corrupt the
# state of the detector, and a run that finds the lock taken ends at once;
# the log is opened inside lockf, so that a run that finds the lock taken does not empty the log of the run that holds it)
# The record files of more than KEEP_DAYS days are deleted once they have been read, and the incident files of more than
# KEEP_INCIDENT_DAYS days are not part of the page any more: their copy stays in archive/.
set -eu
BASE=${INCIDENTS_BASE:-/var/db/aspa-data}
CODE=${INCIDENTS_CODE:-/usr/local/libexec/aspa-data}
GEN=${INCIDENTS_GEN:-/var/db/aspa-gen}
SCRIPTS=${INCIDENTS_SCRIPTS:-/usr/local/libexec/aspa-gen/scripts}
PY=${PYTHON:-/usr/local/bin/python3.12}
NODE=${NODE:-/usr/local/bin/node}
ROAS_URL=${INCIDENTS_ROAS_URL:-https://rpki.ping6.it/json}
KEEP_DAYS=${INCIDENTS_KEEP_DAYS:-3}
KEEP_INCIDENT_DAYS=${INCIDENTS_KEEP_INCIDENT_DAYS:-30}
COLLECTOR=${INCIDENTS_COLLECTOR:-rrc00}
ROAS_MAX_AGE=${INCIDENTS_ROAS_MAX_AGE:-360}

mkdir -p "$BASE/incoming" "$BASE/work/data" "$BASE/work/roas" "$BASE/work/delegations" "$BASE/work/links"
cd "$BASE/work"

# 1. the files that are closed: all but the newest of incoming/ (the names have the epoch of the opening)
newest=$(ls -1 "$BASE"/incoming/records_*.jsonl.gz 2>/dev/null | sort | tail -n 1 || true)
for f in "$BASE"/incoming/records_*.jsonl.gz; do
  [ -e "$f" ] || continue
  [ "$f" = "$newest" ] && continue
  mv "$f" data/
done

# 2. the ROAs (the detector reads every roas/*.xz: only one is kept), at most every ROAS_MAX_AGE minutes, and the CAIDA
# relationships under the name it expects
if [ ! -f roas/current.json.xz ] || [ -n "$(find roas/current.json.xz -mmin +"$ROAS_MAX_AGE")" ]; then
  if curl -fsS --max-time 300 -o roas.json.tmp "$ROAS_URL" && xz -c roas.json.tmp > roas/current.json.xz.tmp; then
    mv roas/current.json.xz.tmp roas/current.json.xz
  else
    echo "the ROAs could not be refreshed: the ones of before are used" >&2
  fi
  rm -f roas.json.tmp roas/current.json.xz.tmp
fi
caida=$(ls -1 "$GEN"/cache/as-rel2-*.bz2 2>/dev/null | sort | tail -n 1 || true)
[ -n "$caida" ] && ln -sf "$caida" 20260901.as-rel.txt.bz2     # CAIDA_FILE of incident.py

# the delegation files of the five RIRs (the cache of the adoption job): extra_detectors.py reads delegations/delegated-*
for f in "$GEN"/cache/delegated-*; do [ -f "$f" ] && ln -sf "$f" delegations/; done

# the links of the table of the collector at the start of the day (the dump that the valley job keeps in its cache), for the
# forged-link detector: extra_detectors.py reads links/*.txt; without the file every link that CAIDA lacks is a candidate
mkdir -p links
if [ -f "$GEN/cache/dump-rrc00.gz" ] && [ "$GEN/cache/dump-rrc00.gz" -nt links/rrc00.txt ]; then     # once for each new dump
  "$NODE" "$SCRIPTS/rib-links.mjs" "$GEN/cache/dump-rrc00.gz" links/rrc00.txt || echo "the links of the table could not be read: every missing link is a candidate" >&2
fi

# 3. the incidents
RS=${INCIDENTS_RS:-$CODE/incident-rs}
if [ -x "$RS" ] && [ -f active_state.rs.bin ]; then ENGINE=rs; else ENGINE=py; fi
if ls data/records_*.jsonl.gz >/dev/null 2>&1; then
  if [ "$ENGINE" = rs ]; then "$RS" run; else "$PY" "$CODE/incident.py"; fi
else
  echo "no closed record file yet"
fi
find data -name 'records_*.jsonl.gz' -mtime +"$KEEP_DAYS" -delete

# the archive: every incident file is kept for good, compressed, in archive/ (about a fifteenth of its size), so that the
# days that leave the page are not lost; a file is copied once, when it is whole (incident.py writes it under another name)
mkdir -p "$BASE/archive"
for f in incidents_*.jsonl; do
  [ -e "$f" ] || continue
  [ -e "$BASE/archive/$f.xz" ] && continue
  if xz -T2 -c "$f" > "$BASE/archive/$f.xz.tmp"; then mv "$BASE/archive/$f.xz.tmp" "$BASE/archive/$f.xz"; else rm -f "$BASE/archive/$f.xz.tmp"; echo "$f could not be archived" >&2; fi
done

# 4. the page: the incident files of the last KEEP_INCIDENT_DAYS days (the period shown is the one of these)
find . -maxdepth 1 -name 'incidents_*.jsonl' -mtime +"$KEEP_INCIDENT_DAYS" -delete
if ls incidents_*.jsonl >/dev/null 2>&1; then
  "$NODE" "$SCRIPTS/build-incidents.mjs" "$GEN/incidents.json" . --cache="$GEN/cache" --detail="$BASE/incidents-detail.jsonl"
  # the detail file is public (/api/v1/incidents-detail.jsonl) and weighs hundreds of megabytes: a compressed copy for nginx (gzip_static)
  gzip -kf "$BASE/incidents-detail.jsonl"
else
  echo "no incident file yet: nothing to publish"
fi

# 5. every day: the archive of the recorder and the days of the backfill; only the days that are new are read. A failure
# here leaves the page of the last 30 days as it is
blocks=""; caida="$GEN/cache"
for d in "$BASE"/blocks/*/; do
  [ -d "$d" ] || continue
  blocks="${blocks:+$blocks,}${d%/}"
  [ -d "${d}cache" ] && caida="$caida,${d}cache"
done
live_from=""
[ -f "$BASE/live-from" ] && live_from=$(head -n 1 "$BASE/live-from")
"$NODE" "$SCRIPTS/build-incidents-history.mjs" "$GEN/incidents-history.json" --live="$BASE/archive" --live-from="$live_from" --blocks="$blocks" \
  --caida="$caida" --days="$BASE/days-cache/$COLLECTOR" --detail="$BASE/days/$COLLECTOR" --collector="$COLLECTOR" \
  || echo "the history of the incidents could not be built" >&2
