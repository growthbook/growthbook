# Keeping Agent Skills in Sync

The feature-flags, experiments, and analytics skills live in [growthbook/skills](https://github.com/growthbook/skills). They ship in the Claude/Cursor plugin and, pinned by `packages/back-end/agent-skills.lock.json`, in the in-app assistant (see `packages/back-end/src/agent/README.md`). Each skill encodes REST paths, payload shapes, enum values, and guardrails from this repo. When those change here and the skill does not, agents call endpoints that no longer exist or send payloads that fail validation.

## What counts as a skill-affecting change

- Adding, removing, or renaming an operation under `packages/back-end/src/api/`.
- Changing a request or response shape, required field, or enum in `packages/shared/src/validators/` that an external API handler uses.
- Changing behavior a skill guardrail describes, such as approval/review gates, revision publishing, stale-flag criteria, experiment start/stop checks, or rate limits.
- Changing docs that skills cite as the source of truth. `scripts/agent-skills-watch-paths.txt` lists every watched path; the docs entries mirror the map in growthbook/skills `CLAUDE.md`.

Internal API changes (`src/controllers/`, `src/routers/`) do not affect skills.

## Check for drift

Run the checker against a growthbook/skills checkout:

```bash
git clone https://github.com/growthbook/skills ../skills   # once
node scripts/check-agent-skills-drift.mjs --skills ../skills
```

To see which skills your branch affects, pass the spec from where your branch started. Use the merge base, not `origin/main`; otherwise operations added on `main` since you branched show up as removed:

```bash
base=$(git merge-base HEAD origin/main) &&
  git show "$base:packages/back-end/generated/spec.yaml" > /tmp/base-spec.yaml &&
  node scripts/check-agent-skills-drift.mjs --skills ../skills --base-spec /tmp/base-spec.yaml
```

In a shallow clone, `git fetch --unshallow` first so the merge base exists. The checker refuses an empty or unparseable spec.

The report has these sections:

- **Skills affected by this change** — operations a skill uses that were removed (including a literal route that now falls through to a `{param}` sibling in router order), newly deprecated, or changed. Renaming a path parameter is not a removal. Changes inside shared `components` schemas count; descriptions, titles, examples, and code samples do not. Read each file and decide whether it needs an edit.
- **New findings compared with the baseline skills** — with `--baseline-skills <dir>`, broken references beyond what the baseline checkout had, counted per method and path, so moving a reference between files or respelling a placeholder is not new.
- **References to endpoints that do not exist** — a skill calls a path or method missing from the spec.
- **References to deprecated endpoints** — a skill uses an operation marked deprecated; move it to the replacement.

The checker resolves references in spec path order, which matches router order for every literal/`{param}` sibling pair today; if a new route ever needs to precede a sibling registered earlier, check the result by hand. It reads references with a method and a versioned path, such as `GET /api/v2/features/<id>` or `POST /v2/features`, and quoted `/api/vN/...` paths without a method. It skips negated mentions such as "not `POST /api/v1/...`". It cannot see behavior or guardrail changes. Review those by hand using the list above. Add `--json` for machine-readable output.

CI runs the same check (`.github/workflows/agent-skills-drift.yml`) on PRs that change `spec.yaml` or the lock file, against the skills commit pinned in `agent-skills.lock.json` (what deploys ship). It fails when the PR removes an operation a pinned skill uses, or when a lock bump pins skills with broken references the previous pin did not have. Deprecations and other changes are warnings in the job summary; the in-app assistant drops deprecated routes, so treat a deprecation warning as a skills update to make soon.

If your PR has to remove an operation a pinned skill uses, open the skills PR first and pin its head commit in `agent-skills.lock.json` in your PR, so the check passes and deploys ship skills that match. The bump workflow only moves the pin forward along growthbook/skills `main`, so it leaves that pin alone until the skills PR merges.

After merge, a Cursor automation keeps growthbook/skills in step: it reviews the commits that touch `scripts/agent-skills-watch-paths.txt` since its last run, following growthbook/skills `.cursor/automations/sync-from-growthbook.md`, and opens or adds to one draft sync PR there. That repo's skills guard checks every PR, the automation's included.

## When your change affects a skill

1. Note the affected skill files in the PR description.
2. Open a PR in growthbook/skills that updates them, or leave it to the sync automation. Follow that repo's `CLAUDE.md`. The Zod validators here are the contract. If you open one, link it in this PR's description as `growthbook/skills#<number>`; the automation then leaves that change to your PR.
3. After the skills PR merges, the `Bump agent skills` workflow opens a PR here that updates `packages/back-end/agent-skills.lock.json` (weekdays, or run it manually), so the in-app assistant picks it up.

If the API change is not deployed yet, merge the skills PR after the API ships. Plugin users run skills `main` against GrowthBook Cloud.
