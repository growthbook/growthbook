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

# A tag runs release.yml and release-notes.yml from its own commit, so the branch needs main's copies.
synced=(.github/workflows/release.yml .github/workflows/build-image.yml .github/workflows/release-notes.yml
  .github/scripts/build-changes.sh .github/scripts/build-impact-section.sh .github/build-change-paths.txt)
if git ls-remote --exit-code --heads origin "$release" >/dev/null; then
  git checkout -B "$release" "origin/$release"
  # Re-copying them would be a workflow change, which GITHUB_TOKEN can't push.
  git diff --quiet "$source_ref" -- "${synced[@]}" ||
    echo "::warning::$release's release workflows differ from main's; copy ${synced[*]} over by hand before tagging"
else
  tag=$(git tag --list "v$line.*" --sort=-v:refname | head -n1)
  [ -n "$tag" ] || { echo "::error::No v$line.* tag to branch from"; exit 1; }
  git checkout -B "$release" "$tag"
  git checkout "$source_ref" -- "${synced[@]}"
  git diff --cached --quiet || git commit -m "Use main's release workflows on $release"
fi
git checkout -B "$branch"

# The package@version entries in a commit's pnpm-lock.yaml.
lock_versions() {
  git show "$1:pnpm-lock.yaml" | sed -nE "s/^  '?(@?[^@ (']+@[^(:' ]+)[^:]*:( \{\})?\$/\1/p" | sort -u
}
dropped=$(mktemp)

for ref in "$@"; do
  ref=${ref#\#}
  sha=$ref
  if [[ $ref =~ ^[0-9]+$ ]]; then
    sha=$(gh pr view "$ref" --json mergeCommit --jq '.mergeCommit.oid // empty')
  fi
  if ! git rev-parse -q --verify "$sha^{commit}" >/dev/null || ! git merge-base --is-ancestor "$sha" "$source_ref"; then
    echo "::error::$ref isn't a PR merged into main or a commit on main"
    exit 1
  fi
  comm -23 <(lock_versions "$sha^") <(lock_versions "$sha") | sed "s/\$/ $ref/" >>"$dropped"
  if git cherry-pick -x "$sha"; then continue; fi

  mapfile -t conflicted < <(git diff --name-only --diff-filter=U)
  if [ ${#conflicted[@]} -eq 0 ]; then
    git cherry-pick --skip
    echo "::notice::$ref is already on $release, skipped"
    continue
  fi
  # Dependency bumps conflict on manifests almost every time; anything else, or a manifest one side
  # added or deleted, needs a person.
  for f in "${conflicted[@]}"; do
    case $f in
      package.json | */package.json)
        git cat-file -e ":1:$f" 2>/dev/null && git cat-file -e ":2:$f" 2>/dev/null &&
          git cat-file -e ":3:$f" 2>/dev/null && continue
        ;;
      pnpm-lock.yaml) continue ;;
    esac
    git cherry-pick --abort
    echo "::error::$ref conflicts in $f on $release; backport it by hand"
    exit 1
  done
  for f in "${conflicted[@]}"; do
    if [ "$f" = pnpm-lock.yaml ]; then
      # Keep the release's lockfile; the pnpm install below resolves this commit's manifest changes into it.
      git checkout --ours -- "$f"
    else
      # Apply only the values this commit changed; a text merge would also pull in main's neighbouring lines.
      # Arrays count as one value, and need a person if the release's copy differs from main's; a
      # diverged scalar, like a version range, still takes the commit's value but is flagged.
      jq --indent 2 --arg ref "$ref" --arg f "$f" --argjson base "$(git show ":1:$f")" --argjson theirs "$(git show ":3:$f")" '
        reduce ([$base, $theirs] | map([path(recurse(objects[]) | select(type != "object"))]) | add | unique[]) as $p (.;
          ($base | getpath($p)) as $b | ($theirs | getpath($p)) as $t |
          if $b == $t then .
          elif ([$b, $t] | any(type == "array")) and getpath($p) != $b then
            "::error::\($ref) changes \($p | join(".")) in \($f), which differs on the release; backport it by hand\n" | halt_error
          else
            (if getpath($p) != $b then
              "::warning::\($ref) sets \($p | join(".")) in \($f) to \($t | tojson), but the release had \(getpath($p) | tojson), not \($b | tojson)\n" | stderr
            else null end) as $_ |
            if $t == null then delpaths([$p]) else setpath($p; $t) end
          end)
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

# A conflicting lockfile keeps the release's, which loses lockfile-only bumps, so check what the picks removed is gone.
stale=$(awk 'NR == FNR { have[$1]; next } $1 in have { print "  " $1 " (removed by " $2 ")" }' <(lock_versions HEAD) "$dropped")
if [ -n "$stale" ]; then
  printf '::error::pnpm-lock.yaml still has versions the picks removed; update them by hand:\n%s\n' "$stale"
  exit 1
fi
