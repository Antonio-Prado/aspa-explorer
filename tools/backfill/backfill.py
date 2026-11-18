"""The incidents of the days before the recorder was started, from the archive of RIPE RIS: for each day of a block the
update files of rrc00 are downloaded and turned into records (tools/replay/mrt2records.py), incident.py reads them with the
relationships, the ROAs, the delegation files and the table of that day, and its incident file is kept compressed in
BASE/archive. The days of a block are read in order, with the state of incident.py kept from one to the next as in the
nightly job; a block starts with an empty state, so it reads some days before its first one only to fill the state
(the incidents written while it does are thrown away). The blocks can be run in any order: the newest first, to go back.

usage: backfill.py BASE FROM TO [--warmup N] [--until YYYY-MM-DDTHH:MM] [--limit-files N] [--collector NAME] [--chunk-hours N]
  BASE    working directory (code/ with incident.py, extra_detectors.py, mrt2records.py, rib-links.mjs, mrt.mjs; venv/ with mrtparse;
          with code/incident-rs, tools/incident-rs built for the host, the incidents are found by it, and code/export_state.py
          brings over the state of a block that incident.py began)
  FROM TO first and last day of the block (YYYY-MM-DD, UTC)
  --warmup N     days read before FROM to fill the state (default 2)
  --until T      a last, partial day after TO: the update files before T (to meet the first record of the recorder)
  --limit-files N  only the first N update files of each day (a test)
  --collector NAME another collector of RIPE RIS than rrc00 (rrc06, rrc10, ...): its update files and its table; each
                   collector has a working directory (BASE) of its own
  --chunk-hours N  read each day in parts of N hours (default 24, or BACKFILL_CHUNK_HOURS): the update files and the
                   records of one part are on the disk at a time, which a small disk needs (a day of a busy collector
                   takes 2 GB at once); the incidents are the same as in one reading of the day
BACKFILL_DROP_DONE_WORK=1 removes the working files of a block when it is done (keep them for a block to be extended).
A day that is done is not read again: a block that was stopped starts again from the day it was reading. `touch BASE/STOP`
ends every block after the day it is reading. Each day adds a line to BASE/days.jsonl (incidents, files, notes, seconds).
The downloaded files come from outside: they stay under BASE/blocks/<block>/tmp, and the parser runs with python -I."""
import argparse, bz2, gzip, json, lzma, os, shutil, subprocess, sys, time, urllib.request, urllib.error
from datetime import date, datetime, timedelta, timezone

UA = "aspa-explorer-backfill"
RIS = "https://data.ris.ripe.net"
COLLECTOR = "rrc00"                # --collector NAME: another collector of RIPE RIS, in a working directory of its own
CAIDA = "https://publicdata.caida.org/datasets/as-relationships/serial-2"
ROAS = "https://ftp.ripe.net/rpki"
TALS = ("afrinic", "apnic", "arin", "lacnic", "ripencc")
MIN_FREE_MB = int(os.environ.get("BACKFILL_MIN_FREE_MB", "1200"))   # a day is not begun with less free space than this


def log(*a):
    print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), *a, flush=True)


def fetch(url, path, tries=4):
    """-> True when the file is there, False when the server has none (404); other errors are tried again, then raised."""
    for i in range(tries):
        r = subprocess.run(["curl", "-sS", "-f", "-L", "-A", UA, "--max-time", "1800", "-o", path + ".part", url],
                           capture_output=True, text=True)
        if r.returncode == 0:
            os.replace(path + ".part", path)
            return True
        if os.path.exists(path + ".part"):
            os.remove(path + ".part")
        if "404" in r.stderr:            # curl says 22, or 56 when the server ends the answer early: either way it has no such file
            return False
        time.sleep(20 * (i + 1))
    raise RuntimeError(f"{url}: {r.stderr.strip()}")


def plain(path):
    """The bytes of a file that may be gzip, bzip2 or xz, told by its first bytes."""
    with open(path, "rb") as f:
        head = f.read(6)
    op = gzip.open if head[:2] == b"\x1f\x8b" else bz2.open if head[:3] == b"BZh" else lzma.open if head == b"\xfd7zXZ\x00" else open
    with op(path, "rb") as f:
        return f.read()


