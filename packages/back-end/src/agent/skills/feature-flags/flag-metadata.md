---
name: flag-metadata
description: Update the administrative metadata of an existing GrowthBook feature flag — description, owner, project, tags, custom fields, or JSON schema. Use when the user says "change the owner of flag X", "add tags to this flag", "move this flag to project Y", "update the description", "set a JSON schema on this flag", "rename the owner", or "tag this flag as payments". Goes through a draft revision and requires publishing to take effect. For changing the flag's default value, use flag-default-value. For creating a new flag, use flag-create. For archiving or deleting a flag, use flag-cleanup.
---

# flag-metadata

Update the administrative metadata of an existing GrowthBook feature flag. Metadata changes (description, owner, project, tags, custom fields, JSON schema) go through a draft revision like all other flag changes — they need to be published before they take effect.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Required inputs

Collect before starting:

- **Flag ID** — kebab-case key. If the user gives a description, use `loadSkill('flag-search')` to resolve it first.
- **What to change** — one or more of: description, owner, project, tags, neverStale, customFields, jsonSchema.

## Workflow

### 1. Fetch current metadata

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Show the user the current values for any fields they're about to change. Confirm the proposed new values before mutating.

### 2. Resolve the project ID (if changing project)

Project names aren't accepted by the API — resolve the name to an ID first:

```json
{ "method": "GET", "path": "/api/v1/projects" }
```

Match the user's project name to the returned list and use the `id` field.

### 3. Apply the metadata change via a draft

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<flag-id>/revisions/new/metadata",
  "body": {
    "description": "<string>",
    "owner": "<email or u_... userId>",
    "project": "<project-id or empty string to clear>",
    "tags": ["<tag>", "<tag>"],
    "neverStale": true,
    "customFields": { "<key>": "<value>" },
    "jsonSchema": { "<json-schema-object>": "..." }
  }
}
```

The `new` magic version creates a fresh draft or layers onto an existing one atomically.

Send only the fields the user wants to change. Do not echo back unchanged fields. Capture the returned `version` number for the publish step.

### 4. Offer to publish

Ask: "Publish this metadata change now, or leave it as a draft?"

Metadata changes are low-risk — default to offering publish immediately. Call `loadSkill('flag-publish')` for the publish step, including any approval-required or merge-conflict handling.

## Guardrails

- **Draft version threading.** If a version number is already in context from a previous write skill in this session, use it explicitly (e.g. `.../revisions/42/metadata`) instead of `new`. This keeps all changes in the same draft. Fall back to `new` when starting fresh — it auto-creates or reuses the most recently updated open draft.
- **`owner` accepts email or `u_...` userId.** Use the logged-in user's identity if they want to assign the flag to themselves. If the user gives a name rather than an email, ask for clarification — the API doesn't accept display names.
- **`project` is an ID, not a name.** Always resolve project names via `GET /api/v1/projects` before setting. An empty string `""` clears the project association (moves the flag back to org-wide scope).
- **`tags` replaces the full array.** It's not additive — if the flag has existing tags and the user only wants to add one, fetch the current tags first, append, and send the full updated array.
- **`neverStale: true` opts the flag out of stale detection permanently.** Use for kill switches, ops toggles, and license gates. Warn the user: once set, it won't appear in stale-flag reports even if untouched for months.
- **`jsonSchema` is enterprise-only.** If the org doesn't have the feature, the API returns an error — surface it clearly.
- **Metadata changes still go through approval workflows.** A seemingly innocuous description change can trigger the org's review gate. Use flag-publish and expect the same approval-required / merge-conflict failure modes as any other revision.
- **`customFields` keys must match the org's configured custom field definitions.** If the key isn't recognized by the org, the API may silently drop it or error. Verify custom field key names are correct.

## Endpoints used

- `GET /api/v2/features/:id` — fetch current metadata for confirmation
- `GET /api/v1/projects` — resolve project name to ID
- `PUT /api/v2/features/:id/revisions/new/metadata` — apply metadata change to draft

## Handoffs

- `loadSkill('flag-search')` — if the user gives a description instead of a flag ID
- `loadSkill('flag-default-value')` — to change what the flag serves when no rules match
- `loadSkill('flag-cleanup')` — to archive or delete the flag entirely
- `loadSkill('flag-publish')` — to publish the draft, handle approval-required (400) and merge conflicts (409)
