# python made_cases.py data/records_made.jsonl
# A few days of made-up records for what a day of rrc00 does not have: NOTIFICATIONs, the jump of the more specifics of an
# origin, prefixes written in another way, records without a collector, a mass withdrawal after a change of state
import json, sys
from datetime import datetime, timezone, timedelta
T0 = datetime(2026, 8, 1, tzinfo=timezone.utc)
rows = []
def at(day, sec): return (T0 + timedelta(days=day, seconds=sec)).strftime("%Y-%m-%d %H:%M:%S")
def A(day, sec, prefix, peer, path, collector="rrc00"):
    r = {"type": "A", "collector": collector, "timestamp": at(day, sec), "prefix": prefix, "peer": peer, "origin": path[-1], "flag": 0, "compressed_path": path}
    if collector is None: del r["collector"]
    rows.append((day, sec, len(rows), r))
def W(day, sec, prefix, peer, collector="rrc00"):
    rows.append((day, sec, len(rows), {"type": "W", "collector": collector, "timestamp": at(day, sec), "prefix": prefix, "peer": peer, "origin": None, "flag": None, "compressed_path": None}))
def X(day, sec, r): rows.append((day, sec, len(rows), dict(r, timestamp=at(day, sec))))
# the jump: origin 3333 with 20 more specifics a day for three days, then 150; origin 1299 with 10, 20, 31, 40 then 200
for origin, base, counts in ((3333, "193.0", [20, 20, 20, 150]), (1299, "62.115", [10, 20, 31, 40, 200])):
    for day, n in enumerate(counts):
        for i in range(n):
            for k, peer in enumerate((3356, 174)):
                A(day, 3600 + i * 20 + k, f"{base}.{i}.0/24", peer, [peer, origin])
# an IPv6 flood under one /32
for i in range(1100):
    for k, peer in enumerate((3356, 174)):
        A(2, 40000 + i * 2 + k, f"2a00:1450:{i:x}::/48", peer, [peer, 15169])
# NOTIFICATIONs and changes of state, with and without a collector
for i, (code, sub) in enumerate(((3, 1), (3, 5), (3, 2), (6, 2), (3, None), (3, 1))):
    X(1, 1000 + i * 30, {"type": "N", "collector": "rrc00", "peer": 6939, "code": code, "subcode": sub})
X(1, 1500, {"type": "N", "peer": 6939, "code": 3, "subcode": 4})
X(1, 50000, {"type": "S", "collector": "rrc00", "peer": 2914, "state": "idle"})
for i in range(700):
    W(1, 50010 + i // 150, f"100.{i // 250}.{i % 250}.0/24", 2914)
for i in range(600):                      # the same without a change of state before, and without a collector
    W(3, 50010 + i // 150, f"101.{i // 250}.{i % 250}.0/24", 1273, collector=None)
# prefixes written in another way, a bogon, a private AS, an AS that comes back
A(0, 100, "193.5.1.77/24", 3356, [3356, 3333]); A(0, 101, "193.5.1.0/24", 174, [174, 3333]); A(0, 102, "2001:DB8:1::/48", 3356, [3356, 3333])
A(0, 103, "10.1.0.0/16", 3356, [3356, 64512, 3333]); A(0, 104, "8.8.8.0/24", 3356, [3356, 15169, 3356, 15169]); A(0, 105, "8.8.4.0/24", 174, [174, 15169], collector=None)
A(0, 106, "not a prefix", 174, [174, 15169]); A(0, 107, "1.2.3.4", 174, [174, 13335])
# a delayed convergence and a flap seen by four peers
for i in range(160):
    A(0, 20000 + i * 5, "203.0.114.0/24", (3356, 174, 2914, 6939)[i % 4], [(3356, 174, 2914, 6939)[i % 4], 4826])
for i in range(60):
    for peer in (3356, 174, 2914, 6939):
        (A if i % 2 else W)(2, 60000 + i * 4, "198.41.0.0/24", peer, *([[peer, 26415]] if i % 2 else []))
# an amplified churn: 3,200 updates of one origin, 320 prefixes, ten peers, in four minutes
for i in range(3200):
    A(4, 70000 + i // 14, f"45.{i % 320 // 250}.{i % 320 % 250}.0/24", 1000 + i % 10, [1000 + i % 10, 3356, 9002])
rows.sort(key=lambda r: r[:3])
with open(sys.argv[1], "w") as f:
    for *_, r in rows:
        f.write(json.dumps(r) + "\n")
    f.write("this line is not JSON\n\n")
print(len(rows), "records")
