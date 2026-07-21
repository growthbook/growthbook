---
name: flag-targeting
description: Add, edit, or remove force-value or percentage-rollout rules on a GrowthBook feature flag, including conditions, saved groups, and rule-level prerequisites. Use when the user says "add a rule to flag Y", "release this flag to 10% of users", "turn this on for beta testers", "target US users", "add a condition to rule X", "edit the targeting condition on flag Z", "disable this rule", "remove the rule", "only for logged-in users", or "target users matching attribute Y". For environment kill switches (enable/disable the whole flag in an env), use flag-toggle. For experiment rules, use flag-experiment. For ramp schedules, use flag-ramp. For monitored rollouts with guardrail metrics, use flag-monitoring. For feature-level prerequisites, use flag-prerequisites.
---

# flag-targeting

Add, edit, or remove targeting rules on an existing GrowthBook feature flag. Handles `force` (serve a specific value to matched users) and `rollout` (serve a value to a random percentage of users) rule types, with full support for conditions, saved groups, and rule-level prerequisites.

Every change goes through a draft revision and requires publishing. For publishing, call `loadSkill('flag-publish')` — it handles approval-required and merge-conflict failure modes.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Required inputs

Collect before starting:

- **Flag ID** — kebab-case key. Use `loadSkill('flag-search')` to resolve from a description.
- **Action** — `add`, `edit`, or `remove`. Infer from the user's request.

## Per-action inputs

### `add`

- **Rule type** — `force` (specific users) or `rollout` (percentage). Infer from wording: "X% of users" → rollout; "for users matching Y" → force.
- **Value** — what the rule serves when matched. Must match the flag's `valueType`, serialized as a string.
- **Scope** — `allEnvironments: true` or `environments: [<env-ids>]`. Ask if not specified.
- **Conditions** (optional) — saved group, attribute condition, or prerequisite on another flag (see conditions decision tree below).
- **For rollout rules** — `coverage` (0–1) and `hashAttribute` (required when coverage < 1).
- **Description** (optional but recommended).

### `edit`

- **Rule ID** — resolved interactively by showing a numbered list (step 3b). User picks by number.
- **Patch fields** — only the fields the user wants to change.

### `remove`

- **Rule ID** — resolved the same way as edit.

## Workflow

```
- [ ] 1. Fetch flag and current state
- [ ] 2. Confirm the action (add / edit / remove)
- [ ] 3a. Add path
- [ ] 3b. Edit path
- [ ] 3c. Remove path
- [ ] 4. Hand off to flag-publish
```

### 1. Fetch flag and current state

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Capture: `valueType`, `environmentSettings` keys (available env IDs), `rules` array (full list with IDs, types, scope, enabled state). If 404, halt: "no flag with id `<flag-id>`." Suggest `loadSkill('flag-search')`.

### 2. Confirm the action

If the user's request is ambiguous, ask before mutating.

### 3a. Add path

**New rules append to the bottom** of the rules array. Rules evaluate top-to-bottom; first match wins. If the flag already has rules, surface this:

> "The flag has `<N>` existing rule(s); this new rule will be evaluated last. If it needs priority over an existing rule, reorder via flag-rules after adding."

**Pre-validate `value` against `valueType`** — the API doesn't catch mismatches at write time:

- `boolean` → must be `"true"` or `"false"`
- `number` → must parse as a number
- `json` → must be valid JSON
- `string` → any non-empty string

**Resolve scope.** Confirm the environment IDs against `environmentSettings`. Set either `allEnvironments: true` or `environments: [...]` — never both.

**Fetch available attributes** — do this before asking the user to describe any condition. If the flag has a project, pass it as `projectId` to get only relevant attributes (org-wide + project-scoped); omit it for org-wide flags:

```json
{
  "method": "GET",
  "path": "/api/v1/attributes",
  "query": { "projectId": "<flag-project-id>" }
}
```

```json
{ "method": "GET", "path": "/api/v1/attributes" }
```

Surface the returned list to the user grouped by type, with notable metadata called out:

```
Available targeting attributes for this flag:
  id            (string, hashAttribute)
  country       (string, format: isoCountryCode)
  app_version   (string, format: version)
  plan          (enum: free|pro|enterprise)
  is_employee   (boolean)
```

