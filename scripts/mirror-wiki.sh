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

git clone --quiet "https://gitlab-ci-token:${CI_JOB_TOKEN}@${host}/${CI_PROJECT_PATH}.wiki.git" "$tmp/wiki" 2>&1 \
  | sed "s/${CI_JOB_TOKEN}/***/g"
cd "$tmp/wiki"
echo "wiki: $(git log --oneline | wc -l | tr -d ' ') commits, $(git ls-files '*.md' | wc -l | tr -d ' ') pages"
git push --force --quiet "https://oauth2:${MIRROR_TOKEN}@${host}/${public}.wiki.git" HEAD:main 2>&1 \
  | sed "s/${MIRROR_TOKEN}/***/g"
echo "published to ${public}.wiki"
