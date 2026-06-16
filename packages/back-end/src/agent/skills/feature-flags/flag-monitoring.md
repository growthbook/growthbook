---
name: flag-monitoring
description: Set up a monitored progressive rollout ("safe rollout") for a GrowthBook feature flag — combining a ramp schedule with guardrail metric monitoring, automated signals, and optional auto-rollback. Use when the user says "roll this out safely", "monitor the rollout with guardrail metrics", "set up a safe rollout", "I want to ramp this with automatic rollback if metrics regress", "configure monitoring on the ramp", "check the monitoring status of this rollout", "approve the next monitored step", or "roll back because guardrails are failing". For unmonitored ramps (just progressive coverage, no metrics), use flag-ramp directly. For simple on/off time windows, use flag-schedule.
---

# flag-monitoring

Set up and manage a monitored progressive rollout (also called a "safe rollout") for a GrowthBook feature flag. A safe rollout is a standard `rollout` rule with a multi-step ramp schedule and `monitoringConfig` attached — the monitoring watches guardrail metrics at each step and can signal or automatically trigger a rollback if regressions are detected.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Required inputs for monitoring configuration

Before configuring, collect:

- **Datasource ID** — the datasource that tracks exposure and metric events
- **Exposure query ID** — which assignment query identifies users in the rollout
- **Guardrail metric IDs** — at least one metric that must not regress (e.g., error rate, crash rate)
- **Signal metric IDs** (optional) — leading-indicator metrics to watch, not hard gates
- **SRM action** — what to do on a Sample Ratio Mismatch: `"hold"` (recommended — pause for inspection) or `"rollback"` (aggressive) or `"warn"`
- **Auto-rollback** (`autoUpdate` in the monitored ramp payload, `autoRollback` in safe-rollout) — `true` means the system rolls back without human approval on guardrail failure; `false` holds for human review. Default to `true` unless the user has concerns about query cost or wants to control the cadence of monitoring snapshots manually

```json
{ "method": "GET", "path": "/api/v1/data-sources" }
```

Resolve metric IDs — query both: fact metrics and legacy metrics are separate endpoints, and most orgs keep guardrail/signal metrics as fact metrics:

```json
{
  "method": "GET",
  "path": "/api/v1/fact-metrics",
  "query": { "datasourceId": "<ds-id>", "limit": "100" }
}
```

```json
{
  "method": "GET",
  "path": "/api/v1/metrics",
  "query": { "datasourceId": "<ds-id>", "limit": "100" }
}
```

## Workflow

### Path A — Create a monitored ramp (ramp structure + monitoring together)

Build the full ramp schedule payload with `monitoringConfig` included in a single PUT. This covers both new ramps and updating an existing draft's ramp before it's published.

**1. Collect the ramp steps** — see flag-ramp for step/interval design guidance.

**2. Collect monitoring config** (see Required inputs above):

```json
{ "method": "GET", "path": "/api/v1/data-sources" }
```

```json
{
  "method": "GET",
  "path": "/api/v1/fact-metrics",
  "query": { "datasourceId": "<ds-id>", "limit": "100" }
}
```

```json
{
  "method": "GET",
  "path": "/api/v1/metrics",
  "query": { "datasourceId": "<ds-id>", "limit": "100" }
}
```

