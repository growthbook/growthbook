---
name: experiment-launch
description: Launch a GrowthBook A/B test end-to-end via the REST API — create the experiment, prep the feature flag, wire the experiment-ref rule, and start the experiment. Use when the user says "launch this experiment", "create the experiment", "wire up the A/B test", "kick off the test", "set up X as an experiment in GrowthBook", "start the experiment for flag Y", or "I already have a flag and want to run an experiment on it". Works for both experiment-first (creates the flag) and flag-first (detects the existing flag via the reuse path and wires the experiment to it). For designing the spec first, use experiment-design. For stopping a running experiment, use experiment-stop. For interpreting results, use experiment-analyze.
---

# experiment-launch

Launch a GrowthBook A/B test end-to-end: create the experiment in draft, prep or reuse the feature flag, add the experiment-ref rule on a fresh draft revision, then call `/start` to publish the rule and flip the experiment to running. Handles the approval-required and pre-launch-checklist failure paths.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Required inputs

Collect from the user (or earlier skill output) before starting. Prompt for what's missing.

- **Feature flag name** — kebab-case key, regex `[a-zA-Z0-9_-]`
- **Experiment name** — human-readable
- **Variations** — array of `{name, value}`, length ≥ 2. The first entry is the **control**. Values are serialized as strings on the rule (booleans → `"false"`/`"true"`, numbers → `"42"`, JSON → JSON-encoded string).
- **Project ID** (optional) — pins the experiment and flag to a specific project

## Optional inputs

- **Hypothesis** — falsifiable; if/then/because format
- **Template description** — English description matched against `templateMetadata.name`/`description` returned by `/v1/experiment-templates`. If omitted and templates exist, ask the user to pick one or skip.

If no template is used, also collect (or resolve interactively in step 2):

