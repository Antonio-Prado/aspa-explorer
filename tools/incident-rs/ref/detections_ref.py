"""The detections of incident.py, one line for each, without the incidents that group them: the reference that the Rust
version (incident-rs detections) must repeat line for line. It calls the functions of incident.py themselves, in the order
process_record calls them, for the detectors named in --detectors (those that the Rust version has so far).
  python detections_ref.py --code DIR --detectors flap,rlk,prh,deg [--caida F] [--roas GLOB] IN.jsonl.gz OUT.tsv
A line: KIND, timestamp, prefix, collector, peer, then what the detector says. Lists that Python takes from a set are sorted."""
import argparse, gzip, json, sys

ap = argparse.ArgumentParser()
ap.add_argument("--code", required=True, help="the directory of incident.py and extra_detectors.py")
ap.add_argument("--detectors", default="flap,rlk,prh,deg")
ap.add_argument("--caida"); ap.add_argument("--roas")
ap.add_argument("src"); ap.add_argument("dst")
a = ap.parse_args()
sys.path.insert(0, a.code)
import incident

on = set(a.detectors.split(","))
rel = incident.load_caida_relationships(a.caida) if ("rlk" in on or "deg" in on) and a.caida else {}
roas = incident.load_roas(a.roas) if ("prh" in on or "deg" in on) and a.roas else {}
state, last_gc, n, hits = {}, None, 0, 0
with gzip.open(a.src, "rt", encoding="utf-8") as f, open(a.dst, "w") as out:
    for line in f:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        kind = rec.get("type")
        if kind not in ("A", "W"):
            continue
        prefix, ts, peer = rec.get("prefix"), rec.get("timestamp"), rec.get("peer")
        if not prefix or not peer or not ts:
            continue
        epoch = incident.parse_timestamp(ts)
        if epoch > 0:
            if last_gc is None:
                last_gc = epoch
            if epoch - last_gc > incident.GC_INTERVAL_SECONDS:
                incident.garbage_collect_state(state, epoch)
                last_gc = epoch
        n += 1
        head = f"{ts}\t{prefix}\t{rec.get('collector')}\t{peer}"
        if "flap" in on:
            hit, det = incident.check_state_volatility(rec, state, epoch)
            if hit:
                hits += 1
                out.write(f"FLAP\t{head}\t{det['flap_count']}\n")
        if kind != "A":
            continue
        if "rlk" in on:
            hit, det = incident.check_route_leak(rec, rel, state, epoch)
            if hit:
                hits += 1
                out.write(f"RLK\t{head}\t{det['from']}\t{det['by']}\t{det['to']}\t{det['rlk_type']}\t{det['learned_from']}\n")
        if "prh" in on:
            hit, det = incident.check_prefix_hijack(rec, roas, state, epoch)
            if hit:
                hits += 1
                expected = ",".join(f"{asn}/{length}" for asn, length in sorted(det["expected_roas"]))
                out.write(f"PRH\t{head}\t{det['actual_origin']}\t{det['anomaly'].split(' ')[0]}\t{expected}\n")
        if "deg" in on:
            hit, det = incident.check_deaggregation(rec, rel, roas, state, epoch)
            if hit and "sub_prefix" in det:
                hits += 1
                out.write(f"DEG\t{head}\t{det['parent_aggregate']}\t{det['parent_origin']}\t{det['sub_origin']}\n")
            elif hit:
                hits += 1
                waited = ",".join(f"{p}|{o}|{t}" for p, o, t in det["covered_specifics"])
                out.write(f"DEGR\t{head}\t{det['parent_aggregate']}\t{det['parent_origin']}\t{waited}\n")
print(f"{n} records, {hits} detections")
