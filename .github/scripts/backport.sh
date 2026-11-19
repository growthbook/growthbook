#!/usr/bin/env bash
# Cherry-picks main commits onto a new branch off release/<line>, oldest first in main's order whatever
# order they're given in, creating release/<line> from the line's newest tag if needed. Given a branch
# that already exists on origin, it adds the picks to that branch instead.
# Usage: backport.sh <line> <branch> <source-ref> <sha-or-PR#>...
#        backport.sh --continue  after resolving and `git add`-ing the conflict it stopped on
#        backport.sh --abort      to drop the run and go back to where it started
# In GitHub Actions a conflict it can't resolve fails the run. Run it locally instead, resolve the
# conflict, push release/<line> and the branch, and pass the branch to the Backport workflow.
set -euo pipefail
# Every commit here is mechanical, so the repo's lint hooks (often absent) shouldn't gate them.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null
# A paused run keeps its settings, the commits still to pick, and a copy of this script here, since
# the release branch it stops on may not have the script.
state="$(git rev-parse --absolute-git-dir)/backport"

# The package@version entries in a commit's pnpm-lock.yaml.
lock_versions() {
  git show "$1:pnpm-lock.yaml" | sed -nE "s/^  '?(@?[^@ (']+@[^(:' ]+)[^:]*:( \{\})?\$/\1/p" | sort -u
}

# Resolves the conflicts that need no judgment and stages them; fails for anything that needs a person.
# Dependency bumps conflict on manifests almost every time.
resolve() {
  local f=$1 ref=$2
  case $f in
    pnpm-lock.yaml | docs/openapi.yaml | packages/back-end/generated/spec.yaml)
      # Keep the release's copy; finish regenerates it from the picked manifests or validators.
      git checkout --ours -- "$f" || return 1
      ;;
    package.json | */package.json)
      # A manifest one side added or deleted needs a person.
      { git cat-file -e ":1:$f" && git cat-file -e ":2:$f" && git cat-file -e ":3:$f"; } 2>/dev/null || return 1
      # Apply only the values this commit changed; a text merge would also pull in main's neighbouring lines.
      # Arrays count as one value, and need a person if the release's copy differs from main's; a
      # diverged scalar, like a version range, still takes the commit's value but is flagged.
      jq --indent 2 --arg ref "$ref" --arg f "$f" --argjson base "$(git show ":1:$f")" --argjson theirs "$(git show ":3:$f")" '
        reduce ([$base, $theirs] | map([path(recurse(objects[]) | select(type != "object"))]) | add | unique[]) as $p (.;
          ($base | getpath($p)) as $b | ($theirs | getpath($p)) as $t |
          if $b == $t then .
          elif ([$b, $t] | any(type == "array")) and getpath($p) != $b then
            "\($ref) changes \($p | join(".")) in \($f), which differs on the release\n" | halt_error
          else
            (if getpath($p) != $b then
              "::warning::\($ref) sets \($p | join(".")) in \($f) to \($t | tojson), but the release had \(getpath($p) | tojson), not \($b | tojson)\n" | stderr
            else null end) as $_ |
            if $t == null then delpaths([$p]) else setpath($p; $t) end
          end)
      ' <(git show ":2:$f") >"$state/manifest" || return 1
      mv "$state/manifest" "$f"
      ;;
    *) return 1 ;;
  esac
  git add "$f"
}

# Stops on a conflict that needs a person: fails the run in CI, pauses it locally.
stop() {
  local ref=$1
  shift
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    git cherry-pick --abort
    rm -rf "$state"
    echo "::error::$ref conflicts in $* on $release. Run backport.sh locally, resolve it, push $release and the branch, then run Backport with that branch."
    exit 1
  fi
  echo
  echo "$ref ($(git log -1 --format=%s "$ref")) conflicts in:"
  printf '  %s\n' "$@"
  echo "Resolve them and git add them, then run: bash $state/backport.sh --continue"
  echo "To drop this backport instead, run: bash $state/backport.sh --abort"
  exit 1
}

