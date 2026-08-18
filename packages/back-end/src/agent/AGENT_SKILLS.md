# In-app agent skills

The in-app assistant's skills are assembled at build time instead of being
maintained as copies in this repository.

## Sources

`scripts/bundle-agent-skills.mjs` combines:

1. An explicit allowlist from
   [`growthbook/skills`](https://github.com/growthbook/skills):
   `feature-flags`, `experiments`, and `analytics`.
2. In-app-only skills checked into `src/agent/skills-local/`.

`gb-setup` is intentionally absent because the in-app assistant uses the
logged-in GrowthBook session. A local skill may not have the same top-level name
as an allowlisted canonical skill; the bundler fails on collisions instead of
silently overriding one source.

The assembled tree is written atomically to `generated/agent-skills/`, which is
gitignored, then copied to `dist/agent/skills/` by `build:skills`.
Assembly fails when a generated `loadSkill(...)` call points at a skill or
reference that is not present in that tree.

## Finding the canonical checkout

The bundler resolves the skills repository in this order:

1. `$SKILLS_SRC`
2. `../skills`, then `../../skills`, relative to this repository

CI and deploy workflows check out the default branch of `growthbook/skills` into
`skills-src`, set `SKILLS_SRC`, and fail if it is unavailable. Local builds warn
when no checkout exists. They reuse an existing canonical assembly when
available, or assemble only local skills otherwise.

```bash
git clone https://github.com/growthbook/skills ../skills
pnpm --filter back-end bundle:skills
```

`dev`, `build`, and `test` invoke the bundler automatically.

## Runtime adaptation

Canonical skills describe REST calls through `gb-call`. At bundle time the
adapter only rewrites `references/<workflow>.md` links to
`loadSkill('<domain>/references/<workflow>')`.

All other canonical content is preserved so runtime testing can reveal which
compatibility adjustments are actually necessary. The system prompt tells the
assistant to translate `gb-call` examples to `callApi` and ignore shell,
credential, host, and setup instructions.

Page context, active-datasource hints, mutation gating, chart rendering, and
other host behavior belong in `general-agent.ts`, not canonical skill content.

## Making changes

- Change workflow semantics, API payloads, and guardrails in
  `growthbook/skills`, then rebuild.
- Add a canonical domain by reviewing its runtime compatibility and adding its
  top-level name to `CANONICAL_SKILLS`.
- Add an in-app-only domain as
  `src/agent/skills-local/<name>/SKILL.md`, with optional
  `references/*.md`. Local routers are already runtime-native and should refer
  to leaves with `loadSkill('<domain>/references/<name>')`.
- Never edit `generated/agent-skills/` or `dist/agent/skills/`.

Only top-level `SKILL.md` files require `name` and `description` frontmatter.
Reference files are addressed by their qualified path and may be plain Markdown.
If a canonical reference includes frontmatter for another client, the loader
strips it from the body but does not use it for routing.

The canonical repository remains the source of truth for API and methodology
guidance. Runtime-specific exceptions should stay small and explicit in the
adapter.
