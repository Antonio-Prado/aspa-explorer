#!/bin/sh
# The daily job of the Incidents page, run from cron as the user of the builders (aspagen), a little after the end of the UTC day:
#   1. takes the record files that stream.py has closed (every one but the newest, which it is still writing);
#   2. refreshes the ROAs (Routinator, rpki.ping6.it) and points incident.py at the newest CAIDA relationships and at the delegation files of the adoption job;
#   3. runs incident.py, which keeps its state between runs and writes incidents_<file>.jsonl for each file;
#   4. builds /api/v1/incidents.json (scripts/build-incidents.mjs) and a file with the verdict of each incident, that is not published.
# Everything is in $BASE: incoming/ (stream.py), work/ (incident.py, with its state), incidents-detail.jsonl.
#   30 2 * * * /usr/bin/lockf -t 0 /var/db/aspa-data/run.lock /bin/sh /usr/local/libexec/aspa-data/run-incidents.sh >/var/db/aspa-data/run.log 2>&1
# (02:30 CEST = 00:30 UTC; lockf: a day of data takes hours to read, and two runs at once would corrupt the state of incident.py)
# The record files of more than KEEP_DAYS days are deleted once they have been read, and the incident files of more than
# KEEP_INCIDENT_DAYS days are not part of the page any more.
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

mkdir -p "$BASE/incoming" "$BASE/work/data" "$BASE/work/roas" "$BASE/work/delegations" "$BASE/work/links"
cd "$BASE/work"

# 1. the files that are closed: all but the newest of incoming/ (the names have the epoch of the opening)
newest=$(ls -1 "$BASE"/incoming/records_*.jsonl.gz 2>/dev/null | sort | tail -n 1 || true)
for f in "$BASE"/incoming/records_*.jsonl.gz; do
  [ -e "$f" ] || continue
  [ "$f" = "$newest" ] && continue
  mv "$f" data/
done

# 2. the ROAs of today (incident.py reads every roas/*.xz: only one is kept) and the CAIDA relationships under the name it expects
if curl -fsS --max-time 300 -o roas.json.tmp "$ROAS_URL" && xz -c roas.json.tmp > roas/current.json.xz.tmp; then
  mv roas/current.json.xz.tmp roas/current.json.xz
else
  echo "the ROAs could not be refreshed: the ones of before are used" >&2
fi
rm -f roas.json.tmp roas/current.json.xz.tmp
caida=$(ls -1 "$GEN"/cache/as-rel2-*.bz2 2>/dev/null | sort | tail -n 1 || true)
[ -n "$caida" ] && ln -sf "$caida" 20260901.as-rel.txt.bz2     # CAIDA_FILE of incident.py

# the delegation files of the five RIRs (the cache of the adoption job): extra_detectors.py reads delegations/delegated-*
for f in "$GEN"/cache/delegated-*; do [ -f "$f" ] && ln -sf "$f" delegations/; done

# the links of the table of the collector at the start of the day (the dump that the valley job keeps in its cache), for the
# forged-link detector: extra_detectors.py reads links/*.txt; without the file every link that CAIDA lacks is a candidate
mkdir -p links
if [ -f "$GEN/cache/dump-rrc00.gz" ]; then
  "$NODE" "$SCRIPTS/rib-links.mjs" "$GEN/cache/dump-rrc00.gz" links/rrc00.txt || echo "the links of the table could not be read: every missing link is a candidate" >&2
fi

# 3. the incidents
if ls data/records_*.jsonl.gz >/dev/null 2>&1; then
  "$PY" "$CODE/incident.py"
else
  echo "no closed record file yet"
fi
find data -name 'records_*.jsonl.gz' -mtime +"$KEEP_DAYS" -delete

# 4. the page: the incident files of the last KEEP_INCIDENT_DAYS days (the period shown is the one of these)
find . -maxdepth 1 -name 'incidents_*.jsonl' -mtime +"$KEEP_INCIDENT_DAYS" -delete
if ls incidents_*.jsonl >/dev/null 2>&1; then
  "$NODE" "$SCRIPTS/build-incidents.mjs" "$GEN/incidents.json" . --cache="$GEN/cache" --detail="$BASE/incidents-detail.jsonl"
else
  echo "no incident file yet: nothing to publish"
fi
