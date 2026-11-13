# Two ways of guessing the providers of an AS, against the ASPAs

RAVEN (github.com/nokia/bgp-routing-security-monitor, Nokia, BSD-3-Clause) has a command, `aspa recommend`, that suggests the ASPA an AS should publish from the routes that a network receives over BMP: every adjacent pair of an AS_PATH is read as provider and customer, the AS closer to the collector being the provider of the one closer to the origin, and the pairs are counted over the routes (`internal/aspa/recommender`). This site has *A starting point for the ASPA*, from `site/evidence.js`: the neighbour of the origin is taken as its provider only when the route goes on from it to a Tier-1 network that is not the neighbour itself, because a network passes the routes of its peers and providers on to its customers only, so a route that climbed to a Tier-1 through N came to N from a customer. `tools/compare-recommenders.mjs` runs both over the same table dumps and judges them against the ASPAs that the ASes published. Run on 9 November 2026.

## Method

- **Routes**: the table dumps of 00:00 UTC of the 30 collectors that the valley job reads (sixteen of RIPE RIS, fourteen of RouteViews), 600,058,939 routes; a first run on `rrc00` and `route-views2` only, 73,011,087 routes.
- **ASPAs**: the 4,042 of the Routinator of the site at the time of the run; 69 say AS0 only and are left out of the scores, the other 3,973 have at least one provider. The declared providers are the yardstick, with the caveat below.
- **RAVEN**: the pairs of the raw path, as the recommender reads them (prepending makes an AS its own provider, 12,768,541 such pairs in the 30 dumps; they are not counted as suggestions). Three minimum numbers of observations, 1 (the default of the command), 10 and 100; and two readings: *every pair* of the path, as RAVEN does, and *the neighbour of the origin only*, which is what the ASPA of the origin is about.
- **This site**: the neighbour of the origin on the path without prepending and without the exchange-point ASes, labelled *provider* (strong evidence) when at least 3 feeders see the route go on to a Tier-1 and that happens on at least 20% of the paths of three or more ASes, *weak* when it happens at all, after at least 5 such paths (the constants of `site/evidence.js`). The Tier-1 clique and the exchange points are those of the adoption file (CAIDA).
- **Judgement**: for every customer with declared providers, the suggested providers that the ASPA declares are hits; the others are classed by the CAIDA relationships of 1 November 2026 (`as-rel2`): a provider of the customer that the ASPA does not list, a peer, a customer, or a pair that CAIDA does not know. *Precision* is hits over suggestions, *recall* hits over declared providers, both summed over the customers; *ASPAs fully right* counts the customers whose suggestions are exactly the declared providers.

## Results

All 30 collectors (600 M routes; feeders of the same AS count once in the evidence):

| Method | Customers with suggestions | Suggestions | Precision | Recall | ASPAs fully right | Non-declared: CAIDA provider / peer / customer / unknown |
|---|---|---|---|---|---|---|
| RAVEN, every pair, at least 1 observation | 3,682 of 3,973 | 46,393 | 20.5% | 71.6% | 1,477 | 689 / 29,380 / 150 / 6,661 |
| RAVEN, every pair, at least 10 observations | 3,638 of 3,973 | 30,964 | 29.1% | 67.9% | 1,560 | 492 / 19,175 / 131 / 2,152 |
| RAVEN, every pair, at least 100 observations | 3,621 of 3,973 | 16,734 | 48.5% | 61.1% | 1,511 | 343 / 7,742 / 98 / 434 |
| RAVEN, the neighbour of the origin only, at least 1 observation | 3,598 of 3,973 | 42,379 | 19.9% | 63.5% | 1,282 | 563 / 27,262 / 92 / 6,020 |
| RAVEN, the neighbour of the origin only, at least 10 observations | 3,534 of 3,973 | 23,671 | 33.5% | 59.8% | 1,347 | 383 / 13,939 / 63 / 1,347 |
| RAVEN, the neighbour of the origin only, at least 100 observations | 3,484 of 3,973 | 10,366 | 68.4% | 53.4% | 1,334 | 257 / 2,826 / 26 / 163 |
| This site, strong evidence | 2,391 of 3,973 | 4,088 | 95.2% | 29.3% | 643 | 161 / 1 / 0 / 35 |
| This site, strong or weak evidence | 2,865 of 3,973 | 6,014 | 95.7% | 43.3% | 1,060 | 197 / 15 / 0 / 49 |
| This site, every neighbour of the origin seen | 3,658 of 3,973 | 44,855 | 20.8% | 70.2% | 1,468 | 627 / 28,688 / 95 / 6,119 |

Two collectors only (`rrc00` and `route-views2`, 73 M routes):

