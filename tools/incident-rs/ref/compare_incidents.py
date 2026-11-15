# python compare_incidents.py A.jsonl B.jsonl
# Two incident files: the same incidents in the same order, once what Python writes from a set is sorted
import json, sys
def norm(l):
    x = json.loads(l); x["prefixes"].sort()
    if "expected_roas" in x["details"]: x["details"]["expected_roas"] = sorted(map(tuple, x["details"]["expected_roas"]))
    return x
n = diff = 0
with open(sys.argv[1]) as a, open(sys.argv[2]) as b:
    for la, lb in zip(a, b):
        n += 1
        x, y = norm(la), norm(lb)
        if x != y:
            diff += 1
            if diff <= 4: print("DIFFERENT line", n, x["actor_key"], y["actor_key"], {k: (x[k], y[k]) for k in x if x[k] != y.get(k) and k != "messages"}, [k for k in x if x[k] != y.get(k)])
    rest = sum(1 for _ in a) + sum(1 for _ in b)
print(f"{n} lines compared, {diff} different, {rest} lines only in one file")
