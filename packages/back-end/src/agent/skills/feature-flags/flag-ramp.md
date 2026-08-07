---
name: flag-ramp
description: Create or manage a multi-step ramp schedule for a GrowthBook feature flag rule — progressively increasing traffic exposure over time with defined intervals between steps. Use when the user says "gradually roll this out", "increase traffic from 5% to 100% over a week", "set up a ramp schedule", "advance to the next ramp step", "pause the rollout", "roll back the ramp", or "set a cutoff date on this rollout". For rollouts that also need guardrail metric monitoring and automatic signals, use flag-monitoring — it builds on this skill with monitoring configuration. For simple on/off time windows, use flag-schedule.
---

# flag-ramp

Create and manage multi-step ramp schedules for a GrowthBook feature flag rule. A ramp schedule progressively increases (or decreases) a rule's traffic coverage over time, with defined hold intervals between steps. Steps can be manual (operator advances them) or time-gated (auto-advance after an interval).

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## How ramp schedules work

A ramp schedule is attached to a specific rule on a feature flag. When published, the ramp begins running immediately — there is no automatic delay unless you explicitly set a `startDate` (uncommon; most teams prefer to trigger the ramp manually after publish via the GrowthBook UI).

At each step, the schedule applies **actions** — patches to the rule, typically changing `coverage`. After a step:

- If the step has an `interval` (seconds), it auto-advances after that duration.
- If `interval` is `null`, it holds until a team member manually advances it in the UI.

When all steps complete, `endActions` are applied (typically setting coverage to 1.0). If the ramp is rolled back at any point, `startActions` are applied (restoring the pre-ramp state).

Ramp schedules are staged on a draft revision as `rampActions` and executed atomically at publish time.

## Workflow

### Path A — Create a ramp schedule on an existing rule

**1. Identify the rule:**

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Show the rules list. Get the ID of the `force` or `rollout` rule the user wants to ramp. Note current `coverage`.

**2. Design the ramp steps with the user:**

Confirm:

- Starting coverage (e.g., `0.05` = 5%)
- Step progression (e.g., 5% → 25% → 50% → 100%)
- Hold time at each step: a number in seconds (e.g., `86400` = 1 day) to auto-advance, or `null` to hold until manually advanced

**Hold-for-approval steps**: add `holdConditions: { "requiresApproval": true }` to any step that needs human sign-off before the ramp advances. Approval is always the _final_ gate — if the step also has an `interval`, the timer must elapse first, then the step waits for an explicit approval call. A pure manual gate (no time component) is `{ "interval": null, "holdConditions": { "requiresApproval": true } }`. Mixed examples:

- Soak for a day, then require approval: `{ "interval": 86400, "holdConditions": { "requiresApproval": true } }`
- Require approval only, no time hold: `{ "interval": null, "holdConditions": { "requiresApproval": true } }`

See Path D for how to submit approvals via API once the interval has cleared.

`startActions` should match the rule's **current coverage** (captured in step 1) — this is the state the ramp restores to on rollback.

**3. Build the ramp schedule payload:**

```json
{
  "startActions": [
    {
      "targetType": "feature-rule",
      "targetId": "<rule-id>",
      "patch": { "coverage": "<current-coverage>" }
    }
  ],
  "steps": [
    {
      "interval": 86400,
      "actions": [
        {
          "targetType": "feature-rule",
          "targetId": "<rule-id>",
          "patch": { "coverage": 0.1 }
        }
      ]
    },
    {
      "interval": 86400,
      "holdConditions": { "requiresApproval": true },
      "actions": [
        {
          "targetType": "feature-rule",
          "targetId": "<rule-id>",
          "patch": { "coverage": 0.5 }
        }
      ]
    }
  ],
  "endActions": [
    {
      "targetType": "feature-rule",
      "targetId": "<rule-id>",
      "patch": { "coverage": 1.0 }
    }
  ]
}
```

`startActions` = the state applied when the ramp begins and restored on rollback. Set this to the rule's **current coverage** before the ramp starts (captured in step 1) — typically `0` for a new rule.
`endActions` = final state after all steps complete (typically 100% coverage).