def delegation_urls(rir, d, this_year):
    n = f"delegated-{rir}-extended-{d:%Y%m%d}"
    if rir == "ripencc":
        return [f"https://ftp.ripe.net/pub/stats/ripencc/{d:%Y}/{n}.bz2", f"https://ftp.ripe.net/pub/stats/ripencc/{n}"]
    if rir == "apnic":
        return [f"https://ftp.ripe.net/pub/stats/apnic/{d:%Y}/{n}.gz", f"https://ftp.ripe.net/pub/stats/apnic/{n}"]
    if rir == "afrinic":
        return [f"https://ftp.ripe.net/pub/stats/afrinic/{d:%Y}/{n}", f"https://ftp.ripe.net/pub/stats/afrinic/{n}"]
    if rir == "arin":
        return [f"https://ftp.arin.net/pub/stats/arin/archive/{d:%Y}/{n}.gz", f"https://ftp.arin.net/pub/stats/arin/{n}"]
    return [f"https://ftp.lacnic.net/pub/stats/lacnic/archive/{d:%Y}/{n}", f"https://ftp.lacnic.net/pub/stats/lacnic/{n}"]


def day_inputs(base, work, tmp, d):
    """The relationships, the ROAs, the delegation files and the links of the table of the day, in the places where incident.py reads them."""
    notes = []
    # CAIDA: the file of the month of the day, or the newest one before it
    cache = os.path.join(base, "cache")
    os.makedirs(cache, exist_ok=True)
    m = d.replace(day=1)
    for _ in range(6):
        p = os.path.join(cache, f"{m:%Y%m%d}.as-rel2.txt.bz2")
        if os.path.exists(p) or fetch(f"{CAIDA}/{m:%Y%m%d}.as-rel2.txt.bz2", p):
            break
        m = (m - timedelta(days=1)).replace(day=1)
    else:
        raise RuntimeError(f"no CAIDA relationships for {d}")
    if m != d.replace(day=1):
        notes.append(f"caida {m:%Y-%m}")
    link = os.path.join(work, "20260901.as-rel.txt.bz2")      # CAIDA_FILE of incident.py
    if os.path.lexists(link):
        os.remove(link)
    os.symlink(p, link)

    # the ROAs: the daily export of the five trust anchors that RIPE NCC keeps, as the JSON that incident.py reads. They are
    # written as they are read (a million of them, kept as a list, stayed in the memory of this process for the whole day)
    n_roas, missing = 0, []
    os.makedirs(os.path.join(work, "roas"), exist_ok=True)
    roa_tmp = os.path.join(work, "roas", "current.json.xz.tmp")
    with lzma.open(roa_tmp, "wt", encoding="utf-8", preset=1) as out:
        out.write('{"roas": [')
        for tal in TALS:
            got = False
            for back in range(8):
                x = d - timedelta(days=back)
                p = os.path.join(tmp, f"roas-{tal}.csv.xz")
                if fetch(f"{ROAS}/{tal}.tal/{x:%Y/%m/%d}/roas.csv.xz", p):
                    try:
                        with lzma.open(p, "rt", encoding="utf-8", errors="replace") as f:
                            rows = f.read().splitlines()[1:]
                    except (lzma.LZMAError, EOFError):
                        continue
                    for row in rows:
                        c = row.split(",")
                        if len(c) >= 4 and c[1].startswith("AS"):
                            out.write((", " if n_roas else "") + json.dumps({"asn": c[1], "prefix": c[2], "maxLength": int(c[3]) if c[3].isdigit() else None}))
                            n_roas += 1
                    got = len(rows) > 0
                    del rows
                    if got:
                        if back:
                            notes.append(f"roas {tal} of {x}")
                        break
            if not got:
                missing.append(tal)
        out.write("]}")
    if missing:
        notes.append("no roas of " + " ".join(missing))
    if not n_roas:
        os.remove(roa_tmp)
        raise RuntimeError(f"no ROAs for {d}")
    os.replace(roa_tmp, os.path.join(work, "roas", "current.json.xz"))

    # the delegation files of the five RIRs (a file that is missing: the one of a day before, or the one already there)
    deleg = os.path.join(work, "delegations")
    os.makedirs(deleg, exist_ok=True)
    for rir in TALS:
        got = False
        for back in range(8):
            x = d - timedelta(days=back)
            p = os.path.join(tmp, f"deleg-{rir}")
            if any(fetch(u, p) for u in delegation_urls(rir, x, None)):
                with open(os.path.join(deleg, f"delegated-{rir}-extended.tmp"), "wb") as f:
                    f.write(plain(p))
                os.replace(os.path.join(deleg, f"delegated-{rir}-extended.tmp"), os.path.join(deleg, f"delegated-{rir}-extended"))
                got = True
                if back:
                    notes.append(f"delegations {rir} of {x}")
                break
        if not got:
            notes.append(f"no delegations of {rir}")

    # the links of the table of the collector at the start of the day, for the forged-link detector
    links = os.path.join(work, "links")
    os.makedirs(links, exist_ok=True)
    bview = os.path.join(tmp, "bview.gz")
    if fetch(f"{RIS}/{COLLECTOR}/{d:%Y.%m}/bview.{d:%Y%m%d}.0000.gz", bview):
        # with Node.js the script of the site, without it the same reading in Python (rib_links.py)
        reader = (["node", os.path.join(base, "code", "rib-links.mjs")] if shutil.which("node")
                  else [os.path.join(base, "venv", "bin", "python"), "-I", os.path.join(base, "code", "rib_links.py")])
        r = subprocess.run(reader + [bview, os.path.join(links, f"{COLLECTOR}.txt")], capture_output=True, text=True)
        if r.returncode:
            notes.append("links of the table not read: " + r.stderr.strip()[-200:])
        os.remove(bview)
    else:
        notes.append("no table of the day: the links of before")
    return notes, n_roas


