#!/bin/sh
# Every unit test of the project (scripts/test-*.mjs), except the one that needs a browser (scripts/test-a11y.mjs, run by `make a11y`).
# One list for the Makefile and the CI, by pattern: a new test runs without anybody remembering to add it.
set -eu
cd "$(dirname "$0")/.."
for f in scripts/test-*.mjs; do
  [ "$f" = scripts/test-a11y.mjs ] && continue
  echo "== $f"
  node --disable-warning=ExperimentalWarning "$f"
done
