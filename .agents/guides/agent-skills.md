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
git show "$(git merge-base HEAD origin/main):packages/back-end/generated/spec.yaml" > /tmp/base-spec.yaml
node scripts/check-agent-skills-drift.mjs --skills ../skills --base-spec /tmp/base-spec.yaml
```

The report has these sections:

- **Skills affected by this change** — operations a skill uses that were removed (including a literal route that now falls through to a `{param}` sibling), newly deprecated, or changed. Changes inside shared `components` schemas count; description and example text does not. Read each file and decide whether it needs an edit.
- **New findings compared with the baseline skills** — with `--baseline-skills <dir>`, broken references the baseline checkout did not have.
- **References to endpoints that do not exist** — a skill calls a path or method missing from the spec.
- **References to deprecated endpoints** — a skill uses an operation marked deprecated; move it to the replacement.

The checker reads only references with a method and a versioned path, such as `GET /api/v2/features/<id>` or `POST /v2/features`, so it cannot see behavior or guardrail changes. Review those by hand using the list above. Add `--json` for machine-readable output.

CI runs the same check (`.github/workflows/agent-skills-drift.yml`) on PRs that change `spec.yaml` or the lock file, against the skills commit pinned in `agent-skills.lock.json` (what deploys ship). It fails when the PR removes or deprecates an operation a pinned skill uses (the in-app assistant drops deprecated routes), or when a lock bump pins skills with broken references the previous pin did not have. Everything else is a warning in the job summary.

After a merge to `main`, the job checks growthbook/skills `main` and, if a skill uses a changed operation, sends a `growthbook-api-changed` dispatch to growthbook/skills (requires the `SKILLS_BOT_TOKEN` secret). The sync workflow there reviews every watched commit since its last run, updates the skills, and opens or updates a draft `sync/growthbook` PR. It also runs weekly for behavior changes the spec cannot show.

## When your change affects a skill

1. Note the affected skill files in the PR description.
2. Open a PR in growthbook/skills that updates them, or leave it to the sync job. Follow that repo's `CLAUDE.md`. The Zod validators here are the contract. If you open one, link it in this PR's description as `growthbook/skills#<number>`. The sync job then leaves this PR's skill changes to your skills PR. When it reviews this PR on its own, it adds any remaining edits there as a commit; otherwise it lists the pairing in its sync PR.
3. After the skills PR merges, the `Bump agent skills` workflow opens a PR here that updates `packages/back-end/agent-skills.lock.json` (weekdays, or run it manually), so the in-app assistant picks it up.

If the API change is not deployed yet, merge the skills PR after the API ships. Plugin users run skills `main` against GrowthBook Cloud.
