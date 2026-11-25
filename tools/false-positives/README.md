# False positives

How many of the routes that the ASPAs prove Invalid come from an ASPA that misses a provider, and how soon the networks fix it.
The result is the page `/false-positives.html`, which reads `site/data/false-positives.json`.

1. `dump-places.mjs YYYYMMDD OUT_DIR rrc00[,rrc01...] before` and the same with `day`, into two directories: every route of the
   table dumps of 00:00 UTC of that day, checked with the downstream procedure against each of the two states of the ASPAs around
   that time (`state.mjs`, from the timeline of the ASPAs): the one known at 00:00, and the one after the changes that may or may
   not have been there at 00:00. The Invalid routes are grouped by place of valley, all of them, with up to eight paths each.
   A dump is deleted once read (keep it between the two runs with `KEEP_DUMPS=1`).
2. `robust.mjs DIR_BEFORE DIR_DAY OUT_DIR`: the places that are Invalid with both states. For a day of the RIPE NCC archive the
   two are a day apart, and a place that is there with one alone owes it to an ASPA that changed that very day.
3. `classify.mjs OUT_DIR`: each place followed for 30 days in the states of the ASPAs, and sorted into the classes described
   in its first lines and on the page. It also sorts the route leaks of the detector (`incidents-invalid.jsonl.gz`), which the
   page does not show.
4. `summary.mjs OUT_DIR site/data/false-positives.json COLLECTORS`: the aggregate that the page shows, with no AS number.

The data files are read from `FP_DATA` (default `data/` here, not in the repository): `timeline.json` (written by
`scripts/build-timeline.mjs`), `events.json` and `history.json` (the history branch), `adoption.json` (for the ASes of the
exchange points), the CAIDA relationships `as-rel2-YYYYMM01.bz2` of the months of the period, `20261001.as-org2info.txt.gz`
(CAIDA AS Organizations), `incidents-invalid.jsonl.gz`, and the IRR databases of the RIRs, fetched by `classify.mjs` (a copy
in `irr/` is used when there is one) and reduced to `irr-roles.json`.

The first version (25 November 2026) checked each dump with the state before it alone, which for a day of the archive is some
19 hours old: the routes whose ASPA had been completed in those hours counted as Invalid and then as fixed the next day.
