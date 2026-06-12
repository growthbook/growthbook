---
name: flag-schedule
description: Add a timed activation window to a GrowthBook feature flag rule — automatically enable it at a start time and/or disable it at an end time. Use when the user says "turn this on at 9am", "schedule the flag to go live Friday at noon", "disable the rule after the sale ends", "set an end date on this rule", "run this rule during the promotion window", or "time-gate this rule". Applies to force and rollout rules. For multi-step progressive rollouts with intervals between steps, use flag-ramp. For the broader campaign of rules around this schedule, use flag-targeting first.
---

# flag-schedule

Add a timed activation window to a GrowthBook feature flag rule. A scheduled rule activates automatically at a start time and/or deactivates automatically at an end time, without requiring a manual publish each time.

Scheduling applies to `force` and `rollout` rule types. It does not apply to `experiment-ref` or `safe-rollout` rules.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## How scheduling works

GrowthBook supports two scheduling mechanisms on rules:

**Simple schedule** (`schedule` field on rule creation) — the preferred approach. Specify `startDate` and/or `endDate` as ISO 8601 timestamps. The server sets up the underlying `scheduleRules` automatically.

**Legacy `scheduleRules`** — a 2-element array `[start, end]` where each element is `{ timestamp: "<ISO 8601 or null>", enabled: <bool> }`. Still accepted by the API; the simple `schedule` field is cleaner for new rules.

## How the OFF state works

A scheduled rule is a **rule-level** mechanism, not a flag-level toggle. When the rule is inactive (outside its window), it is skipped in evaluation — the flag falls through to whatever comes next in rule order, ultimately landing on `defaultValue`.

This means:

- The rule should serve the **ON value** (`"true"` for a boolean flag) during the active window.
- `defaultValue` is the **OFF state** when no rules match. Verify it is set correctly before publishing.
- The scheduled rule should be **last in the rules array** (for new rules) so nothing below it can accidentally serve the ON value when the schedule is inactive. For existing rules, check what's below — anything serving a matching value below this rule would fire when the schedule is off.

## Workflow

### Path A — Create a new rule with a schedule

1. **Fetch the flag:**

   ```json
   { "method": "GET", "path": "/api/v2/features/<flag-id>" }
   ```

   Capture `valueType`, `defaultValue`, `environmentSettings`, and current rules.

   **Check the target environment is enabled.** If `environmentSettings.<env>.enabled` is `false`, the scheduled rule will silently do nothing — warn the user:

   > "The flag is currently disabled in `<env>`. The scheduled rule won't fire until the flag is enabled. Enable it via flag-toggle (it can land in the same draft as this change)."

   **Check `defaultValue` is the OFF state.** For a boolean flag, it should be `"false"`. If it isn't, warn the user:

   > "When the scheduled rule is inactive, the flag will return `<defaultValue>`. Is that the intended off-state? If not, update it first via flag-default-value."

   **Check rule order.** The new rule will append to the bottom. If existing rules above it serve the ON value unconditionally to all users, they'll fire before the schedule can — warn the user and suggest reviewing rule order via flag-rules after adding.

2. **Collect the schedule times:**

   Ask for:
   - Start time (or `null` for "immediately")
   - End time (or `null` for "never expires")
   - The user's timezone, unless they explicitly specify one in the time string

   The API accepts ISO 8601 with timezone offset — use the user's local timezone directly, no UTC conversion needed. Use the correct offset for the date in question (account for daylight saving time):

   ```
   "tomorrow at midnight" in US Eastern (summer, EDT) → "2026-05-30T00:00:00-04:00"
   "right after Christmas" in US Eastern (winter, EST) → "2026-12-26T00:00:00-05:00"
   ```

   For natural-language times, use the current date from context to anchor relative dates ("tomorrow", "next Friday"). For ambiguous phrases like "right after Christmas" or "end of the sale", confirm the exact datetime with the user before proceeding. Always confirm the full resolved datetime back to the user before building the payload.

3. **Build the payload and post:**

   Pre-validate `value` against the flag's `valueType` (captured in step 1): boolean flags must use `"true"`/`"false"`, number flags must parse as a number, json flags must be valid JSON.

   ```json
   {
     "method": "POST",
     "path": "/api/v2/features/<flag-id>/revisions/new/rules",
     "body": {
       "rule": {
         "type": "force",
         "value": "<on-value>",
         "description": "<optional>",
         "enabled": true,
         "allEnvironments": false,
         "environments": ["<env-id>"]
       },
       "schedule": {
         "startDate": "2026-05-30T00:00:00-05:00",
         "endDate": "2026-12-26T00:00:00-05:00"
       }
     }
   }
   ```

   Omit `startDate` or `endDate` if no bound on that side.

