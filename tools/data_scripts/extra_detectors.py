"""Detectors that are not in the original incident.py: they exist only in the copy of ASPA Explorer.

They are described in CROSS-CHECK.md (items X-1 to X-6 of the project data_scripts). The incident files keep the same fields:
the detectors add details (`rlk_type`, `asm_type`, `prh_type`, `vol_type`, `deg_type`, `atr_type`) and the incident types ASM and
ATR get more cases. Every threshold is a constant at the top, a first guess to be set from the distribution of a day of real data.
"""
import bisect
import glob
import ipaddress
import statistics
from datetime import datetime, timezone
from functools import lru_cache

# --- thresholds (first guesses) ---
DEG_BUCKET = {4: 16, 6: 32}             # the aggregate that a more specific belongs to
DEG_LIMIT = {4: 24, 6: 48}              # longer than this is not accepted by most networks, so it is not a deaggregation
DEG_MIN_PEERS = 2                       # a more specific counts when 2 peers of the collector have it (one peer alone is noise)
DEG_EXCESS = 32                         # more specifics of one origin under one aggregate, in a UTC day
DEG_FLOOD_V6 = 1024                     # the same under a /32: 1,024 of the 65,536 /48
DEG_FLOOD_V4_ORIGIN = 1000              # more specifics of one origin, in all its IPv4 aggregates, in a UTC day
DEG_JUMP_FACTOR = 5                     # today's count of an origin against the median of the last days
DEG_JUMP_MIN = 100                      # ... and at least this many
DEG_HISTORY_DAYS = 7
DEG_JUMP_MIN_DAYS = 3                   # the jump is not judged without this many days of history
VOL_DC_GAP = 60                         # seconds without an update of a prefix that end a burst
VOL_DC_SECONDS = 600                    # a burst this long, ...
VOL_DC_UPDATES = 100                    # ... with this many updates (from any peer), is a delayed convergence
VOL_AC_WINDOW = 300                     # seconds
VOL_AC_UPDATES = 3000                   # updates of one origin in the window, ...
VOL_AC_PREFIXES = 300                   # ... for this many different prefixes, ...
VOL_AC_PEERS = 8                        # ... seen from this many peers: churn that goes far beyond one prefix
ATR_ATTRIBUTE_SUBCODES = {1, 4, 5, 9}   # UPDATE message error (code 3): attribute list, flags, length, optional attribute
SESSION_EVENT_SECONDS = 120             # a change of state of the session this close before a mass withdrawal is noted
LEGACY_COLLECTOR = "rrc00"              # X-12: the collector of a state saved before X-12 (the stream of rrc00 is the only one)

# AS numbers that are not for the public Internet: IANA special-purpose and private (RFC 6996, 5398, 7300, 6793)
PRIVATE_ASN = ((64512, 65534), (4200000000, 4294967294))
RESERVED_ASN = ((0, 0), (23456, 23456), (64496, 64511), (65535, 65551), (65552, 131071), (4294967295, 4294967295))


# --- X-12: the session of a record ---

def session_of(rec):
    """X-12: the session that a record comes from, as (collector, peer AS), or None when the record has no peer. The same AS
    feeds several collectors, and the Parquet files of RIS put all of them in one stream: each feed is a session of its own,
    with its own withdrawals, flaps and resets, and counting them by the AS alone would add up the resets of two collectors.
    What counts independent views stays by AS (the peers that see a prefix flap, the more specifics that two peers have, the
    churn seen from many peers): one AS at three collectors is one view, not three."""
    peer = rec.get("peer")
    return (rec.get("collector"), peer) if peer else None


def session_tag(rec):
    """The session in an actor key: `rrc00_34800`, or the AS alone when the record does not say its collector."""
    return f"{rec['collector']}_{rec.get('peer')}" if rec.get("collector") else str(rec.get("peer"))


def upgrade_sessions(incidents, state):
    """X-12: a state saved before X-12 keeps the sessions as AS numbers; they become sessions of LEGACY_COLLECTOR."""
    s = lambda p: p if not p or isinstance(p, tuple) else (LEGACY_COLLECTOR, p)
    for inc in incidents.values():
        if "peers" in inc:
            inc["peers"] = {s(p) for p in inc["peers"]}
    for name in ("peer_withdrawals", "peer_state"):
        if name in state:
            state[name] = {s(k): v for k, v in state[name].items()}
    if "vol_flaps" in state:
        state["vol_flaps"] = {(k[0], s(k[1])): v for k, v in state["vol_flaps"].items()}


@lru_cache(maxsize=1 << 18)
def net_of(prefix):
    try:
        return ipaddress.ip_network(prefix, strict=False)
    except ValueError:
        return None


def utc_day(epoch):
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")


# --- X-1, X-3: route leaks and links ---

