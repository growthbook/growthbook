#!/usr/bin/env bash
# Prints what changed between two revisions that self-hosters building from source depend on.
set -euo pipefail
base=$1
head=$2

mapfile -t paths < "$(dirname "$0")/../build-change-paths.txt"
# --no-renames so renaming a build file away still lists the old path
git diff --no-renames --name-only "$base" "$head" -- "${paths[@]}"

fields='{packageManager, engines, scripts: (.scripts // {} | with_entries(select(.key | test("^(build|start)"))))}'
if [ "$(git show "$base:package.json" | jq -cS "$fields")" != "$(git show "$head:package.json" | jq -cS "$fields")" ]; then
  echo "package.json (packageManager, engines, or build/start scripts)"
fi
