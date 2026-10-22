#!/bin/sh
# usage: run_event.sh RECORDS.jsonl.gz CAIDA_FILE ROAS_XZ DELEGATIONS_DIR WORKDIR
# Runs incident.py of this repository over the records of an event, with the relationships of the time of the event.
# The ROAs and the delegation files are those you give (today's, when the ones of the time are not at hand).
set -eu
CODE=$(cd "$(dirname "$0")/../data_scripts" && pwd)
rec=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); caida=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
roas=$(cd "$(dirname "$3")" && pwd)/$(basename "$3"); deleg=$(cd "$4" && pwd)
d=$5
rm -rf "$d"; mkdir -p "$d/data" "$d/roas" "$d/delegations"
ln -s "$rec" "$d/data/records_event.jsonl.gz"
ln -s "$caida" "$d/20260901.as-rel.txt.bz2"        # CAIDA_FILE of incident.py
ln -s "$roas" "$d/roas/current.json.xz"
for f in "$deleg"/delegated-*; do ln -s "$f" "$d/delegations/"; done
cd "$d"
python3 "$CODE/incident.py" --flush-open
