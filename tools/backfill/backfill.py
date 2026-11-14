"""The incidents of the days before the recorder was started, from the archive of RIPE RIS: for each day of a block the
update files of rrc00 are downloaded and turned into records (tools/replay/mrt2records.py), incident.py reads them with the
relationships, the ROAs, the delegation files and the table of that day, and its incident file is kept compressed in
BASE/archive. The days of a block are read in order, with the state of incident.py kept from one to the next as in the
nightly job; a block starts with an empty state, so it reads some days before its first one only to fill the state
(the incidents written while it does are thrown away). The blocks can be run in any order: the newest first, to go back.

usage: backfill.py BASE FROM TO [--warmup N] [--until YYYY-MM-DDTHH:MM] [--limit-files N]
  BASE    working directory (code/ with incident.py, extra_detectors.py, mrt2records.py, rib-links.mjs, mrt.mjs; venv/ with mrtparse)
  FROM TO first and last day of the block (YYYY-MM-DD, UTC)
  --warmup N     days read before FROM to fill the state (default 2)
  --until T      a last, partial day after TO: the update files before T (to meet the first record of the recorder)
  --limit-files N  only the first N update files of each day (a test)
A day that is done is not read again: a block that was stopped starts again from the day it was reading. `touch BASE/STOP`
ends every block after the day it is reading. Each day adds a line to BASE/days.jsonl (incidents, files, notes, seconds).
The downloaded files come from outside: they stay under BASE/blocks/<block>/tmp, and the parser runs with python -I."""
import argparse, bz2, gzip, json, lzma, os, shutil, subprocess, sys, time, urllib.request, urllib.error
from datetime import date, datetime, timedelta, timezone

UA = "aspa-explorer-backfill"
RIS = "https://data.ris.ripe.net/rrc00"
CAIDA = "https://publicdata.caida.org/datasets/as-relationships/serial-2"
ROAS = "https://ftp.ripe.net/rpki"
TALS = ("afrinic", "apnic", "arin", "lacnic", "ripencc")


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
        if r.returncode == 22 and "404" in r.stderr:
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

    # the ROAs: the daily export of the five trust anchors that RIPE NCC keeps, as the JSON that incident.py reads
    roas, missing = [], []
    for tal in TALS:
        got = False
        for back in range(8):
            x = d - timedelta(days=back)
            p = os.path.join(tmp, f"roas-{tal}.csv.xz")
            if fetch(f"{ROAS}/{tal}.tal/{x:%Y/%m/%d}/roas.csv.xz", p):
                try:
                    rows = lzma.open(p, "rt", encoding="utf-8", errors="replace").read().splitlines()[1:]
                except (lzma.LZMAError, EOFError):
                    continue
                for row in rows:
                    c = row.split(",")
                    if len(c) >= 4 and c[1].startswith("AS"):
                        roas.append({"asn": c[1], "prefix": c[2], "maxLength": int(c[3]) if c[3].isdigit() else None})
                got = len(rows) > 0
                if got:
                    if back:
                        notes.append(f"roas {tal} of {x}")
                    break
        if not got:
            missing.append(tal)
    if missing:
        notes.append("no roas of " + " ".join(missing))
    if not roas:
        raise RuntimeError(f"no ROAs for {d}")
    os.makedirs(os.path.join(work, "roas"), exist_ok=True)
    with lzma.open(os.path.join(work, "roas", "current.json.xz.tmp"), "wt", encoding="utf-8", preset=1) as f:
        json.dump({"roas": roas}, f)
    os.replace(os.path.join(work, "roas", "current.json.xz.tmp"), os.path.join(work, "roas", "current.json.xz"))

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
    if fetch(f"{RIS}/{d:%Y.%m}/bview.{d:%Y%m%d}.0000.gz", bview):
        r = subprocess.run(["node", os.path.join(base, "code", "rib-links.mjs"), bview, os.path.join(links, "rrc00.txt")],
                           capture_output=True, text=True)
        if r.returncode:
            notes.append("links of the table not read: " + r.stderr.strip()[-200:])
        os.remove(bview)
    else:
        notes.append("no table of the day: the links of before")
    return notes, len(roas)