**3. PUT the full payload (steps + monitoring together):**

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>/ramp-schedule",
  "body": {
    "startActions": [
      {
        "targetType": "feature-rule",
        "targetId": "<rule-id>",
        "patch": { "coverage": 0 }
      }
    ],
    "steps": [
      {
        "interval": 86400,
        "monitored": true,
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
        "monitored": true,
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
    ],
    "monitoringConfig": {
      "datasourceId": "<ds-id>",
      "exposureQueryId": "<query-id>",
      "guardrailMetricIds": ["<metric-id>"],
      "signalMetricIds": ["<metric-id>"],
      "autoUpdate": true,
      "srmAction": "hold",
      "noTrafficAction": "warn",
      "noTrafficGracePeriodHours": 24,
      "multipleExposureAction": "warn"
    }
  }
}
```

`startActions` sets coverage to 0 (the rollback anchor). `monitored: true` on a step tells the ramp to wait for monitoring results before auto-advancing — it only has effect when `monitoringConfig` is present. The `holdConditions.requiresApproval` on step 2 adds a human gate after the interval elapses and monitoring clears. Monitored steps require `0 < coverage ≤ 0.5` (the rollout rule is promoted to a 50/50 experiment), so keep monitored coverage at or below 0.5.

`autoUpdate: true` rolls back automatically on guardrail failure. Mention `autoUpdate: false` only if the user wants to control monitoring cadence manually or is concerned about query costs.

Omit `startDate` unless the user explicitly requests a delayed start.

**4. Call `loadSkill('flag-publish')`.**

### Path B — Check monitoring status or respond to signals

Before taking any action, suggest the user open the feature page (`/features/<flag-id>`) — it shows ramp step progress, guardrail and signal metric health, experiment-level health checks (SRM, multiple exposures, no traffic), and full metric performance drilldowns with effect sizes and confidence intervals. The API `/status` endpoint gives you the `decision`, but the UI gives you the context to make it.

**Check status via API** (for scripted pipelines or when the user wants a quick decision signal):

```json
{ "method": "GET", "path": "/api/v1/ramp-schedules/<rs-id>/status" }
```

Returns `decision` (`"advance"` / `"hold"` / `"rollback"` / `"waiting"`), guardrail health, and whether the current step is awaiting approval. Get `<rs-id>` from the flag's rule (`rampScheduleId`) or:

```json
{
  "method": "GET",
  "path": "/api/v1/ramp-schedules",
  "query": { "featureId": "<flag-id>" }
}
```

**Approve a monitored hold-for-approval step** (after interval elapsed and monitoring shows healthy):

```json
{
  "method": "POST",
  "path": "/api/v1/ramp-schedules/<rs-id>/actions/approve-step"
}
```

Returns 400 if monitoring hasn't produced fresh healthy results yet or the interval is still counting — poll `/status` first.

**Advance past a monitoring hold** (decision is `"hold"` and you've reviewed the signals and accept the risk):

```json
{
  "method": "POST",
  "path": "/api/v1/ramp-schedules/<rs-id>/actions/advance",
  "body": {}
}
```

**Roll back on guardrail failure** (when `decision: "rollback"` or guardrails are failing):

```json
{
  "method": "POST",
  "path": "/api/v1/ramp-schedules/<rs-id>/actions/rollback",
  "body": { "reason": "<description of what failed>" }
}
```

**Emergency stop** (fastest — disable the flag environment via `loadSkill('flag-toggle')`, no ramp schedule ID needed).

For the full live ramp management action reference (pause, resume, complete, restart), see flag-ramp Path D.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly instead of `new`. Fall back to `new` when starting fresh.
- **Check the target environment is enabled.** If the flag is disabled in the target env, the ramp will do nothing — warn and route to flag-toggle first.
- **`autoUpdate`** controls auto-rollback in the monitored ramp schedule's `monitoringConfig`. Defaults to `true` (rolls back automatically on guardrail failure).
- **`startDate` is optional** — omit it unless the user explicitly wants a delayed start. Most teams start ramps via user action after verifying the publish succeeded.
- **`cutoffDate` is niche** — don't mention it unless the user asks.
- **At least one guardrail metric is required.** Monitoring without a guardrail is just observation — if the user can't provide a guardrail metric, recommend using an unmonitored ramp (flag-ramp) instead.
- **Metrics must be on the same datasource.** The `datasourceId` in `monitoringConfig` must match the datasource where the guardrail metrics are defined. If they're on different datasources, the API will reject the configuration.
- **`autoUpdate: true` means the system rolls back without human approval.** Mention `autoUpdate: false` only if the user wants to control monitoring cadence manually or is concerned about query costs.
- **For monitored steps with `holdConditions.requiresApproval`:** each step pause requires explicit human sign-off before the ramp advances.
- **SRM action defaults matter.** `"rollback"` on SRM is aggressive. `"hold"` is safer — the ramp pauses for human inspection. Recommend `"hold"` for SRM unless the user explicitly wants aggressive protection.

## Cross-links

This skill orchestrates:

- **flag-ramp** — for the structural ramp schedule (steps, intervals, start/cutoff dates). Consult flag-ramp for building custom step sequences.
- **flag-schedule** — for time-gating the start of the ramp (setting `startDate` on the ramp schedule).
- **flag-targeting** — for setting targeting conditions on the rule that's being ramped.
- **flag-toggle** — for emergency kill-switch if monitoring signals a critical issue.

## Endpoints used

**Draft (pre-publish):**

- `GET /api/v2/features/:id` — fetch flag and current rules
- `GET /api/v1/data-sources` — resolve datasource IDs
- `GET /api/v1/fact-metrics?datasourceId=…`, `GET /api/v1/metrics?datasourceId=…` — resolve guardrail and signal metric IDs (fact metrics and legacy metrics are separate endpoints)
- `PUT /api/v2/features/:id/revisions/new/rules/:ruleId/ramp-schedule` — create/update ramp schedule with monitoringConfig

**Live ramp management:**

- `GET /api/v1/ramp-schedules` — list (`featureId`, `ruleId` filters)
- `GET /api/v1/ramp-schedules/:id/status` — real-time health, decision, per-metric effects
- `POST /api/v1/ramp-schedules/:id/actions/approve-step`
- `POST /api/v1/ramp-schedules/:id/actions/advance` (body: optional `{ force: true }`)
- `POST /api/v1/ramp-schedules/:id/actions/rollback` (body: `{ reason: string }`)
- See flag-ramp Path D for the full action reference (pause, resume, complete, restart)

## Handoffs

- `loadSkill('flag-ramp')` — for managing ramp step structure without monitoring
- `loadSkill('flag-toggle')` — for emergency kill-switch during a live monitored rollout
- `loadSkill('flag-targeting')` — to configure rule conditions before setting up monitoring
- `loadSkill('flag-publish')` — to publish the draft and activate the monitored rollout
