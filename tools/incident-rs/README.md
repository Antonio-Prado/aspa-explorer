# incident-rs

The incident detector of `tools/data_scripts` (`incident.py` and `extra_detectors.py`) in Rust: the same incidents, in about a tenth of the time and half the memory. The Python scripts stay the reference: every step of this version is checked against them, line by line.

## Build

```
cargo build --release        # target/release/incident-rs
```

It calls `xz` and `bzip2` to read the ROAs and the relationships of CAIDA.

## Use

```
incident-rs run [--flush-open]
```

In the working directory of `incident.py`, in its place: it reads `data/*.jsonl` and `data/*.jsonl.gz`, `20260901.as-rel.txt.bz2`, `roas/*.xz`, the delegation files (`INCIDENTS_DELEGATIONS`, default `delegations/delegated-*`) and the links of the table of the collector (`INCIDENTS_LINKS`, default `links/*.txt`), and writes `incidents_<file>.jsonl` and `summary_incidents_<file>.txt` for each file it has not read yet. Its state is `active_state.rs.bin`, written after each file; `--flush-open` writes the incidents still open at the end to `incidents_open.jsonl`. A file that cannot be read whole ends the run with an error and leaves the state as it was.

```
python ref/export_state.py --code ../data_scripts active_state.pkl state.jsonl
incident-rs import-state state.jsonl            # -> active_state.rs.bin
```

To go on from a state of `incident.py`: the open incidents, the files already read and the state of every detector.

```
incident-rs incidents [--caida F] [--roas F] [--delegations DIR] [--links F] [--state F] [--open OPEN.jsonl] IN.jsonl[.gz] OUT.jsonl
incident-rs detections [--detectors LIST] [--caida F] [--roas F] [--delegations DIR] [--links F] IN.jsonl.gz OUT.tsv
```

One file, with the tables named on the command line; and the detections alone, one line for each, for the comparison with `ref/detections_ref.py`, which writes the same lines with the functions of the Python scripts.

## How it is checked

- `detections` against `ref/detections_ref.py`: every line the same.
- `incidents` and `run` against `incident.py` from an empty state: the incident file and the open incidents the same, field by field, once the lists that Python writes from a set (`prefixes`, `expected_roas`) are sorted.
- Two runs with the state between them against one run: the same bytes.
- `incident.py` on the first half of a file, its state exported and imported, `run` on the second half: the same incidents as one run.

- What a day of rrc00 does not have is in the made-up records of `ref/made_cases.py` (NOTIFICATIONs, the jump of the more specifics of an origin against its median, whole and not, an IPv6 flood, prefixes written in another way than Python writes them, an IPv6 flap whose withdrawals write the prefix in full, records without a collector, a mass withdrawal after a change of state): `incident.py` and `run` write the same incidents for them.

`ref/compare_incidents.py` compares two incident files field by field.

## What differs from the Python scripts

- The lists written from a set are sorted.
- The details are written without spaces after `,` and `:`.
- The events of a flap are counted by the network of the prefix: a prefix that is not an address is never a flap (Python keeps it by its text).

Both write an IPv6 prefix as `ipaddress` does (`2605:9cc0:c0d::/48`) before anything else looks at the record, also inside the messages: the withdrawals of some peers write it in full (`2605:9cc0:c0d:0:0:0:0:0/48`), and as two texts the two were two prefixes.
- The state is not the pickle of `incident.py`: it is read with `import-state`, one way.
