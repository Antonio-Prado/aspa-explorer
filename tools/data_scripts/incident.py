import glob
import gzip
import bz2
import lzma 
import json
import os
import signal
import pickle
import ipaddress
import functools
from datetime import datetime, timezone
import argparse
from collections import Counter, defaultdict, deque

import extra_detectors  # detectors of the copy of ASPA Explorer: see CROSS-CHECK.md, items X-1 and X-3

# configuration
DATA_PATHS = ["data/*.jsonl", "data/*.jsonl.gz"]
CAIDA_FILE = "20260901.as-rel.txt.bz2"
ROA_FILE = "roas/*.xz"
DELEGATIONS = os.environ.get("INCIDENTS_DELEGATIONS", "delegations/delegated-*")   # the files of the five RIRs (extra_detectors.py)
STATE_FILE = "active_state.pkl"
TIMEOUT_SECONDS = 900  # 15 minutes
VOL_FO_FLAPS = 10          # X-9: announcements and withdrawals of a prefix from one peer within VOL_FO_WINDOW seconds that make it flap (was 5)
VOL_FO_WINDOW = 300
VOL_FO_MIN_PEERS = 3       # X-9: one incident for the prefix, when this many peers see it flap within the window (one peer alone is its session)
LINKS = os.environ.get("INCIDENTS_LINKS", "links/*.txt")               # X-11: the links of the table of the collector (extra_detectors.py)
GC_INTERVAL_SECONDS = 600  # run garbage collection every 10 minutes of bgp time
BASELINE_TTL_SECONDS = 2592000  # 30 days ttl for baselines
PENDING_TTL_SECONDS = 86400  # a day for the more specifics that wait for their aggregate (with 30 days they were millions of entries)

stop_requested = False


def signal_handler(signum, frame):
    global stop_requested
    print("\ntermination signal received. aborting run...", flush=True)
    stop_requested = True