If no attributes exist (or none are in scope), warn: "No targeting attributes are registered for this project. Add them under Settings → Attributes before targeting."

**Resolve `hashAttribute` for rollout rules** (required when `coverage < 1`):
From the filtered attribute list, prefer `hashAttribute: true` entries. Default to `id` for "by user"; pick the company-scoped attribute for "by company."

A rule has three separate targeting properties that can be combined freely. Determine which ones apply, then build all relevant fields before posting.

**`condition` — attribute-based targeting** (MongoDB-style JSON string)

Targets users based on attributes passed into the SDK. Pick attributes from the filtered list fetched above. If the user's description doesn't map clearly to an available attribute, show the list and ask them to pick. Refuse any attribute name not in the filtered list — unregistered attributes silently never match at SDK evaluation time.

Serialize the condition object as a JSON string in the payload.

| Category                          | Operators                                        | Meaning                                                                                       |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Equality                          | `$eq`, `$ne` (or bare key/value for eq)          | `=`, `≠`                                                                                      |
| Comparison                        | `$lt`, `$lte`, `$gt`, `$gte`                     | `<`, `≤`, `>`, `≥`                                                                            |
| Semantic version                  | `$veq`, `$vne`, `$vlt`, `$vlte`, `$vgt`, `$vgte` | Version-aware comparison — `"1.0.10" > "1.0.9"`. Use on `format: version` attributes.         |
| Set membership                    | `$in`, `$nin`                                    | is any of, is none of (case-sensitive)                                                        |
| Set membership (case-insensitive) | `$ini`, `$nini`                                  | is any of / none of — ignores case                                                            |
| String contains                   | `$includes`, `$notIncludes`                      | string or array contains / does not contain value                                             |
| Regex                             | `$regex`, `$notRegex`                            | matches / does not match pattern (case-sensitive)                                             |
| Regex (case-insensitive)          | `$regexi`, `$notRegexi`                          | same, ignores case                                                                            |
| Existence                         | `$exists`, `$notExists`                          | is not NULL / is NULL                                                                         |
| Emptiness                         | `$empty`, `$notEmpty`                            | string or array is empty / not empty                                                          |
| Boolean                           | `$true`, `$false`                                | attribute is truthy / falsy                                                                   |
| Type                              | `$type`                                          | JS type equals value (e.g. `"string"`, `"number"`)                                            |
| Array                             | `$elemMatch`, `$all`, `$alli`, `$size`           | element matches condition; all values present (`$alli` = case-insensitive); length comparison |
| Saved group (raw)                 | `$inGroup`, `$notInGroup`                        | in / not in a saved group by ID — prefer the `savedGroups` rule field instead                 |
| Logical                           | `$or`, `$and`, `$nor`, `$not`                    | top-level keys are ANDed; use these for OR / negation                                         |

Key rules:

- Multiple top-level keys are **AND**ed: `{"country": "US", "plan": "pro"}` requires both.
- String comparisons are **case-sensitive** by default — use `$ini`/`$regexi` variants when needed.
- Conditions are evaluated **client-side by the SDK** — attribute values never reach GrowthBook servers.
- Only use operators from this table. Unlisted MongoDB operators (e.g. `$where`, `$expr`) silently never match.

Examples:

```json
{"country": "US"}
{"country": {"$ini": ["us", "ca", "gb"]}}
{"plan": {"$ne": "free"}}
{"appVersion": {"$vgte": "3.0.0"}}
{"age": {"$gte": 18, "$lt": 65}}
{"email": {"$regexi": "@acme\\.com$"}}
{"$or": [{"country": "US"}, {"beta": true}]}
{"tags": {"$includes": "power-user"}}
{"company": {"$exists": true}, "plan": {"$in": ["pro", "enterprise"]}}
```

---

**`savedGroups` — saved group targeting** (separate rule field)

Targets users who belong to a pre-defined saved group. Fetch available groups:

```json
{ "method": "GET", "path": "/api/v1/saved-groups" }
```

Build the field as an array of group references:

```json
"savedGroups": [
  { "ids": ["<sg-id>"], "match": "all" }
]
```

- `ids` — array of saved group IDs to reference
- `match: "all"` — user must be in **all** listed groups; `"any"` — user must be in **at least one**

