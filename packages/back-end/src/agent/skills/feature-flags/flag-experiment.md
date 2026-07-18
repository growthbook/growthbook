---
name: flag-experiment
description: Add an experiment-ref rule to a GrowthBook feature flag to run an A/B test through that flag. Use when the user says "run an experiment through this flag", "add an A/B test to flag X", "link experiment Y to this flag", "set up variations on this flag for an experiment", "add an experiment-ref rule", or "wire up this experiment to the flag". For launching a full new experiment end-to-end, use experiment-launch. For editing the targeting conditions or scope of an existing experiment rule, use flag-targeting. For stopping an experiment and cleaning up its rule, use experiment-stop then flag-rules.
---

# flag-experiment

Add an `experiment-ref` rule to a GrowthBook feature flag. This links a flag rule to a separately-managed GrowthBook experiment object — the experiment is the source of truth for variations, metrics, and analysis.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Workflow

### Path A — Add an experiment-ref rule

Use this when the user has an existing GrowthBook experiment or wants to launch one through a flag.

**1. Fetch the flag and confirm the experiment exists:**

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Capture `valueType` — you'll need it to map variation values correctly.

```json
{ "method": "GET", "path": "/api/v1/experiments/<experiment-id>" }
```

Capture the experiment's `variations` array. Each variation has an `id` (e.g., `var_abc123`) and a `name`. You'll need these to wire up the rule.

If the user doesn't have an experiment yet, call `loadSkill('experiment-launch')` — it handles experiment creation AND flag wiring end-to-end. Importantly, if a flag already exists, `experiment-launch` will detect it (via a 409 on create, then the reuse path) and wire the experiment to the existing flag rather than creating a new one. Tell the user: "experiment-launch will pick up your existing flag — just give it the same flag key."

**2. Map variation values:**

For each experiment variation, confirm what flag value should be served. The flag's `valueType` determines the format:

- `boolean`: typically `"true"` for treatment, `"false"` for control
- `string` / `number` / `json`: ask the user for each variation's value

**3. Build and post the payload:**

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>/revisions/new/rules",
  "body": {
    "rule": {
      "type": "experiment-ref",
      "experimentId": "<exp-id>",
      "variations": [
        { "variationId": "<var_control_id>", "value": "false" },
        { "variationId": "<var_treatment_id>", "value": "true" }
      ],
      "description": "<optional>",
      "enabled": true,
      "allEnvironments": false,
      "environments": ["<env-id>"]
    }
  }
}
```

Variation order in the `variations` array must match the experiment's variation order. If the user omits all `variationId` fields, the server auto-fills them from the experiment — but explicitly providing them is safer and avoids silent mismatches.

Capture the returned `version`. Call `loadSkill('flag-publish')`.

### Path B — Edit an existing experiment-ref rule's targeting

The server allows patching `enabled`, `condition`, `savedGroups`, `prerequisites`, scope (`allEnvironments`/`environments`), and `description` on an experiment-ref rule. Call `loadSkill('flag-targeting')` for this — it has the full conditions decision tree and the warn-and-confirm guardrails for the sensitive fields.

**Do not edit `experimentId` or `variations` on an experiment-ref rule directly.** The experiment is the source of truth. Changing these fields on the flag rule alone causes silent drift between the flag and the experiment. If the user needs to change the experiment, call `loadSkill('experiment-launch')` or route to the GrowthBook UI.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly instead of `new`. Fall back to `new` when starting fresh.
- **`variations` order must match the experiment's variation order.** If the order is wrong, variation assignments will be mismatched — the control users will see the treatment value and vice versa. Always confirm variation order by reading the experiment before building the payload.
- **Auto-fill of `variationId` is available but risky.** If all `variationId` fields are omitted, the server fills them from the experiment. Use this only when the experiment has exactly the same number of variations as the values the user specified — otherwise the server may silently mismatch.
- **Editing `experimentId` or `variations` on an existing experiment-ref rule requires warn-and-confirm.** These fields are API-allowed but cause flag/experiment drift. Always surface the risk and require explicit confirmation before patching.
- **Server-rejected patches on experiment-ref rules:** `value`, `coverage`, `controlValue`. These are attributes of the experiment, not the flag rule. Halt early if the user tries to set them.
- **Experiment must be in the same datasource.** If the experiment uses a datasource that doesn't match the org's default, metric lookups may fail. Verify datasource consistency if the user is specifying metrics on an inline rule.
- **One experiment-ref rule per experiment per flag** is the standard convention. Multiple rules pointing at the same experiment create overlapping bucketing and corrupt analysis.

## Endpoints used

- `GET /api/v2/features/:id` — fetch flag state, valueType, and current rules
- `GET /api/v1/experiments/:id` — fetch experiment and its variations
- `POST /api/v2/features/:id/revisions/new/rules` — add the experiment-ref rule

## Handoffs

- `loadSkill('flag-search')` — to find a flag ID when you only have a name or description
- `loadSkill('experiment-launch')` — to create a new experiment and wire it to a flag end-to-end
- `loadSkill('flag-targeting')` — to edit the targeting conditions, scope, or saved groups on an existing experiment-ref rule
- `loadSkill('flag-rules')` — to reorder or delete experiment rules
- `loadSkill('experiment-stop')` — to stop the experiment; after stopping, use flag-rules to clean up the experiment-ref rule
- `loadSkill('flag-publish')` — to publish the draft
