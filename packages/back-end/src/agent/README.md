# Agent skills

The in-app assistant's flag, experiment, and analytics skills come from
[growthbook/skills](https://github.com/growthbook/skills). They are copied at
build time, not checked in.

`pnpm assemble-skills` (also run by `dev` and `build`) writes
`generated/agent-skills/`. An allowlist in `scripts/assemble-agent-skills.mjs`
copies only `feature-flags`, `experiments`, and `analytics` — not `gb-setup`.
Skills that exist only for this assistant live in `skills-local/` and are
merged in after. A local skill whose name matches an allowlisted one is skipped.

## Local checkout

Copy `packages/back-end/agent-skills.local.json.example` to
`packages/back-end/agent-skills.local.json` and set `path` to a
growthbook/skills checkout, relative to the GrowthBook repo root:

```json
{ "path": "../skills" }
```

`$SKILLS_SRC` overrides that. If neither is set, assembly looks in
`skills-src/` (what CI uses) and otherwise ships only `skills-local`.

## CI and updates

`agent-skills.lock.json` pins the commit. Deploy, deploy-branch, and preview
check it out into `skills-src/` before the image build. To pick up upstream
changes, bump the commit in the lock file.
