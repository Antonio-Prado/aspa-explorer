#!/bin/sh
# usage: run_event.sh RECORDS.jsonl.gz CAIDA_FILE ROAS_XZ DELEGATIONS_DIR WORKDIR [LINKS_FILE]
# Runs incident.py of this repository over the records of an event, with the relationships of the time of the event.
# The ROAs and the delegation files are those you give (today's, when the ones of the time are not at hand). LINKS_FILE is the
# list of the links of the table of the collector before the event (scripts/rib-links.mjs over the bview of that day), which
# the forged-link detector leaves out; without it every link that CAIDA lacks is a candidate.
set -eu
CODE=$(cd "$(dirname "$0")/../data_scripts" && pwd)
rec=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); caida=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
roas=$(cd "$(dirname "$3")" && pwd)/$(basename "$3"); deleg=$(cd "$4" && pwd)
d=$5
links=${6:-}
rm -rf "$d"; mkdir -p "$d/data" "$d/roas" "$d/delegations" "$d/links"
ln -s "$rec" "$d/data/records_event.jsonl.gz"
ln -s "$caida" "$d/20260901.as-rel.txt.bz2"        # CAIDA_FILE of incident.py
ln -s "$roas" "$d/roas/current.json.xz"
for f in "$deleg"/delegated-*; do ln -s "$f" "$d/delegations/"; done
[ -z "$links" ] || ln -s "$(cd "$(dirname "$links")" && pwd)/$(basename "$links")" "$d/links/rrc00.txt"
cd "$d"
"${PYTHON:-python3}" "$CODE/incident.py" --flush-open
