# Keeping Agent Skills in Sync

The feature-flags, experiments, and analytics skills live in [growthbook/skills](https://github.com/growthbook/skills). They ship in the Claude/Cursor plugin and, pinned by `packages/back-end/agent-skills.lock.json`, in the in-app assistant (see `packages/back-end/src/agent/README.md`). Each skill encodes REST paths, payload shapes, enum values, and guardrails from this repo. When those change here and the skill does not, agents call endpoints that no longer exist or send payloads that fail validation.

## What counts as a skill-affecting change

- Adding, removing, or renaming an operation under `packages/back-end/src/api/`.
- Changing a request or response shape, required field, or enum in `packages/shared/src/validators/` that an external API handler uses.
- Changing behavior a skill guardrail describes, such as approval/review gates, revision publishing, stale-flag criteria, experiment start/stop checks, or rate limits.
- Changing docs that skills cite as the source of truth: `docs/statistics/`, `docs/experimentation-analysis/`, `docs/features/`, `docs/app/experiment-results.mdx`, `docs/app/experiment-decisions.mdx`, `docs/app/sticky-bucketing.mdx`, `docs/app/metrics.mdx`, and `docs/api/introduction.mdx`. The full map is in growthbook/skills `CLAUDE.md`.

Internal API changes (`src/controllers/`, `src/routers/`) do not affect skills.

## Check for drift

Run the checker against a growthbook/skills checkout:

```bash
git clone https://github.com/growthbook/skills ../skills   # once
node scripts/check-agent-skills-drift.mjs --skills ../skills
```

To see which skills your branch affects, pass the spec from your base:

```bash
git show origin/main:packages/back-end/generated/spec.yaml > /tmp/base-spec.yaml
node scripts/check-agent-skills-drift.mjs --skills ../skills --base-spec /tmp/base-spec.yaml
```

The report has three sections:

- **Skills affected by this change** — operations whose spec changed and the skill files that use them. Read each file and decide whether it needs an edit.
- **References to endpoints that do not exist** — a skill calls a path or method missing from the spec.
- **References to deprecated endpoints** — a skill uses an operation marked deprecated; move it to the replacement.

The checker reads only absolute references such as `GET /api/v2/features/<id>`, so it cannot see behavior or guardrail changes. Review those by hand using the list above.

CI runs the same check (`.github/workflows/agent-skills-drift.yml`) on PRs that change `spec.yaml`. It fails only when the PR removes an operation a skill uses; everything else is a warning in the job summary. It runs again after the merge to `main`, and if skills are affected it sends a `growthbook-api-changed` dispatch to growthbook/skills (requires the `SKILLS_BOT_TOKEN` secret) so Claude updates the skills there and opens a draft `sync/growthbook` PR. That workflow also runs weekly for behavior changes the spec cannot show.

## When your change affects a skill

1. Note the affected skill files in the PR description.
2. Open a PR in growthbook/skills that updates them, or leave it to the sync job. Follow that repo's `CLAUDE.md`. The Zod validators here are the contract. If you open one, link it in this PR's description as `growthbook/skills#<number>`. When this PR merges, the sync job adds any further edits to that PR instead of opening another one.
3. After the skills PR merges, the `Bump agent skills` workflow opens a PR here that updates `packages/back-end/agent-skills.lock.json` (weekdays, or run it manually), so the in-app assistant picks it up.

If the API change is not deployed yet, merge the skills PR after the API ships. Plugin users run skills `main` against GrowthBook Cloud.
