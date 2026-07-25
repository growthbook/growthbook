# Granular Flag Permissions — review notes

Branch: `bryce/granular-flag-permissions`. Design doc: `~/Documents/feature-permissions-design.html`.
Working artifact for review — delete before merge.

## What shipped

Features, constants and configs are merged into one **Flags** permission family;
saved groups keep their own. Each lifecycle action is its own grantable atom, and
custom roles can grant atoms directly (additive `permissions[]`) instead of only
whole policies.

| Action               | Flags atom                                 | Saved-group atom         | Scope                     |
| -------------------- | ------------------------------------------ | ------------------------ | ------------------------- |
| create + edit        | `manageFlags`                              | `manageSavedGroups`      | project                   |
| delete (and archive) | `deleteFlags`                              | `deleteSavedGroups`      | project                   |
| author drafts        | `manageFlagDrafts`                         | `manageSavedGroupDrafts` | project                   |
| review               | `reviewFlags`                              | `reviewSavedGroups`      | project                   |
| publish              | `publishFlags`                             | `publishSavedGroups`     | **environment** / project |
| revert               | `revertFlags`                              | `revertSavedGroups`      | **environment** / project |
| bypass approvals     | `bypassApprovalChecks` (shared, unchanged) | —                        | project                   |

Single source of truth: `REVISION_PERMISSIONS` in
`shared/src/permissions/revisionPermissions.ts`. Every check goes through
`context.permissions.canRevisionAction(model, action, obj, envs?)`.

## Behavior changes to release-note

Two are **restrictions** — they can take access away from an existing custom role:

1. **Archive now requires the delete atom** (was manage/drafts). A custom role with
   manage but _not_ delete loses the ability to archive. Rationale: `deleteFeature`
   tells callers to "archive the feature first" instead of enabling the REST
   bypass, so archive was a route to delete — gating it lower let a caller reach
   delete without ever passing a delete check.
2. **Unarchive now requires publish authority** in the feature's environments
   (was manage/drafts). It returns a flag to service, so it's an ordinary payload
   change — but a manage-only role can no longer do it.

Three are **escalations**, all deliberate:

3. **Merge:** a role holding Configs/Constants access now also manages Features —
   they are one family. Per the "a config only reaches users through a feature
   that references it" decision.
4. **Decouple:** a role with publish but not manage can now publish/toggle
   (previously an AND blocked it). Matches `SDKPayloadPublish`'s own description.
5. **Decision B:** config/constant publish and revert are environment-scoped now,
   so an env-limited role is correctly limited on them (previously unlimited).

Back-compat: deprecated policies (`FeaturesFullAccess`, `FeaturesBypassApprovals`,
`ConfigsFullAccess`, `ConstantsFullAccess`) stay resolvable and hidden from the
editor, remapped onto the merged atoms. `shared/test/granular-flag-permissions.test.ts`
pins the pre-merge capability matrix so a remap can't silently drop access.

## Revert authority

Revert is its own atom, and it authorizes the reversion itself — direct or
draft-based. Proposing a revert as a draft needs either draft _or_ revert
authority, so a revert-only responder isn't blocked on draft CRUD.

A draft-based reversion only rides revert authority when the draft is a **pure
revert**: every value it proposes must restore the target revision's value (or be
a no-op against live). Checked on content at publish time, so it fails closed —
any edit, now or from an edit path added later, changes a proposed value and the
draft falls back to needing publish authority. Side effects that reach beyond the
entity (`rampActions`, `holdout`) must be no-ops even when the target recorded
something different, since "restoring" them still fires the effect.

The purity check runs _only_ on the revert fallback, so callers who can already
publish are unaffected and pay no extra load.

## Accepted boundaries

- **Sparse legacy feature revisions.** A revert to a very old revision whose
  envelopes were never recorded can read as impure and need publish authority.
  Fails safe, self-healing as those revisions age out, and anyone with full flag
  access can unblock it.
- **Bulk publish does not honor revert authority.** `featureBulkAdapter.canPublish`
  is synchronous and runs before gate collection, so multi-publish requires publish
  authority; a revert-only role reverts per entity instead.
- **Config lineage under revert.** Restoring `parent`/`extends`/`schema` reconciles
  descendant configs — a cross-entity write. Still subject to the adapter's
  schema-break and reconcilability guards, which this branch didn't weaken.
- **`isRevert` validation-skipping is unchanged.** It still trusts `revertedFrom`
  without consulting purity, so an edited config revert draft still skips those
  validations. Pre-existing; scoped out deliberately because tightening it would
  change behavior for callers who already have publish rights.

## Gating layers

Staging is draft-class; landing the change is not. Archive follows that split:
the revision-archive endpoints stage under the draft atom, and the delete atom is
enforced wherever the transition lands — the feature archive endpoint's
auto-publish branch (which publishes directly), `assertCanPublishFeatureRevision`,
the bulk publisher, and `assertCanPublishRevision` for the engine entities. The
pure predicates behind that rule are `isArchiveTransition` / `proposedArchivedValue`.

Note the engine's `adapter.canDelete` is **not** the delete atom — it gates
deleting a revision _document_ (`bypassApprovalChecks`). Entity delete comes from
the permission table.

## Verification

- All three packages type-check; every changed file lints at zero warnings.
- back-end 201 suites / 5575 tests, shared 54 / 1912, front-end 50 / 774 — all pass.
- OpenAPI regenerated: no diff (permission-enforcement code only).

## Still open

- **Manual QA of the new personas** — nothing has exercised review-only,
  publish-only, revert-only or edit-no-delete end to end, including the editor's
  preset/atom mutual exclusion. This is the main untested surface.
- Delete this file before merge.

## Docs — deliberately deferred

Held until the permission model stops moving; doing these while the ground shifts
just means writing them twice. All three are known-stale as of this branch:

1. **`.agents/guides/permissions.md` is factually wrong.** Still documents the
   pre-merge atoms — `canReview` and `manageFeatures`/`manageFeatureDrafts` (L22-23),
   `publishFeatures` (L33), and a `permissions.manageFeatures` example (L349). Both
   `AGENTS.md` and `.claude/rules/permissions.md` point agents at it, so the next
   agent touching permissions gets stale names and never learns
   `canRevisionAction` exists. Needs: the atom table, the model→family mapping, the
   single check shape, and the staging-vs-landing rule.
2. **`docs/docs/account/user-permissions.mdx` is customer-facing and stale.**
   Policy renames, the new `Flags Full Access` / `Flags Bypass Approvals`,
   `SDK Payload Publish` moving into the Feature Flagging group, and the
   grant-individual-permissions capability, which isn't documented at all.
3. **Release notes.** The five behavior changes above, led by the two
   restrictions — a self-hosted admin whose manage-only role is about to lose
   archive won't find that in a branch file.
