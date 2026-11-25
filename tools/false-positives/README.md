# False positives

How many of the routes that the ASPAs prove Invalid come from an ASPA that misses a provider, and how soon the networks fix it.
The result is the page `/false-positives.html`, which reads `site/data/false-positives.json`.

1. `dump-places.mjs YYYYMMDD OUT_DIR rrc00[,rrc01...]`: every route of the table dumps of 00:00 UTC of that day, checked with the
   downstream procedure against the ASPAs at the start of the day (the history of changes, `events.json`); the Invalid routes
   grouped by place of valley, all of them, with up to eight paths each. One run a day; a dump is deleted once read.
2. `classify.mjs OUT_DIR`: each place followed for 30 days in the history of the ASPAs, and sorted into the classes described
   in its first lines and on the page; the route leaks of the detector (`incidents-invalid.jsonl.gz`, the lines of the detail
   file of the Incidents page whose `real` verdict is `invalid`) in the same way.
3. `summary.mjs OUT_DIR site/data/false-positives.json COLLECTORS`: the aggregate that the page shows, with no AS number.

The data files are read from `FP_DATA` (default `data/` here, not in the repository): `events.json` (the history branch),
`adoption.json` (for the ASes of the exchange points), the CAIDA relationships `as-rel2-YYYYMM01.bz2` of the months of the period,
`20261001.as-org2info.txt.gz` (CAIDA AS Organizations), `incidents-invalid.jsonl.gz`, and the IRR databases of the RIRs, fetched
by `classify.mjs` (a copy in `irr/` is used when there is one) and reduced to `irr-roles.json`.
