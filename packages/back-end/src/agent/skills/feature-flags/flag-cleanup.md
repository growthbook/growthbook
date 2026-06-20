---
name: flag-cleanup
description: Archive or delete a stale GrowthBook feature flag, surfacing the flag's call sites so the user can inline its effective value before removal. Use when the user says "delete this flag", "remove this stale flag", "clean up flag X", "archive this flag", "we don't need this flag anymore", or "get rid of this flag and its experiment-ref rule". For finding stale flags first, use flag-search. For editing rules instead of removing the flag, use flag-targeting. For stopping an experiment that uses the flag, use experiment-stop.
---

# flag-cleanup

Archive or delete a stale feature flag. Two paths: **archive** (reversible, soft-disable) or **delete** (permanent; always goes through archive first as a safety gate). This skill surfaces call sites from GrowthBook's Code References API (when configured) so the user can inline the flag's effective value in their own codebase — it does **not** edit the user's code directly.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation. The archive→verify→delete pause is a product-safety gate, not a mutation-confirmation prompt — keep it.

## Required inputs

Collect from the user before starting. Prompt for what's missing.

- **Flag ID** — kebab-case key. If the user gives a description, call `loadSkill('flag-search')` first to resolve.
- **Action** — `archive` (reversible) or `delete` (permanent; includes archive). Inferred from wording: "archive" / "disable" → archive; "delete" / "remove" / "clean up" / "get rid of" → delete. Confirm before mutating.

## Workflow

Track progress with this checklist. Do not skip or reorder; each step gates the next.

```
- [ ] 1. Fetch flag, verify safety preconditions (incl. bulk experiment check)
- [ ] 2. Compute defaultValue + detect behavior-change divergences
- [ ] 3. Surface call sites (Code References API) for the user to inline
- [ ] 4. Archive the flag (revision-and-publish; branch to 4a on 403, 4b on 409)
- [ ] 5. Verify-or-rollback gate (delete path only)
- [ ] 6. Delete the flag (delete path only)
- [ ] 7. Report, including reverse-prerequisite limitation warning
```

### 1. Fetch flag and verify safety preconditions

```json
{ "method": "GET", "path": "/api/v2/features/<flag-id>" }
```

Capture from the response: `archived` (boolean), `defaultValue`, `valueType`, `environmentSettings` (which envs are enabled), `rules` (the full array, including any `experiment-ref` rules), `holdout` (informational), `project`.

If 404, halt: "no flag with id `<flag-id>`." Suggest `loadSkill('flag-search')` to list flags.

**Run the safety checks. Halt if any of these fire:**

- **`archived === true` and the user asked to archive** → already archived. Either re-confirm intent ("you said archive; this flag is already archived — did you mean delete?") or exit clean.

- **`archived === true` and the user asked to delete** → this is a continuation of a prior cleanup session (or the user archived in the UI). Ask:

  > This flag is already archived — looks like you're picking up where a previous cleanup left off. Did you already inline the flag's value at call sites in your codebase?
  >
  > - **Yes** → I'll skip the behavior-change check and call-site surfacing; we'll go straight to the verify-or-rollback gate before delete.
  > - **No** → I'll still walk through steps 2–3 first, since the code references may still exist.

  If yes, jump to step 5 (the archive step 4 is a no-op since `archived: true → true` makes no change server-side; the handler short-circuits when `feature.archived` equals the requested value).

- **`neverStale: true` is set on the feature**. Confirm via the staleness endpoint:

  ```json
  {
    "method": "GET",
    "path": "/api/v2/stale-features",
    "query": { "ids": "<flag-id>" }
  }
  ```

  If the response includes `staleReason: "never-stale"`, halt:

  > This flag is marked `neverStale` — someone explicitly said it should never be cleaned up automatically (kill switch, ops toggle, license gate, etc.). To proceed, remove the `neverStale` flag in the GrowthBook UI at `/features/<flag-id>` first and re-run me.

