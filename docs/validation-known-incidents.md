# The detectors against four known incidents

`tools/data_scripts/incident.py` (with `extra_detectors.py`) was run over the BGP updates that RIPE RIS `rrc00` recorded during four documented incidents, to see what it finds and how much noise comes with it. The incidents are four of the cases that the survey of our group cites (Servillo et al., *IEEE Communications Surveys & Tutorials*, vol. 28, 2026, Sec. III, doi:10.1109/COMST.2026.3714569). The run was made on 2026-10-22.

## Method

- **Data**: the update files of `rrc00` (`data.ris.ripe.net/rrc00/<year.month>/updates.<date.time>.gz`, one for every 5 minutes), for a window around the start of each incident, converted into the records of `record.py` with `tools/replay/mrt2records.py`. The start times are those of the public reports (BGPmon, ThousandEyes, the Internet Society, operators' mailing lists), not measured here.
- **Relationships**: the CAIDA AS Relationships (serial-2) of the month of the incident, so that the valley detector and the link detector know what was known then.
- **ROAs and registries**: those of the day of the run (2026-10-22). The ones of the time were not at hand, so a prefix that had no ROA then may be flagged now, and the other way round.
- **ASPAs of the day**: not used. The history of ASPA Explorer starts in October 2023.
- **Detectors**: the thresholds of `extra_detectors.py`, which are first guesses.
- **Collector**: `rrc00` only. An incident that its peers do not see is not seen.

## Results

| Incident | Window (UTC) | Records | Incidents found | What the detectors saw |
|---|---|---|---|---|
| **A9**, Safe Host (AS21217) leaks over 70,000 routes to China Telecom (AS4134), 2019-06-06, 09:43 | 09:00 to 12:30 | 8.4 M | 128,290 | **ASM-PS** on the link AS4134–AS21217, which CAIDA of 2019-06 does not know: opened at 09:44:33, with 6,582 prefixes and 323,457 updates. By updates it is the first of 15,802 ASM candidates and the second of all the incidents. **No valley incident** has AS21217: CAIDA has no relationship between the two ASes, so the valley detector has nothing to compare. |
| **A1**, RTComm (AS8342) announces 104.244.42.0/24 of Twitter, 2022-03-28, about 12:06 | 11:45 to 13:15 | 5.8 M | 113,114 | **PRH** (origin that the ROA does not authorise) on 104.244.42.0/24 from AS8342 at 12:06:40, with a single update: `rrc00` saw the hijack once. |
| **A2**, Rostelecom (AS12389) announces prefixes of Akamai, Cloudflare, Amazon and others, 2020-04-01, 19:28 | 19:00 to 20:45 | 17.1 M | 346,123 | **PRH** on the origin AS12389, one incident for the origin with 8,200 prefixes and 2.4 M updates; it **starts at 19:01:50**, long before the event, because AS12389 announces prefixes that the ROAs of today refuse for ordinary reasons. The event shows in the volume: the announcements with origin AS12389 go from about 150 a minute to 315,574 at 19:27 (peak 369,235 at 19:28, from more than 60 peers) and back to about 350 at 19:39. |
| **A12**, a corrupted Prefix-SID attribute makes sessions reset on several vendors, 2025-05-20, about 07:00 | 06:45 to 07:35 | 9.6 M | 110,351 | **Volume, not the cause**: the updates go from 50,000 to 160,000 a minute to 558,000 at 07:02 and stay between 400,000 and 560,000 until 07:07; the withdrawals reach about 42,000 a minute (07:03 and 07:08). Five **ATR** incidents (mass withdrawal of a peer) open between 07:01:53 and 07:02:36 (nineteen more at 06:45 to 06:53, at the start of the data), and five **VOL-AC** at 07:02, against none to three in the minutes around. The attribute is not in the records, so nothing says that it is the cause. |

## What this shows

- **A detector alone does not do it.** A9 is missed by the valley detector and found by the link detector; A2 is found by the origin detector but with a start that is no use. The types are complementary, which is the point of having several.
- **Size ranks the real case first.** In A9 the incident is the first by updates among 15,802 candidates of its type. A list of candidates should be ordered by prefixes and updates.
- **A candidate from a wrong start needs a time profile.** An incident that groups every announcement of an origin (PRH, DEG) hides when the event began: the count of updates for each minute shows it.
- **There is much noise.** 110,000 to 346,000 incidents in an hour and a half to two hours, most of them flapping (VOL-FO); and in A9, 9,731 valleys, of which 6,286 for one AS (AS6939), probably relationships that CAIDA infers in a way that does not describe the routing policy. A valley detector that relies on inferred relationships gives few real cases among many.
- **A single collector is a thin window.** The Twitter hijack is one update.

## What is not shown

Four incidents are not an estimate of how many real incidents the detectors miss, nor of the false positives. It would take many cases with a known ground truth, other collectors (RouteViews, other `rrc`), the ROAs and registries of the time, and the ASPAs of the day when they exist.

## To repeat it

```sh
python3 -m venv venv && venv/bin/pip install mrtparse            # the parser of MRT files
python3 tools/replay/fetch.py A9 data/A9                          # the update files of the window (A9, A2, A1 or A12)
venv/bin/python -I tools/replay/mrt2records.py A9.jsonl.gz data/A9/updates.*.gz
curl -O https://publicdata.caida.org/datasets/as-relationships/serial-2/20190601.as-rel2.txt.bz2
tools/replay/run_event.sh A9.jsonl.gz 20190601.as-rel2.txt.bz2 roas.json.xz delegations/ run/A9
python3 tools/replay/analyse.py A9 run/A9 A9.jsonl.gz
```

The downloaded files come from outside: keep them in a directory of their own, apart from the code, and read them with `python -I`. The four windows are about 370 MB of update files (A9 63 MB, A2 142 MB, A1 65 MB, A12 103 MB); `incident.py` took from half an hour to over an hour for each on a laptop, with four running together.
