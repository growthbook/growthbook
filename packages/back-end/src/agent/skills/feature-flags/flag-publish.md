---
name: flag-publish
description: Publish a GrowthBook feature flag draft revision, resolve merge conflicts, revert to a prior revision, or discard a draft. Use when the user says "publish this draft", "push this live", "go live with revision X", "there's a merge conflict on my flag", "rebase my draft", "fix the merge conflict on flag X", "revert flag X to a previous version", "roll back this flag change", "discard this draft", or "abandon these changes". For requesting or submitting an approval review before publish, use flag-review. For listing and inspecting drafts, use flag-revisions.
---

# flag-publish

Get a GrowthBook feature flag draft revision live, or undo a change. Handles the full publish flow including the two common failure modes — approval-required (blocked) and merge conflict (stale base) — and the escape hatches: discard and revert.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Workflow

Pick the path that matches what the user asked for. Each path ends at Report — do not continue into another path after completing one.

- **Publish** → steps 1 → 2 → (3a or 3b only if step 2 fails) → 6
- **Discard** → step 4 → 6
- **Revert** → step 5 → 6

### 1. Identify the revision

**If a version number is already in context** (threaded from a previous write skill in this session), skip ahead — use it directly.

**If the user provides a flag ID but no version**, use `/latest`:

```json
{
  "method": "GET",
  "path": "/api/v2/features/<id>/revisions/latest",
  "query": { "mine": "true" }
}
```

```json
{ "method": "GET", "path": "/api/v2/features/<id>/revisions/latest" }
```

If `/latest` returns 404, there are no active drafts on this flag — nothing to publish. Confirm with the user and stop.

If there are likely concurrent drafts, list and let the user choose:

```json
{
  "method": "GET",
  "path": "/api/v2/features/<id>/revisions",
  "query": { "status": "all-drafts", "mine": "true" }
}
```

```json
{
  "method": "GET",
  "path": "/api/v2/features/<id>/revisions",
  "query": { "status": "all-drafts" }
}
```

**If the user has no flag ID** (returning after a lost session, describing the flag by what it does), query approved drafts across all features:

```json
{
  "method": "GET",
  "path": "/api/v2/feature-revisions",
  "query": { "status": "approved", "mine": "true" }
}
```

If the list has one entry, confirm with the user by surfacing the flag ID, revision number, who approved it, and a summary of what changed. If there are multiple, show them all and ask the user to pick.

**When no flag ID is known and the user describes the flag by content** (e.g. "the boolean flag with the country = US rule"), there is no API filter for rule content — resolution requires fetching each candidate revision, inspecting its rules against the description, and confirming with the user before publishing. Never assume a match.

Capture the `version` number before continuing.

### 2. Attempt to publish

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<version>/publish",
  "body": { "comment": "<optional summary of the change>" }
}
```

Branch on response:

- **2xx** → step 6 (done).
- **400 with approval-required body** → step 3a.
- **409** → step 3b (merge conflict).
- **Other 4xx** → halt and surface the raw body.

### 3a. Approval-required branch

The draft exists but publish is blocked by the org's approval policy. Branch on the revision's `status` from step 1 — the right response differs:

**If `pending-review`:** someone has already been asked to approve. Nothing to do but wait.

> "Revision `<version>` is already pending review. Once a teammate approves it in GrowthBook, re-run flag-publish to finish."
> Stop here.

**If `approved`:** the revision is approved but publish is still failing — the issue is the org bypass setting, not the review state. Skip option A and present only the bypass options:

> "Revision `<version>` is approved but publish is still blocked. Pick one:
>
> **A. Org-wide bypass** — an admin enables "REST API always bypasses approval requirements" under Settings → General → Approvals. Re-run flag-publish after that.
>
> **B. Per-token bypass** — use credentials whose role grants `bypassApprovalChecks` on this project, then re-run."

**If `draft` or `changes-requested`:** review hasn't been requested yet. Offer to request it now:

> "Your org requires approval before this revision can publish. Options:
>
> **A. Standard review flow** (recommended) — I'll request review now. A teammate approves it in GrowthBook, then re-run flag-publish to finish.
>
> **B. Review in the UI** — open the flag page (`/features/<flag-id>?v=<version>`) directly and manage the review there.
>
> **C. Org-wide bypass** — an admin enables "REST API always bypasses approval requirements" under Settings → General → Approvals.
>
> **D. Per-token bypass** — use credentials whose role grants `bypassApprovalChecks` on this project, then re-run."

If the user picks **A**, request review and stop:

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<version>/request-review",
  "body": {
    "comment": "Requesting review — re-run flag-publish after approval"
  }
}
```

Do **not** attempt `submit-review` — self-approval is rejected server-side.

If the user picks a bypass option, stop with a one-line note. The existing draft picks up the new permission on retry.

Do **not** silently retry, ignore the error, or discard and recreate to work around the policy.

### 3b. Merge-conflict branch

A 409 means the draft's base revision is stale — the live flag changed since the draft was created. The draft still exists; it just needs to be rebased before it can publish.

**For non-trivial conflicts, the GrowthBook UI is the better tool** — it shows a side-by-side diff and lets the user resolve field-by-field visually. Offer it:

> "There's a merge conflict on `<flag-id>`. Want to resolve it in the GrowthBook UI (recommended for complex changes — open `/features/<flag-id>?v=<version>`), or should I walk through it here?"