def rlk_type(in_rel, out_rel):
    """Type of a valley-free violation, in the terms of the survey (Servillo et al., Sec. III), from the two relationships
    around the leaking AS: in_rel is the one between the AS that sent the route and the leaker (p2c: the sender is its provider),
    out_rel the one between the leaker and the AS that received it (c2p: the receiver is its provider).

    UL (upward leak): the route goes to a provider. LL (lateral leak): it goes to a peer. The survey words them with some
    overlap (UL also "to peers"); this is our reading, based on the receiver. A leak towards a customer is not flagged at all."""
    return "UL" if out_rel == "c2p" else "LL"


def load_links(pattern):
    """X-11: the links (pairs of adjacent ASes) that the table of the collector had at the start of the day, one for each
    line, as scripts/rib-links.mjs of ASPA Explorer writes them from the table dump. A link that is in the table is not forged,
    whether CAIDA knows it or not: on the first day 89% of the FI candidates and 48% of the PS candidates were such links.
    Without the files every missing link is a candidate, as before."""
    links = set()
    for f in sorted(glob.glob(pattern)):
        with open(f) as fh:
            for line in fh:
                p = line.split()
                if len(p) == 2 and p[0].isdigit() and p[1].isdigit():
                    a, b = int(p[0]), int(p[1])
                    links.add((a, b))
                    links.add((b, a))
    return links


def check_forged_link(rec, rel, known=frozenset()):
    """Candidate of AS path manipulation: a link of the path that the CAIDA relationships do not know, nor the table of the
    collector at the start of the day (`known`, X-11).

    FI (forged origin injection): the link between the last AS and the origin, as if the announcer were connected to the
    prefix owner. PS (path shortening): another link, as if ASes in between had been removed. A candidate only: CAIDA
    infers its links from the same kind of data, so it lacks real ones (new links, links between small networks), and every one
    of them is a false positive. Disabled without relationships."""
    path = rec.get("compressed_path") or []
    if not rel or len(path) < 2:
        return False, {}
    first = None
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        if (a, b) not in rel and (a, b) not in known:
            if i == len(path) - 2:
                return True, _forged(rec, path, "FI", a, b)
            if first is None:
                first = (a, b)
    if first:
        return True, _forged(rec, path, "PS", *first)
    return False, {}


def _forged(rec, path, asm_type, a, b):
    names = {"FI": "Forged origin candidate (link not in CAIDA)", "PS": "Path shortening candidate (link not in CAIDA)"}
    return {"anomaly": names[asm_type], "asm_type": asm_type, "link": [a, b], "path": path}


# --- X-4: what the registries say ---

def load_delegations(pattern):
    """The ranges that the RIRs list as available or reserved (the delegated-*-extended files): sorted starts and (end, status).
    -> {"asn": ..., 4: ..., 6: ...}, each a (starts, ends, statuses) triple; empty without files."""
    rows = {"asn": [], 4: [], 6: []}
    for path in sorted(glob.glob(pattern)):
        with open(path, "rt", encoding="utf-8", errors="replace") as f:
            for line in f:
                p = line.split("|")
                if len(p) < 7 or p[6].strip() not in ("available", "reserved"):
                    continue
                status = p[6].strip()
                try:
                    if p[2] == "asn":
                        rows["asn"].append((int(p[3]), int(p[3]) + int(p[4]) - 1, status))
                    elif p[2] == "ipv4":
                        start = int(ipaddress.IPv4Address(p[3]))
                        rows[4].append((start, start + int(p[4]) - 1, status))
                    elif p[2] == "ipv6":
                        start = int(ipaddress.IPv6Address(p[3]))
                        rows[6].append((start, start + (1 << (128 - int(p[4]))) - 1, status))
                except ValueError:
                    continue
    out = {}
    for k, v in rows.items():
        v.sort()
        out[k] = ([r[0] for r in v], [r[1] for r in v], [r[2] for r in v])
    return out


def _listed(table, lo, hi):
    starts, ends, statuses = table
    i = bisect.bisect_right(starts, lo) - 1
    if i >= 0 and hi <= ends[i]:
        return statuses[i]
    return None


def check_unallocated_prefix(rec, reg):
    """Candidate of an abusive hijack (PRH-AB): a prefix that is not for the public Internet (private, documentation, ...) or that
    the RIRs list as available or reserved. Needs no ROA, which is what the ROA check of incident.py lacks."""
    net = net_of(rec.get("prefix") or "")
    if net is None:
        return False, {}
    kind = None
    if not net.is_global:
        kind = "bogon"
    elif reg:
        kind = _listed(reg[net.version], int(net.network_address), int(net.broadcast_address))
    if not kind:
        return False, {}
    return True, {"anomaly": "Prefix in space that is not allocated (abusive hijack candidate)", "prh_type": "AB",
                  "kind": kind, "prefix": rec["prefix"], "actual_origin": rec.get("origin")}


