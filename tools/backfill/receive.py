#!/usr/local/bin/python3.12
"""Forced command of the key with which a backfill machine (worker1) sends the incident archives here: only an rsync that
receives into ~/ring-archive/<collector>/ or ~/ring-blocks/<collector>/ (and its cache/), with -r and -t alone: no links, no
devices, no option that names another path. Anything else is refused and written to ~/ring-in/refused.log."""
import os, re, sys, time
cmd = os.environ.get('SSH_ORIGINAL_COMMAND', '')
ok = re.fullmatch(r'rsync --server -[rtvz]{1,4}e\.[A-Za-z]{1,20}( --remove-source-files)? \. (ring-archive/rrc\d\d[a-z]?/|ring-blocks/rrc\d\d[a-z]?/(cache/)?)', cmd)
if not ok:
    try:
        with open(os.path.expanduser('~/ring-in/refused.log'), 'a') as f:
            f.write('%s %s %r\n' % (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), os.environ.get('SSH_CONNECTION', '').split(' ')[0], cmd[:300]))
    except OSError:
        pass
    sys.stderr.write('not allowed\n')
    sys.exit(1)
os.chdir(os.path.expanduser('~'))
os.execv('/usr/local/bin/rsync', cmd.split(' '))