Use saved groups for named populations managed outside the flag ("beta testers", "internal users", "enterprise accounts"). Prefer this over hand-writing `$inGroup` in the `condition` string.

---

**`prerequisites` — rule-level prerequisite targeting** (separate rule field)

Gates this rule on the evaluated value of another feature flag. If the prerequisite condition fails for a user, this rule is skipped (the next rule in order is evaluated instead — distinct from feature-level prerequisites which skip the entire flag).

```json
"prerequisites": [
  { "id": "<flag-id>", "condition": "{\"value\": true}" }
]
```

The `condition` string evaluates against `{ "value": <the prerequisite flag's evaluated result> }`. `value` is the only valid top-level key.

The two conditions that cover 99% of cases:

| Goal                                           | Condition                       |
| ---------------------------------------------- | ------------------------------- |
| Boolean flag is on                             | `{"value": true}`               |
| Boolean flag is off                            | `{"value": false}`              |
| Non-boolean flag is live (returning any value) | `{"value": {"$exists": true}}`  |
| Non-boolean flag is not live                   | `{"value": {"$exists": false}}` |

For anything more specific (e.g. string flag equals a particular variant), the full operator table from the `condition` section above applies — but ask the user to confirm before writing complex prerequisite conditions.

---

**Combining all three:**

All three properties are ANDed together. A rule with all three set fires only when the user is in the saved group AND the attribute condition matches AND all prerequisite flags pass:

```json
{
  "condition": "{\"country\": \"US\"}",
  "savedGroups": [{ "ids": ["sg_beta"], "match": "all" }],
  "prerequisites": [{ "id": "new-checkout", "condition": "{\"value\": true}" }]
}
```

**Ambiguous cases** ("VIP customers", "enterprise users") — ask: is this a named group in GrowthBook (saved group), an attribute on the user record (condition), or both?

| User says                               | Field to use                                                       |
| --------------------------------------- | ------------------------------------------------------------------ |
| "Turn it on for our beta testers"       | `savedGroups`                                                      |
| "Users in the US"                       | `condition` on `country` attribute                                 |
| "iOS users on version 5.2 or higher"    | `condition`: `{"platform": "ios", "appVersion": {"$vgte": "5.2"}}` |
| "Only when the new-checkout flag is on" | `prerequisites`                                                    |
| "Enterprise users"                      | **Ask** — saved group or `{"plan": "enterprise"}` condition?       |

**Build and POST the payload:**

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules",
  "body": {
    "rule": {
      "type": "force",
      "value": "<string>",
      "description": "<optional>",
      "enabled": true,
      "allEnvironments": false,
      "environments": ["production"],
      "condition": "<optional JSON string>",
      "savedGroups": [{ "ids": ["<sg-id>"], "match": "all" }],
      "prerequisites": [{ "id": "<flag-id>", "condition": "{\"value\": true}" }]
    }
  }
}
```

For rollout: swap `type: "rollout"`, add `coverage` and `hashAttribute`. Omit empty arrays/strings.

Capture `revision.version`.

### 3b. Edit path

Show the rules as a numbered list:

```
Rules on `<flag-id>`:
  1. [force]    all envs     value="true"    "Beta testers" (saved group)
  2. [rollout]  production   10%             hash=id
  3. [force]    staging      value="false"   "Kill switch"
```

User picks by number. Surface current values; ask which fields to change.

**Empty-patch guard:** if the proposed changes match current values verbatim, halt — "no changes to apply." A no-op draft burns rate-limit budget and can invalidate previously-granted approvals via `resetReviewOnChange`.

**Rule-type behavior on edit:**

- **Explicit `type` changes are server-rejected.** To convert a force rule to an experiment-ref rule: remove and re-add (3c then 3a or flag-experiment).
- **`force` ↔ `rollout` auto-flips** based on effective coverage. Patching `coverage: 0.25` onto a force rule silently converts it to rollout (also requires `hashAttribute`). Report the type transition in the summary.

**experiment-ref edit rules:**

- **Server-rejected patches:** `value`, `coverage`, `controlValue`. Halt early with explanation.
- **Warn-and-confirm patches:** `experimentId`, `variations`. API allows them but causes silent flag/experiment drift. Require explicit confirmation: "Changing `experimentId`/`variations` directly can cause the flag rule and experiment to drift. The experiment is the source of truth. Are you sure?"
- **Safe to edit:** `enabled`, `condition`, `savedGroups`, `prerequisites`, scope, `description`.

**Scope subtlety:** when changing scope, always send both `allEnvironments` and `environments` together. Sending only `environments` without `allEnvironments` causes the server to infer `allEnvironments: false`, silently narrowing scope.

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>",
  "body": { "<patch fields>": "..." }
}
```