# Picks the commits left in $state/todo, one at a time so each one's manifest conflicts can be resolved.
pick_all() {
  local sha ref conflicted unresolved f
  while [ -s "$state/todo" ]; do
    sha=$(head -n1 "$state/todo")
    tail -n +2 "$state/todo" >"$state/todo.next"
    mv "$state/todo.next" "$state/todo"
    ref=$(git rev-parse --short "$sha")
    comm -23 <(lock_versions "$sha^") <(lock_versions "$sha") | sed "s/\$/ $ref/" >>"$state/dropped"
    if git cherry-pick -x "$sha"; then continue; fi
    # However this conflict gets resolved (here, by hand or by rerere), finish regenerates a spec it touched.
    git diff --quiet "$sha^" "$sha" -- docs/openapi.yaml packages/back-end/generated/spec.yaml || : >"$state/regen-spec"

    # Not mapfile: macOS still ships bash 3.2.
    conflicted=()
    while IFS= read -r f; do conflicted+=("$f"); done < <(git diff --name-only --diff-filter=U)
    if [ ${#conflicted[@]} -eq 0 ]; then
      if git diff --cached --quiet; then
        git cherry-pick --skip
        echo "::notice::$ref is already on $release, skipped"
      else
        # rerere.autoupdate staged a resolution recorded on an earlier run.
        echo "::notice::$ref reused a conflict resolution git recorded earlier (rerere)"
        git -c core.editor=true cherry-pick --continue
      fi
      continue
    fi
    unresolved=()
    for f in "${conflicted[@]}"; do
      resolve "$f" "$ref" || unresolved+=("$f")
    done
    [ ${#unresolved[@]} -eq 0 ] || stop "$ref" "${unresolved[@]}"
    git -c core.editor=true cherry-pick --continue
  done
}

finish() {
  # Resolve the picked manifests into the picked lockfile, which also drops entries nothing uses any more.
  pnpm install --lockfile-only --ignore-scripts
  if ! git diff --quiet HEAD -- pnpm-lock.yaml; then
    git commit -m "Regenerate pnpm-lock.yaml" -- pnpm-lock.yaml
  fi
  if [ -e "$state/regen-spec" ]; then
    # Skips the root postinstall, which sets up the Python stats engine and fails without its Poetry env.
    pnpm install --frozen-lockfile --ignore-scripts
    pnpm -r --filter "./packages/**" rebuild
    pnpm build:deps
    pnpm --filter back-end generate-openapi
    git add -A -- docs packages/back-end/generated
    git diff --cached --quiet || git commit -m "Regenerate the OpenAPI spec"
  fi
  # A conflicting lockfile keeps the release's, which loses lockfile-only bumps, so check what the picks removed is gone.
  local stale
  stale=$(awk 'NR == FNR { have[$1]; next } $1 in have { print "  " $1 " (removed by " $2 ")" }' <(lock_versions HEAD) "$state/dropped")
  rm -rf "$state"
  if [ -n "$stale" ]; then
    printf '::error::pnpm-lock.yaml still has versions the picks removed; update them by hand:\n%s\n' "$stale"
    exit 1
  fi
}

case ${1:-} in
  --continue)
    [ -d "$state" ] || { echo "::error::No paused backport to continue"; exit 1; }
    # shellcheck source=/dev/null
    . "$state/env"
    [ "$(git branch --show-current)" = "$branch" ] || { echo "::error::Switch back to $branch to continue"; exit 1; }
    if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null; then
      if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
        echo "::error::Resolve and git add these first:"
        git diff --name-only --diff-filter=U | sed 's/^/  /'
        exit 1
      fi
      # A resolution that keeps none of the commit's changes leaves nothing to commit.
      if git diff --cached --quiet; then git cherry-pick --skip; else git -c core.editor=true cherry-pick --continue; fi
    fi
    pick_all
    finish
    ;;
  --abort)
    [ -d "$state" ] || { echo "::error::No paused backport to abort"; exit 1; }
    # shellcheck source=/dev/null
    . "$state/env"
    if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null; then git cherry-pick --abort; fi
    git checkout -q "$start"
    # Put a branch that existed before the run back where it was; delete one the run created.
    if [ -z "${orig:-}" ]; then
      git branch -D "$branch"
    elif [ "$start" = "$branch" ]; then
      git reset -q --hard "$orig"
    else
      git branch -f "$branch" "$orig"
    fi
    rm -rf "$state"
    ;;
  *)
    [ $# -ge 4 ] || { echo "Usage: backport.sh <line> <branch> <source-ref> <sha-or-PR#>... | --continue | --abort"; exit 1; }
    [ ! -d "$state" ] || { echo "::error::A backport is paused; run backport.sh --continue or --abort first"; exit 1; }
    line=$1
    branch=$2
    source_ref=$3
    shift 3
    release="release/$line"
    [[ $line =~ ^[0-9]+\.[0-9]+$ ]] || { echo "::error::Release line must look like 5.1, got '$line'"; exit 1; }
    # A branch on origin is added to; a local branch is reset below, so it must not have anything origin lacks.
    base=$release
    if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
      git fetch -q origin "$branch"
      base=origin/$branch
    fi
    if git show-ref -q --verify "refs/heads/$branch" &&
      ! git merge-base --is-ancestor "refs/heads/$branch" "refs/remotes/origin/$branch" 2>/dev/null; then
      echo "::error::Local branch $branch has commits that aren't on $base; push them or pass a new name"
      exit 1
    fi
    start=$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)
    orig=$(git rev-parse -q --verify "refs/heads/$branch" || true)
    # Copy the script now; checking out the release branch below may remove it.
    self=$(mktemp)
    cp "${BASH_SOURCE[0]}" "$self"

    shas=()
    for ref in "$@"; do
      ref=${ref#\#}
      sha=$ref
      # A short SHA can be all digits too, but it has at least seven.
      if [[ $ref =~ ^[0-9]{1,6}$ ]]; then
        sha=$(gh pr view "$ref" --json mergeCommit --jq '.mergeCommit.oid // empty')
      fi
      if ! git rev-parse -q --verify "$sha^{commit}" >/dev/null || ! git merge-base --is-ancestor "$sha" "$source_ref"; then
        echo "::error::$ref isn't a PR merged into main or a commit on main"
        exit 1
      fi
      shas+=("$(git rev-parse "$sha^{commit}")")
    done

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
    git checkout -B "$branch" "$base"
    git merge-base --is-ancestor "$release" HEAD ||
      { echo "::error::$branch isn't on top of $release; rebase it first"; exit 1; }

    mkdir -p "$state"
    mv "$self" "$state/backport.sh"
    printf 'branch=%q\nrelease=%q\nstart=%q\norig=%q\n' "$branch" "$release" "$start" "$orig" >"$state/env"
    : >"$state/dropped"
    # Main commits the branch already has picks of, newest first.
    picked=$(git log --format=%b "$release..HEAD" | sed -n 's/^(cherry picked from commit \([0-9a-f]*\))$/\1/p')
    # Main's commits since the release branched off, in order, kept to the ones asked for and not yet
    # picked. Anything older is already on the release.
    git rev-list --reverse "$(git merge-base HEAD "$source_ref")..$source_ref" |
      grep -Fx -f <(printf '%s\n' "${shas[@]}") | grep -vFx -f <(printf '%s\n' "$picked") >"$state/todo" || true
    for sha in "${shas[@]}"; do
      grep -qFx "$sha" "$state/todo" || echo "::notice::$(git rev-parse --short "$sha") is already on $branch, skipped"
    done
    # Appended picks keep main's order among themselves only; rebuilding the branch would redo its resolutions.
    [ -z "$picked" ] || while read -r sha; do
      if git merge-base --is-ancestor "$sha" "${picked%%$'\n'*}"; then
        echo "::warning::$(git rev-parse --short "$sha") is older on main than $branch's last pick, so it lands out of main's order"
      fi
    done <"$state/todo"
    echo "Picking $(wc -l <"$state/todo" | tr -d ' ') commits in main's order"
    pick_all
    finish
    ;;
esac
