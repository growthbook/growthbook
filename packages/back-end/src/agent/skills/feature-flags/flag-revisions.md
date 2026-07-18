---
name: flag-revisions
description: List, inspect, and manage draft revisions for a GrowthBook feature flag. Use when the user asks "what drafts are open for flag X", "show me pending approvals", "who owns this draft", "discard this draft", "start a new draft", "what revision is my flag on", "list all my pending changes", "what's waiting for review", or any question about the state of in-progress changes to a flag. Every flag write operation — rules, metadata, default value, toggles — works through a draft revision; use this skill to see what's in flight before making changes. For requesting or submitting an approval review, use flag-review. For publishing a draft live or resolving merge conflicts, use flag-publish. For making flag changes, use the relevant flag-* write skill.
---

# flag-revisions

Inspect and manage draft revisions on GrowthBook feature flags. Every flag change goes through a draft revision before going live — this is the "what's in flight?" skill. Use it to see open drafts, understand their status, and manage their lifecycle (create, discard). Making actual flag changes (rules, metadata, toggles, default value) is handled by the relevant flag-\* write skills, which create and manage drafts automatically.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Revision status reference

| Status              | Meaning                             | What happens next                         |
| ------------------- | ----------------------------------- | ----------------------------------------- |
| `draft`             | Being edited, not yet submitted     | Edit more, then request-review or publish |
| `pending-review`    | Review requested, awaiting approval | Reviewer submits decision via flag-review |
| `approved`          | Approved, ready to publish          | Publish via flag-publish                  |
| `changes-requested` | Reviewer flagged issues             | Author edits draft, re-requests review    |
| `published`         | Live, immutable                     | Can be reverted via flag-publish          |
| `discarded`         | Abandoned                           | No further action                         |
| `pending-parent`    | Auto-managed by a ramp schedule     | Do not discard manually                   |

## Workflow

Pick the path that matches the user's request.

### Path A — List active drafts for a specific feature

Ask whether the user wants their own drafts or all drafts on this flag, then query accordingly:

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

`all-drafts` expands to all four active-draft statuses (draft, pending-review, approved, changes-requested). Omitting `status` on v2 has the same effect. To target a subset: `?status=draft,pending-review`.

For each revision surface: version number, status, who created it, date, comment. Call out anything that needs attention — `pending-review` needs a reviewer, `changes-requested` needs the author to act.

### Path B — List my drafts across all features

```json
{
  "method": "GET",
  "path": "/api/v2/feature-revisions",
  "query": { "mine": "true", "status": "all-drafts" }
}
```

Omit `mine=true` to see all active drafts across the org. Omitting `status` on v2 defaults to `all-drafts`.

Group output by feature for readability. Surface how many need action.

### Path C — Inspect a specific revision

```json
{ "method": "GET", "path": "/api/v2/features/<id>/revisions/<version>" }
```

Surface what changed vs the live version: `defaultValue`, `rules` array, metadata fields, `environmentsEnabled` per env, `prerequisites`. Also show `baseVersion` (what live version this draft branched from) and `status`.

To get the most recently updated active draft without knowing the version number, ask first whether the user wants their own draft or the latest by anyone — this avoids silently landing in a teammate's draft:

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

Returns a single revision. If multiple drafts are open, it silently picks the most recently updated one — use Path A to surface all of them instead.

### Path D — Draft creation: implicit vs. explicit

There are two ways to create a draft. Both are valid; which to use depends on the situation.

**Implicit (the default in all write skills):** pass `new` as the version in any write endpoint. The server auto-creates a fresh draft or layers the change onto the most recently updated open draft.

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<id>/revisions/new/default-value",
  "body": { "defaultValue": "<string>" }
}
```

Use this when: making a single change, or when there's only one open draft and layering onto it is the right behavior.

**Explicit (pre-create, then target):** create a blank draft first, capture the version number, then point all subsequent write calls at that specific version instead of `new`. This is a three-phase flow — do not skip ahead.

**Phase 1 — Setup (before any flag changes):**

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions",
  "body": { "comment": "<optional intent note>" }
}
```

Returns `{ revision: { version: <N>, status: "draft", ... } }`. Note the version number `<N>`. All changes in Phase 2 must target this version.

**Phase 2 — All flag changes (complete everything before moving on):**

Use the relevant write skills (flag-targeting, flag-toggle, flag-metadata, flag-default-value, flag-prerequisites, etc.), substituting `<N>` for `new` in every endpoint path:

```json
{
  "method": "PUT",
  "path": "/api/v2/features/<id>/revisions/<N>/default-value",
  "body": { "...": "..." }
}
```

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<N>/rules",
  "body": { "...": "..." }
}
```

Do not proceed to Phase 3 until **all** intended changes have been applied.

**Phase 3 — Publish (only after all changes are done):**

Call `loadSkill('flag-publish')` with version `<N>`.

Use this pattern when: the user wants a clean slate independent of existing open drafts, when making several coordinated changes that must land in the same revision, or when multiple drafts are open and you need to control which one receives the edits.

Note: `baseVersion` can be passed in the Phase 1 body to branch from a specific published revision rather than the current live one.

### Path E — Discard a draft

```json
{
  "method": "POST",
  "path": "/api/v2/features/<id>/revisions/<version>/discard"
}
```

Confirm before discarding: "Discard revision `<version>` on `<flag-id>`? This is irreversible — all pending changes in this draft will be lost."

Works on any non-terminal status — `draft`, `pending-review`, `approved`, `changes-requested` can all be discarded directly. Only `published` and `discarded` are blocked by the server.

## Guardrails

- **`status` accepts comma-separated values.** `?status=draft,approved` returns revisions matching either status. Use `?status=all-drafts` as a shorthand for all four active-draft statuses. On v2 endpoints, omitting `status` defaults to `all-drafts`.
- **`pending-parent` revisions are auto-managed.** They're created and published automatically as part of a ramp schedule. Never discard them manually; contact GrowthBook support if one appears stuck.
- **A flag can have multiple open drafts.** Always show all of them — don't assume there's only one.
- **`version=new` is the canonical write pattern.** Other write skills use it to create-or-reuse a draft atomically. Only call `POST /revisions` explicitly when the user wants a blank draft before editing.
- **Discard is irreversible.** The draft and all its pending changes are gone. If the user says "discard" casually as part of "I'll redo this," confirm they understand the changes won't be preserved.
- **`changes-requested` ≠ discarded.** The draft still exists and can be edited. The author fixes the issues and calls request-review again via flag-review.
- **This skill is read/manage only.** For changing a flag's rules, metadata, default value, or environment toggles, use the relevant write skill.

## Endpoints used

- `GET /api/v2/features/:id/revisions` — list revisions for a feature (status, author, limit, offset filters)
- `GET /api/v2/feature-revisions` — list revisions across all features (mine, status, featureId, author filters)
- `GET /api/v2/features/:id/revisions/:version` — inspect a specific revision
- `GET /api/v2/features/:id/revisions/latest` — get most recent draft (mine=true filter available)
- `POST /api/v2/features/:id/revisions` — create a new empty draft
- `POST /api/v2/features/:id/revisions/:version/discard` — discard a draft

## Handoffs

- `loadSkill('flag-review')` — to request or submit an approval review on a draft
- `loadSkill('flag-publish')` — to publish a draft, resolve merge conflicts, or revert to a prior revision
- `loadSkill('flag-rules')`, `loadSkill('flag-targeting')`, `loadSkill('flag-toggle')`, `loadSkill('flag-metadata')`, `loadSkill('flag-default-value')`, `loadSkill('flag-prerequisites')` — write skills that create and modify drafts
