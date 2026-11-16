"""The detections of incident.py and extra_detectors.py, one line for each, without the incidents that group them: the
reference that the Rust version (incident-rs detections) must repeat line for line. It calls the functions of the Python
scripts themselves, in the order process_record calls them, for the detectors named in --detectors.
  python detections_ref.py --code DIR [--detectors LIST] [--caida F] [--roas GLOB] [--delegations GLOB] [--links GLOB] IN.jsonl.gz OUT.tsv
A line: KIND, timestamp, prefix, collector, peer, then what the detector says. Lists that Python takes from a set are sorted.
Two things are not as in process_record, where they depend on the incidents that are open: the delayed convergence is
checked at every update (process_record skips the check while the incident of the prefix is open), and the mass withdrawal
is told at every withdrawal over the threshold. The count of the withdrawals of a session is the code of process_record,
copied here, since it is not a function of its own."""
import argparse, gzip, json, sys

ALL = "flap,rlk,prh,deg,ab,asm,degs,dc,ac,atr"
ap = argparse.ArgumentParser()
ap.add_argument("--code", required=True, help="the directory of incident.py and extra_detectors.py")
ap.add_argument("--detectors", default=ALL)
ap.add_argument("--caida"); ap.add_argument("--roas"); ap.add_argument("--delegations"); ap.add_argument("--links")
ap.add_argument("src"); ap.add_argument("dst")
a = ap.parse_args()
sys.path.insert(0, a.code)
import incident, extra_detectors

on = set(a.detectors.split(","))
rel = incident.load_caida_relationships(a.caida) if on & {"rlk", "deg", "asm"} and a.caida else {}
roas = incident.load_roas(a.roas) if on & {"prh", "deg"} and a.roas else {}
reg = extra_detectors.load_delegations(a.delegations) if on & {"ab", "asm"} and a.delegations else {}
links = extra_detectors.load_links(a.links) if "asm" in on and a.links else frozenset()
state, last_gc, n, hits = {}, None, 0, 0
with gzip.open(a.src, "rt", encoding="utf-8") as f, open(a.dst, "w") as out:
    for line in f:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        kind = rec.get("type")
        ts, peer = rec.get("timestamp"), rec.get("peer")
        if kind in ("N", "S"):
            if "atr" in on and peer and ts:
                det = extra_detectors.session_event(rec, state, incident.parse_timestamp(ts))
                if det:
                    hits += 1
                    out.write(f"ATRN\t{ts}\t{rec.get('collector')}\t{peer}\t{det['atr_type']}\t{det['code']}\t{det['subcode']}\n")
            continue
        if kind not in ("A", "W"):
            continue
        prefix = rec.get("prefix")
        if not prefix or not peer or not ts:
            continue
        if type(prefix) is str and ":" in prefix:
            prefix = rec["prefix"] = incident.canonical_v6(prefix)        # as process_record
        epoch = incident.parse_timestamp(ts)
        if epoch > 0:
            if last_gc is None:
                last_gc = epoch
            if epoch - last_gc > incident.GC_INTERVAL_SECONDS:
                incident.garbage_collect_state(state, epoch)
                last_gc = epoch
        n += 1
        head = f"{ts}\t{prefix}\t{rec.get('collector')}\t{peer}"
        if "dc" in on:
            hit, det = extra_detectors.check_slow_convergence(rec, state, epoch)
            if hit:
                hits += 1
                out.write(f"DC\t{head}\t{det['burst_seconds']}\t{det['updates']}\n")
        if "atr" in on and kind == "W" and epoch > 0:
            session = extra_detectors.session_of(rec)
            atr_state = state.setdefault("peer_withdrawals", {})
            window = atr_state.get(session)
            if not isinstance(window, dict):
                window = atr_state[session] = incident.withdrawal_window(window)
            by_second = window["by_second"]
            by_second[epoch] = by_second.get(epoch, 0) + 1
            window["count"] += 1
            window["last"] = max(window["last"], epoch)
            for second in [s for s in by_second if epoch - s > 10]:
                window["count"] -= by_second.pop(second)
            if window["count"] > 500:
                hits += 1
                out.write(f"ATRW\t{head}\t{window['count']}\t{extra_detectors.session_note(state, session, epoch) or '-'}\n")
        if "flap" in on:
            hit, det = incident.check_state_volatility(rec, state, epoch)
            if hit:
                hits += 1
                key, det = incident.flapping_prefix(state, prefix, peer, epoch, det)
                out.write(f"FLAP\t{head}\t{det['flap_count']}\t{det['peers'] if key else 0}\n")
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
        if "ab" in on:
            hit, det = extra_detectors.check_unallocated_prefix(rec, reg)
            if hit:
                hits += 1
                out.write(f"AB\t{head}\t{det['actual_origin']}\t{det['kind']}\n")
        if "asm" in on:
            hit, det = extra_detectors.check_path_asns(rec, reg)
            if hit:
                hits += 1
                out.write(f"ASM\t{head}\t{det['asm_type']}\t{det['asn']}\t{det['asn_kind']}\n")
            else:
                hit, det = extra_detectors.check_forged_link(rec, rel, links)
                if hit:
                    hits += 1
                    out.write(f"ASML\t{head}\t{det['asm_type']}\t{det['link'][0]}\t{det['link'][1]}\n")
        if "deg" in on:
            hit, det = incident.check_deaggregation(rec, rel, roas, state, epoch)
            if hit and "sub_prefix" in det:
                hits += 1
                out.write(f"DEG\t{head}\t{det['parent_aggregate']}\t{det['parent_origin']}\t{det['sub_origin']}\n")
            elif hit:
                hits += 1
                waited = ",".join(f"{p}|{o}|{t}" for p, o, t in det["covered_specifics"])
                out.write(f"DEGR\t{head}\t{det['parent_aggregate']}\t{det['parent_origin']}\t{waited}\n")
        if "degs" in on:
            for det in extra_detectors.check_deaggregation_scale(rec, state, epoch):
                hits += 1
                median = int(2 * det["median_before"]) if "median_before" in det else "-"      # twice the median: a whole number
                out.write(f"DEGS\t{head}\t{det['deg_type']}\t{det['aggregate']}\t{det['more_specifics']}\t{det['origin_more_specifics']}\t{median}\n")
        if "ac" in on:
            hit, det = extra_detectors.check_amplified_churn(rec, state, epoch)
            if hit:
                hits += 1
                out.write(f"AC\t{head}\t{det['origin']}\t{det['updates']}\t{det['peers']}\n")
print(f"{n} records, {hits} detections")
