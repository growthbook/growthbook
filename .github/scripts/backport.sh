#!/usr/bin/env bash
# Cherry-picks main commits onto a new branch off release/<line>, creating release/<line> from the
# line's newest tag if needed. Usage: backport.sh <line> <branch> <source-ref> <sha-or-PR#>...
set -euo pipefail
line=$1
branch=$2
source_ref=$3
shift 3
release="release/$line"
# Every commit here is mechanical, so the repo's lint hooks (often absent) shouldn't gate them.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null

[[ $line =~ ^[0-9]+\.[0-9]+$ ]] || { echo "::error::Release line must look like 5.1, got '$line'"; exit 1; }

if git ls-remote --exit-code --heads origin "$release" >/dev/null; then
  git checkout -B "$release" "origin/$release"
else
  tag=$(git tag --list "v$line.*" --sort=-v:refname | head -n1)
  [ -n "$tag" ] || { echo "::error::No v$line.* tag to branch from"; exit 1; }
  git checkout -B "$release" "$tag"
  # A tag runs release.yml from its own commit, so the branch needs main's, which builds the tagged commit.
  git checkout "$source_ref" -- .github/workflows/release.yml .github/workflows/build-image.yml
  git diff --cached --quiet || git commit -m "Use main's release workflows on $release"
fi
git checkout -B "$branch"

for ref in "$@"; do
  sha=$ref
  if [[ $ref =~ ^[0-9]+$ ]]; then
    sha=$(gh pr view "$ref" --json mergeCommit --jq .mergeCommit.oid)
  fi
  if git cherry-pick -x "$sha"; then continue; fi

  mapfile -t conflicted < <(git diff --name-only --diff-filter=U)
  if [ ${#conflicted[@]} -eq 0 ]; then
    git cherry-pick --skip
    echo "::notice::$ref is already on $release, skipped"
    continue
  fi
  # Dependency bumps conflict on manifests almost every time; anything else needs a person.
  for f in "${conflicted[@]}"; do
    case $f in
      package.json | */package.json | pnpm-lock.yaml) ;;
      *)
        git cherry-pick --abort
        echo "::error::$ref conflicts in $f on $release; backport it by hand"
        exit 1
        ;;
    esac
  done
  for f in "${conflicted[@]}"; do
    if [ "$f" = pnpm-lock.yaml ]; then
      # Keep the release's lockfile; the pnpm install below resolves this commit's manifest changes into it.
      git checkout --ours -- "$f"
    else
      # Apply only the values this commit changed; a text merge would also pull in main's neighbouring lines.
      # Arrays count as one value, edited by the entries this commit added or removed.
      jq --indent 2 --argjson base "$(git show ":1:$f")" --argjson theirs "$(git show ":3:$f")" '
        reduce ([$base, $theirs] | map([path(recurse(objects[]) | select(type != "object"))]) | add | unique[]) as $p (.;
          ($base | getpath($p)) as $b | ($theirs | getpath($p)) as $t |
          if $b == $t then .
          elif $t == null then delpaths([$p])
          elif ($t | type) == "array" then
            setpath($p; (getpath($p) // []) - (($b // []) - $t) | . + ($t - ($b // []) - .))
          else setpath($p; $t) end)
      ' <(git show ":2:$f") >"$f"
    fi
    git add "$f"
  done
  git -c core.editor=true cherry-pick --continue
done

# Resolve the picked manifests into the picked lockfile, which also drops entries nothing uses any more.
pnpm install --lockfile-only --ignore-scripts
if ! git diff --quiet HEAD -- pnpm-lock.yaml; then
  git commit -m "Regenerate pnpm-lock.yaml" -- pnpm-lock.yaml
fi
