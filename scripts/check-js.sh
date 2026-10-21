#!/bin/sh
# Syntax of every script of the project: the browser code, the scripts, the notifier, the shell scripts. One list for the Makefile and the CI
# (by pattern, so that a new file is covered without anybody remembering to add it).
set -eu
cd "$(dirname "$0")/.."
for f in site/*.js scripts/*.mjs notifier/*.mjs; do node --check "$f"; done
for f in scripts/*.sh; do sh -n "$f"; done
echo "syntax ok"
