#!/bin/sh
# Report known vulnerabilities of the packages installed on this host (the FreeBSD base
# system included), using the VuXML database that `pkg audit` reads.
#
# Exit status: 0 nothing found; 1 a fix is available (fail); 2 database missing; 3 only
# vulnerabilities without a fix yet (warning); 4 the database has not been refreshed.
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

if [ "$rc" -eq 0 ]; then
  if [ "$stale" -ne 0 ]; then
    exit 4
  fi
  echo "OK: no known vulnerabilities in the installed packages"
  exit 0
fi

# A vulnerable package for which the repository already offers a newer version can be
# fixed right away; `pkg upgrade -n` marks it "(vulnerable!)".
fixable=$(pkg upgrade -n 2>/dev/null | grep '(vulnerable!)')
if [ -n "$fixable" ]; then
  echo "FIXABLE: the repository already offers a fix for:"
  echo "$fixable"
  echo "Run 'pkg upgrade' on the host."
  exit 1
fi

# Known vulnerabilities, but no fixed version in the repository yet: nothing to apply,
# only to watch (the CI job passes with a warning).
echo "WARNING: $(echo "$report" | tail -n 1) No fixed package is available in the repository yet; check again after the next package build."
exit 3
