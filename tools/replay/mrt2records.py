"""RIPE RIS update files (MRT) -> the records of record.py/stream.py: A and W, S for a change of state of a session, and M for an
entry that the parser could not read in full. Needs `mrtparse` (`pip install -r requirements.txt` in this folder, which pins it); run it with `python -I`.
usage: mrt2records.py [--mrtparse] OUT.jsonl.gz FILE.gz ...

An UPDATE of a four-byte AS session with nothing odd in it (nearly all of a RIS file) is read here, byte by byte, which is
many times faster than mrtparse. Everything else is left to mrtparse, one entry at a time: the other kinds of entry, and any
UPDATE where a length does not add up, a prefix has bits after its length or is there twice, or an attribute is one that
mrtparse reads in a way of its own. So the records are those of mrtparse in every case but one: an entry that mrtparse cannot get out of, where it would stop or
never end, is an M record. `--mrtparse` reads all of it with mrtparse, to compare the two (check_mrt2records.py does it)."""
import bz2, gzip, io, json, signal, socket, sys
from datetime import datetime, timezone
from struct import unpack_from
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


def entries(reader, out):
    """The records of the entries that mrtparse reads, as lines added to out."""
    for entry in reader:
        d = entry.data
        t = int(first(d["type"]))
        if t not in (16, 17):
            continue
        st = int(first(d["subtype"]))
        epoch = int(first(d["timestamp"]))
        if "peer_as" not in d:
            # an entry that the parser could not read in full (a message that does not parse): kept as a record of its own
            out.append(json.dumps({"type": "M", "collector": "rrc00", "timestamp": stamp(epoch), "length": d.get("length")}) + "\n")
            continue
        peer = int(d["peer_as"])
        if st in (0, 5):        # state change
            ns = d.get("new_state") or {}
            out.append(json.dumps({"type": "S", "collector": "rrc00", "timestamp": stamp(epoch), "peer": peer,
                                   "state": str(list(ns.values())[0]).lower() if ns else None}) + "\n")
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
            out.append(json.dumps({"type": "W", "collector": "rrc00", "timestamp": stamp(epoch), "prefix": p, "peer": peer,
                                   "origin": None, "flag": None, "compressed_path": None}) + "\n")
        if ann and path and not has_set:
            cp, flag = compress(path)
            for p in ann:
                out.append(json.dumps({"type": "A", "collector": "rrc00", "timestamp": stamp(epoch), "prefix": p, "peer": peer,
                                       "origin": cp[-1], "flag": flag, "compressed_path": cp}) + "\n")


class Odd(Exception):
    """An entry that is left to mrtparse."""


CACHE = 2_000_000                  # entries kept in each of the three tables below before it is emptied
PFX4, PFX6, PATHS = {}, {}, {}     # the bytes of a prefix -> its text; the bytes of an AS_PATH -> (has a set, end of the A line)
PAD = bytes(16)
# the attributes that mrtparse reads as a fixed number of bytes, whatever their length says: the two must agree
FIXED = {1: (1,), 4: (4,), 5: (4,), 7: (6, 8), 9: (4,), 18: (8,)}
MULTIPLE = {8: 4, 10: 4, 16: 8, 32: 12}     # read in steps of this many bytes
W_HEAD = '{"type": "W", "collector": "rrc00", "timestamp": "'
A_HEAD = '{"type": "A", "collector": "rrc00", "timestamp": "'
W_TAIL = ', "origin": null, "flag": null, "compressed_path": null}\n'


def nlri(buf, p, end, v6):
    """The prefixes between p and end, when they fill it exactly and none is odd."""
    cache, longest = (PFX6, 128) if v6 else (PFX4, 32)
    out = []
    while p < end:
        plen = buf[p]
        q = p + 1 + ((plen + 7) >> 3)
        if plen > longest or q > end:
            raise Odd
        key = buf[p:q]
        text = cache.get(key)
        if text is None:
            if plen & 7 and key[-1] & (0xff >> (plen & 7)):       # bits after the length
                raise Odd
            if len(cache) >= CACHE:
                cache.clear()
            if v6:
                text = f"{socket.inet_ntop(socket.AF_INET6, key[1:] + PAD[:17 - len(key)])}/{plen}"
            else:
                text = f"{socket.inet_ntop(socket.AF_INET, key[1:] + PAD[:5 - len(key)])}/{plen}"
            cache[key] = text
        out.append(text)
        p = q
    if len(out) > 1 and len(set(out)) != len(out):                # mrtparse then reads them again as ADD-PATH
        raise Odd
    return out


def segments(key, keep):
    """The AS numbers of an AS_PATH or AS4_PATH with four-byte numbers -> (has a set, the numbers)."""
    asns, sets, r, size = [], False, 0, len(key)
    while r < size:
        if size - r < 2:
            raise Odd
        nxt = r + 2 + 4 * key[r + 1]
        if nxt > size:
            raise Odd
        if key[r] != 2:
            sets = True
        if keep:
            asns += unpack_from(f">{key[r + 1]}I", key, r + 2)
        r = nxt
    return sets, asns


