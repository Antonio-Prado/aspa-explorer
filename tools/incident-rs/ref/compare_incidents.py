# python compare_incidents.py A.jsonl B.jsonl
# Two incident files: the same incidents in the same order, once what Python writes from a set is sorted. When they are not,
# the incidents (type, actor, start) that only one file has are counted by type: one incident more shifts every line after it.
# The last line is the verdict (run-incidents.sh reads it).
import json, sys
from collections import Counter
def norm(l):
    x = json.loads(l); x["prefixes"].sort()
    if "expected_roas" in x["details"]: x["details"]["expected_roas"] = sorted(map(tuple, x["details"]["expected_roas"]))
    return x
def keys(path):
    c = Counter()
    with open(path) as f:
        for l in f:
            x = json.loads(l); c[(x["incident_type"], x["actor_key"], x["start"])] += 1
    return c
n = diff = 0
with open(sys.argv[1]) as a, open(sys.argv[2]) as b:
    for la, lb in zip(a, b):
        n += 1
        x, y = norm(la), norm(lb)
        if x != y:
            diff += 1
            if diff <= 4: print("DIFFERENT line", n, x["actor_key"], y["actor_key"], {k: (x[k], y[k]) for k in x if x[k] != y.get(k) and k != "messages"}, [k for k in x if x[k] != y.get(k)])
    rest = sum(1 for _ in a) + sum(1 for _ in b)
if diff or rest:
    ka, kb = keys(sys.argv[1]), keys(sys.argv[2])
    for name, only in (("first", ka - kb), ("second", kb - ka)):
        by_type = Counter(k[0] for k in only.elements())
        print(f"only in the {name} file: {sum(only.values())} incidents", dict(sorted(by_type.items())), [k[1] for k in list(only)[:3]])
print(f"{n} lines compared, {diff} different, {rest} lines only in one file")
