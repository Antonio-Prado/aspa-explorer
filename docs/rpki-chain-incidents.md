# The RPKI chain and the incidents that broke it

The section *The validator as a router sees it* of the Right now page watches one link of a chain. This note lists the chain and the documented incidents on each link, with their sources, as background for that section and for the status check and the alerts that come with it. The idea, and most of the list, come from Ritesh Mukherjee's RIPE Labs article [*Your Router Trusts Its Validator. But Who's Watching the Validator?*](https://labs.ripe.net/author/ritesh-mukherjee/your-router-trusts-its-validator-but-whos-watching-the-validator/) (9 November 2026), which introduces the RTR monitor that the site runs.

## Why the chain matters

Route Origin Validation and ASPA verification fail open by design: a certificate that is revoked, a ROA or an ASPA that disappears, a repository that cannot be fetched, all turn a *Valid* route into *NotFound* or *Unknown*, never into *Invalid*. Reachability is preserved, and nothing tells the operator that the protection went away. The chain between a holder's intent and a router's decision has five links:

1. the **account** at the certification authority (the RIR or a delegated CA), where ROAs and ASPAs are created;
2. the **repository** (publication point), from which the signed objects are fetched;
3. the **relying party** (the validator), which fetches, validates and produces the payloads;
4. the **RTR session** between the validator and the router;
5. the **policy** of the router, which applies the verdicts.

The first two are run by the registries, the other three by the operator. A failure upstream shows up as a change in what the validator holds, which is why the validator, seen as a router sees it, is the place to watch.

## Incidents by link

### The account

- **Orange España, 3 January 2024.** The RIPE NCC account of the operator (AS12479), protected by a weak password and without two-factor authentication, was taken over; the attacker created ROAs for its address space with other origin ASes, and the networks that drop RPKI-invalid routes did what they were told: reachability fell for several hours. The signal was a large number of routes going from Valid to Invalid within minutes. Doug Madory, [*Digging into the Orange España Hack*](https://www.kentik.com/blog/digging-into-the-orange-espana-hack) (Kentik, January 2024; also on the [APNIC blog](https://blog.apnic.net/2024/01/26/digging-into-the-orange-espana-hack/)); Ben Cartwright-Cox, [*RPKI: signed but not secure*](https://blog.benjojo.co.uk/post/rpki-signed-but-not-secure).

### The repository

- **RIPE NCC, 22 to 24 February 2020.** A disk fault on the publication server stopped the publication of new, changed and deleted ROAs (176 in all) for about three days; the objects were stored but not published, and the disk raised no alarm, so nobody was alerted until an operator reported it. After the repair, the expired CRL took the objects beneath it with it, and the CA key had to be rolled. Validators reacted differently: the RIPE NCC Validator only warned, rpki-client dropped the CRL and everything under it. [RPKI Outage Post-Mortem](https://lists.ripe.net/pipermail/routing-wg/2020-February/004015.html) on the routing-wg list; Nathalie Trenaman, [*Lessons Learned on Improving RPKI*](https://labs.ripe.net/author/nathalie_nathalie/lessons-learned-on-improving-rpki) (RIPE Labs).
- **RIPE NCC, 1 April 2020.** An update of the internal registry software classified Provider Independent assignments as not certifiable and deleted their ROAs, 2,669 of them (a first message said 4,100); they were restored the next day. The same day Rostelecom (AS12389) leaked routes of Akamai, Cloudflare, Amazon and others, and a small part of the misrouted space had lost its ROAs hours earlier. [RPKI ROA Deletion: Post-mortem](https://lists.ripe.net/pipermail/routing-wg/2020-April/004076.html) on the routing-wg list.
- **ARIN, 20 to 22 November 2020.** A bug in the generator of the repository left the manifests of the delegated organisations without the entry of their certificate: about 180 ROAs of nine delegated CAs disappeared from the global RPKI for about 36 hours; hosted customers were not affected. The dip was first noticed in the statistics of a validator. ARIN added tests of the delegated repositories afterwards. [Issue for Delegated Users within ARIN's RPKI Repository, Outage Report](https://lists.arin.net/pipermail/arin-tech-discuss/2020-November/000875.html) and the [corrected dates](https://lists.arin.net/pipermail/arin-tech-discuss/2020-November/000881.html) on arin-tech-discuss.
- **AFRINIC, 6 April 2019.** The CRL and the manifest of the repository expired at about 07:24 UTC: the offline part of the RPKI engine had to be refreshed in March, the reminder was sent and nobody acted on it. An expired manifest takes the CA out of service for the validators. [06 April 2019 RPKI incident, Postmortem report](https://lists.afrinic.net/pipermail/community-discuss/2019-April/002816.html) on community-discuss.

### The relying party

- **Stalloris (USENIX Security 2022).** Hlavacek, Jeitner, Mirdita, Shulman and Waidner showed that a malicious or rate-limited publication point can stall a relying party until the cached objects expire, which removes the protection of the prefixes it covers; every implementation tested in 2021 was vulnerable, and the fixes followed. [*Stalloris: RPKI Downgrade Attack*](https://www.usenix.org/conference/usenixsecurity22/presentation/hlavacek) ([arXiv 2205.06064](https://arxiv.org/abs/2205.06064)).
- **CURE (NDSS 2024).** Mirdita, Schulmann, Vogel and Waidner built a fuzzer for RPKI repositories and found 18 vulnerabilities in the popular relying parties, most of them crashes from insufficient error handling of objects, including the handling of RTR requests; five CVEs, one of them critical (a path traversal in Routinator, CVE-2023-39916). [*The CURE to Vulnerabilities in RPKI Validation*](https://dev.ndss-symposium.org/ndss-paper/the-cure-to-vulnerabilities-in-rpki-validation) ([arXiv 2312.01872](https://arxiv.org/abs/2312.01872)); Niklas Vogel, [*Crashing the Party: Vulnerabilities in RPKI Relying Party Software*](https://labs.ripe.net/author/niklas-vogel/crashing-the-party-vulnerabilities-in-rpki-relying-party-software) (RIPE Labs).
- **Fort, 2024.** A set of CVEs on the Fort validator before 1.6.3 (among them [CVE-2024-45234](https://cve.circl.lu/vuln/cve-2024-45234), [CVE-2024-45236](https://cve.circl.lu/vuln/cve-2024-45236), [CVE-2024-45238](https://db.gcve.eu/vuln/CVE-2024-45238), [CVE-2024-45239](https://ubuntu.com/security/CVE-2024-45239)): a repository under a trusted trust anchor can serve an object that makes the validator crash, for example a signed object with an empty set of signed attributes. A validator that crashes drops its RTR sessions.

### The RTR session and the router

- When the validator goes away, the RTR session drops and, after the expire interval, the routers flush the payloads: every route goes back to NotFound. Nothing is dropped and nothing is logged as an incident.
- **FRRouting, issue [#24001](https://github.com/FRRouting/frr/issues/24001)** (open, October 2026): the payloads of an RTR update arrive within seconds, but the inbound policy that matches on the RPKI state is not run again, so a route that just became Invalid stays installed and keeps being announced to the iBGP peers, and a route that became Valid stays denied.
- **GoBGP, issue [#3674](https://github.com/osrg/gobgp/issues/3674)** (closed, September 2026): disabling an RPKI server left its payloads active, so the router kept judging routes against data that no longer had a source.

## What the site does about it

- The RTR monitor (`raven rtr monitor` of [RAVEN](https://github.com/nokia/bgp-routing-security-monitor), Nokia, BSD-3-Clause) keeps an RTR session with the Routinator of the site as a router would, records every sync and runs an adaptive detector on them; `scripts/build-rtr.mjs` sums the telemetry up as `/api/v1/rtr.json`, the Right now page shows it, the status page checks the session and the subscribers to the status alerts are told of every anomaly (release 1.58.1, 9 November 2026; the wiki page *Deployment* says how to set it up). A validator that stops publishing (link 3), a repository that loses objects (link 2) or an account that signs what it should not (link 1) show up as changes in the payloads before any route changes. Since 1.59.0 three more monitors follow other caches: a second validator of the site, Fort (different code, same host as Routinator), and public RTR servers as references: the ones of Level66 Network and of DaKnObNET in Zurich (RTR version 2, with the ASPAs), and the ones of DaKnObNET in Amsterdam (rpki-client with StayRTR) and of Cloudflare (rpki-client), both RTR version 0, so VRPs only. A change that every cache sees is upstream; one that Routinator alone sees is its own; one that Routinator and Fort see but the references do not is in the network or the timing of the host.
- The comparison of four validators (*Validators compared*) is a check on link 3 from another angle: the same repositories read with different code.
- Links 4 and 5 are not visible from the validator. Where ASPA is applied in practice is the question of the enforcement measurements of the research project (the subsection *Where ASPA Is Enforced* of the paper on BGP incidents and the ASPA-invalid beacon AS4492): a healthy validator does not mean that its verdicts are applied, and the two router issues above are one of the reasons.

## What is not covered

- The list is the one of the article plus what the public post-mortems say; it is not a census of RPKI incidents. Incidents of the data itself (a wrong ROA created on purpose by its holder, an ASPA that lists a peer) are the subject of the *ASPA quality* checks, not of this note.
- The dates and figures are those of the sources linked, some of which corrected themselves (the ARIN start date, the number of ROAs deleted by the RIPE NCC): where two figures exist, the later one is used.
