---
name: flag-graph
description: Trace the dependency relationships around a GrowthBook feature flag — what it depends on (prerequisites), what depends on it (reverse lookup), which experiments link to it, and any holdout associations. Use when the user asks "what depends on flag X", "what flags does flag X require", "will deleting this flag break anything", "show me the dependency graph", "what experiments are linked to this flag", "find everything that uses flag X", or "is it safe to clean up this flag". Read-only — for making changes to prerequisites, use flag-prerequisites. For cleanup, use flag-cleanup.
---

# flag-graph

Trace the dependency relationships around a GrowthBook feature flag. Use this skill before making structural changes to a flag (renaming, archiving, deleting) to understand the blast radius, or when building a mental model of how flags depend on each other.

Read-only — this skill never writes.

Use the `callApi` tool for every REST request.

## Workflow

### 1. Fetch the flag

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Capture: `prerequisites` (feature-level), `rules` (check for rule-level prerequisites, `experiment-ref` entries, `safe-rollout` entries), `holdout`.

### 2. What does this flag depend on? (forward dependencies)

From the flag's `prerequisites` array, for each prerequisite:

```json
{ "method": "GET", "path": "/api/v2/features/<prereq-flag-id>" }
```

Show: prerequisite flag ID, its current state (enabled envs, default value), and the condition the current flag is checking against it. Recurse one level if the prerequisite also has prerequisites — surface the full chain, noting where it ends.

Also check rule-level prerequisites in the `rules` array — each rule can have its own `prerequisites` field. Surface these as rule-scoped dependencies.

### 3. What depends on this flag? (reverse lookup)

GrowthBook has no reverse-prerequisite API endpoint. A full reverse lookup requires scanning all flags:

```json
{ "method": "GET", "path": "/api/v2/feature-keys" }
```

Then paginate through all flags looking for any that list the target flag in their `prerequisites`:

```json
{ "method": "GET", "path": "/api/v2/features", "query": { "limit": "100" } }
```

```json
{
  "method": "GET",
  "path": "/api/v2/features",
  "query": { "limit": "100", "offset": "100" }
}
```

For each flag returned, check `prerequisites[*].id` and `rules[*].prerequisites[*].id` against the target flag ID.

Warn the user: this is an O(n) scan across all flags. On large orgs with hundreds of flags, it may take several paginated calls.

### 4. Which experiments link to this flag?

Check for experiment-ref rules in the flag's `rules` array (field `experimentId` on rules with `type: "experiment-ref"`). For each:

```json
{ "method": "GET", "path": "/api/v1/experiments/<experiment-id>" }
```

Surface: experiment name, status (running/stopped/draft), and whether the flag's `id` is the experiment's `trackingKey`.

Also check if any experiments list this flag in `linkedFeatures`:

```json
{
  "method": "GET",
  "path": "/api/v1/experiments",
  "query": { "trackingKey": "<flag-id>" }
}
```

This catches experiments wired by convention (experiment-launch sets `trackingKey === flag-id`). Complement with the experiment-ref rule scan above for experiments wired manually.

### 5. Holdout associations

If the flag has a `holdout` field set, note the holdout ID and warn: "This flag participates in holdout `<holdout-id>`. Deleting or significantly changing this flag could affect holdout analysis."

### 6. Present the dependency report

```
Dependency graph for `<flag-id>`:

DEPENDS ON (forward):
  → flag-Y (prerequisite, condition: value === true)
      → flag-Z (flag-Y's prerequisite, condition: value === "v2")

DEPENDED ON BY (reverse, scanned <N> flags):
  ← flag-A (feature-level prerequisite)
  ← flag-B (rule-level prerequisite on rule "Beta testers")
  [limitation: reverse lookup scanned all flags; may miss any created after this scan]

EXPERIMENTS:
  exp_abc123 "Checkout experiment" — status: running, trackingKey matches

HOLDOUTS:
  holdout_xyz — flag participates; remove cautiously

SAFE TO DELETE?: <yes / no / caution — explain why>
```

## Guardrails

- **Reverse lookup is a full scan — rate-limit aware.** The 60 rpm rate limit applies. If the org has >600 flags, the scan takes 10+ API calls. Surface the count before starting and offer to proceed.
- **Reverse lookup is point-in-time.** Flags created after this scan won't appear. Note the scan timestamp in the report.
- **No API for reverse prerequisite lookup.** There is no `GET /features?dependsOn=<id>` endpoint. The scan is the only reliable approach.
- **Experiment `trackingKey` scan catches the common case.** experiment-launch sets `trackingKey === flag-id` by convention. Manual wiring (different `trackingKey`, linked via `linkedFeatures`) may not be caught by the trackingKey query — the rule scan in step 4 is the defensive check.
- **Read-only.** This skill never writes. For changing prerequisites, use flag-prerequisites. For deletion, use flag-cleanup.
- **Circular dependency detection.** If during the forward-dependency traversal you encounter a flag that points back to the starting flag, surface it as a circular dependency warning — it means the flag can never fully evaluate.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag and its dependencies
- `GET /api/v2/feature-keys` — full flag ID list for reverse lookup
- `GET /api/v2/features` (paginated, limit/offset) — full flag scan for reverse lookup
- `GET /api/v1/experiments/:id` — fetch linked experiment details
- `GET /api/v1/experiments?trackingKey=<flag-id>` — find experiments linked by convention

## Handoffs

- `loadSkill('flag-prerequisites')` — to add, remove, or modify feature-level prerequisites
- `loadSkill('flag-cleanup')` — to archive or delete the flag after confirming the blast radius
- `loadSkill('experiment-stop')` — if a linked experiment is running and needs to be stopped before flag removal
- `loadSkill('flag-search')` — to find all flags matching criteria (broader than single-flag dependency tracing)
