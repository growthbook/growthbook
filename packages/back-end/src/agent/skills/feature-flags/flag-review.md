---
name: flag-review
description: Request or submit an approval review on a GrowthBook feature flag draft revision. Use when the user says "request review for this draft", "approve this change", "reject this draft", "request changes on revision X", "I want to review flag Y's pending draft", "submit my approval", "mark this as needing changes", "who needs to approve this", or "check the review status". For creating and editing drafts, use the relevant flag-* write skill. For publishing an approved draft or resolving merge conflicts, use flag-publish. For listing all pending drafts across flags, use flag-revisions.
---

# flag-review

Request and submit approval reviews on GrowthBook feature flag draft revisions. Only needed when the org has approval workflows configured — if approvals aren't required, flag-publish handles the full flow without a review step.

Two roles use this skill: the **drafter** (requests a review, can't self-approve) and the **reviewer** (submits the review decision).

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Approval flow

```
draft → [request-review] → pending-review → [approve]           → approved → [publish]
                                           → [request-changes]  → changes-requested → [edit + re-request] → pending-review
                                           → [comment]          → pending-review (status unchanged)
```

## Workflow

### Path A — Request review (drafter asking for approval)

1. Resolve the revision. If the user gave a version number, use it. Otherwise try `/latest` (happy path when one draft exists), then fall back to listing if needed:

   ```json
   { "method": "GET", "path": "/api/v2/features/<id>/revisions/latest" }
   ```

   ```json
   { "method": "GET", "path": "/api/v2/features/<id>/revisions/<version>" }
   ```

   Accept `draft` or `changes-requested` status. For any other status, surface it and explain what it means using the status table from flag-revisions.

2. Request review:

   ```json
   {
     "method": "POST",
     "path": "/api/v2/features/<id>/revisions/<version>/request-review",
     "body": { "comment": "<optional context for reviewers>" }
   }
   ```

   Revision moves to `pending-review`. Tell the user a reviewer needs to approve before it can be published via flag-publish. Remind them that self-approval is not allowed — a different team member must review.

### Path B — Submit a review (reviewer acting on a pending-review revision)

1. Identify the revision. A version number alone is not enough — you always need the flag ID too (version numbers are per-flag counters, not globally unique). Collect whichever of these the user has, then query accordingly:

   **Flag ID + version known** → fetch directly:

   ```json
   { "method": "GET", "path": "/api/v2/features/<id>/revisions/<version>" }
   ```

   **Flag ID known, version unknown** → list pending-review on that flag:

   ```json
   {
     "method": "GET",
     "path": "/api/v2/features/<id>/revisions",
     "query": { "status": "pending-review" }
   }
   ```

   **Author email or userId known** → filter cross-feature by author:

   ```json
   {
     "method": "GET",
     "path": "/api/v2/feature-revisions",
     "query": { "status": "pending-review", "author": "<email-or-userid>" }
   }
   ```

   **Author name known but not email** → fetch all pending-review revisions and filter client-side on `createdBy` matching the name:

   ```json
   {
     "method": "GET",
     "path": "/api/v2/feature-revisions",
     "query": { "status": "pending-review" }
   }
   ```

   Each revision has a `createdBy` field (display name or "API"). Filter for entries where `createdBy` contains the name the user gave, then confirm with the user before proceeding.

   **Nothing known** → same broad query, show all results and ask the user to identify theirs.

2. For anything non-trivial, offer to open the GrowthBook UI first (`/features/<flag-id>?v=<version>`) — the side-by-side diff and approval controls are clearer than text. If the reviewer prefers to work in the UI, stop here.

   For API-based review, fetch both the revision and the live feature to show a proper before/after diff:

   ```json
   { "method": "GET", "path": "/api/v2/features/<id>/revisions/<version>" }
   ```

   ```json
   { "method": "GET", "path": "/api/v2/features/<id>" }
   ```

   Surface: which rules changed (added/edited/removed), defaultValue change, metadata changes, env toggle changes, prerequisites changes — comparing draft fields against the live feature.

3. Ask the reviewer which action they want:
   - **approve** — changes look good, ready to publish
   - **request-changes** — issues found, author needs to update
   - **comment** — feedback only, no status change

4. Submit the review:

   ```json
   {
     "method": "POST",
     "path": "/api/v2/features/<id>/revisions/<version>/submit-review",
     "body": { "action": "approve", "comment": "<optional>" }
   }
   ```

   Status transitions:
   - `approve` → `approved` — tell user to publish via flag-publish
   - `request-changes` → `changes-requested` — tell reviewer what happens next (author edits, re-requests)
   - `comment` → `pending-review` unchanged — comment is recorded

### Path C — Check review status

If version isn't known, try `/latest` first:

```json
{ "method": "GET", "path": "/api/v2/features/<id>/revisions/latest" }
```

```json
{ "method": "GET", "path": "/api/v2/features/<id>/revisions/<version>" }
```

Report status and what needs to happen next:

| Status              | Next step                                   |
| ------------------- | ------------------------------------------- |
| `draft`             | Author requests review when ready           |
| `pending-review`    | Reviewer submits a decision                 |
| `approved`          | Author publishes via flag-publish           |
| `changes-requested` | Author edits draft, then re-requests review |

## Guardrails

- **Self-approval is blocked server-side.** Before calling submit-review, check whether the logged-in user created the draft (compare against the revision's `createdBy`). If they did, halt: "You created this draft — a different team member must approve it."
- **Can only request-review on `draft` or `changes-requested` status.** Surface the actual status if the user tries on anything else.
- **Can only submit-review on `pending-review` status.** Surface the actual status if it doesn't match.
- **`changes-requested` is not discarded.** The draft still exists; the author edits it and re-requests review via Path A. Don't suggest discarding unless the author explicitly wants to abandon the changes.
- **Reset-review-on-changes.** If the org has this setting enabled, any edit to an `approved` draft reverts it to `draft`. Warn the user if they're about to edit an already-approved revision: "Editing this revision will reset its approval status — you'll need to request review again."
- **Approval ≠ publication.** An `approved` draft is not yet live. The author still needs to run flag-publish.
- **This skill does not publish.** After approval, hand off to flag-publish.

## Endpoints used

- `GET /api/v2/features/:id/revisions/:version` — inspect revision before acting
- `GET /api/v2/features/:id/revisions` (status filter) — find pending-review revisions for a flag
- `GET /api/v2/feature-revisions` (status, mine filters) — find pending-review revisions across all flags
- `POST /api/v2/features/:id/revisions/:version/request-review` (body: optional comment)
- `POST /api/v2/features/:id/revisions/:version/submit-review` (body: action + optional comment)

## Handoffs

- `loadSkill('flag-revisions')` — to list and inspect all open drafts
- `loadSkill('flag-publish')` — after approval, to publish the draft live
