#!/usr/bin/env python3
"""Rebuild the history of the ASPA data from the RIPE NCC RPKI repository archive.

For every day it reads https://ftp.ripe.net/rpki/<ta>.tal/YYYY/MM/DD/output.json.xz of the five
trust anchors and writes, into the output directory:

  events.json    the changes between consecutive days: [date, "AS123", ["AS1", "AS2"] | null],
                 null meaning the ASPA was removed; replaying them gives the state of any day
  coverage.json  every 7th day (and the last): [ASes seen in BGP, ASPA customers among them],
                 from the ASes seen by the RIPE RIS collectors (RIPEstat, data call ris-asns)

Usage: tools/backfill-history.py OUT_DIR [--start 2023-10-12] [--end YYYY-MM-DD] [--skip 2026-06-13,2026-06-28]
Days listed in --skip (missing or partial archives) are ignored: the next day is compared with the
last good one. Python 3.9+, standard library only. Takes about ten minutes.
"""
import argparse, concurrent.futures as cf, datetime as dt, json, lzma, os, sys, urllib.request

TAS = ['afrinic', 'apnic', 'arin', 'lacnic', 'ripencc']
UA = {'User-Agent': 'aspa-explorer-backfill'}


def get(url, tries=3):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
    return None


def state_of(day):
    """customer -> sorted providers, merged over the trust anchors; None if an archive is missing."""
    merged, dup = {}, 0
    for ta in TAS:
        raw = get(f'https://ftp.ripe.net/rpki/{ta}.tal/{day:%Y/%m/%d}/output.json.xz')
        if raw is None:
            return day, None, 0
        for a in json.loads(lzma.decompress(raw)).get('aspas', []):
            if a['customer'] in merged:
                dup += 1
            merged.setdefault(a['customer'], set()).update(a['providers'])
    return day, {c: sorted(p, key=lambda x: int(x[2:])) for c, p in merged.items()}, dup


def ris_asns(day):
    raw = get(f'https://stat.ripe.net/data/ris-asns/data.json?list_asns=true&query_time={day:%Y-%m-%d}T00:00:00')
    return None if raw is None else {f'AS{n}' for n in json.loads(raw)['data']['asns']}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--start', default='2023-10-12')
    ap.add_argument('--end', default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument('--skip', default='2026-06-13,2026-06-28')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    d0, d1 = dt.date.fromisoformat(a.start), dt.date.fromisoformat(a.end)
    skip = set(a.skip.split(',')) if a.skip else set()
    days = [d0 + dt.timedelta(n) for n in range((d1 - d0).days + 1) if (d0 + dt.timedelta(n)).isoformat() not in skip]
    sample = {d for i, d in enumerate(days) if i % 7 == 0} | {days[-1]}

    events, coverage, prev, dups = [], {}, {}, 0
    with cf.ThreadPoolExecutor(8) as ex:
        for i, (day, cur, dup) in enumerate(ex.map(state_of, days)):
            if cur is None:
                print('missing', day, file=sys.stderr)
                continue
            dups += dup
            iso = day.isoformat()
            for c in sorted(set(prev) | set(cur), key=lambda x: int(x[2:])):
                if prev.get(c) != cur.get(c):
                    events.append([iso, c, cur.get(c)])
            prev = cur
            if day in sample:
                seen = ris_asns(day)
                if seen:
                    coverage[iso] = [len(seen), len(seen & set(cur))]
            if i % 50 == 0:
                print(i, len(days), iso, len(cur), len(events), flush=True)
    json.dump(events, open(os.path.join(a.out, 'events.json'), 'w'), separators=(',', ':'))
    json.dump(coverage, open(os.path.join(a.out, 'coverage.json'), 'w'), separators=(',', ':'))
    print(f'DONE {len(events)} events, {len(coverage)} coverage samples, {dups} duplicate customers across trust anchors')


main()