4. Capture the returned `version`. Call `loadSkill('flag-publish')`.

### Path B — Add a schedule to an existing rule

1. **Fetch the flag and identify the rule:**

   ```json
   { "method": "GET", "path": "/api/v2/features/<flag-id>" }
   ```

   Show the rules list. Get the rule `id` (UUID) the user wants to schedule. Note the rule's current position in the array — if it's not last, check whether rules below it would serve an unintended value when this schedule is inactive.

2. **Collect the schedule times** (same as Path A step 2).

3. **Build the scheduleRules patch and apply it:**

   ```json
   {
     "method": "PUT",
     "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>",
     "body": {
       "scheduleRules": [
         { "timestamp": "2026-05-30T00:00:00-05:00", "enabled": true },
         { "timestamp": "2026-12-26T00:00:00-05:00", "enabled": false }
       ],
       "scheduleType": "schedule"
     }
   }
   ```

   - Element 0: the start event (`enabled: true` — rule turns on at this time)
   - Element 1: the end event (`enabled: false` — rule turns off at this time)
   - Use `null` for a timestamp to omit that bound (open-ended start or end)
   - `scheduleType` must be `"schedule"`

4. Capture the returned `version`. Call `loadSkill('flag-publish')`.

### Path C — Remove a schedule from a rule

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>",
  "body": {
    "scheduleRules": [
      { "timestamp": null, "enabled": true },
      { "timestamp": null, "enabled": false }
    ],
    "scheduleType": "none"
  }
}
```

Setting all timestamps to `null` and `scheduleType: "none"` clears the schedule. The rule becomes always-active (subject to its `enabled` field and conditions).

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly (e.g. `.../revisions/42/rules`) instead of `new`. This keeps all changes in the same draft. Fall back to `new` when starting fresh.
- **The OFF state is `defaultValue`, not a toggle.** Scheduling works at the rule level — outside the active window the rule is skipped and the flag falls through to `defaultValue`. Always verify `defaultValue` is the intended off state before publishing.
- **Place new scheduled rules last.** Rules evaluate top-to-bottom; a scheduled rule that's inactive is simply skipped. If another rule below it serves the ON value unconditionally, that rule fires during the inactive period. For new rules, last position is safest.
- **The API accepts ISO 8601 with timezone offset.** Send times in the user's local timezone using the offset form: `"2026-12-26T00:00:00-05:00"`. No UTC conversion needed. Confirm the resolved datetime with the user before building the payload — never silently assume a timezone.
- **Resolve natural-language times explicitly.** Use the current date from context for relative dates ("tomorrow", "next Friday"). For ambiguous phrases ("right after Christmas", "end of the sale"), confirm the exact date and time with the user before proceeding.
- **`scheduleRules` is a 2-element array.** Element 0 = start event (`enabled: true`), element 1 = end event (`enabled: false`). The server enforces this shape — it is not a list of arbitrary events.
- **Use `schedule` field for new rules, `scheduleRules` for patching existing ones.**
- **Scheduled rules must have `enabled: true`.** The schedule controls when the rule is active within the evaluation cycle, but `enabled: false` on the rule overrides the schedule entirely.
- **Publishing activates the schedule.** If publish is delayed by approvals and the start time passes before the revision goes live, the rule will activate immediately on publish rather than at the scheduled time.
- **For multi-step progressive rollouts, use flag-ramp.** This skill handles on/off windows only.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag and current rules
- `POST /api/v2/features/:id/revisions/new/rules` — create rule with `schedule` field (body includes `rule` + `schedule`)
- `PUT /api/v2/features/:id/revisions/new/rules/:ruleId` — patch existing rule's `scheduleRules` and `scheduleType`

## Handoffs

- `loadSkill('flag-targeting')` — to build the rule's targeting conditions alongside the schedule
- `loadSkill('flag-ramp')` — for multi-step progressive rollouts with intervals between coverage increases
- `loadSkill('flag-rules')` — to reorder rules after adding a scheduled rule
- `loadSkill('flag-publish')` — to publish the draft
