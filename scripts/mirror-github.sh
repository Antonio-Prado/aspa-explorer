#!/bin/sh
# Copy the commit (or the tag) of this pipeline to the read-only copy on GitHub, with a deploy key that can write to that
# repository only (the protected CI variable GITHUB_DEPLOY_KEY, a file). Runs in the pipelines of the main branch and of the tags.
set -eu
: "${GITHUB_DEPLOY_KEY:?GITHUB_DEPLOY_KEY is not set}"
repo=${GITHUB_REPO:-Antonio-Prado/aspa-explorer}
# the fingerprint that GitHub publishes for its Ed25519 host key
fingerprint='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$GITHUB_DEPLOY_KEY" "$tmp/key"
chmod 600 "$tmp/key"
ssh-keyscan -t ed25519 github.com > "$tmp/known_hosts" 2>/dev/null
seen=$(ssh-keygen -lf "$tmp/known_hosts" | awk '{print $2}')
[ "$seen" = "$fingerprint" ] || { echo "unexpected host key of github.com: $seen" >&2; exit 1; }
export GIT_SSH_COMMAND="ssh -i $tmp/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$tmp/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes"

if [ -n "${CI_COMMIT_TAG:-}" ]; then
  git push --force "git@github.com:${repo}.git" "refs/tags/${CI_COMMIT_TAG}:refs/tags/${CI_COMMIT_TAG}"
else
  git push --force "git@github.com:${repo}.git" "HEAD:refs/heads/main"
fi
echo "copied to github.com/${repo}"