If the user wants the UI, stop here — tell them to rebase in the UI and re-run flag-publish when done.

If the user wants to resolve via API, continue:

**Step 3b-i: Get the conflict details.**

```json
{
  "method": "GET",
  "path": "/api/v2/features/<id>/revisions/<version>/merge-status"
}
```

Returns `{ hasConflicts: true, conflicts: [...] }`. Each conflict object has:

- `key` — which field collided (`defaultValue`, `rules`, `prerequisites`, `environmentsEnabled.<envId>`)
- `name` — human-readable label for the field
- `revision` — the **draft's** value
- `live` — the **current live** value
- `base` — the value when the draft was originally created

Possible conflict keys: `defaultValue`, `rules`, `prerequisites`, `environmentsEnabled.<envId>` (e.g., `environmentsEnabled.production`).

**Step 3b-ii: For each conflict, show the user both versions and ask which to keep.**

Use the `revision` field for the draft's version and `live` for the current live version. Present them side-by-side and ask:

- **overwrite** — keep the draft's version (`revision` wins; the concurrent live change is discarded)
- **discard** — keep the live version (`live` wins; the draft's change to this field is dropped)

Do **not** auto-resolve any conflict. Each one requires a human judgment call about which version is correct.

**Step 3b-iii: Rebase.**

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<version>/rebase",
  "body": {
    "conflictResolutions": { "defaultValue": "overwrite", "rules": "discard" }
  }
}
```

Only include keys for fields that had conflicts.

**Step 3b-iv: Retry publish.** Return to step 2. The rebased draft should publish cleanly unless new conflicts arose during the rebase (rare).

### 4. Discard path (abandon the draft entirely)

Confirm clearly before proceeding:

> "Discard revision `<version>` on `<flag-id>`? All pending changes in this draft will be permanently lost."

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<version>/discard"
}
```

Works on any non-terminal status — `draft`, `pending-review`, `approved`, and `changes-requested` can all be discarded directly. Only `published` and `discarded` are blocked by the server.

### 5. Revert path (restore a prior published revision)

List recent published revisions so the user can pick a target:

```json
{
  "method": "GET",
  "path": "/api/v2/features/<id>/revisions",
  "query": { "status": "published", "limit": "10" }
}
```

Confirm the intent: "Restore flag `<id>` to how it looked at revision `<N>` (published `<date>`)?"

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<target-version>/revert",
  "body": { "strategy": "draft" }
}
```

`strategy: "draft"` creates a new draft with the prior state — the user reviews it via flag-publish before it goes live. **This is the default and recommended path.**

`strategy: "publish"` creates and publishes immediately. Only offer this if the user explicitly asks for an immediate rollback. Org approval settings still apply.

### 6. Report

- Flag ID and outcome (published / approval-requested / discarded / reverted).
- Revision version and new status (from the publish response).
- UI link: `/features/<flag-id>?v=<version>`.
- For publish: optionally fetch the full flag state to summarize what's now live:
  ```json
  { "method": "GET", "path": "/api/v2/features/<id>" }
  ```
  Surface: which environments are enabled, the default value, and a one-line summary of the active rules. Skip this call if the user is in a hurry — the UI link gives them the full picture.

## Guardrails

- **A 409 is a merge conflict, not a transient error.** Don't blindly retry — it will keep failing.
- **Never auto-rebase.** Each conflict field requires a human decision. Guessing "overwrite" on everything could silently discard concurrent teammate changes.
- **Never discard a draft to escape a merge conflict.** The draft contains user work. Help them rebase instead.
- **Self-approval is blocked server-side.** If the user who created the draft tries to approve it in step 3a, it will fail. They need a different reviewer.
- **After a successful rebase, the draft is still in `draft` status.** Retry publish explicitly — rebase does not auto-publish.
- **Discard is irreversible.** The draft cannot be recovered. Confirm before calling.
- **`strategy: "publish"` on revert bypasses review.** Org approval settings may still gate it. Default to `"draft"` strategy; only offer `"publish"` when the user explicitly wants an immediate rollback.
- **Conflict resolution keys are exact strings.** For environment-level toggles the key is `environmentsEnabled.<envId>` (e.g., `environmentsEnabled.production`) — include the full string in `conflictResolutions`.
- **400 approval-required vs 403 permission error.** A 400 with an approval body means the policy gate is working as intended. A 403 may mean the caller lacks permission entirely — surface the body if it doesn't mention approval.

## Endpoints used

- `GET /api/v2/features/:id/revisions` — list revisions for draft selection
- `GET /api/v2/features/:id/revisions/latest` — get most recent draft
- `POST /api/v2/features/:id/revisions/:version/publish` (body: optional comment)
- `GET /api/v2/features/:id/revisions/:version/merge-status`
- `POST /api/v2/features/:id/revisions/:version/rebase` (body: `{ conflictResolutions: { key: "overwrite"|"discard" } }`)
- `POST /api/v2/features/:id/revisions/:version/request-review` (approval-required branch only)
- `POST /api/v2/features/:id/revisions/:version/discard`
- `POST /api/v2/features/:id/revisions/:version/revert` (body: `{ strategy: "draft"|"publish" }`)

## Handoffs

- `loadSkill('flag-review')` — for the approval workflow (triggered in step 3a)
- `loadSkill('flag-revisions')` — to list and inspect drafts before publishing