To add guardrail metric monitoring to the ramp, add a `monitoringConfig` block and `"monitored": true` on each step — see flag-monitoring.

Omit `startDate` and `cutoffDate` unless the user explicitly requests them — see Guardrails.

**4. Attach the ramp schedule to the rule via draft:**

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>/ramp-schedule",
  "body": { "<ramp-schedule-payload>": "..." }
}
```

Capture the returned `version`. The ramp schedule is staged as a `rampAction` on the draft — it becomes live when the draft is published.

**5. Call `loadSkill('flag-publish')`.**

### Path B — Create a new rule with a ramp schedule in one step

When creating the rule and ramp together, fetch available `hashAttribute` candidates first (required for rollout rules):

```json
{
  "method": "GET",
  "path": "/api/v1/attributes",
  "query": { "projectId": "<flag-project-id>" }
}
```

Validate the rule's `value` against the flag's `valueType` (captured from the flag fetch). Then post:

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules",
  "body": {
    "rule": {
      "type": "rollout",
      "value": "<on-value>",
      "coverage": 0.05,
      "hashAttribute": "<hash-attr-id>",
      "enabled": true,
      "allEnvironments": false,
      "environments": ["<env-id>"]
    },
    "rampSchedule": {
      "startActions": [
        {
          "targetType": "feature-rule",
          "targetId": "new",
          "patch": { "coverage": 0.0 }
        }
      ],
      "steps": [
        {
          "interval": 86400,
          "actions": [
            {
              "targetType": "feature-rule",
              "targetId": "new",
              "patch": { "coverage": 0.1 }
            }
          ]
        },
        {
          "interval": 86400,
          "holdConditions": { "requiresApproval": true },
          "actions": [
            {
              "targetType": "feature-rule",
              "targetId": "new",
              "patch": { "coverage": 0.5 }
            }
          ]
        }
      ],
      "endActions": [
        {
          "targetType": "feature-rule",
          "targetId": "new",
          "patch": { "coverage": 1.0 }
        }
      ]
    }
  }
}
```

Use `"targetId": "new"` as a placeholder in the ramp actions — the server replaces it with the actual rule ID on creation.

### Path C — Remove a ramp schedule from a rule

```json
{
  "method": "DELETE",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>/ramp-schedule"
}
```

This stages a `detach` ramp action on the draft. The live schedule is removed when the draft publishes. The rule's coverage is left at whatever the schedule last set it to.

### Path D — Manage a live ramp (post-publish)

Before taking any action, suggest the user open the feature page (`/features/<flag-id>`) for a full picture of ramp progress — the UI surfaces schedule status, step timeline, and metric health that the API only returns as raw values.

For API-based management: get the ramp schedule ID from the flag's rules (`rampScheduleId` field on the rule), or look it up:

```json
{
  "method": "GET",
  "path": "/api/v1/ramp-schedules",
  "query": { "featureId": "<flag-id>" }
}
```

```json
{
  "method": "GET",
  "path": "/api/v1/ramp-schedules",
  "query": { "ruleId": "<rule-id>" }
}
```

**Check status:**

```json
{ "method": "GET", "path": "/api/v1/ramp-schedules/<rs-id>/status" }
```

Returns: current step index, `decision` (`"advance"` / `"hold"` / `"rollback"` / `"waiting"`), health signals, and whether the step is awaiting approval.