def day_records(base, tmp, d, out, until=None, limit=None):
    """The update files of the day -> the record file. -> (files read, files missing)."""
    dl = os.path.join(tmp, "updates")
    os.makedirs(dl, exist_ok=True)
    t = datetime(d.year, d.month, d.day)
    end = until or t + timedelta(days=1)
    names = []
    while t < end:
        names.append(f"updates.{t:%Y%m%d.%H%M}.gz")
        t += timedelta(minutes=5)
    if limit:
        names = names[:limit]
    cfg = os.path.join(tmp, "curl.cfg")
    with open(cfg, "w") as f:
        for n in names:
            f.write(f'url = "{RIS}/{d:%Y.%m}/{n}"\noutput = "{os.path.join(dl, n)}"\n')
    for attempt in range(4):
        todo = [n for n in names if not os.path.exists(os.path.join(dl, n))]
        if not todo:
            break
        with open(cfg, "w") as f:
            for n in todo:
                f.write(f'url = "{RIS}/{d:%Y.%m}/{n}"\noutput = "{os.path.join(dl, n)}"\n')
        subprocess.run(["curl", "-sS", "-f", "-A", UA, "--retry", "3", "--max-time", "600", "--parallel", "--parallel-max", "2",
                        "-K", cfg], capture_output=True, text=True)
        time.sleep(5 * attempt)
    have = [os.path.join(dl, n) for n in names if os.path.exists(os.path.join(dl, n)) and os.path.getsize(os.path.join(dl, n)) > 0]
    if not have:                     # a day when the collector wrote nothing
        shutil.rmtree(dl)
        return 0, len(names)
    py = os.path.join(base, "venv", "bin", "python")
    r = subprocess.run([py, "-I", os.path.join(base, "code", "mrt2records.py"), out + ".tmp.gz"] + have, capture_output=True, text=True)
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
    a = ap.parse_args()
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
        t0 = time.time()
        if os.path.exists(tmp):
            shutil.rmtree(tmp)
        os.makedirs(tmp)
        for f in os.listdir(os.path.join(work, "data")):      # what a run that was stopped left
            os.remove(os.path.join(work, "data", f))
        epoch = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
        name = f"records_{epoch}"
        partial = until if until and d == until.date() else None
        log(f"{d}{' (warm-up)' if warm else ''}: inputs")
        notes, n_roas = day_inputs(base, work, tmp, d)
        t1 = time.time()
        log(f"{d}: update files")
        n_files, n_missing = day_records(base, tmp, d, os.path.join(work, "data", name + ".jsonl.gz"), partial, a.limit_files)
        t2 = time.time()
        is_last = i == len(days) - 1
        if not n_files and not is_last:
            notes.append("no update files")
            shutil.rmtree(tmp)
            done.append(key)
            with open(done_file + ".tmp", "w") as f:
                json.dump(done, f)
            os.replace(done_file + ".tmp", done_file)
            with open(os.path.join(base, "days.jsonl"), "a") as f:
                f.write(json.dumps({"day": key, "block": f"{first}_{last}", "warmup": warm, "partial": bool(partial), "incidents": 0,
                                    "update_files": 0, "missing_files": n_missing, "roas": n_roas, "notes": notes}) + "\n")
            log(f"{d}: no update files, day skipped")
            continue
        log(f"{d}: incident.py")
        # the last day of the block also writes the incidents that are still open: no later day of this block will close them
        cmd = [py, os.path.join(base, "code", "incident.py")] + (["--flush-open"] if is_last else [])
        with open(os.path.join(block, "incident.log"), "a") as lg:
            r = subprocess.run(cmd, cwd=work, stdout=lg, stderr=subprocess.STDOUT)
        out = os.path.join(work, f"incidents_{name}.jsonl")
        if r.returncode or not os.path.exists(out):
            raise RuntimeError(f"{d}: incident.py ended with {r.returncode} (see {block}/incident.log)")
        t3 = time.time()
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
        for f in os.listdir(work):
            if f.startswith("summary_incidents_"):
                os.remove(os.path.join(work, f))
        os.remove(os.path.join(work, "data", name + ".jsonl.gz"))
        shutil.rmtree(tmp)
        done.append(key)
        with open(done_file + ".tmp", "w") as f:
            json.dump(done, f)
        os.replace(done_file + ".tmp", done_file)
        row = {"day": key, "block": f"{first}_{last}", "warmup": warm, "partial": bool(partial), "incidents": n_inc, "update_files": n_files,
               "missing_files": n_missing, "roas": n_roas, "notes": notes,
               "seconds": {"inputs": round(t1 - t0), "records": round(t2 - t1), "incidents": round(t3 - t2), "all": round(time.time() - t0)}}
        with open(os.path.join(base, "days.jsonl"), "a") as f:
            f.write(json.dumps(row) + "\n")
        log(f"{d}: done, {n_inc} incidents, {round((time.time() - t0) / 60)} min" + (f" ({'; '.join(notes)})" if notes else ""))
    log(f"block {first}_{last}: done")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        log("stopped:", e)
        sys.exit(1)
