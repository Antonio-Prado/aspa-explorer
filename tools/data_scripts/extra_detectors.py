"""Detectors that are not in the original incident.py: they exist only in the copy of ASPA Explorer.

They were added on 2026-10-22 and are described in CROSS-CHECK.md (items X-1 and X-3 of the project data_scripts).
The incident files keep the same fields; the new detectors add details and the incident type ASM.
"""


def rlk_type(in_rel, out_rel):
    """Type of a valley-free violation, in the terms of the survey (Servillo et al., Sec. III), from the two relationships
    around the leaking AS: in_rel is the one between the AS that sent the route and the leaker (p2c: the sender is its provider),
    out_rel the one between the leaker and the AS that received it (c2p: the receiver is its provider).

    UL (upward leak): the route goes to a provider. LL (lateral leak): it goes to a peer. The survey words them with some
    overlap (UL also "to peers"); this is our reading, based on the receiver. A leak towards a customer is not flagged at all."""
    return "UL" if out_rel == "c2p" else "LL"


def check_forged_link(rec, rel):
    """Candidate of AS path manipulation: a link of the path that the CAIDA relationships do not know.

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
        if (a, b) not in rel:
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
