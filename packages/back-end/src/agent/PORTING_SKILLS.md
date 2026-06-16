# Porting skills from the `skills` repo

These agent skills are **ported by hand from the upstream `skills` repo** — a
Claude Code plugin where each skill is a `SKILL.md` in its own directory. Tell the
porting agent where that repo lives when you prompt it; the location depends on
your local setup. We used to port with a deterministic script; it did string
surgery on prose and couldn't make the judgment calls a good port needs, so it was
retired in favor of an agent doing the port manually against this spec.

**This file is the prompt.** To re-sync after the upstream `skills` repo changes,
re-run an agent with: "Re-port the skills following
`packages/back-end/src/agent/PORTING_SKILLS.md`." Some drift between the two repos
is acceptable — the GrowthBook REST API contract is stable across releases, so a
slightly stale port keeps working.

## What this runtime is (and why the port is needed)

The `skills` repo targets **Claude Code as a CLI plugin**: skills shell out to a
bundled `gb-call` Node helper, read credentials from env / `~/.config/growthbook/.env`,
and gate mutations through skill prose. Our general agent is different:

- It calls the REST API through a **`callApi` tool** that takes a JSON request
  object, not a shell helper.
- It runs **inside an authenticated GrowthBook session** — no API keys, no email
  env var, no setup flow.
- **Mutations are gated by the platform**, not by the skill asking for confirmation.
- Skills load **hierarchically**: domain routers in the system prompt, leaves on
  demand via `loadSkill('<name>')`.

## Source of truth — verify endpoints before you write

The port is a translation of skills that were already vetted upstream, so the
statistical framing, lifecycle guidance, and "best practices" they carry are
settled — copy that content faithfully rather than re-deriving or re-verifying it.
The one thing to re-check is the **API surface**, since that's what this runtime
actually calls. Confirm every payload shape, endpoint path, and enum value against
the local back-end, which is authoritative here:

- `packages/back-end/src/api/<area>/` (handlers) and
  `packages/shared/src/validators/` (Zod schemas — the schema is the contract).
- When a skill's prose disagrees with the code, **trust the code** and flag the drift.

The `experiment-launch` skill is the canonical voice on experiment methodology.
When another experiment skill disagrees with it on stats framing, hypothesis
discipline, metric counts, or guardrails, align to `experiment-launch` — never the
reverse.

## File layout

```
agent/
  skills.ts                 # loader (do not port into; it's the runtime)
  PORTING_SKILLS.md         # this file
  skills/                   # agent-readable content only — everything here is copied into dist
    product-analytics.md    # backend-only, hand-authored — DO NOT overwrite from skills repo
    growthbook-docs.md      # backend-only, hand-authored — DO NOT overwrite from skills repo
    feature-flags/
      SKILL.md              # hand-written domain router — DO NOT overwrite from skills repo
      flag-*.md             # ported leaves (group: feature-flags)
    experiments/
      SKILL.md              # hand-written domain router — DO NOT overwrite from skills repo
      experiment-*.md       # ported leaves (group: experiments)
```

### Mapping (skills repo → backend)

Feature-flag leaves (→ `feature-flags/<name>.md`):
`flag-create`, `flag-search`, `flag-toggle`, `flag-targeting`, `flag-rules`,
`flag-experiment`, `flag-default-value`, `flag-metadata`, `flag-schedule`,
`flag-ramp`, `flag-prerequisites`, `flag-monitoring`, `flag-graph`,
`flag-cleanup`, `flag-review`, `flag-publish`, `flag-revisions`.

Experiment leaves (→ `experiments/<name>.md`):
`experiment-brainstorm`, `experiment-design`, `experiment-launch`,
`experiment-analyze`, `experiment-stop`.

**Do not port:**

- `gb-setup` — no env/setup flow in this runtime.
- `flag-discovery` — superseded by the backend-only `flag-search`.
- The two domain `SKILL.md` routers, `product-analytics.md`, `growthbook-docs.md`
  — these are backend-only and hand-maintained.

## The transformation contract

Apply every rule below to each leaf. The goal is a faithful port of the
**workflow, guardrails, and endpoint list**, rewritten for this runtime.

