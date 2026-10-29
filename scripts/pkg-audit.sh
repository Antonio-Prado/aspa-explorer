#!/bin/sh
# Report known vulnerabilities of the packages installed on this host (the FreeBSD base
# system included), using the VuXML database that `pkg audit` reads.
#
# Exit status: 0 nothing found; 1 a fix is available (fail); 2 database missing; 3 only
# vulnerabilities without a fix yet (warning); 4 the database has not been refreshed;
# 5 the audit itself did not run (pkg failed: not a result, the job fails).
#
# Runs as an unprivileged user on the CI runner host. The database is refreshed by
# root (`pkg audit -F`, see deploy/freebsd/pkg-audit-refresh and its cron line); this script only reads it and
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

# 0: nothing found; 1: vulnerable packages, listed in the report. Anything else, or a 1 without a list, is pkg failing and not an answer.
if [ "$rc" -ne 0 ] && { [ "$rc" -ne 1 ] || ! echo "$report" | grep -q 'vulnerable'; }; then
  echo "ERROR: 'pkg audit' failed (status $rc): the packages were not checked" >&2
  exit 5
fi

if [ "$rc" -eq 0 ]; then
  if [ "$stale" -ne 0 ]; then
    exit 4
  fi
  echo "OK: no known vulnerabilities in the installed packages"
  exit 0
fi

# A vulnerable package for which the repository already offers a newer version can be
# fixed right away; `pkg upgrade -n` marks it "(vulnerable!)".
upgrade=$(pkg upgrade -n 2>&1)
urc=$?
if [ "$urc" -ne 0 ]; then
  echo "ERROR: 'pkg upgrade -n' failed (status $urc): it is not known whether a fix is available" >&2
  echo "$upgrade" | tail -n 3 >&2
  exit 5
fi
fixable=$(echo "$upgrade" | grep '(vulnerable!)')
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
