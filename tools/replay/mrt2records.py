"""RIPE RIS update files (MRT) -> the records of record.py/stream.py: A and W, S for a change of state of a session, and M for an
entry that the parser could not read in full. Needs `mrtparse` (pip install mrtparse); run it with `python -I`.
usage: mrt2records.py OUT.jsonl.gz FILE.gz ..."""
import gzip, json, sys
from datetime import datetime, timezone
import mrtparse


def compress(asns):
    out, flag = [], 0
    for a in asns:
        if out and out[-1] == a:
            flag = 1
        else:
            out.append(a)
    return out, flag


def first(d):
    return list(d)[0]


def stamp(epoch):
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat(sep=" ")[:19]


def prefixes(items):
    return [f"{x['prefix']}/{x['length']}" for x in items or []]


def convert(path, out):
    n = 0
    for entry in mrtparse.Reader(path):
        d = entry.data
        t = int(first(d["type"]))
        if t not in (16, 17):
            continue
        st = int(first(d["subtype"]))
        epoch = int(first(d["timestamp"]))
        if "peer_as" not in d:
            # an entry that the parser could not read in full (a message that does not parse): kept as a record of its own
            out.write(json.dumps({"type": "M", "collector": "rrc00", "timestamp": stamp(epoch), "length": d.get("length")}) + "\n")
            n += 1
            continue
        peer = int(d["peer_as"])
        if st in (0, 5):        # state change
            ns = d.get("new_state") or {}
            out.write(json.dumps({"type": "S", "collector": "rrc00", "timestamp": stamp(epoch), "peer": peer,
                                  "state": str(list(ns.values())[0]).lower() if ns else None}) + "\n")
            n += 1
            continue
        bm = d.get("bgp_message")
        if not bm or int(first(bm["type"])) != 2:
            continue
        withdrawn = prefixes(bm.get("withdrawn_routes"))
        ann = prefixes(bm.get("nlri"))
        path, has_set = None, False
        for attr in bm.get("path_attributes", []):
            at = int(first(attr["type"]))
            if at == 2:
                path = []
                for seg in attr["value"]:
                    if int(first(seg["type"])) != 2:
                        has_set = True
                    path += [int(x) for x in seg["value"]]
            elif at == 14:
                ann += prefixes(attr["value"].get("nlri"))
            elif at == 15:
                withdrawn += prefixes(attr["value"].get("withdrawn_routes"))
        for p in withdrawn:
            out.write(json.dumps({"type": "W", "collector": "rrc00", "timestamp": stamp(epoch), "prefix": p, "peer": peer,
                                  "origin": None, "flag": None, "compressed_path": None}) + "\n")
            n += 1
        if ann and path and not has_set:
            cp, flag = compress(path)
            for p in ann:
                out.write(json.dumps({"type": "A", "collector": "rrc00", "timestamp": stamp(epoch), "prefix": p, "peer": peer,
                                      "origin": cp[-1], "flag": flag, "compressed_path": cp}) + "\n")
                n += 1
    return n


if __name__ == "__main__":
    total = 0
    with gzip.open(sys.argv[1], "wt", encoding="utf-8") as out:
        for f in sys.argv[2:]:
            total += convert(f, out)
    print(sys.argv[1], total, "records")
