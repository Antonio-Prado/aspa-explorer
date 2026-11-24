#!/bin/sh
# Daily archive of the IRR databases of the five RIRs (authoritative sources
# only), to know later which route objects, aut-nums and as-sets existed on a
# given day. One folder a day: $ROOT/YYYY/MM/DD/, with the files as the RIRs
# publish them (gzip, mtime of the server kept), SHA256SUMS and a log line.
#
# When every file is there, index.tsv.gz lists the route and route6 objects (prefix, origin, source), sorted, after a
# first line "# snapshot <time of the fetch, UTC> canonical" (prefixes in canonical form, irr-canon.py): the Incidents page reads it (scripts/irr-registered.mjs).
#
# Run once a day from cron; a day already complete is skipped, so a second
# run only fills in what failed.
set -u

ROOT=${IRR_ARCHIVE:-/backup/archive/ring-archive/irr}
AWK=${IRR_INDEX_AWK:-/home/thinker/irr-archive/irr-index.awk}
CANON=${IRR_INDEX_CANON:-/home/thinker/irr-archive/irr-canon.py}
PY=${PYTHON:-/usr/local/bin/python3.12}
LOG=$ROOT/fetch.log
day=$(date -u +%Y/%m/%d)
dir=$ROOT/$day
mkdir -p "$dir" || exit 1

URLS="
https://ftp.ripe.net/ripe/dbase/split/ripe.db.route.gz
https://ftp.ripe.net/ripe/dbase/split/ripe.db.route6.gz
https://ftp.ripe.net/ripe/dbase/split/ripe.db.aut-num.gz
https://ftp.ripe.net/ripe/dbase/split/ripe.db.as-set.gz
https://ftp.ripe.net/ripe/dbase/split/ripe.db.route-set.gz
https://ftp.ripe.net/ripe/dbase/RIPE.CURRENTSERIAL
https://ftp.arin.net/pub/rr/arin.db.gz
https://ftp.arin.net/pub/rr/ARIN.CURRENTSERIAL
https://ftp.apnic.net/apnic/whois/apnic.db.route.gz
https://ftp.apnic.net/apnic/whois/apnic.db.route6.gz
https://ftp.apnic.net/apnic/whois/apnic.db.aut-num.gz
https://ftp.apnic.net/apnic/whois/apnic.db.as-set.gz
https://ftp.apnic.net/apnic/whois/apnic.db.route-set.gz
https://ftp.apnic.net/apnic/whois/APNIC.CURRENTSERIAL
https://ftp.afrinic.net/pub/dbase/afrinic.db.gz
https://ftp.afrinic.net/pub/dbase/AFRINIC.CURRENTSERIAL
https://ftp.lacnic.net/lacnic/irr/lacnic.db.gz
https://ftp.lacnic.net/lacnic/irr/LACNIC.CURRENTSERIAL
"

ok=0 failed=""
for u in $URLS; do
	f=$dir/${u##*/}
	[ -s "$f" ] && { ok=$((ok + 1)); continue; }
	got=no
	for try in 1 2 3; do
		if fetch -q -T 300 -o "$f.part" "$u" 2>/dev/null; then
			case $f in
			*.gz) gzip -t "$f.part" 2>/dev/null || { rm -f "$f.part"; sleep 60; continue; } ;;
			esac
			mv "$f.part" "$f" && got=yes && break
		fi
		rm -f "$f.part"
		sleep 60
	done
	if [ $got = yes ]; then ok=$((ok + 1)); else failed="$failed ${u##*/}"; fi
done

if [ -z "$failed" ] && [ ! -s "$dir/index.tsv.gz" ]; then
	{
		echo "# snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ) canonical"
		for f in ripe.db.route.gz ripe.db.route6.gz arin.db.gz apnic.db.route.gz apnic.db.route6.gz afrinic.db.gz lacnic.db.gz; do
			gzip -dc "$dir/$f" | awk -f "$AWK"
		done | "$PY" "$CANON" | LC_ALL=C sort -u
	} | gzip -9 > "$dir/index.tsv.gz.part" && mv "$dir/index.tsv.gz.part" "$dir/index.tsv.gz" || { rm -f "$dir/index.tsv.gz.part"; failed="index"; }
fi

(cd "$dir" && sha256 -r -- * 2>/dev/null | grep -v ' SHA256SUMS$' > SHA256SUMS)
size=$(du -sk "$dir" | cut -f1)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $day ok=$ok failed=${failed:- none} ${size}k" >> "$LOG"
[ -z "$failed" ]
