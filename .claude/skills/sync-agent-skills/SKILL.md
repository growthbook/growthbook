---
name: sync-agent-skills
description: Find and fix drift between this repo's REST API/docs and the growthbook/skills agent skills, then open a skills PR and bump agent-skills.lock.json. Use when the user says "sync skills", "are our skills up to date", "update the skills for this API change", or after changing packages/back-end/src/api, shared validators, or docs the skills cite.
---

# Sync agent skills

Read `.agents/guides/agent-skills.md` first. It defines what counts as a skill-affecting change and how the checker works.

## 1. Get a skills checkout

Use `$SKILLS_SRC`, `skills-src/`, or the `path` in `packages/back-end/agent-skills.local.json` if one has a `skills/` directory. Otherwise clone `https://github.com/growthbook/skills` into a temp directory. Pull `main` before comparing.

## 2. Decide the scope

- **This branch:** base spec is `git show $(git merge-base HEAD origin/main):packages/back-end/generated/spec.yaml`. Regenerate the head spec first with `pnpm --filter back-end generate-openapi`.
- **Catch-up since the last sync:** the last reviewed GrowthBook commit is in the growthbook/skills `sync-state` tag (`git -C <checkout> for-each-ref refs/tags/sync-state --format='%(contents)'`, field `growthbook`). Use its spec as the base, and list `git log <that commit>..origin/main -- $(grep -v '^#' scripts/agent-skills-watch-paths.txt)` for behavior changes the spec cannot show.

## 3. Run the checker

```bash
node scripts/check-agent-skills-drift.mjs --skills <checkout> --base-spec <base-spec>
```

## 4. Verify each finding against the source

For every affected operation, missing reference, and deprecated reference:

- Read the handler in `packages/back-end/src/api/` and its validator in `packages/shared/src/validators/`. The Zod schema is the contract.
- Read the skill file and decide what is actually wrong: path, method, payload field, enum, guardrail, or nothing.
- For commits from the catch-up log, read the diff and check whether any skill guardrail describes the old behavior.

Drop findings where the skill is already correct. Do not change a skill based only on a doc; when docs and code disagree, follow the code and tell the user about the doc.

## 5. Edit the skills

Follow growthbook/skills `CLAUDE.md` and the "Edit" and "Review your own edits" rules in its `.github/sync/prompt.md`, which the sync job uses too. Re-run the checker until the findings you fixed are gone, then run the same guard CI runs. Leave the edits uncommitted, and set `BASE_SHA` to the commit you started from:

```bash
SKILLS_DIR=<checkout> BASE_SHA=<commit you started from> \
  CHECKER=scripts/check-agent-skills-drift.mjs SPEC=packages/back-end/generated/spec.yaml \
  node <checkout>/.github/sync/sync.mjs guard
```

It prints "Guard passed" or the list of problems, and exits 1 on any problem.

## 6. Hand off

Show the user the findings and the proposed skills diff. Only after they confirm:

1. If an open growthbook/skills PR already covers this change (it names the GrowthBook PR, or the GrowthBook PR links it), add a commit there. Otherwise open a PR on a new branch and link it from the GrowthBook PR as `growthbook/skills#<number>`.
2. After it merges, the `Bump agent skills` workflow updates `packages/back-end/agent-skills.lock.json` here. Run it manually if the bump can't wait for the next weekday.

Never push or open PRs without confirmation.