1. **Frontmatter.** Keep `name` and `description` verbatim. **Drop `allowed-tools`**
   — the tool boundary is the runtime, not the skill.

2. **`gb-call` → `callApi`.** Every API call becomes a fenced ```json block holding
   a request object:

   ```json
   { "method": "GET", "path": "/api/v2/feature-keys" }
   ```

   - `echo '<json>' | gb-call POST <path> -` → `{ "method": "POST", "path": "<path>", "body": <json> }`.
   - Query strings on the path → a `query` object (`/x?a=1&b=2` →
     `"path": "/x", "query": { "a": "1", "b": "2" }`), or leave inline if clearer.
   - Replace the "All API calls go through the bundled helper…" preamble with:
     "Use the `callApi` tool for every REST request. Mutating calls are gated
     automatically — issue `callApi` directly; do not use `askUser` for mutation
     confirmation."
   - Replace bare `` `gb-call` `` / `` `${CLAUDE_PLUGIN_ROOT}/scripts/gb-call` `` mentions with `` `callApi` ``.

3. **Strip the credential/env contract.** Remove all `GB_API_KEY`, `GB_API_URL`,
   `GB_EMAIL`, `~/.config/growthbook/.env`, and `/growthbook:setup` references.
   - `owner` was "read from `GB_EMAIL`" → "omit `owner` unless the user specifies
     one; send an empty string if the API requires the key." (Verify whether the
     endpoint requires `owner` — `flag-create`'s v2 create schema does.)
   - `<host>` / "derive host from `GB_API_URL`" → use **relative app paths**
     (`/features/<key>`, `/experiment/<id>`). Delete any "replace `api.` → `app.`"
     instructions entirely — don't leave the surrounding sentence half-built.

4. **Mutation confirmation.** The skills repo leans on prose like "confirm before
   POSTing." Rewrite to note mutations are **gated automatically**; the skill
   should issue the call when ready and must **not** use `askUser` to confirm a
   mutation. Keep genuine product-safety pauses (e.g. `flag-cleanup`'s
   archive-then-verify-then-delete gate) — those are not mutation-confirmation
   prompts, they're one-way-door warnings.

5. **Handoffs.** `use \`flag-rules\``/`Hand off to \`experiment-design\``/
bullets like `` -`flag-toggle`— … `` all become`loadSkill('<name>')`:
`` - `loadSkill('flag-toggle')`— … ``. Only rewrite names that are real ported
leaves; leave references to`product-analytics`/`growthbook-docs`as plain`loadSkill('product-analytics')` too (they exist as domains).

6. **Per-skill judgment edits.**
   - `flag-cleanup`: **drop the "Agent-mediated code cleanup" section** — this
     agent has no Read/Edit access to the user's working tree.
   - `experiment-analyze`: **remove tight poll loops** (`for i in …`, `sleep`).
     Replace with a single snapshot POST + one non-blocking status check; tell the
     user analysis is running and to ask again later instead of looping.
   - Any other CLI-only affordance (file writes, shelling out to non-`gb-call`
     binaries) → drop or adapt; never invent a tool the runtime doesn't have.

7. **Preserve substance.** Workflow steps, guardrail bullets, and the "Endpoints
   used" list are the valuable, source-of-truth-verified content — keep them
   faithful. Re-verify each endpoint/payload against the local back-end source
   while porting; fix upstream drift rather than copying it.

## Output shape per leaf

```
---
name: <same as source>
description: <same as source>
---

# <skill-name>

<adapted body — workflow, guardrails, endpoints, handoffs>
```

## Self-check before finishing

- No `gb-call`, `GB_API_KEY`, `GB_EMAIL`, `GB_API_URL`, `CLAUDE_PLUGIN_ROOT`,
  `/growthbook:setup`, or `allowed-tools` strings remain in any leaf.
- No half-deleted sentences ("Derive from by replacing…") — read the prose.
- Every handoff uses `loadSkill('<name>')` and names a real skill.
- Routers, `product-analytics.md`, `growthbook-docs.md` are untouched.
- Each endpoint in "Endpoints used" still exists in `packages/back-end/src/api`.