- **Active experiment-ref rule pointing at a `running` experiment**. One bulk call covers the common case:

  ```json
  {
    "method": "GET",
    "path": "/api/v1/experiments",
    "query": { "trackingKey": "<flag-id>", "status": "running" }
  }
  ```

  This works because `experiment-launch` sets `trackingKey === flag-id` by convention. If the response array is non-empty, halt:

  > This flag is wired into experiment `<exp-id>` (`<exp-name>`) which is still running. Stop that experiment first (`loadSkill('experiment-stop')`), then re-run me.

  **Defensive cross-check.** If the bulk call returns empty but the flag has `experiment-ref` rules in its `rules` array, the experiment may have been manually wired with `experimentId ≠ trackingKey`. Iterate the experiment-ref rules and fetch each one as a fallback:

  ```json
  { "method": "GET", "path": "/api/v1/experiments/<experiment-id-from-rule>" }
  ```

  If any returns `status: "running"`, halt with the same message.

  **Temporary rollout check.** While fetching linked experiments, also note any with `status: "stopped"` AND `enableTemporaryRollout: true` — these are not a blocker (the experiment is stopped), but step 2 must use the winner value as the inline replacement. Surface a reminder:

  > "Temporary rollout is active on experiment `<exp-id>` — all users currently see the winner value. Step 2 will use the winner value as the inline replacement, not `defaultValue`."

- **Draft experiment referencing the flag.** Lower-priority than running, but worth a warn-and-confirm. Reuse the bulk query with a different status filter:

  ```json
  {
    "method": "GET",
    "path": "/api/v1/experiments",
    "query": { "trackingKey": "<flag-id>", "status": "draft" }
  }
  ```

  If non-empty, warn:

  > Note: this flag is the `trackingKey` for draft experiment `<exp-id>`. Deleting the flag won't break anything immediately, but it will prevent that experiment from launching successfully. Proceed?

- **Unresolved draft revision on the flag.** A draft would be discarded by the archive:

  ```json
  { "method": "GET", "path": "/api/v2/features/<flag-id>/revisions/latest" }
  ```

  If 404, no draft exists — continue. If a draft is returned, halt:

  > There's an active draft revision (`<version>`) on this flag. Cleaning up the flag would discard those pending changes. Either publish or discard the draft in the GrowthBook UI at `/features/<flag-id>` first.

- **`/stale-features` doesn't flag this as stale and the user is asking to delete.** Warn but don't halt:
  > Heads-up: GrowthBook doesn't flag this as stale. It's still enabled in `<env>` with active rules. Proceed?

### 2. Compute the inline-replacement value and detect behavior changes

After archival, **every rule stops evaluating** — the flag returns `defaultValue` for all callers. The inline replacement value is usually `defaultValue`, but not always — see the temporary rollout case below.

**Check for an active temporary rollout first.** For each `experiment-ref` rule in the flag, fetch the linked experiment:

```json
{ "method": "GET", "path": "/api/v1/experiments/<experiment-id>" }
```

If `experiment.status === "stopped"` AND `experiment.enableTemporaryRollout === true`:

- The experiment's `releasedVariationId` tells you which variation is serving 100% of traffic.
- Find that variation's value in the experiment-ref rule's `variations` array.
- **That value — not `defaultValue` — is what all users currently see.**
- Use it as the inline replacement value. Warn the user clearly:

  > "Temporary rollout is active on this flag. All users currently see the winner value `<winner_value>`. After cleanup, all users will shift to `defaultValue: <default_value>`. If these differ, inlining `<winner_value>` is the correct replacement — not `<default_value>`."

For `valueType: "json"`, surface the raw JSON-encoded string and let the user adapt the inline shape.

**The real question this step exists to answer is: does cleanup change behavior in production?**

Walk the `rules` array and flag anything that previously diverged from `defaultValue`:

- A `force` rule serving a different value to a targeted segment.
- An active `rollout` rule (coverage > 0) — even one with no condition.
- An `experiment-ref` rule: fetch the linked experiment. If stopped with temporary rollout, the winner value is the divergence (handled above). If still assigning traffic normally (stopped experiment, no temporary rollout), users are split across variations — archiving shifts everyone to `defaultValue`, which is a change for treatment-group users.

Surface a table:

```
Behavior-change check for <flag-id>:
  defaultValue (post-cleanup):  "true"

  Pre-cleanup divergences (these stop applying after archive):
    production:  rule 1 (force, "beta testers" saved-group) served "false" → those users will now get "true"
    production:  rule 2 (rollout, 25% via id)              served "false" → 25% of traffic will shift to "true"
    staging:     no divergence — all traffic gets "true" today

Is this the intent?
```

