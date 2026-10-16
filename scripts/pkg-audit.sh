#!/bin/sh
# Fail when a package installed on this host (the FreeBSD base system included) has a
# known vulnerability, using the VuXML database that `pkg audit` reads.
#
# Runs as an unprivileged user on the CI runner host. The database is refreshed by
# root (`pkg audit -F`, see the daily periodic scripts); this script only reads it and
# complains when it has not been refreshed for a while.
set -u

db=/var/db/pkg/vuln.xml
# pkg only rewrites vuln.xml when upstream changes, so freshness is judged on the marker
# that the refresh script (deploy/freebsd/pkg-audit-refresh) touches after every
# successful check; without it the file's own date is used.
marker=$db.checked
max_age_days=${PKG_AUDIT_MAX_AGE_DAYS:-4}

if [ ! -r "$db" ]; then
  echo "vulnerability database $db is missing or unreadable (run 'pkg audit -F' as root)" >&2
  exit 2
fi

ref=$db
[ -r "$marker" ] && ref=$marker
age=$(( ( $(date +%s) - $(stat -f %m "$ref") ) / 86400 ))
echo "host: $(hostname), $(freebsd-version -u 2>/dev/null || uname -r)"
echo "vulnerability database last checked ${age} day(s) ago"
stale=0
if [ "$age" -gt "$max_age_days" ]; then
  echo "WARNING: the database is older than ${max_age_days} days; refresh it with 'pkg audit -F' as root" >&2
  stale=1
fi

report=$(pkg audit 2>&1)
rc=$?
echo "$report"
echo
if [ "$rc" -ne 0 ]; then
  echo "FAILED: $(echo "$report" | tail -n 1)"
  echo "Update the affected packages (pkg upgrade) and run the audit again."
  exit 1
fi
if [ "$stale" -ne 0 ]; then
  exit 3
fi
echo "OK: no known vulnerabilities in the installed packages"
