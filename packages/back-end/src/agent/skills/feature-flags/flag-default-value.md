---
name: flag-default-value
description: Set the default value of a GrowthBook feature flag — the value served when no rules match. Use when the user says "change the default value of flag X", "what does this flag return when no rules apply", "set the fallback to false", "update the default to the new config", or "change what users get by default". Goes through a draft revision and requires publishing. For adding or editing targeting rules, use flag-targeting or flag-rules. For updating administrative metadata, use flag-metadata. For creating a new flag, use flag-create.
---

# flag-default-value

Set the default value of a GrowthBook feature flag. The default value is what the SDK returns when no rules match a user — it's the flag's baseline state, not a targeting rule. Changes go through a draft revision and require publishing before they take effect.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Required inputs

- **Flag ID** — kebab-case key. Use `loadSkill('flag-search')` to resolve if the user gives a description.
- **New default value** — must match the flag's `valueType`. Always serialized as a string.

## Workflow

### 1. Fetch the flag

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Capture `valueType` and current `defaultValue`. Show the user the current default so they can confirm the change.

### 2. Validate the new value

Pre-validate before sending — the API does not catch type mismatches at write time:

| `valueType` | Valid `defaultValue`                                |
| ----------- | --------------------------------------------------- |
| `boolean`   | `"true"` or `"false"` (string, not JSON bool)       |
| `number`    | Any string that parses as a number: `"0"`, `"3.14"` |
| `json`      | Any valid JSON string: `"{\"key\":\"value\"}"`      |
| `string`    | Any non-empty string                                |

If the user's value doesn't match, halt and ask them to fix it. Do not silently coerce.

### 3. Apply the change via a draft

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<flag-id>/revisions/new/default-value",
  "body": { "defaultValue": "<string>" }
}
```

The `new` magic version creates a fresh draft or layers onto an existing one atomically. Capture the returned `version` number.

### 4. Offer to publish

Ask: "Publish this default-value change now, or leave it as a draft?"

Changing the default value affects every user who matches no rules — this is potentially high-impact. Before publishing, surface the behavior change clearly:

> Changing the default from `<old>` to `<new>` will affect all users not matched by any rule. In `<env>` that's currently `<rule-count>` rule(s) — users falling through all of them will now get `<new>` instead of `<old>`.

Call `loadSkill('flag-publish')` for the publish step.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly (e.g. `.../revisions/42/default-value`) instead of `new`. This keeps all changes in the same draft. Fall back to `new` when starting fresh — it auto-creates or reuses the most recently updated open draft.
- **`defaultValue` is always a string, regardless of `valueType`.** The API rejects non-string values. `"false"` for boolean off, `"0"` for numeric zero, `"{}"` for an empty JSON object.
- **Default value ≠ a force rule.** The default value applies only when all rules fail to match. If the user wants to serve a specific value to targeted users, they want flag-targeting, not this skill.
- **This is potentially high-traffic impact.** The default value applies to every unmatched user in every enabled environment. Changing it from the "off" state (e.g., `"false"` → `"true"`) can expose a feature to production traffic if there are no rules. Surface this before publishing.
- **Changing default value for a boolean flag is equivalent to a global toggle** when there are no targeting rules. Confirm the user understands this.
- **Type mismatches surface at SDK evaluation time, not at write time.** The v2 default-value endpoint accepts any string. A number flag with `defaultValue: "not-a-number"` won't error until clients evaluate it.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag to get current `defaultValue` and `valueType`
- `PUT /api/v2/features/:id/revisions/new/default-value` (body: `{ "defaultValue": "<string>" }`)

## Handoffs

- `loadSkill('flag-search')` — if the user gives a description instead of a flag ID
- `loadSkill('flag-targeting')` — to add or edit rules that serve specific values to targeted users
- `loadSkill('flag-cleanup')` — if the flag is no longer needed and should be archived
- `loadSkill('flag-publish')` — to publish the draft, handle approval-required (400) and merge conflicts (409)