If the table is empty (no divergences), the cleanup is purely cosmetic and the user can proceed without further confirmation. If any rule diverged, **halt and confirm** — this is real behavior change.

### 3. Surface call sites for the user to inline

This agent cannot read or edit the user's working tree, so it surfaces the flag's known call sites and asks the user to inline the effective value (`defaultValue`, or the temporary-rollout winner from step 2) in their own codebase before deletion.

Try Code References:

```json
{ "method": "GET", "path": "/api/v1/code-refs/<flag-id>" }
```

The response is `{codeRefs: [{ repo, branch, platform, refs: [{filePath, startingLineNumber, lines, flagKey}] }, ...]}`. One document per (repo, branch) — a feature may have multiple entries if Code References has been pushed from multiple branches.

- **Non-empty response** → present line-level references to the user, grouped by file, with branch info if multiple branches are represented. Cite that the data is from Code References (so the user knows it may be stale relative to local edits). Ask the user to replace each reference with the inline value and confirm when done.
- **Empty response** → either Code References isn't configured, or the flag genuinely isn't referenced. Surface:
  > Code References returned no results — either it isn't set up for this org, or the flag isn't referenced in scanned code. If you're confident the flag isn't used anywhere, we can proceed to archive. Otherwise, check Code References at `/features/<flag-id>`, or search your own codebase for `<flag-id>` before removing it.

If the user wants to defer code-cleanup entirely ("just archive the flag now, I'll clean up code later"), allow it — the archive is reversible and the user can re-run this skill later to finish before deletion.

### 4. Archive the flag

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>",
  "body": { "archived": true }
}
```

**What happens server-side.** This isn't a metadata patch. Setting `archived` triggers `createAndPublishRevision` server-side — a new revision is created and published atomically. The same failure modes that affect any v2 publish apply:

- **2xx** → archived. Proceed to step 5 (delete path) or step 7 (archive-only path).
- **403 with "approval required" body** → step 4a.
- **409** → step 4b (merge conflict; another actor changed the flag between our GET and our archive POST).
- Other 4xx → halt with the body.

A revision-history entry will appear for the archive event — surface this in step 7.

### 4a. Approval required for archive

Same three-option branch as `flag-targeting`, **but with one critical asymmetry between archive and delete:**

> Your org requires approval before this flag can be archived. To proceed:
>
> **A. Standard review flow** (recommended) — I'll request review on the change; a teammate approves it in the GrowthBook UI at `/features/<flag-id>`; you re-run me to resume.
>
> **B. Org-wide bypass** — admin enables "REST API always bypasses approval requirements" in Settings → General → Approvals. This single setting authorizes _both_ archive and the final delete step.
>
> **C. Per-token bypass** — use a PAT with `bypassApprovalChecks` permission. **This authorizes archive but NOT delete.** The per-token permission is intentionally a review-workflow bypass only, not a destructive-action override. If your end goal is archive-only, this works. If you want to delete, you'll still need the org-wide setting from option B (or an admin to do the delete in the UI). Surface this asymmetry to the user _before_ they pick C — don't let them discover it at step 6.

For path A, request review on the draft and halt:

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>/revisions/<version>/request-review",
  "body": { "comment": "Auto-requested by flag-cleanup" }
}
```

Do **not** attempt `submit-review` — the API rejects self-approval.

### 4b. Merge conflict on archive

A 409 on the archive POST means the draft's base revision is stale — a teammate (or another agent invocation) published changes to the same flag between our step 1 (GET) and our step 4 (POST). **Do not auto-rebase.** Halt with:

> Your archive of `<flag-id>` couldn't be applied — the flag has changed since I last looked at it. To resolve:
>
> - Open `/features/<flag-id>` in the GrowthBook UI.
> - Reconcile the change (either rebase our pending archive on top, or discard and re-run me to start fresh against the new live state).
>
> Re-run me after the conflict is resolved.

Surface the conflict body verbatim. The `POST /api/v2/features/<id>/revisions/<version>/rebase` endpoint exists for opt-in resolution; v1 stays conservative for the same reasons `flag-targeting` does — merge resolution needs human judgment per conflicting field.