def _asn_kind(asn, reg):
    for lo, hi in PRIVATE_ASN:
        if lo <= asn <= hi:
            return "private"
    for lo, hi in RESERVED_ASN:
        if lo <= asn <= hi:
            return "reserved"
    return _listed(reg["asn"], asn, asn) if reg else None


def check_path_asns(rec, reg):
    """Candidate of AS path manipulation by the AS numbers of the path (no relationships needed):
    PE (poisoning): an AS number that comes back after another one, which is the shape of poisoning (and a loop that routers drop),
    or that no registry has allocated; EX (extension): a private AS number. A candidate only."""
    path = rec.get("compressed_path") or []
    if len(path) < 2:
        return False, {}
    seen = set()
    for asn in path:
        if asn in seen:
            return True, {"anomaly": "Poisoning candidate (an AS comes back in the path)", "asm_type": "PE", "asn": asn, "asn_kind": "loop", "path": path}
        seen.add(asn)
    for asn in path:
        kind = _asn_kind(asn, reg)
        if kind == "private":
            return True, {"anomaly": "Extension candidate (private AS number in the path)", "asm_type": "EX", "asn": asn, "asn_kind": kind, "path": path}
        if kind:
            return True, {"anomaly": "Poisoning candidate (AS number that is not allocated)", "asm_type": "PE", "asn": asn, "asn_kind": kind, "path": path}
    return False, {}


# --- X-5: deaggregation by scale, and the volatility of a prefix and of an origin ---

def check_deaggregation_scale(rec, state, epoch):
    """The more specifics of one origin under one aggregate, counted for a UTC day: excessive deaggregation (DEG-XS: careless,
    exploitative or malicious, the intent is not visible) and flood (DEG-FF), and a jump of the count of an origin against its
    median of the last days. Same origin only (the divergent origin is check_deaggregation of incident.py). -> list of details."""
    origin = rec.get("origin")
    if rec.get("type") != "A" or origin is None or epoch == 0:
        return []
    net = net_of(rec.get("prefix") or "")
    if net is None:
        return []
    v = net.version
    if not DEG_BUCKET[v] < net.prefixlen <= DEG_LIMIT[v]:
        return []
    day = utc_day(epoch)
    peer = rec.get("peer")
    # the aggregate as a number: its string is made only when something is reported
    aggregate = (v, int(net.network_address) >> ((32 if v == 4 else 128) - DEG_BUCKET[v]))
    buckets = state.setdefault("deg_scale", {})
    b = buckets.get((origin, aggregate))
    if b is None or b["day"] != day:
        b = buckets[(origin, aggregate)] = {"day": day, "p": {}, "n": 0, "fired": 0}
    prefix = rec["prefix"]
    first = b["p"].get(prefix)
    if first is None:
        b["p"][prefix] = peer
        if DEG_MIN_PEERS > 1:
            return []
    elif first == 0 or first == peer:
        return []
    else:
        b["p"][prefix] = 0
    b["n"] += 1
    origins = state.setdefault("deg_origin", {})
    o = origins.get(origin)
    if o is None or o["day"] != day:
        _roll_origin(state, origin, o)
        o = origins[origin] = {"day": day, "n": 0, "n4": 0, "fired": 0}
    o["n"] += 1
    if v == 4:
        o["n4"] += 1
    out = []
    base = {"origin": origin, "aggregate": str(net.supernet(new_prefix=DEG_BUCKET[v])), "more_specifics": b["n"], "origin_more_specifics": o["n"]}
    if v == 6 and b["n"] >= DEG_FLOOD_V6 and not b["fired"] & 2:
        b["fired"] |= 2
        out.append({"anomaly": "Fragmentation flood candidate", "deg_type": "flood", **base})
    elif v == 4 and o["n4"] >= DEG_FLOOD_V4_ORIGIN and not o["fired"] & 2:
        o["fired"] |= 2
        out.append({"anomaly": "Fragmentation flood candidate", "deg_type": "flood", **base})
    if b["n"] >= DEG_EXCESS and not b["fired"] & 1 and not out:
        b["fired"] |= 1
        out.append({"anomaly": "Excessive deaggregation candidate", "deg_type": "excessive", **base})
    history = state.get("deg_hist", {}).get(origin, [])
    if len(history) >= DEG_JUMP_MIN_DAYS and not o["fired"] & 4 and not out:
        if o["n"] >= max(DEG_JUMP_MIN, DEG_JUMP_FACTOR * statistics.median(history)):
            o["fired"] |= 4
            out.append({"anomaly": "Jump in the more specifics of an origin", "deg_type": "jump", "median_before": statistics.median(history), **base})
    return out


def _roll_origin(state, origin, o):
    if o is not None:
        history = state.setdefault("deg_hist", {}).setdefault(origin, [])
        history.append(o["n"])
        del history[:-DEG_HISTORY_DAYS]