- **Datasource** — id or English name
- **Hash attribute** — the unit of randomization (`id`, `device_id`, etc.). Must equal the `identifierType` of the assignment query selected on the datasource.
- **Assignment query** — id or English name; lives inside the chosen datasource's `assignmentQueries`
- **Goal metric ID** — exactly one (the primary KPI you'd ship or kill on)
- **Secondary metric IDs** — supporting metrics
- **Guardrail metric IDs** — defensive metrics that should not regress

## Workflow

Track progress with this checklist. Do not skip or reorder.

```
- [ ] 1. Pick a template (or skip)
- [ ] 2. Resolve hash attribute → datasource → assignment query → metrics (no-template path only)
- [ ] 3. Create the experiment in draft
- [ ] 4. Create or reuse the feature flag
- [ ] 5. Add the experiment-ref rule on a fresh draft revision
- [ ] 6. Surface QA links for the experiment and feature flag config
- [ ] 7. POST /start; branch to 7a (approval) or 7b (checklist) on 400
- [ ] 8. Report links and state
```

### 1. Pick a template (or skip)

```json
{ "method": "GET", "path": "/api/v1/experiment-templates" }
```

- **Zero templates** → continue without one; go to step 2.
- **One or more** → list as `name — description` plus a final "Skip" option. If a template description was provided, pre-select the best match by `templateMetadata.name`/`description` and confirm. Never invent a template.

If chosen, capture: `id` (becomes `templateId`), `datasource`, `exposureQueryId`, `hashAttribute`, `goalMetrics`, `statsEngine`, `targeting`. Templates inject all of these; skip step 2 entirely.

If the template's `type` is `"multi-armed-bandit"`, halt and confirm with the user. Bandits behave very differently from standard A/B tests (dynamic traffic allocation, per-arm probabilities instead of winner/loser, different analysis), and this skill's launch and analysis assumptions are written for `type: "standard"`. Recommend they configure bandits in the UI for now.

### 2. Resolve hash attribute → datasource → assignment query → metrics

No-template path only. Order matters — pick hash attribute first so you don't trap yourself on a datasource that can't randomize on it.

**2a. Pick the hash attribute.** Filter to attributes flagged as hashAttribute:

```json
{ "method": "GET", "path": "/api/v1/attributes" }
```

Surface attributes where `hashAttribute === true` and `archived !== true`. Ask the user to pick. If the filtered list is empty, halt — tell the user to mark at least one attribute as a hash attribute under **Settings → Attributes** in GrowthBook.

**2b. Pick the datasource.**

```json
{ "method": "GET", "path": "/api/v1/data-sources" }
```

Resolve English name or ID against `dataSources[].name` / `id`. Capture `DATASOURCE_ID` and keep the full object — 2c reads its `assignmentQueries`.

**2c. Pick the assignment query.** Filter `dataSources[].assignmentQueries` to entries where `identifierType === HASH_ATTRIBUTE`:

- **Exactly one match** → auto-select it; print one line stating the choice.
- **Zero matches** → halt and offer three fixes: pick a different datasource (rerun 2b), change the hash attribute (rerun 2a), or add an assignment query for `<HASH_ATTRIBUTE>` in GrowthBook.
- **Two or more** → list each as `name (identifierType=<value>) — <description>` and let the user pick.

If `assignmentQueries` is empty entirely, halt and tell the user to configure one in GrowthBook before re-running.

**2d. Pick metrics, filtered by datasource.** The API rejects metrics from a different datasource than the experiment's:

```json
{
  "method": "GET",
  "path": "/api/v1/fact-metrics",
  "query": { "datasourceId": "<DATASOURCE_ID>", "limit": "100" }
}
```

```json
{
  "method": "GET",
  "path": "/api/v1/metrics",
  "query": { "datasourceId": "<DATASOURCE_ID>", "limit": "100" }
}
```

Help the user pick:

- **Goal metric(s)** (`GOAL_METRIC_IDS`). Ideally one, two max — push back at three or more and demote the rest to secondary or guardrail.
- **Secondary metrics** (`SECONDARY_METRIC_IDS`) — supporting context.
- **Guardrail metrics** (`GUARDRAIL_METRIC_IDS`) — defensive. Push back if they name none; every experiment needs at least one. Guardrails are excluded from multiple-comparison correction by design.

### 3. Create the experiment in draft

Set `trackingKey` to the feature flag name so the SDK ties exposures to the flag. Each variation needs a stable string `key` (`"0"`, `"1"`, ...) and `name`. Variation values live on the flag rule (step 5), not on the experiment payload.

**Template path** — do NOT also send `datasourceId` / `assignmentQueryId`; the template provides them and the API rejects the combination.

```json
{
  "method": "POST",
  "path": "/api/v1/experiments",
  "body": {
    "templateId": "<from step 1>",
    "trackingKey": "<flag-name>",
    "name": "<experiment name>",
    "hypothesis": "<hypothesis>",
    "variations": [
      { "key": "0", "name": "Control" },
      { "key": "1", "name": "Treatment" }
    ],
    "project": "<project id, omit if org-wide>"
  }
}
```

**No-template path** — send everything from step 2 explicitly:

```json
{
  "method": "POST",
  "path": "/api/v1/experiments",
  "body": {
    "datasourceId": "<DATASOURCE_ID>",
    "assignmentQueryId": "<ASSIGNMENT_QUERY_ID>",
    "hashAttribute": "<HASH_ATTRIBUTE>",
    "trackingKey": "<flag-name>",
    "name": "<experiment name>",
    "hypothesis": "<hypothesis>",
    "variations": [
      { "key": "0", "name": "Control" },
      { "key": "1", "name": "Treatment" }
    ],
    "metrics": ["<GOAL_METRIC_ID>"],
    "secondaryMetrics": ["<SECONDARY_METRIC_IDS>"],
    "guardrailMetrics": ["<GUARDRAIL_METRIC_IDS>"],
    "project": "<project id, omit if org-wide>"
  }
}
```

Notes:

- `metrics` is the goal-metric array; with the one-goal rule it should always be length 1.
- Omit `secondaryMetrics` / `guardrailMetrics` entirely if the user picked none. Don't send empty arrays.

Capture from the response:

- `experiment.id` — used in steps 5 and 6.
- `experiment.variations[].variationId` — the **string ID** for each variation (e.g. `var_abc123`). You need these in step 5; they are required on the `experiment-ref` rule.

### 4. Create or reuse the feature flag

**Try create first** unless the user said the flag already exists. The flag must default to the **control** value (variation 0's value), serialized as a string. Default all environments to off as well. Set `owner` to the user's email/`u_...` userId if they specify one, otherwise send an empty string.

```json
{
  "method": "POST",
  "path": "/api/v2/features",
  "body": {
    "id": "<flag-name>",
    "owner": "",
    "valueType": "<boolean|string|number|json>",
    "defaultValue": "<control value as string>",
    "description": "Drives experiment: <experiment name> (<exp_id>)",
    "project": "<project id, omit if org-wide>"
  }
}
```

- **Success** → go to step 5.
- **409 Conflict** (flag exists) → fall through to the reuse compatibility checks below.

**Reuse path — fetch and validate:**

```json
{ "method": "GET", "path": "/api/v2/features/<flag-name>" }
```

Run these compatibility checks against the response. Each row says what to do on failure:

| Check                                                                                              | Action on failure                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archived === false`                                                                               | **Halt.** Tell the user to un-archive the flag in the UI before re-running.                                                                              |
| `valueType` matches the experiment's `<boolean\|string\|number\|json>`                             | **Halt.** Surface both values; do not silently change types.                                                                                             |
| `project` matches the experiment's project (when set)                                              | **Halt.** Reusing a flag from another project misroutes the experiment.                                                                                  |
| `defaultValue` equals the control value (string-compared)                                          | **Warn**, do not halt. The experiment rule supplies the variation values; the existing default applies only when the rule doesn't match. Ask "continue?" |
| No existing rule with `type === "experiment-ref"` AND `experimentId === <exp_id>` already attached | If one exists → this experiment is already wired up. Skip step 5 and jump to step 6.                                                                     |
| No conflicting `experiment-ref` rule for another _running_ experiment in the same environments     | **Warn**, do not halt. Ask "this flag is currently driving experiment `<other_id>`; add another rule alongside it?"                                      |

When all checks pass, capture the flag's identity and proceed to step 5. Do **not** mutate the existing flag here — all mutations go through the draft revision in step 5.

### 5. Add the experiment-ref rule on a fresh draft revision

Use the literal version `new` to create a draft and add the rule in one call. The path segment `new` is a magic value that creates a draft branched off the live revision atomically. If the feature has multiple environments, prompt the user for which environments to go live in, and ensure this rule turns on the feature flag for those environments in addition to adding the rule to those environments.

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-name>/revisions/new/rules",
  "body": {
    "rule": {
      "type": "experiment-ref",
      "experimentId": "<exp_id from step 3>",
      "enabled": true,
      "allEnvironments": true,
      "variations": [
        {
          "value": "<variation 0 value as string>",
          "variationId": "<var_id from step 3, position 0>"
        },
        {
          "value": "<variation 1 value as string>",
          "variationId": "<var_id from step 3, position 1>"
        }
      ],
      "description": "Experiment: <experiment name>"
    }
  }
}
```

`variations[]` must have one entry per experiment variation, in the same order as step 3. Each entry needs **both** `value` (serialized as a string) and `variationId` (the string ID captured in step 3) — `variationId` is required by the v2 features validator and omitting it returns a `400`. Capture the returned `version` for the draft revision.

Do **not** publish the revision here. Step 7's `/start` call auto-publishes the draft when it flips the experiment to running.

### 6. Pause for QA before /start

The draft revision and experiment are reversible up to this point; step 7's `/start` publishes the rule and flips the experiment to running.

Surface the UI links so the user can QA the flag default, the rule's variation values, and the experiment's targeting and metrics:

- Experiment: `/experiment/<exp_id>`
- Feature: `/features/<flag-name>` (draft revision `<version>`)

When the user is ready, proceed to step 7 — `callApi` gates the `/start` mutation.

### 7. Start the experiment

```json
{ "method": "POST", "path": "/api/v1/experiments/<exp_id>/start", "body": {} }
```

The `/start` endpoint does two things server-side:

1. Publishes the draft feature revision from step 5 (`publishPendingFeatureDraftsForExperiment`).
2. Enforces the org's pre-launch checklist.

Either can fail with a `400`. Branch:

- Body starts with **"This revision requires approval before publishing"** → step 7a.
- Body lists incomplete checklist items → step 7b.
- `2xx` → step 8.

#### 7a. Approval required

The experiment and flag exist; only the rule revision is stuck in draft. Halt and offer the user three concrete paths:

> Your org requires approval before this feature flag rule can go live, and `/start` will not flip the experiment to running until the rule is published. Revision `<version>` on `<flag-name>` is in draft state. Pick one:
>
> **A. Standard review flow** (recommended) — I'll request a review now. A teammate (not you, since you created the draft) approves it in the GrowthBook UI at `/features/<flag-name>`, then you re-run me and I'll resume from `/start`.
>
> **B. Org-wide bypass** — an admin enables "REST API always bypasses approval requirements" in **Settings → General → Approvals**. After that, re-run me.
>
> **C. Per-token bypass** — use credentials whose role grants `bypassApprovalChecks` on this project (Admin or custom role), then re-run me.

If the user picks **A**, request review on the draft and stop:

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-name>/revisions/<version>/request-review",
  "body": { "comment": "Auto-requested by experiment-launch for <exp_id>" }
}
```

Do **not** attempt `submit-review` yourself — the API rejects self-approval on a draft you created. Stop and tell the user to re-run after approval.

If the user picks **B** or **C**, stop with a one-line note. The existing draft will pick up the new permission and publish on retry.

Do **not** silently retry `/start`, ignore the error, or discard and recreate the draft to work around the policy.

#### 7b. Checklist incomplete

The REST API does not expose a separate `start-checklist` endpoint — the failure body from `/start` is the canonical source. Parse it and surface the incomplete items verbatim:

> The pre-launch checklist isn't complete. The `/start` call returned:
>
> `<full error body>`
>
> Fix the listed items in the GrowthBook UI at `/experiment/<exp_id>`, then re-run me — I'll jump straight back to `/start`.

Only retry `/start` with `{"skipChecklist": true}` in the body if the user **explicitly** asks to bypass. Never default to bypassing; the checklist is intentional friction.

### 8. Report

Print a summary:

- Experiment name and `id`
- Feature flag ID and published revision version
- Template used (name + id) if any
- Unit of randomization (`hashAttribute`)
- Variations and their values
- Pre-launch checklist status (should be `allRequiredComplete=true`)
- Experiment status (should be `running` after a clean `/start`)
- Direct UI links:
  - Experiment: `/experiment/<exp_id>`
  - Feature: `/features/<flag-name>`

## Guardrails

- **Ideally one goal metric, two max.** GrowthBook's decision framework treats goal metrics as plural by design and the power calculator supports up to five, but each additional goal dilutes power and complicates the ship/kill decision. Push back at three or more; demote the rest to secondary.
- **At least one guardrail.** Push back if the user skips guardrails.
- **`hashAttribute` and `assignmentQuery.identifierType` must match.** Mismatch is a real and recoverable error; surface the fix paths in step 2c.
- **Metrics must live on the experiment's datasource.** Filter `/v1/metrics` and `/v1/fact-metrics` by `datasourceId` in step 2d.
- **Do NOT mix `templateId` with `datasourceId`/`assignmentQueryId`.** The template path supplies those; the no-template path supplies them explicitly. Mixing yields a `400`.
- **Flag default = control value.** Variation values for flag-linked experiments are strings on the rule — `"false"`/`"true"` for booleans, `"42"` for numbers, JSON-encoded text for `json`.
- **Reuse with care.** Always run the step 4 compatibility checks before reusing an existing flag. Silently attaching to a flag with the wrong `valueType`, wrong `project`, or a conflicting rule will break the experiment or step on a teammate's in-flight test.
- **No manual revision publish.** The step 5 draft is published by `/start` in step 7. Do not call publish endpoints separately.
- **Approval failures: do not self-approve.** The API blocks approval on drafts you created. Walk the user through 7a instead.
- **Checklist failures: do not bypass by default.** Only set `skipChecklist: true` after the user explicitly opts in.

## Endpoints used

- `GET /api/v1/experiment-templates` — list templates
- `GET /api/v1/attributes` — filter to `hashAttribute=true`
- `GET /api/v1/data-sources` — pick datasource and assignment query
- `GET /api/v1/fact-metrics?datasourceId=…`, `GET /api/v1/metrics?datasourceId=…` — pick goal / secondary / guardrail
- `POST /api/v1/experiments` — create the draft experiment
- `POST /api/v2/features` — create the linked feature flag (when not reusing)
- `GET /api/v2/features/<id>` — fetch the flag for the reuse compatibility checks
- `POST /api/v2/features/<id>/revisions/new/rules` — atomic draft + add experiment-ref rule
- `POST /api/v2/features/<id>/revisions/<version>/request-review` — used only in the 7a "request review" path
- `POST /api/v1/experiments/<id>/start` — publish the draft revision and start the experiment. Body accepts `{"skipChecklist": true}` to bypass the pre-launch checklist when the user explicitly opts in. Failure responses carry the canonical reason in the body — there's no separate `start-checklist` GET to query.

## Handoffs

- `loadSkill('experiment-design')` — if no spec exists, route back here first.
- `loadSkill('flag-search')` — to find an existing flag ID when you only have a name or description.
- `loadSkill('experiment-analyze')` — after the experiment is running and traffic accumulates.
- `loadSkill('experiment-stop')` — when results are settled.
- Manual metric creation — if a metric you need doesn't exist yet, the user must create it in the GrowthBook UI at `/metrics` (or `/fact-tables` for fact metrics) before re-running this skill. No skill for that yet.