### 5. Verify-or-rollback gate (delete path only)

After archive succeeds, halt and confirm with the user. **Frame the irreversibility of delete in the prompt itself**, not just in a guardrail the user may not have read:

> The flag is archived. **At this point the action is fully reversible** — unarchive in the UI (or reply "rollback") and everything goes back. Once we delete, the flag and all its revisions are gone permanently; there's no undo.
>
> Before I delete:
>
> - Check that nothing in your codebase broke. Run your tests; deploy to staging; verify the app behaves correctly with `defaultValue` instead of the old rules; whatever your normal post-flag-removal check is.
> - When you're confident, reply "proceed" and I'll delete.
> - Reply "rollback" and I'll unarchive.

This is the load-bearing gate of the skill. Permanent deletion is a one-way door and the user should sit with the archived-but-not-deleted state for at least one verification cycle. Don't collapse the two steps even if the user pushes for it.

**If the user picks "rollback":** undo the archive by setting `archived: false` via the same endpoint:

```json
{
  "method": "POST",
  "path": "/api/v2/features/<flag-id>",
  "body": { "archived": false }
}
```

This goes through the same revision-and-publish flow as the archive — same approval-required and merge-conflict failure modes apply. Verify it completes cleanly, surface the outcome, and exit.

### 6. Delete the flag (delete path only)

```json
{ "method": "DELETE", "path": "/api/v2/features/<flag-id>" }
```

- **2xx with `{deletedId}`** → proceed to report.
- **403** → almost certainly the `restApiBypassesReviews` setting is off. The flag is archived, just not deletable via the API. Surface:
  > Your org requires the "REST API always bypasses approval requirements" setting to be enabled before flags can be deleted via the API. The flag is archived; you can either:
  >
  > - Ask an admin to enable the setting (Settings → General → Approvals), then re-run me to finish the delete.
  > - Delete manually in the GrowthBook UI at `/features/<flag-id>` (the archived flag is still listed there).
  >
  > Per-token `bypassApprovalChecks` does **not** authorize this — it's intentionally a review-workflow bypass only, not a destructive-action override.
- Other 4xx → halt with the body.

**Server-side cleanup.** Deletion removes the feature record, all its revisions, all revision logs, and unlinks any experiments that had this flag in their `linkedFeatures`. The experiments themselves are not deleted — they continue to exist with stale tracking keys. Surface this in step 7 so the user knows the experiments are still there.

### 7. Report

Print a summary:

