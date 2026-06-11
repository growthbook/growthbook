---
name: flag-rules
description: Entry point for working with rules on a GrowthBook feature flag. Use when the user asks "what rules does flag X have", "show me the rules on this flag", "add a rule", "delete a rule", "reorder the rules", or describes a flag operation without specifying the rule type. Routes to specialized skills for creating and editing specific rule types. Also handles listing, reordering, and deleting rules directly. For specific rule types, use flag-targeting for force/rollout rules, flag-experiment for experiment-ref rules, flag-schedule for timed activation, flag-ramp for progressive rollouts, flag-monitoring for monitored rollouts, flag-prerequisites for feature-level prerequisite gates.
---

# flag-rules

Entry point for rule operations on a GrowthBook feature flag. Use this skill to inspect rules, delete a rule, or reorder rules. For creating or editing rules, this skill identifies the right rule type and routes to the specialized skill.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Rule types reference

| Type                | What it does                                                                                                                                                                                                                 | Skill           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `force` / `rollout` | Serve a specific value, optionally to a random % of users. `rollout` is the same type as `force` but with `coverage < 1` and a required `hashAttribute` — the server auto-flips between the two based on effective coverage. | flag-targeting  |
| `experiment-ref`    | Run an A/B test via a linked experiment                                                                                                                                                                                      | flag-experiment |

Rules evaluate **top-to-bottom, first match wins**. Order matters.

## Workflow

### Path A — List rules on a flag

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Present the `rules` array in evaluation order with a numbered list:

```
Rules on `<flag-id>` (top-to-bottom evaluation):
  1. [force]          all environments              value="true"    "Beta testers" (saved group)
  2. [rollout]        production                    coverage=10%    hash=id
  3. [experiment-ref] production, staging           → exp_abc123    "Checkout experiment"
  4. [force]          staging                       value="false"   "Kill switch"
```

For each rule show: number, type, scope (allEnvironments or specific envs), enabled state, a one-line summary of the rule's effect, and the rule ID (UUID) for reference.

### Path B — Route to the right skill for creating/editing a rule

Ask the user what they're trying to accomplish and route:

| User intent                                          | Route to                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "Serve X to users matching condition Y"              | `loadSkill('flag-targeting')`                                                                          |
| "Roll out to N% of users"                            | `loadSkill('flag-targeting')`                                                                          |
| "Run an A/B test" (experiment already exists)        | `loadSkill('flag-experiment')`                                                                         |
| "Run an A/B test" (starting from scratch)            | `loadSkill('experiment-launch')` — it creates the experiment AND reuses or creates the flag end-to-end |
| "Turn this on at 9am, off at 5pm"                    | `loadSkill('flag-schedule')`                                                                           |
| "Gradually increase traffic from 5% to 100%"         | `loadSkill('flag-ramp')`                                                                               |
| "Gradually release with guardrail metric monitoring" | `loadSkill('flag-monitoring')`                                                                         |
| "Only if feature Y is enabled" (whole flag)          | `loadSkill('flag-prerequisites')`                                                                      |
| "Only if feature Y is enabled" (one rule)            | `loadSkill('flag-targeting')`                                                                          |

If the user describes something ambiguous, ask one clarifying question before routing.

### Path C — Delete a rule

Show the numbered list (Path A) so the user can pick by number. Confirm:

> "Delete rule `<N>` (`<type>`, `<scope>`, `<summary>`)? This goes into a draft and only takes effect after publishing."

```json
{
  "method": "DELETE",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>"
}
```

Capture the returned `version`. Call `loadSkill('flag-publish')`.

**safe-rollout removal:** The server cleans up the `SafeRollout` entity when the rule is still in draft and the rollout hasn't started. If the rollout has already started, the SafeRollout entity is preserved (no data loss) but the rule is removed from the flag.

**experiment-ref removal:** The linked experiment is not affected. Removing the rule on the flag doesn't stop or modify the experiment.

### Path D — Reorder rules

Show the current order (Path A). Ask the user for the new order (by number or by describing the desired sequence).

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/reorder",
  "body": { "ruleIds": ["<id-1>", "<id-2>", "<id-3>"] }
}
```

Supply the **complete ordered array** of all rule IDs — this replaces the full order, not a swap. Capture the returned `version`. Call `loadSkill('flag-publish')`.

Remind the user that evaluation is top-to-bottom, first match wins — rules higher in the list take priority.

## Guardrails

- **Rules evaluate in order; position matters.** A broad rule (e.g., 50% rollout with no condition) placed first will match before a more specific rule below it. Surface this when the user adds or reorders.
- **Rule ID is a string UUID (`fr_...`), not a position number.** Always resolve to the UUID from the `rules` array before calling edit/delete/reorder endpoints.
- **Reorder requires the complete array.** Missing a rule ID in the reorder payload will cause an error or lose rules. Fetch the current `rules` array, reorder in memory, then send all IDs.
- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly instead of `new`. Fall back to `new` when starting fresh.
- **`version=new` is the canonical draft pattern.** Don't manually POST `/revisions` first — the `new` magic creates or reuses a draft atomically.
- **experiment-ref rules can only be deleted here.** For editing an experiment-ref rule's targeting conditions or scope, use flag-targeting. For changing the linked experiment, warn the user and use flag-experiment.

## Endpoints used

- `GET /api/v2/features/:id` — list current rules and flag state
- `DELETE /api/v2/features/:id/revisions/new/rules/:ruleId` — delete a rule
- `POST /api/v2/features/:id/revisions/new/rules/reorder` (body: `{ "ruleIds": ["<id>", ...] }`)

## Handoffs

- `loadSkill('flag-targeting')` — force/rollout rules with conditions, saved groups, rule-level prerequisites
- `loadSkill('flag-experiment')` — experiment-ref and inline experiment rules
- `loadSkill('flag-schedule')` — timed activation windows on rules
- `loadSkill('flag-ramp')` — multi-step progressive rollout schedules
- `loadSkill('flag-monitoring')` — monitored rollouts and safe-rollout rules
- `loadSkill('flag-prerequisites')` — feature-level prerequisite gates (not rule-level)
- `loadSkill('flag-publish')` — to publish the draft after a delete or reorder