**Start the ramp** (if it hasn't started automatically):

```json
{ "method": "POST", "path": "/api/v1/ramp-schedules/<rs-id>/actions/start" }
```

**Approve a hold-for-approval step** (after the interval has elapsed):

```json
{
  "method": "POST",
  "path": "/api/v1/ramp-schedules/<rs-id>/actions/approve-step"
}
```

Returns 400 if the interval hasn't cleared yet or other holds are still active — poll `/status` first and only approve when the step is awaiting approval.

**Advance to next step** (override all holds — use for CI pipelines or hard overrides):

```json
{
  "method": "POST",
  "path": "/api/v1/ramp-schedules/<rs-id>/actions/advance",
  "body": {}
}
```

To force past an unsatisfied approval gate (requires canBypassApprovalChecks permission), send `{ "force": true }` as the body.

**Pause / Resume:**

```json
{ "method": "POST", "path": "/api/v1/ramp-schedules/<rs-id>/actions/pause" }
```

```json
{ "method": "POST", "path": "/api/v1/ramp-schedules/<rs-id>/actions/resume" }
```

**Roll back** (restores `startActions` state, marks as `rolled-back`):

```json
{
  "method": "POST",
  "path": "/api/v1/ramp-schedules/<rs-id>/actions/rollback",
  "body": { "reason": "<description>" }
}
```

**Complete immediately** (skip remaining steps, apply `endActions`):

```json
{ "method": "POST", "path": "/api/v1/ramp-schedules/<rs-id>/actions/complete" }
```

**Restart after rollback:** POST `/api/v1/ramp-schedules/<rs-id>/actions/restart`, then start again with `/actions/start`.

**Emergency kill-switch** (faster than rollback): disable the flag environment via `loadSkill('flag-toggle')` — kills all rules instantly without needing the ramp schedule ID.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly instead of `new`. Fall back to `new` when starting fresh.
- **Ramp schedules apply only to `force` and `rollout` rules.** They don't work on `experiment-ref` or `safe-rollout` rules.
- **`startActions` must match the rule's pre-ramp coverage.** Capture it in step 1 and use it as the rollback state. Don't default to 0 unless the rule was at 0 before the ramp.
- **Steps with `null` interval hold until manually advanced in the UI.** Useful for human-gated checkpoints. Steps with an interval auto-advance.
- **`startDate` is optional** — the ramp starts immediately on publish if omitted. Only ask for it if the user specifically wants a delayed start; most teams prefer to trigger manually after verifying the publish succeeded.
- **`cutoffDate` is a niche safety net.** Only mention it if the user asks — it's a deadline that auto-rolls the ramp back if reached. Don't include it by default.
- **Coverage patches on steps must be within 0–1.** The server validates this at publish time.
- **Check the target environment is enabled.** If the flag is disabled in the target env, the ramp will do nothing — warn and route to flag-toggle first.
- **For monitored ramps (guardrail metrics, auto-rollback signals), use flag-monitoring.**
- **Ramp actions are staged on the draft.** Nothing changes until published. If the draft is discarded, the ramp is never created.
- **One ramp schedule per rule.** Adding a new one replaces any existing schedule.

## Endpoints used

**Draft (pre-publish):**

- `GET /api/v2/features/:id` — fetch flag and current rules
- `PUT /api/v2/features/:id/revisions/new/rules/:ruleId/ramp-schedule` — stage ramp schedule on a draft
- `DELETE /api/v2/features/:id/revisions/new/rules/:ruleId/ramp-schedule` — stage ramp detach
- `POST /api/v2/features/:id/revisions/new/rules` — create rule with inline `rampSchedule`

**Live ramp management:**

- `GET /api/v1/ramp-schedules` — list (`featureId`, `ruleId`, `status` filters)
- `GET /api/v1/ramp-schedules/:id/status` — real-time health and decision
- `POST /api/v1/ramp-schedules/:id/actions/start`
- `POST /api/v1/ramp-schedules/:id/actions/pause`
- `POST /api/v1/ramp-schedules/:id/actions/resume`
- `POST /api/v1/ramp-schedules/:id/actions/advance` (body: optional `{ force: true }`)
- `POST /api/v1/ramp-schedules/:id/actions/approve-step`
- `POST /api/v1/ramp-schedules/:id/actions/rollback` (body: `{ reason: string }`)
- `POST /api/v1/ramp-schedules/:id/actions/restart`
- `POST /api/v1/ramp-schedules/:id/actions/complete`

## Handoffs

- `loadSkill('flag-monitoring')` — to add guardrail metrics and automated monitoring signals to the ramp
- `loadSkill('flag-targeting')` — to set up the rule's targeting conditions before attaching a ramp
- `loadSkill('flag-toggle')` — for an emergency kill-switch if the ramp needs to be stopped immediately
- `loadSkill('flag-publish')` — to publish the draft and activate the ramp