def check_slow_convergence(rec, state, epoch):
    """VOL-DC: a prefix that keeps receiving updates, from any peer, with no pause of VOL_DC_GAP seconds, for VOL_DC_SECONDS
    or more and with VOL_DC_UPDATES updates or more: the system does not settle."""
    prefix = rec.get("prefix")
    if not prefix or epoch == 0:
        return False, {}
    bursts = state.setdefault("bursts", {})
    b = bursts.get(prefix)
    if b is None or epoch - b[1] > VOL_DC_GAP:
        bursts[prefix] = (epoch, epoch, 1, 0)
        return False, {}
    start, _, n, fired = b
    n += 1
    if not fired and epoch - start >= VOL_DC_SECONDS and n >= VOL_DC_UPDATES:
        bursts[prefix] = (start, epoch, n, 1)
        return True, {"anomaly": "Delayed convergence candidate", "vol_type": "DC", "burst_seconds": epoch - start, "updates": n, "gap_seconds": VOL_DC_GAP}
    bursts[prefix] = (start, epoch, n, fired)
    return False, {}


def check_amplified_churn(rec, state, epoch):
    """VOL-AC: an origin whose prefixes give a very large number of updates in a short window, seen from many peers."""
    origin = rec.get("origin")
    if rec.get("type") != "A" or origin is None or epoch == 0:
        return False, {}
    windows = state.setdefault("churn", {})
    w = windows.get(origin)
    if w is None or epoch - w["start"] >= VOL_AC_WINDOW:
        w = windows[origin] = {"start": epoch, "n": 0, "prefixes": set(), "peers": set(), "fired": 0}
    w["n"] += 1
    if len(w["prefixes"]) < VOL_AC_PREFIXES:
        w["prefixes"].add(rec["prefix"])
    w["peers"].add(rec.get("peer"))
    if not w["fired"] and w["n"] >= VOL_AC_UPDATES and len(w["prefixes"]) >= VOL_AC_PREFIXES and len(w["peers"]) >= VOL_AC_PEERS:
        w["fired"] = 1
        return True, {"anomaly": "Amplified churn candidate", "vol_type": "AC", "origin": origin, "updates": w["n"],
                      "window_seconds": VOL_AC_WINDOW, "peers": len(w["peers"])}
    return False, {}


def collect_garbage(state, epoch):
    """Drop what is stale: the bursts, the windows of the churn and the counts of the days that ended."""
    for key in [k for k, b in state.get("bursts", {}).items() if epoch - b[1] > VOL_DC_GAP]:
        del state["bursts"][key]
    for key in [k for k, w in state.get("churn", {}).items() if epoch - w["start"] >= VOL_AC_WINDOW]:
        del state["churn"][key]
    day = utc_day(epoch)
    for key in [k for k, b in state.get("deg_scale", {}).items() if b["day"] != day]:
        del state["deg_scale"][key]
    for origin in [k for k, o in state.get("deg_origin", {}).items() if o["day"] != day]:
        _roll_origin(state, origin, state["deg_origin"].pop(origin))
    for peer in [k for k, v in state.get("peer_state", {}).items() if epoch - v[0] > SESSION_EVENT_SECONDS]:
        del state["peer_state"][peer]


# --- X-6: the session ---

def atr_type(code, subcode):
    """A NOTIFICATION with the code 3 (UPDATE message error) ends a session because of an update: RFC 7606 asks to treat such
    an update as withdrawn instead, so a reset of this kind is an error-handling case (EH); when the subcode says that the
    fault is in an attribute it is a malformed-attribute case (MA). Any other NOTIFICATION is an ordinary end of session."""
    if code != 3:
        return None
    return "MA" if subcode in ATR_ATTRIBUTE_SUBCODES else "EH"


def session_event(rec, state, epoch):
    """A record of the session (type N: NOTIFICATION, type S: change of state of the peer). -> details of an ATR incident or None."""
    if rec.get("type") == "S":
        state.setdefault("peer_state", {})[session_of(rec)] = (epoch, rec.get("state"))
        return None
    kind = atr_type(rec.get("code"), rec.get("subcode"))
    if not kind:
        return None
    return {"anomaly": "Session ended by an UPDATE message error", "atr_type": kind, "peer": rec.get("peer"),
            "collector": rec.get("collector"), "code": rec.get("code"), "subcode": rec.get("subcode")}


def session_note(state, session, epoch):
    """The change of state of this session (session_of) in the last SESSION_EVENT_SECONDS, if any (a mass withdrawal that
    follows it is an ordinary reset of the session)."""
    v = state.get("peer_state", {}).get(session)
    return v[1] if v and 0 <= epoch - v[0] <= SESSION_EVENT_SECONDS else None
