"""Canonical form of the lines of the IRR index: "prefix<TAB>origin<TAB>source" from stdin, with the prefix in the
form that Python's ipaddress writes (no leading zeros, lower case, host bits cleared) and the origin as AS<number>.
Lines that are not a prefix and an AS number are dropped. Output unsorted: sort it afterwards."""
import ipaddress
import re
import sys

AS = re.compile(r'^AS(\d{1,10})$', re.I)

for line in sys.stdin:
    f = line.rstrip('\n').split('\t')
    if len(f) != 3:
        continue
    p, o, s = f
    m = AS.match(o)
    if not m or int(m.group(1)) > 4294967295:
        continue
    try:
        if ':' not in p:
            a, l = p.split('/')
            p = '.'.join(str(int(x)) for x in a.split('.')) + '/' + l
        net = ipaddress.ip_network(p, strict=False)
    except ValueError:
        continue
    sys.stdout.write(f'{net}\tAS{int(m.group(1))}\t{s}\n')
