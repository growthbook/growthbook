---
name: flag-prerequisites
description: Add, remove, or inspect feature-level prerequisites on a GrowthBook feature flag. Use when the user says "gate flag X on flag Y being enabled", "add a prerequisite", "flag X should only evaluate if flag Y is on", "remove the prerequisite on flag X", "what does this flag depend on", or "this flag should require the new-checkout flag to be true first". Feature-level prerequisites gate the entire flag — when the prerequisite flag is off, this flag returns its default value for every user. The prerequisite must be a boolean flag. For prerequisites scoped to a single rule (not the whole flag), use flag-targeting. For tracing the full dependency graph, use flag-graph.
---

# flag-prerequisites

Add, remove, or inspect feature-level prerequisites on a GrowthBook feature flag. A feature-level prerequisite is a boolean gate: if the specified prerequisite flag is off for a user, the current flag skips all its rules and returns its `defaultValue` for that user.

**Feature-level prerequisites are boolean-flag-only.** The prerequisite flag must have `valueType: "boolean"`. The gate condition is always "prerequisite flag is on" (`{"value": true}`) — no custom conditions. If the user wants a more nuanced dependency (e.g. gate on a string flag's value, or gate a single rule rather than the whole flag), call `loadSkill('flag-targeting')`.

This is distinct from rule-level prerequisites (which gate a single rule and support richer conditions) — feature-level prerequisites apply to every rule on the flag simultaneously.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Workflow

### Path A — Add a prerequisite

1. **Fetch the flag's current prerequisites:**

   ```json
   { "method": "GET", "path": "/api/v2/features/<flag-id>" }
   ```

   Capture the existing `prerequisites` array. The PUT below replaces the full array, so you need the current contents to avoid overwriting existing prerequisites.

2. **Confirm the prerequisite flag exists and is boolean:**

   ```json
   { "method": "GET", "path": "/api/v2/features/<prerequisite-flag-id>" }
   ```

   Check `valueType`. If it is not `"boolean"`, halt:

   > "Feature-level prerequisites only support boolean flags. `<prerequisite-flag-id>` is a `<valueType>` flag. To gate on a non-boolean flag's value, add a rule-level prerequisite instead via flag-targeting."

3. **Build the new prerequisites array.** Append to any existing entries. The condition is always `{"value": true}` — the gate means "prerequisite flag is on":

   ```json
   [
     { "id": "<existing-prereq-id>", "condition": "{\"value\": true}" },
     { "id": "<new-prereq-id>", "condition": "{\"value\": true}" }
   ]
   ```

4. **Apply via draft:**

   ```json
   {
     "method": "PUT",
     "path": "/api/v2/features/<flag-id>/revisions/new/prerequisites",
     "body": { "prerequisites": ["..."] }
   }
   ```

5. Call `loadSkill('flag-publish')`.

### Path B — Remove a prerequisite

1. Fetch current prerequisites (step A-1 above).
2. Show the list and ask which to remove.
3. Build the updated array without the removed entry.
4. Apply via draft (step A-4 above) with the filtered array. An empty array `[]` removes all prerequisites.
5. Call `loadSkill('flag-publish')`.

### Path C — Inspect current prerequisites

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Surface the `prerequisites` array. For each entry, fetch the prerequisite flag to show its current evaluated state and value type. Call `loadSkill('flag-graph')` to trace the full dependency chain if needed.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly (e.g. `.../revisions/42/prerequisites`) instead of `new`. This keeps all changes in the same draft. Fall back to `new` when starting fresh — it auto-creates or reuses the most recently updated open draft.
- **`PUT /prerequisites` replaces the full array.** It's not additive. Always fetch the current array first and include all existing entries when adding or modifying — otherwise you'll silently delete prerequisites the user didn't intend to touch.
- **Prerequisite flags must be boolean.** Halt and route to flag-targeting if the user specifies a non-boolean flag as a prerequisite.
- **The condition is always `{"value": true}`.** Do not accept or generate custom conditions for feature-level prerequisites. The backend is permissive but we intentionally constrain this — the gate means "this flag is on". If the user wants a richer condition (e.g. string flag equals a value, flag is live but not necessarily true), route to flag-targeting rule-level prerequisites.
- **Feature-level vs rule-level prerequisites.** This skill gates the entire flag. If the user wants a prerequisite scoped to a single rule, route to flag-targeting.
- **Circular dependencies must be avoided.** If flag A requires flag B and flag B requires flag A, neither will ever evaluate. Check the existing dependency chain via flag-graph before adding a prerequisite.
- **Prerequisite flags must be in the same GrowthBook project (or org-wide).** Cross-project prerequisites may not resolve correctly depending on SDK configuration.
- **Deleting a prerequisite flag breaks any flag that depends on it.** The dependent flag's prerequisite condition will silently always fail. Surface this when the user is reviewing dependencies via flag-graph before cleanup.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag state including current `prerequisites` array
- `PUT /api/v2/features/:id/revisions/new/prerequisites` (body: `{ "prerequisites": [...] }`)

## Handoffs

- `loadSkill('flag-search')` — to find the prerequisite flag's ID if the user gives a name
- `loadSkill('flag-graph')` — to trace the full dependency chain and detect circular dependencies
- `loadSkill('flag-targeting')` — to add rule-level prerequisites (scoped to a single rule rather than the whole flag)
- `loadSkill('flag-publish')` — to publish the draft, handle approval-required (400) and merge conflicts (409)
