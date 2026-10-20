#!/bin/sh
# Copy the wiki of this (internal) project to the wiki of the public mirror. The push
# mirror only copies the repository, so the wiki is published by this script (daily
# schedule, SCHEDULE=wiki). Needs MIRROR_TOKEN (access token of the public project).
set -eu

public=${PUBLIC_PROJECT:-Antonio-Prado/aspa-explorer}
host=${CI_SERVER_HOST:-gitlab.dei.unipd.it}
: "${MIRROR_TOKEN:?MIRROR_TOKEN is not set}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The tokens go to git in its environment (GIT_CONFIG_*), not in the address or in the arguments: on the host the arguments of every process can be
# read by every user, and the address of a remote is also written in .git/config.
auth() { printf 'Authorization: Basic %s' "$(printf '%s:%s' "$1" "$2" | base64 | tr -d '\n')"; }
git_as() {   # git_as USER TOKEN git-arguments...
  header=$(auth "$1" "$2"); shift 2
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="$header" git "$@"
}

git_as gitlab-ci-token "$CI_JOB_TOKEN" clone --quiet "https://${host}/${CI_PROJECT_PATH}.wiki.git" "$tmp/wiki" 2>&1 \
  | sed "s/${CI_JOB_TOKEN}/***/g"
cd "$tmp/wiki"
echo "wiki: $(git log --oneline | wc -l | tr -d ' ') commits, $(git ls-files '*.md' | wc -l | tr -d ' ') pages"
git_as oauth2 "$MIRROR_TOKEN" push --force --quiet "https://${host}/${public}.wiki.git" HEAD:main 2>&1 \
  | sed "s/${MIRROR_TOKEN}/***/g"
echo "published to ${public}.wiki"