def load_caida_relationships(filepath):
    rel = {}
    print(f"loading caida relationships from '{filepath}'...", flush=True)
    if not os.path.exists(filepath):
        print("caida file not found. rlk detection will be disabled.")
        return rel

    open_fn = bz2.open if filepath.endswith(".bz2") else open
    with open_fn(filepath, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            parts = line.strip().split("|")
            if len(parts) >= 3:
                as1, as2, rel_type = int(parts[0]), int(parts[1]), int(parts[2])
                if rel_type == -1:
                    rel[(as1, as2)] = "p2c"
                    rel[(as2, as1)] = "c2p"
                elif rel_type == 0:
                    rel[(as1, as2)] = "p2p"
                    rel[(as2, as1)] = "p2p"

    print(f"loaded {len(rel)} directional relationship links.", flush=True)
    return rel


def load_roas(path_pattern):
    roas = defaultdict(set)
    print(f"loading roas from '{path_pattern}'...", flush=True)
    files = glob.glob(path_pattern)
    if not files:
        print("roa files not found. prh detection will be disabled.")
        return roas

    for filepath in sorted(files):
        try:
            with lzma.open(filepath, "rt", encoding="utf-8") as f:
                data = json.load(f)
                for entry in data.get("roas", []):
                    prefix = entry.get("prefix")
                    asn = entry.get("asn")
                    max_len = entry.get("maxLength") or entry.get("max_length")
                    
                    if prefix and asn:
                        asn_int = int(str(asn).replace("AS", ""))
                        try:
                            max_len_int = int(max_len) if max_len else ipaddress.ip_network(prefix, strict=False).prefixlen
                        except Exception:
                            max_len_int = ipaddress.ip_network(prefix, strict=False).prefixlen
                            
                        roas[prefix].add((asn_int, max_len_int))
        except Exception as e:
            print(f"error reading '{filepath}': {e}", flush=True)
            
    print(f"loaded roas for {len(roas)} prefixes across {len(files)} files.", flush=True)
    return roas


# --- DETECTOR MODULES ---

def check_route_leak(rec, rel, state, current_epoch):
    path = rec.get("compressed_path", [])
    if not path or len(path) < 3 or not rel:
        return False, {}

    for i in range(1, len(path) - 1):
        try:
            to_as = int(path[i - 1])
            by_as = int(path[i])
            from_as = int(path[i + 1])
        except ValueError:
            continue

        in_rel = rel.get((from_as, by_as))
        out_rel = rel.get((by_as, to_as))

        if in_rel in ("p2c", "p2p") and out_rel in ("c2p", "p2p"):
            return True, {
                "anomaly": "Valley-Free Violation (Route Leak)", 
                "from": from_as, "by": by_as, "to": to_as, "path": path,
                "rlk_type": extra_detectors.rlk_type(in_rel, out_rel),
                "learned_from": "provider" if in_rel == "p2c" else "peer",
            }

    return False, {}


_ROA_CACHE = {}
_ROA_OWNER = [None]


def check_prefix_hijack(rec, roas, state, current_epoch):
    """The ROA check of a record, remembered for each (prefix, origin): the same announcement comes again and again from many
    peers, and the check (every covering prefix, as strings) was the largest cost of the run. The answer depends on the ROAs
    only, which do not change while the script runs."""
    if _ROA_OWNER[0] is not roas:
        _ROA_CACHE.clear()
        _ROA_OWNER[0] = roas
    key = (rec.get("prefix"), rec.get("origin"))
    hit = _ROA_CACHE.get(key)
    if hit is None:
        if len(_ROA_CACHE) > 1_000_000:
            _ROA_CACHE.clear()
        hit = _ROA_CACHE[key] = _check_prefix_hijack(rec, roas, state, current_epoch)
    return hit


def _check_prefix_hijack(rec, roas, state, current_epoch):
    prefix_str = rec.get("prefix")
    origin = rec.get("origin")
    
    if not prefix_str or origin is None or not roas:
        return False, {}

    try:
        net = ipaddress.ip_network(prefix_str, strict=False)
    except (ValueError, IndexError):
        return False, {}

    # gather all covering roas before evaluating
    covering_roas = set()
    
    if prefix_str in roas:
        covering_roas.update(roas[prefix_str])
        
    min_len = 8 if net.version == 4 else 16
    if net.prefixlen > min_len:
        for i in range(net.prefixlen - 1, min_len - 1, -1):
            supernet = str(net.supernet(new_prefix=i))
            if supernet in roas:
                covering_roas.update(roas[supernet])
                
    if covering_roas:
        is_valid = False
        invalid_length = False
        
        for roa_asn, roa_max_len in covering_roas:
            if origin == roa_asn:
                if net.prefixlen <= roa_max_len:
                    is_valid = True
                    break
                else:
                    invalid_length = True
                    
        if not is_valid:
            if invalid_length:
                return True, {
                    "anomaly": "Invalid_Length (Sub-Prefix Hijack)",
                    "expected_roas": list(covering_roas), 
                    "actual_origin": origin,
                    "prefix": prefix_str
                }
            else:
                return True, {
                    "anomaly": "Invalid_Origin (Prefix Hijack)",
                    "expected_roas": list(covering_roas), 
                    "actual_origin": origin,
                    "prefix": prefix_str
                }

    return False, {}


"""def check_as_path_manipulation(rec, rel, state, current_epoch):
    if rec.get("flag") == 1:
        return True, {"anomaly": "Operational Anomaly (Excessive Prepending)", "origin": rec.get("origin")}

    path = rec.get("compressed_path", [])
    if not path:
        return False, {}

    for asn_str in path:
        try:
            asn = int(asn_str)
            if (64512 <= asn <= 65534) or (4200000000 <= asn <= 4294967294):
                return True, {"anomaly": "Policy Inconsistency (Private ASN Leaked)", "violating_asn": asn, "path": path}
        except ValueError:
            continue

    if len(path) > 15:
        return True, {"anomaly": "Operational Anomaly (Path Inflation)", "length": len(path), "path": path}

    return False, {}"""


@functools.lru_cache(maxsize=1_000_000)
def _supernets(prefix_str):
    """(version, length, canonical prefix, the covering prefixes from /16 (IPv4) or /32 (IPv6) up), or None."""
    try:
        net = ipaddress.ip_network(prefix_str, strict=False)
    except (ValueError, IndexError):
        return None
    lo = 16 if net.version == 4 else 32
    return net.version, net.prefixlen, str(net), tuple(str(net.supernet(new_prefix=i)) for i in range(lo, net.prefixlen))


def check_deaggregation(rec, rel, roas, state, current_epoch):
    prefix_str = rec.get("prefix")
    origin = rec.get("origin")

    if not prefix_str or origin is None:
        return False, {}

    info = _supernets(prefix_str)
    if info is None:
        return False, {}
    version, plen, canonical, supernets = info

    deg_state = state.setdefault("prefix_history", {})
    pending_specs = state.setdefault("pending_specifics", {})

    specific_min, aggregate_max = (24, 22) if version == 4 else (48, 32)
    if plen >= specific_min:
        for supernet in supernets:
            if supernet in deg_state:
                parent_origin = deg_state[supernet]["origin"]
                # only flag if origins diverge (fixes normal multi-homing flood)
                if parent_origin != origin and not deaggregation_is_ordinary(prefix_str, origin, parent_origin, rel, roas):
                    return True, {
                        "anomaly": "Cross-Origin Deaggregation",
                        "parent_aggregate": supernet,
                        "parent_origin": parent_origin,
                        "sub_prefix": prefix_str,
                        "sub_origin": origin
                    }
                return False, {}
        # add timestamp to pending specifically to prevent memory leak
        for supernet in supernets:
            pending_specs.setdefault(supernet, {})[(prefix_str, origin)] = current_epoch

    elif plen <= aggregate_max:
        deg_state[canonical] = {"origin": origin, "ts": current_epoch}
        if canonical in pending_specs:
            specifics = [(sp, so, ts) for (sp, so), ts in pending_specs.pop(canonical).items()]

            # check specifics against newly arrived parent
            flagged_specifics = [s for s in specifics if s[1] != origin and not deaggregation_is_ordinary(s[0], s[1], origin, rel, roas)]
            if flagged_specifics:
                return True, {
                    "anomaly": "Cross-Origin Deaggregation (Retroactive)",
                    "parent_aggregate": canonical,
                    "parent_origin": origin,
                    "covered_specifics": flagged_specifics[:5]
                }

    return False, {}


def check_state_volatility(rec, state, current_epoch):
    prefix = rec.get("prefix")
    peer = extra_detectors.session_of(rec)        # X-12: the flaps of a session, not of an AS that feeds several collectors
    if not prefix or not peer or current_epoch == 0:
        return False, {}

    vol_state = state.setdefault("vol_flaps", {})
    key = (prefix, peer)
    
    # a deque: the events older than the window leave from the left (the list that was rebuilt for every update cost more
    # than everything else together for a prefix that flaps for hours); a state saved with lists is converted
    history = vol_state.get(key)
    if not isinstance(history, deque):
        history = vol_state[key] = deque(history or ())
    history.append((current_epoch, rec.get("type")))
    while current_epoch - history[0][0] > VOL_FO_WINDOW:
        history.popleft()

    if len(history) >= VOL_FO_FLAPS:
        if any(x[1] == "A" for x in history) and any(x[1] == "W" for x in history):
            return True, {"flap_count": len(history), "window_seconds": VOL_FO_WINDOW, "vol_type": "FO"}

    return False, {}


def flapping_prefix(state, prefix, peer, current_epoch, details):
    """X-9: one incident for a prefix that flaps, not one for each peer that sees it flap. The peers that flap it within
    VOL_FO_WINDOW seconds are counted, and the incident (actor VOL_<prefix>) opens at VOL_FO_MIN_PEERS of them: a prefix that
    flaps for one peer alone is that peer's session, not the prefix. `peer` is the peer AS (X-12: one AS at several collectors
    is one view). Returns the actor key, or None while the peers are too few."""
    peers = state.setdefault("vol_peers", {}).setdefault(prefix, {})
    peers[peer] = current_epoch
    for p in [p for p, t in peers.items() if current_epoch - t > VOL_FO_WINDOW]:
        del peers[p]
    if len(peers) < VOL_FO_MIN_PEERS:
        return None, details
    return f"VOL_{prefix}", dict(details, peers=len(peers))


def roa_authorises(net, origin, roas):
    """Whether a ROA covers the prefix with this origin and a maxLength that allows it."""
    if not roas:
        return False
    min_len = 8 if net.version == 4 else 16
    for i in range(net.prefixlen, min_len - 1, -1):
        for roa_asn, roa_max_len in roas.get(str(net.supernet(new_prefix=i)), ()):
            if roa_asn == origin and net.prefixlen <= roa_max_len:
                return True
    return False


def deaggregation_is_ordinary(sub_prefix, sub_origin, parent_origin, rel, roas):
    """X-10: a more specific with another origin than its aggregate is not a candidate when the ROAs authorise that origin
    for it (the holder of the space said so) or when CAIDA knows a link between the two origins (a customer announcing its
    part of the provider's block, or the other way round): that is the ordinary way address space is used, and it was three
    quarters of the candidates of the first day."""
    if rel and ((parent_origin, sub_origin) in rel or (sub_origin, parent_origin) in rel):
        return True
    try:
        return roa_authorises(ipaddress.ip_network(sub_prefix, strict=False), sub_origin, roas)
    except ValueError:
        return False


# --- CORE LOGIC ---

def parse_timestamp(ts_str):
    try:
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return 0


def flush_incident(out_f, inc, end_time, end_reason, end_msg=None):
    if end_msg:
        inc["messages"].append(end_msg)
        
    # keep buffer constrained to start, evolving middle, penultimate, and end
    if len(inc["messages"]) > 4:
        inc["messages"] = [
            inc["messages"][0],
            inc["messages"][1],
            inc["messages"][-2],
            inc["messages"][-1]
        ]

    inc_record = {
        "incident_type": inc["incident_type"],
        "actor_key": inc["actor_key"],
        "prefixes": list(inc["prefixes"]),
        "start": inc["start_time"],
        "end": end_time,
        "end_reason": end_reason,
        "total_updates": inc["total_updates"],
        "details": inc["details"],
        "messages": inc["messages"],
    }
    out_f.write(json.dumps(inc_record, ensure_ascii=False) + "\n")


def prefix_index(state, active_incidents):
    """prefix -> the keys of the incidents that have it, so that a withdrawal finds its incidents without a look at all of them
    (a run keeps thousands open). Built when first needed, and kept up to date where incidents are added and removed."""
    idx = state.get("_idx")
    if idx is None:
        idx = state["_idx"] = {}
        for key, inc in active_incidents.items():
            for p in inc["prefixes"]:
                idx.setdefault(p, set()).add(key)
    return idx


def index_prefix(state, key, prefix):
    idx = state.get("_idx")
    if idx is not None:
        idx.setdefault(prefix, set()).add(key)


def check_timeouts(active_incidents, current_epoch, timeout_seconds, out_f, state=None):
    expired_keys = []
    for key, inc in active_incidents.items():
        timeout = 600 if inc["incident_type"] == "VOL" else timeout_seconds
        if current_epoch - inc["last_epoch"] > timeout:
            expired_keys.append(key)

    for key in expired_keys:
        inc = active_incidents.pop(key)
        idx = state.get("_idx") if state else None
        if idx is not None:
            for p in inc["prefixes"]:
                if p in idx:
                    idx[p].discard(key)
                    if not idx[p]:
                        del idx[p]
        flush_incident(out_f, inc, end_time=inc["last_time"], end_reason="timeout")


def garbage_collect_state(state, current_epoch):
    if "vol_flaps" in state:
        stale = [k for k, v in state["vol_flaps"].items() if not v or (current_epoch - v[-1][0]) > VOL_FO_WINDOW]
        for k in stale: 
            del state["vol_flaps"][k]

    if "vol_peers" in state:
        stale = [k for k, v in state["vol_peers"].items() if not v or current_epoch - max(v.values()) > VOL_FO_WINDOW]
        for k in stale:
            del state["vol_peers"][k]
            
    if "peer_withdrawals" in state:
        stale = [k for k, v in state["peer_withdrawals"].items()
                 if not v or (current_epoch - (v["last"] if isinstance(v, dict) else v[-1])) > 10]
        for k in stale:
            del state["peer_withdrawals"][k]

    if "prefix_history" in state:
        stale = [k for k, v in state["prefix_history"].items() if (current_epoch - v["ts"]) > BASELINE_TTL_SECONDS]
        for k in stale: 
            del state["prefix_history"][k]
            
    extra_detectors.collect_garbage(state, current_epoch)

    # clear old pending specifics to prevent memory leaks
    if "pending_specifics" in state:
        for k in list(state["pending_specifics"].keys()):
            # keep items newer than ttl
            state["pending_specifics"][k] = {
                key: ts for key, ts in state["pending_specifics"][k].items()
                if current_epoch - ts <= PENDING_TTL_SECONDS
            }
            if not state["pending_specifics"][k]:
                del state["pending_specifics"][k]


def withdrawal_window(epochs=None):
    """The withdrawals of a peer counted by second; built from the list of epochs of a state saved by an older version."""
    epochs = list(epochs or ())
    return {"by_second": dict(Counter(epochs)), "count": len(epochs), "last": epochs[-1] if epochs else 0}


def new_incident(incident_type, actor_key, prefix, peer, ts_str, current_epoch, details, rec, total_updates=1):
    return {
        "incident_type": incident_type,
        "actor_key": actor_key,
        "prefixes": {prefix},
        "peers": {peer},
        "start_time": ts_str,
        "last_time": ts_str,
        "last_epoch": current_epoch,
        "total_updates": total_updates,
        "details": details,
        "messages": [rec],
    }


def add_message(inc, rec, ts_str, current_epoch):
    inc["total_updates"] += 1
    inc["last_time"] = ts_str
    inc["last_epoch"] = current_epoch

    if len(inc["messages"]) < 4:
        inc["messages"].append(rec)
    else:
        # power of 2 trick for logarithmic middle
        if (inc["total_updates"] & (inc["total_updates"] - 1)) == 0:
            inc["messages"][1] = inc["messages"][2]
        # shift final slots
        inc["messages"][2] = inc["messages"][3]
        inc["messages"][3] = rec


def process_record(rec, rel, roas, active_incidents, timeout_seconds, out_f, state, reg=None, links=frozenset()):
    msg_type = rec.get("type")
    prefix = rec.get("prefix")
    # X-12: the peer as a session (collector, peer AS): the same AS at two collectors is two sessions
    peer = extra_detectors.session_of(rec)
    ts_str = rec.get("timestamp")
    origin = rec.get("origin")

    if msg_type in ("N", "S"):
        # the messages of the session (stream.py of the copy of ASPA Explorer); they have no prefix
        if peer and ts_str:
            epoch = parse_timestamp(ts_str)
            details = extra_detectors.session_event(rec, state, epoch)
            if details:
                key = f"ATR_{details['atr_type']}_{extra_detectors.session_tag(rec)}"
                if key not in active_incidents:
                    active_incidents[key] = new_incident("ATR", key, "", peer, ts_str, epoch, details, rec)
                    active_incidents[key]["prefixes"] = set()
                else:
                    add_message(active_incidents[key], rec, ts_str, epoch)
        return

    if not prefix or not peer or not ts_str:
        return

    current_epoch = parse_timestamp(ts_str)

    if current_epoch > 0:
        last_gc = state.setdefault("last_gc_check", current_epoch)
        if current_epoch - last_gc > GC_INTERVAL_SECONDS:
            if len(active_incidents) > 0:
                check_timeouts(active_incidents, current_epoch, timeout_seconds, out_f, state)
            garbage_collect_state(state, current_epoch)
            state["last_gc_check"] = current_epoch

    # an update of a prefix whose delayed convergence is already an incident belongs to it
    dc_key = f"VOLDC_{prefix}"
    if dc_key in active_incidents:
        add_message(active_incidents[dc_key], rec, ts_str, current_epoch)
    else:
        is_dc, dc_det = extra_detectors.check_slow_convergence(rec, state, current_epoch)
        if is_dc:
            active_incidents[dc_key] = new_incident("VOL", dc_key, prefix, peer, ts_str, current_epoch, dc_det, rec,
                                                    total_updates=dc_det["updates"])
            index_prefix(state, dc_key, prefix)

    if msg_type == "W":
        if current_epoch > 0:
            atr_state = state.setdefault("peer_withdrawals", {})
            # the withdrawals of the peer in the last 10 s, counted by second: a list rebuilt at every withdrawal made a
            # session reset of a full table (hundreds of thousands of withdrawals within 10 s) quadratic. The count is the
            # same as the list's, also when the timestamps of a peer are not in order.
            window = atr_state.get(peer)
            if not isinstance(window, dict):
                window = atr_state[peer] = withdrawal_window(window)
            by_second = window["by_second"]
            by_second[current_epoch] = by_second.get(current_epoch, 0) + 1
            window["count"] += 1
            window["last"] = current_epoch
            for second in [s for s in by_second if current_epoch - s > 10]:
                window["count"] -= by_second.pop(second)
            withdrawals = window["count"]

            if withdrawals > 500:
                atr_key = f"ATR_{extra_detectors.session_tag(rec)}"
                if atr_key not in active_incidents:
                    active_incidents[atr_key] = new_incident(
                        "ATR", atr_key, prefix, peer, ts_str, current_epoch,
                        dict({"dropping_peer": rec.get("peer"), "collector": rec.get("collector"), "withdrawal_count": withdrawals},
                             **({"session_event": note} if (note := extra_detectors.session_note(state, peer, current_epoch)) else {})), rec)
                else:
                    inc = active_incidents[atr_key]
                    inc["prefixes"].add(prefix)
                    add_message(inc, rec, ts_str, current_epoch)

        is_vol, vol_details = check_state_volatility(rec, state, current_epoch)
        if is_vol:
            vol_key, vol_details = flapping_prefix(state, prefix, rec.get("peer"), current_epoch, vol_details)
            if vol_key and vol_key not in active_incidents:
                # the flaps that triggered the detection are already part of the incident
                active_incidents[vol_key] = new_incident(
                    "VOL", vol_key, prefix, peer, ts_str, current_epoch, vol_details, rec,
                    total_updates=vol_details["flap_count"])
            elif vol_key:
                inc = active_incidents[vol_key]
                inc["peers"].add(peer)
                inc["details"]["peers"] = max(inc["details"].get("peers", 0), vol_details["peers"])
                add_message(inc, rec, ts_str, current_epoch)

        # a withdrawal belongs to an incident only if the peer that sends it announced the anomaly
        keys_to_resolve = []
        keys = prefix_index(state, active_incidents).get(prefix, ())
        for k in list(keys):
            inc = active_incidents.get(k)
            if inc is None:
                continue
            if inc["incident_type"] not in ["VOL", "ATR"] and peer in inc.get("peers", {peer}):
                keys_to_resolve.append(k)

        for k in keys_to_resolve:
            add_message(active_incidents[k], rec, ts_str, current_epoch)
        return

    if msg_type == "A":
        is_vol, vol_details = check_state_volatility(rec, state, current_epoch)
        if is_vol:
            vol_key, vol_details = flapping_prefix(state, prefix, rec.get("peer"), current_epoch, vol_details)
            if vol_key and vol_key in active_incidents:
                inc = active_incidents[vol_key]
                inc["peers"].add(peer)
                inc["details"]["peers"] = max(inc["details"].get("peers", 0), vol_details["peers"])
                add_message(inc, rec, ts_str, current_epoch)

        anomalies = []
        is_rlk, rlk_det = check_route_leak(rec, rel, state, current_epoch)
        if is_rlk: anomalies.append(("RLK", f"RLK_{rlk_det.get('from')}_{rlk_det.get('by')}_{rlk_det.get('to')}", rlk_det))
        
        is_prh, prh_det = check_prefix_hijack(rec, roas, state, current_epoch)
        if is_prh: anomalies.append(("PRH", f"PRH_{origin}", prh_det))

        is_ab, ab_det = extra_detectors.check_unallocated_prefix(rec, reg)
        if is_ab: anomalies.append(("PRH", f"PRH_AB_{origin}", ab_det))
        
        # is_asm, asm_det = check_as_path_manipulation(rec, rel, state, current_epoch)
        # if is_asm: anomalies.append(("ASM", f"ASM_{origin}", asm_det))

        # the AS numbers of the path first: a link to a number that is not allocated would be flagged again as a forged link
        is_asm, asm_det = extra_detectors.check_path_asns(rec, reg)
        if is_asm:
            anomalies.append(("ASM", f"ASM_{asm_det['asm_type']}_{asm_det['asn']}", asm_det))
        else:
            is_asm, asm_det = extra_detectors.check_forged_link(rec, rel, links)
            if is_asm: anomalies.append(("ASM", f"ASM_{asm_det['asm_type']}_{asm_det['link'][0]}_{asm_det['link'][1]}", asm_det))
        
        is_deg, deg_det = check_deaggregation(rec, rel, roas, state, current_epoch)
        if is_deg: anomalies.append(("DEG", f"DEG_{origin}", deg_det))

        for deg_det in extra_detectors.check_deaggregation_scale(rec, state, current_epoch):
            anomalies.append(("DEG", f"DEG_{deg_det['deg_type']}_{origin}", deg_det))

        is_ac, ac_det = extra_detectors.check_amplified_churn(rec, state, current_epoch)
        if is_ac: anomalies.append(("VOL", f"VOLAC_{origin}", ac_det))

        for inc_type, actor_key, details in anomalies:
            if actor_key not in active_incidents:
                active_incidents[actor_key] = new_incident(
                    inc_type, actor_key, prefix, peer, ts_str, current_epoch, details, rec)
                index_prefix(state, actor_key, prefix)
            else:
                inc = active_incidents[actor_key]
                inc["prefixes"].add(prefix)
                index_prefix(state, actor_key, prefix)
                inc.setdefault("peers", set()).add(peer)
                add_message(inc, rec, ts_str, current_epoch)


def generate_incident_summary(output_file):
    base_name = os.path.basename(output_file).split('.')[0]
    summary_file = f"summary_{base_name}.txt"

    print(f"generating incident summary for '{output_file}'...", flush=True)

    counts = Counter()
    try:
        with open(output_file, "rt", encoding="utf-8") as f:
            for line in f:
                try:
                    counts[json.loads(line).get("incident_type") or "unknown"] += 1
                except json.JSONDecodeError:
                    continue
        with open(summary_file, "w", encoding="utf-8") as out:
            out.write("=" * 40 + "\n")
            out.write(f" INCIDENT TYPE SUMMARY: {base_name}\n")
            out.write("=" * 40 + "\n")
            out.write(f"{'Incident Type':<35} | Count\n")
            out.write("-" * 40 + "\n")
            for inc_type, count in counts.most_common():
                out.write(f"{inc_type:<35} | {count}\n")
            out.write("=" * 40 + "\n")
        print(f"summary written to '{summary_file}'.", flush=True)
    except Exception as e:
        print(f"could not generate summary: {e}")


def main():
    global stop_requested
    parser = argparse.ArgumentParser(description="Detect and classify BGP incidents in the files written by record.py and stream.py.")
    parser.add_argument("--flush-open", action="store_true",
                        help="at the end of the run write the incidents that are still open to incidents_open.jsonl "
                             "(end_reason dataset_end) and clear them from the saved state; "
                             "without it they stay in the state and are written when they time out in a later run")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    rel = load_caida_relationships(CAIDA_FILE)
    roas = load_roas(ROA_FILE)
    reg = extra_detectors.load_delegations(DELEGATIONS)
    print(f"loaded {sum(len(v[0]) for v in reg.values())} ranges that the registries list as available or reserved.", flush=True)
    links = extra_detectors.load_links(LINKS)
    print(f"loaded {len(links) // 2} links of the table of the collector (a link that is in the table is not forged).", flush=True)

    file_list = sorted({f for pattern in DATA_PATHS for f in glob.glob(pattern)})
    if not file_list:
        print(f"no files found matching {DATA_PATHS}. fallback to live stream processing mode.")
        file_list = ["live_data_stream.jsonl"]

    active_incidents = {}
    processed_files = set()
    state = {}
    
    if os.path.exists(STATE_FILE):
        print(f"loading state from previous run ('{STATE_FILE}')...", flush=True)
        try:
            with open(STATE_FILE, "rb") as f:
                saved_data = pickle.load(f)
                active_incidents = saved_data.get("incidents", {})
                processed_files = saved_data.get("processed_files", set())
                state = saved_data.get("state", {})
                # a state saved before the dedup keeps the specifics as a set of (prefix, origin, epoch)
                for k, v in state.get("pending_specifics", {}).items():
                    if isinstance(v, set):
                        state["pending_specifics"][k] = {(sp, so): ts for sp, so, ts in v}
                # and one saved before X-12 keeps the peers as AS numbers
                extra_detectors.upgrade_sessions(active_incidents, state)
        except Exception as e:
            print(f"could not load state: {e}. starting fresh.")

    total_processed = 0

    for filepath in file_list:
        if stop_requested:
            break

        if filepath in processed_files:
            print(f"skipping '{filepath}' (already processed)...")
            continue

        base_name = os.path.basename(filepath).split('.')[0]
        dynamic_output_file = f"incidents_{base_name}.jsonl"
        tmp_output_file = dynamic_output_file + ".tmp"

        checkpoint_incidents = pickle.dumps(active_incidents)
        checkpoint_state = pickle.dumps(state)

        print(f"\nprocessing '{filepath}' -> '{dynamic_output_file}'...", flush=True)
        open_fn = gzip.open if filepath.endswith(".gz") else open

        try:
            with open_fn(filepath, "rt", encoding="utf-8") as in_f, \
                 open(tmp_output_file, "w", encoding="utf-8", buffering=1) as out_f:
                
                for line in in_f:
                    if stop_requested:
                        break
                    
                    line = line.strip()
                    if not line:
                        continue
                    
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    process_record(rec, rel, roas, active_incidents, TIMEOUT_SECONDS, out_f, state, reg, links)
                    total_processed += 1
                    
                    if total_processed % 50000 == 0:
                        print(f"processed {total_processed} total records | active incidents: {len(active_incidents)}...", end="\r", flush=True)
        except Exception as e:
            print(f"\nerror reading {filepath}: {e}")
            if not os.path.exists(filepath):
                break
            continue

        if stop_requested:
            print(f"\nrun aborted mid-file! state was NOT saved for '{filepath}'.")
            if os.path.exists(tmp_output_file):
                os.remove(tmp_output_file)
            active_incidents = pickle.loads(checkpoint_incidents)
            state = pickle.loads(checkpoint_state)
            break
        else:
            if os.path.exists(tmp_output_file):
                os.replace(tmp_output_file, dynamic_output_file)
            processed_files.add(filepath)
            print(f"\nfinished '{filepath}'. saving {len(active_incidents)} active incidents...", flush=True)
            with open(STATE_FILE, "wb") as f:
                pickle.dump({
                    "incidents": active_incidents,
                    "processed_files": processed_files,
                    "state": state
                }, f)

            generate_incident_summary(dynamic_output_file)

    if not stop_requested:
        if args.flush_open and active_incidents:
            print(f"\nflushing {len(active_incidents)} open incidents at dataset end...", flush=True)
            with open("incidents_open.jsonl", "w", encoding="utf-8") as final_f:
                for k, inc in list(active_incidents.items()):
                    flush_incident(final_f, inc, end_time=inc["last_time"], end_reason="dataset_end")
            active_incidents.clear()
            state.pop("_idx", None)
            with open(STATE_FILE, "wb") as f:
                pickle.dump({"incidents": active_incidents, "processed_files": processed_files, "state": state}, f)

        print(f"\nall files processed successfully! total raw updates evaluated: {total_processed}.")

if __name__ == "__main__":
    main()
    