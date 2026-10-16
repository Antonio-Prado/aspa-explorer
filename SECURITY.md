# Security policy

## Supported versions

Only the latest release and the `main` branch receive fixes.

## Reporting a vulnerability

Please do not open a public issue. Send an email to **antonio.prado@dei.unipd.it** with a description of the problem and, if possible, steps to reproduce it. You can expect an acknowledgement within a few working days.

## Scope notes

The page only displays public RPKI data and processes it in the browser. Relevant areas are the handling of remote data (it must never be inserted as HTML), the Content-Security-Policy and the nginx proxy and cache configuration.
