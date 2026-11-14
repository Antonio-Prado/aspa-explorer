"""Checks that mrt2records.py writes the records of mrtparse. Each file is read both ways and the two outputs must be the
same; then its first entries are read one at a time, one in ten with bytes changed at random (in the body, at its end, in
the type), and each must give what mrtparse gives, or an M record where mrtparse stops or does not end.
usage: check_mrt2records.py [--entries N] [--rounds N] FILE.gz ...     (run it with `python -I`, as mrt2records.py)"""
import argparse, io, json, os, random, signal, sys
from struct import unpack_from
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mrtparse
import mrt2records as m


def damaged(e, rng):
    e = bytearray(e)
    how = rng.random()
    if how < 0.75 and len(e) > 12:   # a byte of the body
        e[rng.randrange(12, len(e))] = rng.randrange(256)
    elif how < 0.9 and len(e) > 13:  # some bytes dropped from the end, the length in the header put right
        del e[-rng.randrange(1, min(len(e) - 12, 40)):]
        e[8:12] = (len(e) - 12).to_bytes(4, "big")
    else:                            # the subtype
        e[7] = rng.randrange(12)
    return bytes(e)


def reference(e, when):
    out = []
    signal.setitimer(signal.ITIMER_REAL, 10)
    try:
        m.entries(mrtparse.Reader(io.BytesIO(e)), out)
    except Exception:
        out = [json.dumps({"type": "M", "collector": "rrc00", "timestamp": when, "length": len(e) - 12}) + "\n"]
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--entries", type=int, default=20000)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    signal.signal(signal.SIGALRM, m.stuck)
    bad = 0
    for f in a.files:
        outs = []
        for only in (True, False):
            buf = io.BytesIO()
            n, left = m.convert(f, buf, only)
            outs.append(buf.getvalue())
        same = outs[0] == outs[1]
        bad += not same
        print(f, "same" if same else "DIFFERENT", n, "records;", left, "entries left to mrtparse", flush=True)
        raw = m.read(f)
        for r in range(a.rounds):
            rng = random.Random(f"{os.path.basename(f)}-{r}")
            p = count = changed = differ = fast = 0
            while len(raw) - p >= 12 and count < a.entries:
                q = p + 12 + unpack_from(">I", raw, p + 8)[0]
                e, p, count = raw[p:q], q, count + 1
                if unpack_from(">H", e, 4)[0] not in (16, 17):
                    continue
                if rng.random() < 0.1:
                    e, changed = damaged(e, rng), changed + 1
                when = m.stamp(unpack_from(">I", e, 0)[0])
                want, got = reference(e, when), []
                fast += not m.one(e, 0, len(e), when, got)
                if want != got:
                    differ += 1
                    if differ <= 3:
                        print("   ", e.hex(), want[:2], got[:2])
            bad += differ
            print(f"  round {r}: {count} entries, {changed} changed, {count - fast} left to mrtparse:",
                  f"{differ} DIFFERENT" if differ else "all the same", flush=True)
    sys.exit(1 if bad else 0)
