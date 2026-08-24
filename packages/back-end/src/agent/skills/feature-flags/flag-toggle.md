---
name: flag-toggle
description: Enable or disable a GrowthBook feature flag in a specific environment. Use when the user says "turn on flag X in production", "disable this flag in staging", "kill switch flag X", "turn this off everywhere", "enable the flag", "flip it off in prod", or "I need to disable this flag now". This is the environment-level kill switch — it controls whether the flag is evaluated at all in an environment, independent of its rules. Changes are review-gated and go through the standard draft → publish flow. For adding or editing targeting rules within an environment, use flag-targeting. For toggling a rule on or off without affecting the environment, use flag-rules.
---

# flag-toggle

Enable or disable a GrowthBook feature flag in a specific environment. Toggling an environment is the kill switch — when a flag is disabled in an environment, its rules don't evaluate and the SDK returns the default value for all users in that environment, regardless of what the rules say.

Like all flag changes, environment toggles go through the draft → review → publish flow. There is no bypass path — review is the happy path, not an obstacle.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Required inputs

- **Flag ID** — kebab-case key. Use `loadSkill('flag-search')` to resolve if the user gives a description.
- **Environment** — the environment to toggle. If the user says "production" or "prod", confirm against the actual environment IDs.
- **Direction** — enable (`true`) or disable (`false`). Infer from the user's words.

## Workflow

### 1. Fetch the flag and current toggle state

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Capture:

- `environmentSettings` — the map of environment IDs to their current `enabled` state. Use this to confirm the environment name and show the user the current state before toggling.
- `rules` — to warn about active rules if the user is disabling (they'll all stop evaluating).

If the flag is already in the requested state, halt: "Flag `<flag-id>` is already `<enabled/disabled>` in `<env>`. No change needed."

### 2. Resolve the environment

Show the available environments from `environmentSettings`. If the user said "prod" or an alias, confirm which environment ID they mean before proceeding.

```json
{ "method": "GET", "path": "/api/v1/environments" }
```

Use this if the flag's environmentSettings doesn't list all environments (e.g., the flag has never been toggled in that env).

### 3. State the action

State the change explicitly:

> "`<flag-id>` is currently `<enabled/disabled>` in `<env>`. I'll `<enable/disable>` it. When disabled, all rules stop evaluating and the SDK returns the default value (`<defaultValue>`) for all users in `<env>`."

For disabling: if the flag has active rules with non-default values, surface the behavior change:

> "Note: `<N>` rule(s) are currently serving values different from the default. Disabling will revert all matched users to `<defaultValue>`."

### 4. Apply the toggle via a draft

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>/revisions/new/toggle",
  "body": { "environment": "<env-id>", "enabled": true }
}
```

The `new` magic version creates a fresh draft or layers onto an existing one. Capture the returned `version` number.

### 5. Publish via flag-publish

Environment toggles are the canonical kill-switch use case — offer to publish immediately:

> "Toggle applied to draft revision `<version>`. Publish now?"

Call `loadSkill('flag-publish')` for the publish step. flag-publish handles the approval-required (400) and merge-conflict (409) failure modes.

Note: even for emergency kill switches, the approval flow is the happy path. If approval is required and the situation is urgent, option B or C in flag-publish's approval branch (org-wide bypass or per-token bypass) are the fastest paths, but they require admin action.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly (e.g. `.../revisions/42/toggle`) instead of `new`. This keeps all changes in the same draft. Fall back to `new` when starting fresh — it auto-creates or reuses the most recently updated open draft.
- **Environment toggle ≠ rule-level `enabled`.** This controls whether the flag evaluates at all in the environment. Rule-level `enabled` controls whether a specific rule participates in evaluation. They're independent — a flag can be enabled in an environment but have all its rules disabled.
- **Disabling stops all rule evaluation.** Users will get `defaultValue`. If `defaultValue` is `"false"` and rules were serving `"true"` to some users, those users lose the feature. Make sure the user understands this.
- **There is no instant kill switch that bypasses review.** Review is the happy path. If urgency requires skipping approval, point the user to the GrowthBook UI — human operators can sometimes publish faster there — or to the org-wide bypass setting.
- **`new` version layers onto an existing draft.** If a teammate has an open draft on this flag, the toggle lands in their draft. Show the user if an existing draft was reused — they should coordinate with the owner before publishing.
- **allEnvironments toggle is not supported here.** This skill toggles one environment at a time. For toggling all environments simultaneously, run this skill once per environment or use the GrowthBook UI.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag state and current environment toggle status
- `GET /api/v1/environments` — list all environments to confirm env IDs
- `POST /api/v2/features/:id/revisions/new/toggle` (body: `{ "environment": "<env-id>", "enabled": true|false }`)

## Handoffs

- `loadSkill('flag-search')` — if the user gives a description instead of a flag ID
- `loadSkill('flag-targeting')` — to add or edit rules within the enabled environment
- `loadSkill('flag-rules')` — to enable or disable individual rules without toggling the whole environment
- `loadSkill('flag-publish')` — to publish the draft, handle approval-required (400) and merge conflicts (409)
