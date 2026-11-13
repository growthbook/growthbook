# Backport (patch) releases

Read this before preparing a patch release such as 5.2.1, or before changing
`.github/workflows/backport.yml`, `.github/scripts/backport.sh` or
`.github/scripts/backport-candidates.sh`.

## How it works

- All work lands on `main`. A patch release `vX.Y.Z` is a tag on a long-lived `release/X.Y`
  branch: the `vX.Y.0` tag plus commits cherry-picked from `main`. A release branch never
  merges back into `main`.
- Every pick is made with `git cherry-pick -x`. The `(cherry picked from commit <sha>)` line it
  adds is the only record of what has been backported, and `backport-candidates.sh` reads it.
  Never remove or edit that line.
- A tag runs the release workflows from its own commit, so `release/X.Y` carries `main`'s copies
  of `release.yml`, `build-image.yml`, `release-notes.yml` and the scripts they call.
  `backport.sh` copies them when it creates the branch and warns when they have drifted from
  `main` since.
- Patch releases exist for self-hosted users. Docs deploy from `main`, and the release
  workflows don't publish the SDK packages, so a pick's changes under `docs/` or to SDK source
  don't ship with the patch.

## Which workflows run for a release branch

Only the Backport workflow is tied to `main`. The workflows that publish a release are
triggered by the tag and run from the tagged commit, whichever branch it is on.

| Event                    | Workflow                   | What it does                                                                    |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------- |
| PR into `release/X.Y`    | CI and the other PR checks | Same as a PR into `main`                                                        |
| Push to `release/X.Y`    | Helm Chart                 | Lints and packages the chart. CI doesn't run on these pushes                    |
| Tag `vX.Y.Z` pushed      | Release                    | Builds the tagged commit and pushes `growthbook/growthbook:X.Y.Z` to Docker Hub |
| Tag `vX.Y.Z` pushed      | Helm Chart                 | Pushes chart `X.Y.Z` to `oci://ghcr.io/growthbook/charts`                       |
| GitHub release published | Release notes              | Appends "Self-hosted build changes" to the release notes                        |

A patch release leaves these alone, because they only follow `main`: the Docker Hub `:latest`
tag and GrowthBook Cloud (Deploy), the docs site (Docs), the SDK packages, and the version in
`main`'s `package.json`.

## Who decides what goes in

The person running the release says yes or no to every candidate commit. An agent's job is to
list the candidates with what each one fixes, how big it is, whether it applies cleanly on the
release branch and whether it only matters outside self-hosted. Don't cherry-pick or push
anything until they have decided.

Fixes and security fixes are the usual picks. A feature goes in only when it is chosen on
purpose.

## Steps

### 1. List the candidates

```bash
.github/scripts/backport-candidates.sh 5.2
```

This lists the `main` commits after the newest one already picked onto `origin/release/5.2`,
or after `v5.2.0` if there are none. Commits that only touch `docs/` or `.github/` are left
out. Commits before that point count as decided. Nothing records a "no", so a commit rejected
after the newest pick comes up again on the next pass.

While picks sit on a backport branch that hasn't landed yet, point the script at that branch
instead: `git fetch origin <branch>`, then
`.github/scripts/backport-candidates.sh 5.2 origin/<branch>`.

### 2. Pick the commits

**From GitHub Actions.** Run the Backport workflow from `main` with `line` (`5.2`) and
`commits` (PR numbers or `main` commit SHAs, in any order). It picks them in `main`'s order
onto a new `backport/<line>-<run id>` branch, opens a PR into `release/<line>`, and creates or
adds to the draft release for the next patch version. GitHub doesn't start CI on a PR opened
by Actions: close and reopen the PR to run it.

**Locally, when a pick conflicts.** A conflict the script can't resolve fails the Actions run
before it pushes anything. Run the same script from a clean working tree instead. It needs
`gh`, `jq` and `pnpm`.

```bash
bash .github/scripts/backport.sh 5.2 backport/5.2-<date> origin/main <PR numbers or SHAs>
```

- The branch name must be new. The script checks out `release/<line>` (creating it from the
  line's newest tag if it doesn't exist) and starts the branch from there.
- On a conflict it stops and prints the two commands to use next. Resolve the files,
  `git add` them, and run the printed `--continue` command; `--abort` drops the run and
  returns to where it started. Use the printed path: the release branch has no copy of the
  script, so the run keeps one under `.git`.
- It resolves two kinds of conflict by itself. `pnpm-lock.yaml` keeps the release's copy and
  is regenerated after the last pick. `package.json` takes only the values the commit changed.
- When it finishes, `git push origin release/<line> <branch>`, then run the Backport workflow
  with `branch` set to that branch instead of `commits`. It skips the cherry-picks and opens
  the PR and the draft release.

