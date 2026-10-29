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

# The output of git goes through sed to hide the token, and in a pipe the status is the one of sed: git is run first, its status kept, and then the output is filtered.
masked() {   # masked TOKEN command...: runs the command, prints its output without the token, returns its status
  token=$1; shift
  status=0
  out=$("$@" 2>&1) || status=$?
  [ -z "$out" ] || printf '%s\n' "$out" | sed "s/${token}/***/g"
  return "$status"
}

masked "$CI_JOB_TOKEN" git_as gitlab-ci-token "$CI_JOB_TOKEN" clone --quiet "https://${host}/${CI_PROJECT_PATH}.wiki.git" "$tmp/wiki"
cd "$tmp/wiki"
echo "wiki: $(git log --oneline | wc -l | tr -d ' ') commits, $(git ls-files '*.md' | wc -l | tr -d ' ') pages"
masked "$MIRROR_TOKEN" git_as oauth2 "$MIRROR_TOKEN" push --force --quiet "https://${host}/${public}.wiki.git" HEAD:main
echo "published to ${public}.wiki"

# The same pages on the wiki of the copy on GitHub (the links of the README point there, since the GitLab of the department is
# not reachable from outside), with the deploy key of that repository (GITHUB_DEPLOY_KEY, as in mirror-github.sh). GitHub shows
# the image sizes written the GitLab way ({height=N}) as text, so an image with a height becomes an <img> with that height and the
# other sizes are removed; GitHub has no [[_TOC_]] either, so that line goes.
if [ -n "${GITHUB_DEPLOY_KEY:-}" ]; then
  gh_repo=${GITHUB_REPO:-Antonio-Prado/aspa-explorer}
  fingerprint='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'    # the Ed25519 host key that GitHub publishes
  cp "$GITHUB_DEPLOY_KEY" "$tmp/key"
  chmod 600 "$tmp/key"
  ssh-keyscan -t ed25519 github.com > "$tmp/known_hosts" 2>/dev/null
  seen=$(ssh-keygen -lf "$tmp/known_hosts" | awk '{print $2}')
  [ "$seen" = "$fingerprint" ] || { echo "unexpected host key of github.com: $seen" >&2; exit 1; }
  git checkout --quiet -b github
  for f in *.md; do
    sed -E -e 's/!\[([^]]*)\]\(([^)]*)\)\{height=([0-9]+)\}/<img src="\2" alt="\1" height="\3">/g' \
      -e 's/\{(height|width)=[0-9]*\}//g' -e '/^\[\[_TOC_\]\]$/d' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
  git -c user.name='Antonio Prado' -c user.email=antonio.prado@dei.unipd.it commit --quiet -am "The pages as GitHub shows them" || true
  GIT_SSH_COMMAND="ssh -i $tmp/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$tmp/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes" \
    git push --force --quiet "git@github.com:${gh_repo}.wiki.git" HEAD:master
  echo "published to github.com/${gh_repo}/wiki"
fi