def update(buf, p, end, when, out):
    """A BGP4MP_MESSAGE_AS4 entry, from the byte after the MRT header to its end -> its lines added to out."""
    if end - p < 12:
        raise Odd
    peer, afi = unpack_from(">I6xH", buf, p)
    if afi == 1:
        p += 20
    elif afi == 2:
        p += 44
    else:
        raise Odd
    if end - p < 19:
        raise Odd
    length, kind = unpack_from(">HB", buf, p + 16)
    if length != end - p:
        raise Odd
    if kind == 4:                  # KEEPALIVE
        return
    if kind != 2 or length < 23:
        raise Odd
    p += 19
    aend = p + 2 + unpack_from(">H", buf, p)[0]
    if aend + 2 > end:
        raise Odd
    withdrawn = nlri(buf, p + 2, aend, False)
    p = aend + 2
    aend = p + unpack_from(">H", buf, aend)[0]
    if aend > end:
        raise Odd
    more, tail, has_set = [], None, False
    while p < aend:
        if aend - p < 3:
            raise Odd
        kind = buf[p + 1]
        if buf[p] & 0x10:
            if aend - p < 4:
                raise Odd
            q = p + 4 + unpack_from(">H", buf, p + 2)[0]
            p += 4
        else:
            q = p + 3 + buf[p + 2]
            p += 3
        if q > aend:
            raise Odd
        n = q - p
        if kind == 2:
            key = buf[p:q]
            hit = PATHS.get(key)
            if hit is None:
                sets, asns = segments(key, True)
                if asns:
                    cp, flag = compress(asns)
                    hit = (sets, f', "origin": {cp[-1]}, "flag": {flag}, "compressed_path": {cp}}}\n')
                else:
                    hit = (sets, None)
                if len(PATHS) >= CACHE:
                    PATHS.clear()
                PATHS[key] = hit
            has_set = has_set or hit[0]
            tail = hit[1]
        elif kind == 14:
            if n < 5:
                raise Odd
            afi, safi, hop = unpack_from(">HBB", buf, p)
            if safi != 1 or not (afi == 1 and hop == 4 or afi == 2 and hop in (16, 32)) or p + 5 + hop > q:
                raise Odd
            more += nlri(buf, p + 5 + hop, q, afi == 2)
        elif kind == 15:
            if n < 3:
                raise Odd
            afi, safi = unpack_from(">HB", buf, p)
            if safi != 1 or afi not in (1, 2):
                raise Odd
            withdrawn += nlri(buf, p + 3, q, afi == 2)
        elif kind in FIXED:
            if n not in FIXED[kind]:
                raise Odd
        elif kind in MULTIPLE:
            if n % MULTIPLE[kind]:
                raise Odd
        elif kind == 17:
            segments(buf[p:q], False)
        elif kind in (26, 128):    # AIGP, ATTR_SET
            raise Odd
        p = q
    ann = nlri(buf, aend, end, False) + more
    for text in withdrawn:
        out.append(f'{W_HEAD}{when}", "prefix": "{text}", "peer": {peer}{W_TAIL}')
    if ann and tail and not has_set:
        for text in ann:
            out.append(f'{A_HEAD}{when}", "prefix": "{text}", "peer": {peer}{tail}')


def read(path):
    with open(path, "rb") as f:
        magic = f.read(3)
    if magic.startswith(b"\x42\x5a\x68"):
        return bz2.BZ2File(path, "rb").read()
    if magic.startswith(b"\x1f\x8b"):
        return gzip.GzipFile(path, "rb").read()
    return open(path, "rb").read()


class Stuck(Exception):
    """mrtparse has been on one entry for too long."""


def stuck(*_):
    raise Stuck


def one(buf, p, q, when, out):
    """The entry of type BGP4MP between p and q -> its lines added to out; True when it was left to mrtparse.
    mrtparse does not get out of some broken entries (an error of its own, or a loop without end, as on an AIGP attribute
    of length zero): such an entry is an M record, as any other that could not be read in full."""
    mark = len(out)
    try:
        if buf[p + 4:p + 8] != b"\x00\x10\x00\x04":     # BGP4MP, BGP4MP_MESSAGE_AS4
            raise Odd
        update(buf, p + 12, q, when, out)
        return False
    except Odd:
        del out[mark:]
    signal.setitimer(signal.ITIMER_REAL, 10)
    try:
        entries(mrtparse.Reader(io.BytesIO(buf[p:q])), out)
    except Exception:
        del out[mark:]
        out.append(json.dumps({"type": "M", "collector": "rrc00", "timestamp": when, "length": q - p - 12}) + "\n")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return True


def whole(buf):
    """True when the file is a row of whole entries. One that ends in the middle of an entry is read by mrtparse alone:
    what it makes of the end depends on the entries before."""
    p, size = 0, len(buf)
    while size - p >= 12:
        p += 12 + unpack_from(">I", buf, p + 8)[0]
    return p == size


def convert(path, out, only_mrtparse=False):
    """-> (records, entries left to mrtparse)"""
    lines, n, left = [], 0, 0
    buf = b"" if only_mrtparse else read(path)
    if only_mrtparse or not whole(buf):
        entries(mrtparse.Reader(path), lines)
        out.write("".join(lines).encode())
        return len(lines), 0
    p, size, epoch, when = 0, len(buf), None, None
    while p < size:
        ts, t, length = unpack_from(">IH2xI", buf, p)
        q = p + 12 + length
        if t in (16, 17):          # the entries of any other type give no record
            if ts != epoch:
                epoch, when = ts, stamp(ts)
            left += one(buf, p, q, when, lines)
        p = q
        if len(lines) >= 100_000:
            out.write("".join(lines).encode())
            n += len(lines)
            lines.clear()
    out.write("".join(lines).encode())
    return n + len(lines), left


if __name__ == "__main__":
    args = sys.argv[1:]
    only = args[:1] == ["--mrtparse"]
    if only:
        args = args[1:]
    total = left = 0
    signal.signal(signal.SIGALRM, stuck)
    # level 1: the file is read once by incident.py and deleted; the highest level takes longer than the reading of the MRT
    with gzip.open(args[0], "wb", compresslevel=1) as out:
        for f in args[1:]:
            n, m = convert(f, out, only)
            total += n
            left += m
    print(args[0], total, "records;", left, "entries left to mrtparse")