def update_names(d, until=None, limit=None):
    """The update files of the day (or of the part before `until`), as (start, name), five minutes apart."""
    t = datetime(d.year, d.month, d.day)
    end = until or t + timedelta(days=1)
    names = []
    while t < end:
        names.append((t, f"updates.{t:%Y%m%d.%H%M}.gz"))
        t += timedelta(minutes=5)
    return names[:limit] if limit else names


def day_records(base, tmp, d, names, out):
    """Some update files of the day (names from update_names) -> the record file out. -> (files read, files missing)."""
    names = [n for _, n in names]
    dl = os.path.join(tmp, "updates")
    os.makedirs(dl, exist_ok=True)
    cfg = os.path.join(tmp, "curl.cfg")
    for attempt in range(4):
        todo = [n for n in names if not os.path.exists(os.path.join(dl, n))]
        if not todo:
            break
        with open(cfg, "w") as f:
            for n in todo:
                f.write(f'url = "{RIS}/{COLLECTOR}/{d:%Y.%m}/{n}"\noutput = "{os.path.join(dl, n)}"\n')
        subprocess.run(["curl", "-sS", "-f", "-A", UA, "--retry", "3", "--max-time", "600", "--parallel", "--parallel-max", "2",
                        "-K", cfg], capture_output=True, text=True)
        time.sleep(5 * attempt)
    have = [os.path.join(dl, n) for n in names if os.path.exists(os.path.join(dl, n)) and os.path.getsize(os.path.join(dl, n)) > 0]
    if not have:                     # a part of the day when the collector wrote nothing
        shutil.rmtree(dl)
        return 0, len(names)
    py = os.path.join(base, "venv", "bin", "python")
    r = subprocess.run([py, "-I", os.path.join(base, "code", "mrt2records.py"), "--collector", COLLECTOR, out + ".tmp.gz"] + have,
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"{d}: mrt2records: {r.stderr.strip()[-400:]}")
    os.replace(out + ".tmp.gz", out)
    shutil.rmtree(dl)
    return len(have), len(names) - len(have)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base"); ap.add_argument("first"); ap.add_argument("last")
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--until")
    ap.add_argument("--limit-files", type=int)
    ap.add_argument("--collector", default="rrc00")
    ap.add_argument("--chunk-hours", type=int, default=int(os.environ.get("BACKFILL_CHUNK_HOURS", "24")))
    a = ap.parse_args()
    global COLLECTOR
    COLLECTOR = a.collector
    base = os.path.abspath(a.base)
    first, last = date.fromisoformat(a.first), date.fromisoformat(a.last)
    until = datetime.fromisoformat(a.until) if a.until else None
    block = os.path.join(base, "blocks", f"{first}_{last}")
    work, tmp, archive = os.path.join(block, "work"), os.path.join(block, "tmp"), os.path.join(base, "archive")
    for p in (os.path.join(work, "data"), archive):
        os.makedirs(p, exist_ok=True)
    done_file = os.path.join(block, "done.json")
    done = json.load(open(done_file)) if os.path.exists(done_file) else []

    days = [(first - timedelta(days=i), True) for i in range(a.warmup, 0, -1)]
    d = first
    while d <= last:
        days.append((d, False))
        d += timedelta(days=1)
    if until:
        days.append((until.date(), False))
    py = os.path.join(base, "venv", "bin", "python")

    for i, (d, warm) in enumerate(days):
        key = f"{d}"
        if key in done:
            continue
        if os.path.exists(os.path.join(base, "STOP")):       # touch BASE/STOP: the workers end after the day they are reading
            log("STOP is there: ending")
            return
        # a day takes some hundreds of megabytes while it is read (update files, records, ROAs, table): on a small disk the
        # worker waits (it tries the block again every 15 minutes) instead of filling it
        free = shutil.disk_usage(base).free
        if free < MIN_FREE_MB << 20:
            raise RuntimeError(f"{d}: {free >> 20} MB free in {base}, less than {MIN_FREE_MB} (BACKFILL_MIN_FREE_MB)")
        t0 = time.time()
        if os.path.exists(tmp):
            shutil.rmtree(tmp)
        os.makedirs(tmp)
        epoch = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
        name = f"records_{epoch}"
        partial = until if until and d == until.date() else None
        is_last = i == len(days) - 1
        # The day is read in parts of --chunk-hours hours (24: the whole day at once): the update files of a part are
        # downloaded, turned into a record file, read by the detector and removed before the next part, so a small disk
        # holds one part and not a whole day. The detector keeps its state from one part to the next, and its incidents are
        # added to the file of the day, the same lines in the same order as in one reading. day.json says how far a day that
        # was stopped had come, so that it goes on from there.
        names = update_names(d, partial, a.limit_files)
        step = max(1, a.chunk_hours) * 12
        chunks = [names[j:j + step] for j in range(0, len(names), step)] or [[]]
        acc = os.path.join(work, "day_incidents.jsonl.part")
        prog_file = os.path.join(block, "day.json")
        prog = json.load(open(prog_file)) if os.path.exists(prog_file) else {}
        if prog.get("day") != key:
            prog = {"day": key, "chunks": 0, "size": 0, "files": 0, "missing": 0}
            for f in os.listdir(os.path.join(work, "data")):      # what a run that was stopped left
                os.remove(os.path.join(work, "data", f))
            if os.path.exists(acc):
                os.remove(acc)
        log(f"{d}{' (warm-up)' if warm else ''}: inputs")
        notes, n_roas = day_inputs(base, work, tmp, d)
        t1 = time.time()
        t_rec = t_inc = 0.0
        rs = os.path.join(base, "code", "incident-rs")
        use_rs = os.access(rs, os.X_OK)
        cmd = None
        for c, part in enumerate(chunks):
            if c < prog["chunks"]:
                continue
            last_part = c == len(chunks) - 1
            ce = int(part[0][0].replace(tzinfo=timezone.utc).timestamp()) if part else epoch
            cname = f"records_{ce}"
            rec = os.path.join(work, "data", cname + ".jsonl.gz")
            cout = os.path.join(work, f"incidents_{cname}.jsonl")
            ta = time.time()
            if not os.path.exists(rec) and not os.path.exists(cout):
                if len(chunks) > 1:
                    log(f"{d}: update files {part[0][0]:%H:%M}-{part[-1][0]:%H:%M}")
                else:
                    log(f"{d}: update files")
                n_files, n_missing = day_records(base, tmp, d, part, rec)
                prog["files"] += n_files
                prog["missing"] += n_missing
            tb = time.time()
            t_rec += tb - ta
            if not os.path.exists(rec) and not os.path.exists(cout):
                # nothing in this part: the detector has nothing to read, unless it is the last part of the block, which
                # also writes the incidents that are still open
                if not (is_last and last_part):
                    prog["chunks"] = c + 1
                    with open(prog_file + ".tmp", "w") as f:
                        json.dump(prog, f)
                    os.replace(prog_file + ".tmp", prog_file)
                    continue
            # incident-rs (tools/incident-rs) when code/ has it, incident.py otherwise. A block that incident.py began goes on
            # from its state, brought over once (ref/export_state.py and import-state)
            if len(chunks) == 1:
                log(f"{d}: {'incident-rs' if use_rs else 'incident.py'}")
            with open(os.path.join(block, "incident.log"), "a") as lg:
                if use_rs and os.path.exists(os.path.join(work, "active_state.pkl")) and not os.path.exists(os.path.join(work, "active_state.rs.bin")):
                    dump = os.path.join(work, "state.jsonl")
                    subprocess.run([py, os.path.join(base, "code", "export_state.py"), "--code", os.path.join(base, "code"), "active_state.pkl", dump],
                                   cwd=work, stdout=lg, stderr=subprocess.STDOUT, check=True)
                    subprocess.run([rs, "import-state", dump], cwd=work, stdout=lg, stderr=subprocess.STDOUT, check=True)
                    os.remove(dump)
                    os.rename(os.path.join(work, "active_state.pkl"), os.path.join(work, "active_state.pkl.before-rs"))
                # the last part of the last day of the block also writes the incidents that are still open: no later day of
                # this block will close them
                cmd = ([rs, "run"] if use_rs else [py, os.path.join(base, "code", "incident.py")]) + (["--flush-open"] if is_last and last_part else [])
                r = subprocess.run(cmd, cwd=work, stdout=lg, stderr=subprocess.STDOUT)
            if os.path.exists(rec) and (r.returncode or not os.path.exists(cout)):
                raise RuntimeError(f"{d}: {os.path.basename(cmd[0])} ended with {r.returncode} (see {block}/incident.log)")
            t_inc += time.time() - tb
            # the incidents of the part go to the file of the day; a copy that was stopped halfway is cut back first
            with open(acc, "ab") as o:
                o.truncate(prog["size"])
                if os.path.exists(cout):
                    with open(cout, "rb") as f:
                        shutil.copyfileobj(f, o)
                o.flush()
                os.fsync(o.fileno())
                prog["size"] = o.tell()
            prog["chunks"] = c + 1
            with open(prog_file + ".tmp", "w") as f:
                json.dump(prog, f)
            os.replace(prog_file + ".tmp", prog_file)
            if os.path.exists(cout):
                os.remove(cout)
            # the record files read before this one go; this one stays until the end of the day, so that a last part with
            # no update files still finds a file (already read) and the detector writes the incidents that are open
            for f in os.listdir(os.path.join(work, "data")):
                if os.path.join(work, "data", f) != rec:
                    os.remove(os.path.join(work, "data", f))
            for f in os.listdir(work):
                if f.startswith("summary_incidents_"):
                    os.remove(os.path.join(work, f))
        n_files, n_missing = prog["files"], prog["missing"]
        t2 = t1 + t_rec
        if not n_files and not is_last:
            notes.append("no update files")
            shutil.rmtree(tmp)
            if os.path.exists(acc):
                os.remove(acc)
            os.remove(prog_file)
            done.append(key)
            with open(done_file + ".tmp", "w") as f:
                json.dump(done, f)
            os.replace(done_file + ".tmp", done_file)
            with open(os.path.join(base, "days.jsonl"), "a") as f:
                f.write(json.dumps({"day": key, "block": f"{first}_{last}", "collector": COLLECTOR, "warmup": warm, "partial": bool(partial), "incidents": 0,
                                    "update_files": 0, "missing_files": n_missing, "roas": n_roas, "notes": notes}) + "\n")
            log(f"{d}: no update files, day skipped")
            continue
        out = os.path.join(work, f"incidents_{name}.jsonl")
        os.replace(acc, out)
        t3 = t2 + t_inc
        n_inc = 0
        outs = [(out, f"incidents_{name}.jsonl.xz")]
        if is_last and os.path.exists(os.path.join(work, "incidents_open.jsonl")):
            outs.append((os.path.join(work, "incidents_open.jsonl"), f"incidents_open_{epoch}.jsonl.xz"))
        for src, dst in outs:
            if not warm:
                with open(src, "rb") as f:
                    n_inc += sum(1 for _ in f)
                subprocess.run(["xz", "-T2", "-c", src], stdout=open(os.path.join(archive, dst + ".tmp"), "wb"), check=True)
                os.replace(os.path.join(archive, dst + ".tmp"), os.path.join(archive, dst))
            os.remove(src)
        for f in os.listdir(os.path.join(work, "data")):
            os.remove(os.path.join(work, "data", f))
        shutil.rmtree(tmp)
        os.remove(prog_file)
        done.append(key)
        with open(done_file + ".tmp", "w") as f:
            json.dump(done, f)
        os.replace(done_file + ".tmp", done_file)
        row = {"day": key, "block": f"{first}_{last}", "collector": COLLECTOR, "warmup": warm, "partial": bool(partial), "incidents": n_inc, "update_files": n_files,
               "missing_files": n_missing, "roas": n_roas, "notes": notes,
               "seconds": {"inputs": round(t1 - t0), "records": round(t2 - t1), "incidents": round(t3 - t2), "all": round(time.time() - t0)}}
        with open(os.path.join(base, "days.jsonl"), "a") as f:
            f.write(json.dumps(row) + "\n")
        log(f"{d}: done, {n_inc} incidents, {round((time.time() - t0) / 60)} min" + (f" ({'; '.join(notes)})" if notes else ""))
    # with BACKFILL_DROP_DONE_WORK=1 the working files of a block that is done (its state, ROAs, delegation files and links:
    # about 100 MB) go: no other block uses them, each starting from an empty state, but a block that is to be extended
    # later (--until, to meet the recorder) needs its state, so they stay by default; done.json and incident.log stay
    if os.environ.get("BACKFILL_DROP_DONE_WORK") == "1" and os.path.exists(work):
        shutil.rmtree(work)
    log(f"block {first}_{last}: done")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        log("stopped:", e)
        sys.exit(1)
