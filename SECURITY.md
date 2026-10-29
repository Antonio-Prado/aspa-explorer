# Security policy

## Supported versions

Only the latest release and the `main` branch receive fixes.

## Reporting a vulnerability

Please do not open a public issue. Send an email to **antonio.prado@dei.unipd.it** with a description of the problem and, if possible, steps to reproduce it. You can expect an acknowledgement within a few working days.

## Scope notes

ASPA Explorer is a static page that processes public RPKI data in the browser, with small services behind it. Relevant areas:

- **Remote data.** Data from the validator, RIPEstat, the RIPE database, RIS Live, Globalping, RIPE Atlas and PeeringDB must never be inserted into the page as HTML (`textContent` and DOM calls only), and the Content-Security-Policy and the nginx proxy and cache configuration must keep holding.
- **The notification service** (`notifier/`) keeps personal data: the e-mail addresses (and the webhook addresses with their secrets) of the people who subscribed. Things to look at: the subscription and confirmation flow (tokens are HMACs, a confirmation link is valid for one request), the limits against abuse and mail bombing, header injection in the mails, the DKIM key, and the database file, which only the service user can read.
- **Webhooks** are called from the server, so they must not become a way to reach its network: https only, a public host name that resolves only to public addresses, the connection made to the address that was checked, no redirects, short timeouts, a small answer. A way around any of these is in scope.
- **Shared results** (`/api/v1/reports`, `/r/<id>`) are written by anybody and kept 30 days: the service takes only plain text in a fixed shape, with size and rate limits. A way to make a shared page run code or look like something it is not is in scope.
- **The RIPE Atlas service** (`atlas/`) spends the credits of an account with its key: it creates measurements only towards an address inside a prefix that the AS announces, from a few probes, within limits for each address and for each day. A way to read the key, to aim the measurements elsewhere or to get around the limits is in scope.
- **The public API and the files** built for it (`/api/v1/*`, badges, feeds) are generated from public data; a way to make them serve something else, or to fill the disk, is in scope.

The data of the page itself is public. Reports about the availability of the service are welcome but are not vulnerabilities.