**Adding picks to a backport branch that is already open.** `backport.sh` always starts a new
branch. To add to an existing one, `git cherry-pick -x <sha>` onto it, keeping the picks in
`main`'s order (rebuild the branch and push with `--force-with-lease` when a new pick belongs
before an existing one). If a pick changes a `package.json`, run
`pnpm install --lockfile-only --ignore-scripts` and commit the lockfile. Add the pick to the
PR description, and to its "Self-hosted build impact" section when the pick changes build
files.

### 3. Land the picks on the release branch

Don't use the merge button on the backport PR. The repo only allows squash merges, and a
squash would turn every pick into one commit. Fast-forward `release/<line>` to the PR's head
instead, so each pick keeps its own commit and the release branch gets exactly the commits CI
tested. GitHub then shows the PR as merged.

1. Review the PR and mark it ready for review.
2. Check that CI passed on the head commit you are about to land:
   `gh pr view <PR> --json headRefOid,statusCheckRollup`.
3. Push that commit to the release branch. Without `--force`, git refuses anything but a
   fast-forward:

   ```bash
   git fetch origin
   git push origin origin/<backport branch>:refs/heads/release/<line>
   ```

4. Confirm the PR now says "Merged", then delete the backport branch.

If the push is rejected, `release/<line>` has moved since the backport branch was cut. Rebase
the backport branch onto `origin/release/<line>` (the `(cherry picked from commit …)` lines
survive a rebase), push it with `--force-with-lease`, wait for CI, and try again. Never
force-push `release/<line>`.

### 4. Commit the version bump

Do this when the release is ready to cut, as one commit named `Release X.Y.Z` made directly on
`release/<line>`. `main` isn't bumped for a patch release.

```bash
git fetch origin
git switch release/<line> && git merge --ff-only origin/release/<line>
pnpm install
pnpm build:deps   # the spec generator needs the SDK and shared packages built
```

Change the version from the previous one to `X.Y.Z` in:

- `package.json`: `version`
- `charts/growthbook/Chart.yaml`: `version`, `appVersion` and the image under
  `artifacthub.io/images`
- `charts/growthbook/charts/server/Chart.yaml`: `appVersion`

Then regenerate the OpenAPI spec, which reads the version from `package.json`, and commit:

```bash
pnpm --filter back-end generate-openapi
git diff --shortstat   # 5 files changed, 7 insertions(+), 7 deletions(-)
git commit -am "Release X.Y.Z"
git push origin release/<line>
```

The commit changes one version line each in `package.json`,
`charts/growthbook/charts/server/Chart.yaml`, `packages/back-end/generated/spec.yaml` and
`docs/openapi.yaml`, and three in `charts/growthbook/Chart.yaml`. Anything else in the diff
means the generated spec was out of date on the branch: stop and find out why.

This is the same set of files as the `Release X.Y` commit that cuts a minor release on
`main`, minus one. That commit also points the "X.Y Release Notes" links in
`packages/front-end/components/GetStarted/DocumentationSidebar.tsx` at the new tag. A patch
release leaves them on `vX.Y.0`, where the release's feature notes are.

CI doesn't run on a push to a release branch. To get a CI run for the bump, push it to its
own branch, open a PR into `release/<line>`, and land it with the same fast-forward push as
step 3.

Without the bump, the tag republishes the previous Helm chart version pointing at the previous
image.

### 5. Tag and publish

Publishing a GitHub release creates the tag at the head of `release/<line>` at that moment, so
publish only after the picks and the `Release X.Y.Z` commit are on the branch.

1. Check the head is the bump: `git log -1 --format='%h %s' origin/release/<line>`.
2. If the Backport workflow didn't leave a draft release (the PR was opened by hand), create
   one, with the picks as its notes:

   ```bash
   git log --reverse --grep='^(cherry picked from' --format='- %s' \
     vX.Y.<previous>..origin/release/<line> > notes.md
   gh release create vX.Y.Z --draft --latest=false --target release/<line> \
     --title vX.Y.Z --notes-file notes.md
   ```

   Put `## Security Patch Release` at the top of the notes when a pick is a security fix. The
   workflow's `security` input does this for its own drafts, and is on by default: turn it
   off when no pick is a security fix.

3. Publish the draft. Tick "Set as the latest release" when the patch is on the newest
   release line, and leave it off when patching an older line.

### 6. Check the release

The tag starts Release and Helm Chart, and publishing starts Release notes:

```bash
gh run list --workflow Release --limit 1
gh run list --workflow "Helm Chart" --limit 3
gh run list --workflow "Release notes" --limit 1
docker buildx imagetools inspect growthbook/growthbook:X.Y.Z
helm show chart oci://ghcr.io/growthbook/charts/growthbook --version X.Y.Z
```

- The image exists on Docker Hub for `linux/amd64` and `linux/arm64`.
- The chart's `version` and `appVersion` are both `X.Y.Z`.
- The release notes end with "Self-hosted build changes" if a pick changed build files. That
  section is built from the backport PR's "Self-hosted build impact" section, and lists the
  PR once per pick that changed build files: remove any repeats by hand.
