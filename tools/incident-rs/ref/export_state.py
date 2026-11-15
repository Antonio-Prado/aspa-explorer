"""The state that incident.py saves (active_state.pkl), as lines of JSON that `incident-rs import-state` reads: the open
incidents, the files already read and the state of every detector, so that the Rust version goes on where the Python one
stopped.
  python export_state.py --code DIR active_state.pkl state.jsonl
--code is the directory of incident.py: the state is loaded by its load_state, which also brings an older state up to date."""
import argparse, json, os, sys

ap = argparse.ArgumentParser()
ap.add_argument("--code", required=True); ap.add_argument("src"); ap.add_argument("dst")
a = ap.parse_args()
sys.path.insert(0, a.code)
import incident

incident.STATE_FILE = os.path.abspath(a.src)
incidents, processed, state = incident.load_state()
n = 0
with open(a.dst, "w", encoding="utf-8") as out:
    def put(*row):
        global n
        n += 1
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
    put("processed", sorted(processed))
    put("last_gc", state.get("last_gc_check"))
    for key, inc in incidents.items():                 # in the order they were opened
        if key.startswith("VOLDC_"):
            actor = ["dc", key[6:]]
        elif inc["incident_type"] == "VOL" and key.startswith("VOL_"):
            actor = ["vol", key[4:]]
        elif key.startswith("ATR_") and not key.startswith(("ATR_MA_", "ATR_EH_")):
            collector, _, peer = key[4:].rpartition("_")
            actor = ["atr", collector or None, int(peer)]
        else:
            actor = ["other", key]
        put("incident", actor, inc["incident_type"], sorted(inc["prefixes"]), [[c, p] for c, p in inc.get("peers", ())],
            inc["start_time"], inc.get("start_epoch", incident.parse_timestamp(inc["start_time"])), inc["last_time"], inc["last_epoch"], inc["total_updates"],
            json.dumps(inc["details"], ensure_ascii=False), [json.dumps(m, ensure_ascii=False) for m in inc["messages"]])
    for (prefix, (collector, peer)), v in state.get("vol_flaps", {}).items():
        codes = [v] if type(v) is int else v if (not v or type(v[0]) is int) else incident._flap_codes(v)
        if codes:
            put("flap", prefix, collector, peer, list(codes))
    for prefix, peers in state.get("vol_peers", {}).items():
        put("flap_peers", prefix, [[p, t] for p, t in peers.items()])
    for (collector, peer), w in state.get("peer_withdrawals", {}).items():
        if not isinstance(w, dict):
            w = incident.withdrawal_window(w)
        put("withdrawals", collector, peer, [[s, c] for s, c in w["by_second"].items()], w["count"], w["last"])
    for (collector, peer), (epoch, what) in state.get("peer_state", {}).items():
        put("session", collector, peer, epoch, what)
    for prefix, v in state.get("prefix_history", {}).items():
        put("aggregate", prefix, v["origin"], v["ts"])
    for supernet, waiting in state.get("pending_specifics", {}).items():
        put("pending", supernet, [[p, o, t] for (p, o), t in waiting.items()])      # in the order they came
    for (origin, (version, number)), b in state.get("deg_scale", {}).items():
        put("scale", origin, version, str(number), b["day"], b["n"], b["fired"], [[p, peer] for p, peer in b["p"].items()])
    for origin, o in state.get("deg_origin", {}).items():
        put("scale_origin", origin, o["day"], o["n"], o["n4"], o["fired"])
    for origin, history in state.get("deg_hist", {}).items():
        put("scale_history", origin, list(history))
    for prefix, (start, last, count, fired) in state.get("bursts", {}).items():
        put("burst", prefix, start, last, count, fired)
    for origin, w in state.get("churn", {}).items():
        put("churn", origin, w["start"], w["n"], sorted(w["prefixes"]), sorted(w["peers"]), w["fired"])
known = {"last_gc_check", "vol_flaps", "vol_peers", "peer_withdrawals", "peer_state", "prefix_history", "pending_specifics", "deg_scale", "deg_origin", "deg_hist", "bursts", "churn", "_idx"}
unknown = sorted(set(state) - known)
if unknown:
    sys.exit(f"parts of the state that this script does not know: {unknown}")
print(f"{n} lines, {len(incidents)} open incidents")