| Method | Customers with suggestions | Suggestions | Precision | Recall | ASPAs fully right | Non-declared: CAIDA provider / peer / customer / unknown |
|---|---|---|---|---|---|---|
| RAVEN, every pair, at least 1 observation | 3,662 of 3,973 | 17,630 | 50.7% | 67.2% | 1,551 | 562 / 6,543 / 64 / 1,527 |
| RAVEN, every pair, at least 10 observations | 3,618 of 3,973 | 12,258 | 65.6% | 60.6% | 1,486 | 358 / 3,453 / 37 / 365 |
| RAVEN, every pair, at least 100 observations | 2,228 of 3,973 | 5,361 | 72.9% | 29.4% | 658 | 124 / 1,259 / 26 / 45 |
| RAVEN, the neighbour of the origin only, at least 1 observation | 3,561 of 3,973 | 15,524 | 50.8% | 59.3% | 1,341 | 452 / 5,772 / 31 / 1,385 |
| RAVEN, the neighbour of the origin only, at least 10 observations | 3,488 of 3,973 | 9,736 | 72.4% | 53.1% | 1,317 | 272 / 2,237 / 16 / 163 |
| RAVEN, the neighbour of the origin only, at least 100 observations | 1,933 of 3,973 | 3,387 | 85.0% | 21.7% | 535 | 78 / 413 / 8 / 9 |
| This site, strong evidence | 2,362 of 3,973 | 3,688 | 95.2% | 26.4% | 614 | 150 / 0 / 0 / 26 |
| This site, strong or weak evidence | 2,820 of 3,973 | 5,369 | 96.0% | 38.8% | 935 | 176 / 5 / 0 / 35 |
| This site, every neighbour of the origin seen | 3,638 of 3,973 | 16,729 | 52.3% | 65.8% | 1,535 | 511 / 6,050 / 32 / 1,393 |

## What this shows

- **Counting pairs mistakes peers for providers.** Of the suggestions of RAVEN that the ASPA does not declare, the great majority are peers of the customer according to CAIDA (29,380 of 36,880 at one observation over 30 collectors, 7,742 of 8,617 at a hundred). A route received from a peer and passed on to a customer puts the peer closer to the collector, and the heuristic reads it as a provider. The minimum number of observations helps only partly: a peering link with a full table is observed as often as a transit link.
- **The more vantage points, the worse the count does.** With two collectors RAVEN's precision is 51 to 85%; with thirty it is 20 to 68%, because the 30 feeders see more peering links of the same customers. The evidence of this site does not move (95 to 96%): it depends on where the route goes next, not on how many times it is seen. The same holds for the plain list of the neighbours of the origin (the last line of each table), which is what RAVEN's count comes down to for the origin: it is the Tier-1 condition that makes the difference, not the cleaning of the path.
- **Evidence buys precision with recall.** The strong evidence lists 4,088 providers, 95% of them declared, but finds only 29% of the declared ones (43% with the weak leads), and only 643 ASPAs come out exactly as published. A backup provider that carries no route on the day is invisible, and a route that does not climb to the clique says nothing. RAVEN, which lists what it sees, finds 54 to 72% of the declared providers, and gets 1,300 to 1,560 ASPAs exactly right, more than the evidence does, at the price of the peers in the list. For the operator who looks at one AS the two readings are complementary: the count says what is there, the evidence says what can be defended.
- **The other side of the mirror.** The providers that CAIDA knows and the ASPA does not list, 161 to 689 depending on the method, are the same kind of lead as the section *ASPAs that seem to miss a provider* of the Right now page: an ASPA that is too short, or a relationship that CAIDA infers wrongly. They are not errors of either method.
- **For whom each is meant.** RAVEN's recommender reads the Adj-RIB-In of one network from its own routers: the pairs it sees first are its own neighbours, which it knows, and the recommendation is for its customers, whose providers it is. Over the tables of public collectors, whose feeders peer widely, the same count sees mostly peering. A route collector is the worst vantage point for it, and the best for the evidence.

## Caveats

- The declared providers are the yardstick, not the truth: an ASPA can list a peer or miss a provider (the quality checks of the site find some). A suggestion counted as wrong here may be right, and the other way round.
- The two runs read dumps of two different days (the dumps of the day of the run); the ASPAs and the relationships are those of the day.
- Feeders are counted by AS, not by session; CAIDA's clique and exchange-point list are those of its monthly file.

## To repeat it

On the host, with the dumps of the valley job in its cache and the relationships file of the adoption job:

```
CAIDA=/var/db/aspa-gen/cache/as-rel2-YYYYMM01.bz2 node tools/compare-recommenders.mjs out.json /var/db/aspa-gen/cache/dump-*.gz /var/db/aspa-gen/cache/dump-*.bz2
```

`ASPA_DATA` and `ADOPTION` point the tool at the files of another site or at local copies. The 30 dumps take about eight minutes and four gigabytes of heap.
