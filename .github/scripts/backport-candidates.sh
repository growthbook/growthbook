#!/usr/bin/env bash
# Lists main commits to review for the next backport: everything on main after the newest main commit
# already cherry-picked onto the release branch (or after v<line>.0 if none is). Commits before that
# point count as decided, picked or not. Docs-only and CI-only commits are left out.
# Usage: backport-candidates.sh <line> [release-ref]   e.g. backport-candidates.sh 5.2
set -euo pipefail
line=${1:?usage: backport-candidates.sh <line> [release-ref]}
release=${2:-origin/release/$line}
base="v$line.0"
git fetch -q origin main --tags
git fetch -q origin "release/$line" 2>/dev/null || true

# Main commits on the release branch, from the -x trailers backport.sh adds.
# Backport PRs land by fast-forward, so each pick is its own commit there. A squash merge would
# keep the trailers too, but only with its default message.
picked=""
if git rev-parse -q --verify "$release^{commit}" >/dev/null; then
  picked=$(git log "$base..$release" --format=%b | sed -n 's/^(cherry picked from commit \([0-9a-f]*\))$/\1/p')
fi

# The newest of those in main's order is the starting point.
start=$base
if [ -n "$picked" ]; then
  main_shas=$(git rev-list "$base..origin/main")
  newest=$(grep -F -m1 -f <(printf '%s\n' "$picked") <<<"$main_shas" || true)
  start=${newest:-$base}
fi
echo "Reviewing main after $(git log -1 --format='%h %s' "$start")"
echo

git log --reverse --format='%H %s' "$start..origin/main" | while read -r sha subject; do
  # Docs deploy from main and CI changes don't ship in the image, so neither needs a backport.
  files=$(git diff-tree --no-commit-id --name-only -r "$sha")
  grep -qvE '^(docs/|\.github/)' <<<"$files" || continue
  printf '%s  %s\n' "${sha:0:10}" "$subject"
done
