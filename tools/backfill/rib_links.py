"""The links (pairs of adjacent ASes, prepending removed) of a table dump of a collector, one for each line: what
scripts/rib-links.mjs writes, for a host without Node.js (the same reading as scripts/mrt.mjs: the routes whose AS path is
a plain AS_SEQUENCE of 4-byte numbers, in the unicast tables of a TABLE_DUMP_V2 file).
usage: rib_links.py DUMP OUT   (DUMP gzip or bzip2)"""
import bz2, gzip, os, struct, sys

TABLE_DUMP_V2 = 13
PEER_INDEX_TABLE, RIB4, RIB6, RIB4_ADDPATH, RIB6_ADDPATH = 1, 2, 4, 8, 10
MAX_PATH = 512


def as_path(buf, pos, end):
    """The AS numbers of an AS_PATH attribute, or None when it has anything but AS_SEQUENCE segments or does not fit."""
    out = []
    while pos + 2 <= end:
        kind, count = buf[pos], buf[pos + 1]
        pos += 2
        if kind != 2 or pos + count * 4 > end or len(out) + count > MAX_PATH:
            return None
        out.extend(struct.unpack_from(f">{count}I", buf, pos))
        pos += count * 4
    return out


def path_of_attributes(buf, pos, end):
    while pos + 3 <= end:
        flags, kind = buf[pos], buf[pos + 1]
        if flags & 0x10:
            if pos + 4 > end:
                return None
            length, hdr = struct.unpack_from(">H", buf, pos + 2)[0], 4
        else:
            length, hdr = buf[pos + 2], 3
        if pos + hdr + length > end:
            return None
        if kind == 2:
            return as_path(buf, pos + hdr, pos + hdr + length)
        pos += hdr + length
    return None


def links(stream):
    seen, entries = {}, 0
    while True:
        head = stream.read(12)
        if len(head) < 12:
            break
        _, kind, subtype, length = struct.unpack(">IHHI", head)
        buf = stream.read(length)
        if len(buf) < length:
            break
        if kind != TABLE_DUMP_V2 or subtype not in (RIB4, RIB6, RIB4_ADDPATH, RIB6_ADDPATH):
            continue
        head_len = 12 if subtype in (RIB4_ADDPATH, RIB6_ADDPATH) else 8
        pos = 4
        plen = buf[pos]
        pos += 1 + (plen + 7) // 8
        count = struct.unpack_from(">H", buf, pos)[0]
        pos += 2
        for _ in range(count):
            if pos + head_len > length:
                break
            alen = struct.unpack_from(">H", buf, pos + head_len - 2)[0]
            path = path_of_attributes(buf, pos + head_len, pos + head_len + alen)
            pos += head_len + alen
            if not path:
                continue
            entries += 1
            prev = -1
            for a in path:
                if a == prev:
                    continue
                if prev >= 0:
                    seen[f"{prev} {a}" if prev < a else f"{a} {prev}"] = None
                prev = a
    return seen, entries


if __name__ == "__main__":
    dump, out = sys.argv[1:3]
    with (bz2.open if dump.endswith(".bz2") else gzip.open)(dump, "rb") as f:
        seen, entries = links(f)
    with open(out + ".tmp", "w") as f:
        f.write("\n".join(seen) + "\n")
    os.replace(out + ".tmp", out)
    print(f"{len(seen)} links from {entries} routes")