- Flag ID and final state (`archived` or `deleted`).
- For archive: revision-history entry was created (user's audit log will show it).
- For delete: linked experiments were unlinked (but not deleted); their tracking keys now point at a non-existent flag.
- Number of call sites surfaced from Code References, and a reminder of which the user said they'd inline.
- Inline replacement value used (`defaultValue` for the flag), surfaced for transparency.
- UI link: `/features/<flag-id>` — only useful for archived flags (deleted flags 404).
- **Limitation warning:** "Heads-up: I can't detect whether other flags use this one as a prerequisite. If you're not sure, check the GrowthBook UI's 'Used by' panel before deleting — or after archive but before delete, since archive is reversible."
- **Holdout warning** (if `feature.holdout` was present): "This flag was associated with holdout `<holdout-id>`. The holdout's `linkedExperiments` may still reference experiments that pointed at this flag; their tracking keys are now stale. Audit the holdout in the GrowthBook UI if your experiment-analysis depends on it being clean."
- Suggested follow-up: re-run Code References (CLI/Action) so the dashboard reflects the post-cleanup codebase state.

## Guardrails

- **Archive-before-delete is the canonical flow on live flags.** The back-end rejects DELETE on non-archived features unless `restApiBypassesReviews` is set org-wide. Even if the setting is on, prefer archive→verify→delete for the safety pause.
- **Archive triggers a revision-and-publish.** Setting `archived: true` via `POST /v2/features/<id>` creates and publishes a revision server-side. The same failure modes that affect any v2 publish apply — approval-required (4a) and merge-conflict (4b).
- **`bypassApprovalChecks` is asymmetric across archive and delete.**
  - Archive: per-token `bypassApprovalChecks` works (`updateFeatureV2.ts` checks both org-wide and per-token).
  - Delete: per-token `bypassApprovalChecks` does NOT work (`deleteFeature.ts` explicit comment: "review-workflow bypass, not destructive-action override").
  - Only org-wide `restApiBypassesReviews` authorizes both. Don't conflate them when surfacing approval options to the user.
- **`neverStale: true` flags are deliberately permanent.** Halt if the user asks to clean one up; they need to explicitly remove that flag in the UI first.
- **Active running experiments block cleanup.** A flag with an `experiment-ref` rule pointing at a `running` experiment cannot be cleaned up — stopping the experiment is a separate decision routed to `experiment-stop`.
- **Unresolved drafts block cleanup.** Surface the draft and ask the user to discard or publish first.
- **Permanent deletion is a one-way door.** The skill stops between archive and delete to let the user verify nothing broke. Don't collapse the two steps even if the user pushes for it. Frame the irreversibility in the user-facing prompt, not just in this guardrail.
- **Code cleanup is the user's job.** This agent can't edit the user's working tree — surface Code References call sites and ask the user to inline the value themselves. Don't claim to have edited code you can't see.
- **Code References can be stale.** The data reflects the last CLI/GitHub Action run, not the live working tree. Tell the user the data may lag their local edits.
- **`/code-refs` empty doesn't mean "not used in code."** It could mean Code References isn't set up. Don't assume the flag is unreferenced just because the API returns no results.
- **One bulk experiment lookup beats N per-rule lookups.** Use `listExperiments?trackingKey=<flag-id>&status=running` for the primary check; fall back to per-rule fetches only when the bulk call returns empty but `experiment-ref` rules exist (manual-wiring edge case).
- **After archival, every rule stops evaluating — `defaultValue` is what callers get.** Step 2's job isn't to compute per-user behavior; it's to detect whether cleanup changes production behavior by listing rules that diverged from `defaultValue`.
- **Reverse prerequisite-detection is out of scope.** The API doesn't expose a reverse-lookup for "what depends on this flag." Surface the limitation in the report; don't silently miss the case.
- **Holdout linkages aren't explicitly cleaned up on delete.** The feature delete handler doesn't update holdout records. If a flag with a holdout association is deleted, the holdout's `linkedExperiments` may have stale references. Warn the user in the report when `feature.holdout` was present.
- **Deletion unlinks experiments but doesn't delete them.** Experiments that referenced this flag continue to exist with stale `trackingKey` values. Mention this in the report for the delete path.

## Endpoints used

- `GET /api/v2/features/<id>` — fetch flag state (rules, defaultValue, archived, environmentSettings, holdout, project)
- `GET /api/v2/stale-features?ids=<id>` — confirm staleness + check `neverStale` reason
- `GET /api/v1/experiments?trackingKey=<flag-id>&status=running` (and `&status=draft`) — bulk lookup for experiments wired to this flag
- `GET /api/v1/experiments/<id>` — defensive cross-check fallback for the manual-wiring edge case
- `GET /api/v2/features/<id>/revisions/latest` — detect unresolved drafts (404 means none)
- `GET /api/v1/code-refs/<id>` — line-level call sites if Code References is configured; returns `{codeRefs: []}` (not 404) when empty
- `POST /api/v2/features/<id>` — archive (body: `{archived: true}`) or unarchive (`{archived: false}`); triggers revision-and-publish
- `DELETE /api/v2/features/<id>` — permanent delete; requires `restApiBypassesReviews` for live flags (rejected without it)
- `POST /api/v2/features/<id>/revisions/<version>/request-review` — used only in the 4a approval branch

## Handoffs

- `loadSkill('flag-search')` — for finding and auditing stale flags before cleanup (Path C in flag-search is the natural caller).
- `loadSkill('flag-graph')` — to check what depends on a flag before archiving or deleting it.
- `loadSkill('flag-targeting')` — if the user really wants to change the flag's behavior rather than remove it.
- `loadSkill('flag-revisions')` — to check for open drafts that must be resolved before archiving.
- `loadSkill('flag-publish')` — handles the approval-required (4a) and merge-conflict (4b) branches on archive.
- `loadSkill('experiment-stop')` — must precede cleanup of a flag wired to a running experiment.