Capture `revision.version`.

### 3c. Remove path

Show the numbered list. Confirm:

> "Remove rule `<N>` (`<type>`, `<scope>`, `<summary>`) from `<flag-id>`? This goes into a draft and only takes effect after publishing."

```json
{
  "method": "DELETE",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules/<rule-id>"
}
```

For experiment-ref removal: "The linked experiment is not affected by removing this rule."

Capture `revision.version`.

### 4. Hand off to flag-publish

After any mutation, ask: "Publish this change now, or leave it as a draft?"

Call `loadSkill('flag-publish')`. It handles:

- Approval-required (400) — offer review flow, org-wide bypass, per-token bypass
- Merge conflict (409) — show conflict fields, collect overwrite/discard decisions, rebase

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly (e.g. `.../revisions/42/rules`) instead of `new`. This keeps all changes in the same draft across chained skills. Fall back to `new` when starting fresh — it auto-creates or reuses the most recently updated open draft via `resolveOrCreateRevision`.
- **Rule ID is a UUID (`fr_...`), not a position number.** Always resolve from the `rules` array — never guess.
- **`force` vs `rollout` is mostly cosmetic server-side.** A force rule with `coverage < 1` is effectively a rollout. Default to `force` unless the user says "percentage" or specifies coverage; the server auto-flips.
- **`coverage < 1` requires `hashAttribute`.** Validate before POSTing.
- **Scope: exactly one of `allEnvironments: true` or `environments: [...]`.** Never both.
- **Always fetch attributes before asking for a condition.** Use `?projectId=<id>` when the flag is project-scoped so the server returns only relevant attributes. Surface the list upfront. Never accept an attribute name the user provides without confirming it's in the returned list — unregistered attributes silently never match at SDK evaluation time.
- **Conditions are JSON strings.** Validate they're parseable. Prefer Saved Groups over hand-written conditions — they're reusable and managed.
- **`valueType` mismatch is a footgun.** The v2 rule-add handler doesn't validate at write time. Always pre-validate client-side.
- **Refuse empty patches.** A no-op revision update burns rate limit and can reset review approvals.
- **New rules append to the bottom.** First match wins. Surface evaluation order concerns before posting.
- **Self-approval blocked.** Don't attempt `submit-review` after `request-review`.
- **Environment toggles are handled by flag-toggle**, not this skill. This skill does not touch env-level enable/disable.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag state, current rules, env list, valueType
- `GET /api/v1/attributes` — fetch attributes; pass `?projectId=<id>` when the flag is project-scoped; surface upfront before building any condition; pick `hashAttribute` for rollouts
- `GET /api/v1/saved-groups` — resolve saved groups for targeting
- `POST /api/v2/features/:id/revisions/new/rules` — add rule
- `PUT /api/v2/features/:id/revisions/new/rules/:ruleId` — edit rule
- `DELETE /api/v2/features/:id/revisions/new/rules/:ruleId` — remove rule

## Handoffs

- `loadSkill('flag-toggle')` — for environment-level enable/disable (kill switch)
- `loadSkill('flag-rules')` — for reordering rules or routing to other rule types
- `loadSkill('flag-experiment')` — for adding experiment-ref or inline experiment rules
- `loadSkill('flag-ramp')` — to progressively increase coverage on a rollout rule over time
- `loadSkill('flag-monitoring')` — to add guardrail metric monitoring to a rollout
- `loadSkill('flag-prerequisites')` — for feature-level prerequisite gates
- `loadSkill('flag-search')` — to resolve a flag ID from a description
- `loadSkill('flag-publish')` — to publish the draft (handles approval and merge conflicts)
