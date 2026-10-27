"""What incident.py found in the records of an event, and what the record says of the event itself.
usage: analyse.py EVENT WORKDIR RECORDS.jsonl.gz     (WORKDIR: where run_event.sh ran; EVENT: a key of events.json)"""
import collections, glob, gzip, json, os, sys

EV, WORK, REC = sys.argv[1], sys.argv[2], sys.argv[3]
meta = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")))[EV]


def incidents():
    out = []
    for f in glob.glob(os.path.join(WORK, "incidents_*.jsonl")):
        with open(f) as fh:
            out += [json.loads(l) for l in fh if l.strip()]
    return out


def kind(o):
    d = o["details"]
    sub = d.get("rlk_type") or d.get("asm_type") or d.get("prh_type") or d.get("vol_type") or d.get("deg_type") or d.get("atr_type") or ""
    return (o["incident_type"], sub or (d.get("anomaly") or "")[:24])


def rank(inc, o, key):
    return 1 + sum(1 for x in inc if key(x) > key(o))


def per_minute(match=None, around=10):
    """announcements, withdrawals, session changes and new prefixes for each minute around the start of the event"""
    t0 = meta["start"][11:16]
    h, m = map(int, t0.split(":"))
    lo, hi = (h * 60 + m - around), (h * 60 + m + around)
    c = collections.defaultdict(collections.Counter); seen = set()
    with gzip.open(REC, "rt") as f:
        for l in f:
            r = json.loads(l)
            hh, mm = int(r["timestamp"][11:13]), int(r["timestamp"][14:16])
            if not lo <= hh * 60 + mm <= hi:
                continue
            if match and not match(r):
                continue
            k = r["timestamp"][11:16]
            c[k][r["type"]] += 1
            if r["type"] == "A" and r["prefix"] not in seen:
                seen.add(r["prefix"]); c[k]["new"] += 1
    return c


inc = incidents()
print(f"{EV}: {meta['what']} (start {meta['start']} UTC)\n{len(inc)} incidents")
for k, v in sorted(collections.Counter(kind(o) for o in inc).items()):
    print(f"  {v:>7}  {k[0]} {k[1]}")

if EV == "A9":
    o = next((o for o in inc if o["actor_key"] == "ASM_PS_4134_21217"), None)
    leak = [o for o in inc if o["incident_type"] == "RLK" and 21217 in (o["details"]["from"], o["details"]["by"], o["details"]["to"])]
    print(f"valley incidents with AS21217: {len(leak)} (CAIDA of the time has no relationship between AS21217 and AS4134)")
    if o:
        asm = [x for x in inc if x["incident_type"] == "ASM"]
        print(f"ASM-PS link 4134-21217: start {o['start']}, {len(o['prefixes'])} prefixes, {o['total_updates']} updates; "
              f"rank by updates {rank(asm, o, lambda x: x['total_updates'])} of {len(asm)} ASM, {rank(inc, o, lambda x: x['total_updates'])} of {len(inc)} incidents")
elif EV == "A1":
    for o in inc:
        if "104.244.42.0/24" in o["prefixes"]:
            print(f"incident on 104.244.42.0/24: {o['start']} {o['incident_type']} {o['details'].get('anomaly')} origin {o['details'].get('actual_origin')} updates {o['total_updates']}")
elif EV == "A2":
    p = [o for o in inc if o["incident_type"] == "PRH" and o["details"].get("actual_origin") == 12389]
    for o in p:
        print(f"PRH_12389: {o['start']} to {o['end']}, {len(o['prefixes'])} prefixes, {o['total_updates']} updates (one incident for the origin: the start is the first announcement that the ROAs of today refuse)")
    c = per_minute(lambda r: r.get("origin") == 12389 and r["type"] == "A", 12)
    print("announcements with origin AS12389, by minute:")
    for k in sorted(c):
        print(f"  {k}  {c[k]['A']:>8}  new prefixes {c[k]['new']:>6}")
elif EV == "A10":
    o = next((o for o in inc if o["actor_key"] == "RLK_7195_52863_400282"), None)
    if o:
        rlk = [x for x in inc if x["incident_type"] == "RLK"]
        print(f"valley AS7195-AS52863-AS400282: start {o['start']}, {len(o['prefixes'])} prefixes, {o['total_updates']} updates; "
              f"rank by updates {rank(inc, o, lambda x: x['total_updates'])} of {len(inc)} incidents, by prefixes {rank(rlk, o, lambda x: len(x['prefixes']))} "
              f"of {len(rlk)} RLK (those above open at the start of the data: valleys that were already there)")
    links = {tuple(sorted(x["actor_key"].split("_")[2:])) for x in inc
             if x["incident_type"] == "ASM" and "7195" in x["actor_key"].split("_")[2:] and x["start"] >= meta["start"]}
    print(f"links of AS7195 that the link detector reports after the start: {len(links)}")
    # the routes of the peers that go through the leak (AS7195 AS52863 AS400282), at the end of each minute, and all the updates
    leak, through, seen, by_min, last = ("400282", "52863", "7195"), set(), set(), {}, None
    with gzip.open(REC, "rt") as f:
        for l in f:
            r = json.loads(l)
            if r["type"] not in ("A", "W"):
                continue
            m = r["timestamp"][11:16]
            if m != last:
                if last:
                    by_min[last][1:] = [len(through), len({p for _, p in through})]
                by_min.setdefault(m, [0, 0, 0]); last = m
            by_min[m][0] += 1
            p = [str(x) for x in r.get("compressed_path") or []]
            k = (r["peer"], r["prefix"])
            if r["type"] == "A" and any(tuple(p[i:i + 3]) == leak for i in range(len(p) - 2)):
                through.add(k); seen.add(r["prefix"])
            else:
                through.discard(k)
    by_min[last][1:] = [len(through), len({p for _, p in through})]
    before = [v[0] for k, v in by_min.items() if k < meta["start"][11:16]][-30:]
    print(f"prefixes seen through the leak: {len(seen)}; updates a minute in the half hour before: {min(before)} to {max(before)}")
    print("minute, updates, routes through the leak, their prefixes:")
    for k in sorted(by_min):
        if meta["start"][11:16] <= k <= "18:40":
            print(f"  {k}  {by_min[k][0]:>8} {by_min[k][1]:>7} {by_min[k][2]:>6}")
elif EV == "A12":
    c = per_minute(None, 8)
    print("records by minute (A, W, state changes):")
    for k in sorted(c):
        print(f"  {k}  {c[k]['A']:>8} {c[k]['W']:>7} {c[k]['S']:>4}")
    for o in sorted((o for o in inc if o["incident_type"] == "ATR"), key=lambda o: o["start"]):
        print(f"  ATR {o['start']} peer {o['details'].get('dropping_peer')} withdrawals {o['details'].get('withdrawal_count')}")
