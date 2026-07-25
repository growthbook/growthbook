# Granular Flag Permissions — review notes

Branch: `bryce/granular-flag-permissions`. Design doc: `~/Documents/feature-permissions-design.html`.
Working artifact for review — delete before merge.

## What shipped

Features, constants and configs are merged into one **Flags** permission family;
saved groups keep their own. Each lifecycle action is its own grantable atom, and
custom roles can grant atoms directly (additive `permissions[]`) instead of only
whole policies.

| Action               | Flags atom            | Saved-group atom            | Scope                     |
| -------------------- | --------------------- | --------------------------- | ------------------------- |
| create + edit        | `manageFlags`         | `manageSavedGroups`         | project                   |
| delete (and archive) | `deleteFlags`         | `deleteSavedGroups`         | project                   |
| author drafts        | `manageFlagDrafts`    | `manageSavedGroupDrafts`    | project                   |
| review               | `reviewFlags`         | `reviewSavedGroups`         | project                   |
| publish              | `publishFlags`        | `publishSavedGroups`        | **environment** / project |
| revert               | `revertFlags`         | `revertSavedGroups`         | **environment** / project |
| bypass approvals     | `bypassApprovalFlags` | `bypassApprovalSavedGroups` | project                   |

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
2. **Unarchive now requires publish authority** in the entity's environments
   (was manage/drafts). It returns a flag to service, so it's an ordinary payload
   change — but a manage-only role can no longer do it.

Both directions are enforced on **every** path that can land the flip: the REST
archive/unarchive endpoints, the entity `PUT` (the dashboard's own archive modal),
the feature archive endpoint's auto-publish branch, and revision publish. The
single definition is `canLandArchivedState` in `revisions/archiveTransition.ts` —
add a path, call that.

Three are **escalations**, all deliberate:

3. **Merge:** a role holding Configs/Constants access now also manages Features —
   they are one family. Per the "a config only reaches users through a feature
   that references it" decision.
4. **Decouple:** a role with publish but not manage can now publish/toggle
   (previously an AND blocked it). Matches `SDKPayloadPublish`'s own description.
5. **Decision B:** config/constant publish and revert are environment-scoped now,
   so an env-limited role is correctly limited on them (previously unlimited).

One is a **model change** with no access impact:

6. **Bypass-approval is per family.** The single shared `bypassApprovalChecks`
   atom is split into `bypassApprovalFlags` and `bypassApprovalSavedGroups`, so a
   role can bypass approvals for one family without the other — and each row now
   lives in its resource's group in the editor, retiring the cross-entity
   "Revisions and Approvals" group. This closes the branch's one deliberate
   deviation from the design doc (bypass was left shared because the atom is the
   `requiresPermission` literal threaded through the whole publish-gate system).
   Nothing loses access: the deprecated `FeaturesBypassApprovals` grants **both**
   atoms and the default Project Admin role gains `SavedGroupsBypassApprovals`,
   because the pre-split atom covered saved groups too. New policy for new roles:
   `SavedGroupsBypassApprovals`.

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
both bulk adapters, `assertCanPublishRevision` for the engine entities, the REST
archive endpoints, and the entity `PUT`. The predicates behind the rule are
`isArchiveTransition` / `proposedArchivedValue` / `canLandArchivedState`.

**Landing is not sufficient on its own.** Every archive path also runs the
staging gate first — draft authority for features, manage for the engine
entities' `PUT` — so `deleteFlags` is effectively a **modifier**: it authorizes
the elevation, it doesn't grant the action alone. Since deleting requires
archiving first, a role holding _only_ `deleteFlags` can't delete anything. That
follows from "archive and delete are the same elevation", which raised the floor
without lowering it; whether the delete atom should also stand in for staging (the
way revert authority stands in for proposing a revert draft) is an open call —
see "Open questions".

Because both gates run, **the UI has to check both**. It didn't: every archive
menu item gated on the landing atom alone, so a publish-only role was offered
Unarchive and got a permission error from the staging gate. All four entity
surfaces now require staging **and** landing authority.

Note the engine's `adapter.canDelete` is **not** the delete atom — it gates
deleting a revision _document_ (the entity's bypass-approval atom). Entity delete
comes from the permission table.

## Full-branch audit — what it found

A whole-diff pass over the 227 changed files, aimed at the rewiring risk: gates
that were merged, split, or repointed. Seven gaps, all fixed. The first three came
from the diff itself; the rest came from re-auditing the fixes — worth noting that
ratio, since each fix moved a rule and moving a rule exposed the next path that
didn't have it.

1. **The entity `PUT` was never repointed** (Configs, Constants, Saved Groups).
   It can archive and it can publish, and it still gated everything on the one
   manage atom — while the REST archive endpoints and revision publish had both
   moved to the delete atom, and the UI had already been switched to hide archive
   behind delete. So the branch's headline restriction was **client-side only on
   the dashboard's own path**. Now gated by `canLandArchivedState`, and the same
   predicate replaced the hand-rolled ternary in the feature archive controller so
   the rule has one definition.
2. **The front-end asked for env-scoped authority with no environment list.** An
   empty list skips the env limit entirely (`envs.every` over nothing), so
   Config/Constant publish and revert read as granted for an env-limited role and
   the server then refused. The footprint helpers moved to
   `shared/util/configs.ts` (`configPublishEnvironments` /
   `constantPublishEnvironments`) so both sides scope identically.
3. **"Request Review" was enabled without draft authority**, though the endpoint
   behind it requires it — so publish-only, review-only and revert-only roles were
   offered a button that 403s. The generic tab gated it on "any authority"; the
   feature page checked nothing at all. The publish CTA beside it already got this
   right; the fix was to match it on both surfaces.

4. **Unarchive was only publish-class on features.** The engine entities shared
   one `setArchivedState` helper gating both directions on delete, contradicting
   release-note #2. Now uniform across all four.
5. **The archive menu items checked only the landing atom**, so a publish-only
   role was offered Unarchive and got a staging-gate error. All four surfaces now
   check both gates — see "Gating layers".
6. **Reverting to an archived state bypassed the archive gate.** A draft-based
   revert that archives runs through `assertCanPublishFeatureRevision` and needs
   the delete atom; the **direct** revert paths (feature controller + v2 REST, and
   the three engine-entity revert endpoints, which call `applyChanges` straight
   past `assertCanPublishRevision`) gated only on revert authority. So revert
   authority alone could take a flag out of service. All six now apply the
   delete-class gate on the archive transition, restoration-vs-elevation being the
   line: revert covers restoring the values, not the elevation.

   The UI follows: the feature revert modal only offers publish-now when the
   viewer can land the archive (staging a revert draft is unaffected), and the
   generic modal drops its "Also archive" opt-in without the delete atom — so the
   revert still goes through, minus the elevation. Only the archive direction is
   gated; reverting to an _unarchived_ state needs revert authority alone, on both
   the server and the client.

7. **The generic bulk adapter had no archive gate.** `featureBulkAdapter` enforced
   the delete atom on an archive transition; the adapter every _other_ entity
   shares only asked for publish authority, so a multi-entity publish could archive
   a Config, Constant or Saved Group without it. Same shape as the bypass leak the
   previous audit found — the multi-entity path keeps missing per-entity rules, so
   it's worth checking first whenever a rule is added. Covered by the predicate
   tests only; there is no bulk-adapter test harness to extend.

Checked and found correct (no change needed): the internal direct-revert
controller's per-field env gating; discard staying author-or-draft; the
per-family bypass split with no model-agnostic path hardcoding a family atom;
role validation (`permissions[]` is a Zod enum over `ALL_PERMISSIONS`, behind
`canManageCustomRoles` + the premium gate); the set of policies hidden from the
editor matching `DEPRECATED_POLICIES` exactly; and no permission newly reachable
only via additive grants (`manageExecReports` is policy-orphaned on `main` too).

## Verification

- All three packages type-check; every changed file lints at zero warnings.
- back-end 201 suites / 5581 tests, shared 54 / 1925, front-end 50 / 774 — all pass.
- OpenAPI regenerated: description-only diff from the bypass-atom rename.
- `pnpm lint` at the repo root currently fails on a **stale git worktree** at
  `.claude/worktrees/reverent-colden-d80529` (registered, 158M, holds uncommitted
  work from the copy sweep, based on `main`). Nothing to do with this branch —
  lint globs into it. Clear it with `git worktree remove` once that work is
  salvaged or abandoned.

## Open questions

- **Should the delete atom stand in for staging?** Today archive needs delete
  **and** draft/manage, which makes a delete-only role unable to delete anything
  (delete requires archiving first). Revert set the opposite precedent: revert
  authority alone suffices to propose a revert draft. Making delete behave the
  same way would make the Deleter persona coherent; leaving it keeps the floor
  higher. Not a blocker either way — it only affects roles that grant delete
  without manage or drafts.
- **Publish authority on the entity `PUT`.** For the engine entities that path
  still lands live changes under the manage atom, so `publishFlags` is only
  authoritative through the revision engine. Enforcing it there would be a real
  behavior change (a manage-only role could no longer save a Config at all with
  approvals off, since save _is_ publish on that path), so it wants a deliberate
  decision rather than a quiet tightening. Not a regression — `main` was the same.

## Still open

- **Manual QA of the new personas** — nothing has exercised review-only,
  publish-only, revert-only or edit-no-delete end to end, including the editor's
  preset/atom mutual exclusion. This is the main untested surface.
- Delete this file before merge.

## Expected behavior — the QA oracle

Derived from the rules as implemented, so QA has something to check _against_
rather than just observing. Each persona is a custom role holding **only** the
atoms named (plus `readData`). Disagreements here are spec bugs to settle before
testing, not test failures.

| Action (Flags)                     | Collab.<br>`addComments` | Draft author<br>`manageFlagDrafts` | Reviewer<br>`reviewFlags` | Publisher<br>`publishFlags` | Reverter<br>`revertFlags` | Editor<br>`manageFlags`+drafts | Deleter<br>`deleteFlags` |
| ---------------------------------- | :----------------------: | :--------------------------------: | :-----------------------: | :-------------------------: | :-----------------------: | :----------------------------: | :----------------------: |
| Create flag                        |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✗             |
| Edit flag metadata                 |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✗             |
| Create / edit draft                |            ✗             |                 ✓                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✗             |
| Rebase / resolve conflicts         |            ✗             |                 ✓                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✗             |
| Discard draft (incl. others')      |            ✗             |                 ✓                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✗             |
| Request review                     |            ✗             |                 ✓                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✗             |
| Comment on a revision              |            ✓             |                 ✓                  |             ✓             |              ✗              |             ✗             |               ✓                |            ✗             |
| Approve / request changes          |            ✗             |                 ✗                  |             ✓             |              ✗              |             ✗             |               ✗                |            ✗             |
| Approve **and** publish            |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✗                |            ✗             |
| Publish a draft                    |            ✗             |                 ✗                  |             ✗             |              ✓              |             ✗             |               ✗                |            ✗             |
| Toggle env / kill switch           |            ✗             |                 ✗                  |             ✗             |              ✓              |             ✗             |               ✗                |            ✗             |
| Direct revert                      |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✓             |               ✗                |            ✗             |
| Propose revert as draft            |            ✗             |                 ✓                  |             ✗             |              ✗              |             ✓             |               ✓                |            ✗             |
| Publish a **pure** revert draft    |            ✗             |                 ✗                  |             ✗             |              ✓              |             ✓             |               ✗                |            ✗             |
| Publish an **edited** revert draft |            ✗             |                 ✗                  |             ✗             |              ✓              |             ✗             |               ✗                |            ✗             |
| Archive (land it)                  |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✗                |      ✗ (+drafts ✓)       |
| Unarchive (land it)                |            ✗             |                 ✗                  |             ✗             |        ✗ (+drafts ✓)        |             ✗             |               ✗                |            ✗             |
| Delete an archived flag            |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✗                |            ✓             |
| Delete a live flag (REST)          |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✗                |            ✗             |

Notes that the grid can't carry:

- **Approve-and-publish needs review _and_ publish**, so no single-atom persona can
  do it — that's intended, not a gap.
- **Deleting a live flag via REST** additionally needs env-scoped publish authority
  _and_ the org's REST-bypass setting; the internal path requires archiving first.
  So the Deleter column is ✓ only for already-archived flags.
- **Staging vs landing.** A draft author can stage `archived: true` through the
  feature revision-archive endpoint; it just won't publish. Only the landing
  column is shown above — and because the staging gate still runs on the archive
  paths themselves, those rows need the landing atom **plus** draft authority
  (manage, for the engine entities' `PUT`, which gates the flip in either
  direction whether it stages or lands). Marked `+drafts` rather than ✓.
- **Env scoping.** Publish and revert are per-environment for Flags, so an
  env-limited Publisher/Reverter is ✓ only within its environments — and a revert
  spanning an environment they lack is ✗ in full, not partially applied.
- **Impure revert drafts** fall back to needing publish authority, which is why the
  Reverter column differs between the pure and edited rows.
- **Saved groups** follow the same shape with their own atoms, except publish and
  revert are project-scoped (no env dimension) — which also makes their unarchive
  project-scoped.
- **UI parity.** Every ✓ above should be reachable in the product, not just via
  REST — that's the specific thing the `canEditEntity` split was fixing, and the
  most likely place for a mismatch to remain.

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
   Policy renames, the new `Flags Full Access` / `Flags Bypass Approvals` /
   `Saved Groups Bypass Approvals`,
   `SDK Payload Publish` moving into the Feature Flagging group, and the
   grant-individual-permissions capability, which isn't documented at all.
3. **Release notes.** The five behavior changes above, led by the two
   restrictions — a self-hosted admin whose manage-only role is about to lose
   archive won't find that in a branch file.
4. **REST API reference copy for Constant/Config.** `Constant` and `Config` are
   now Title Case named resources in the copy glossary
   (`.agents/guides/ui-copy-style.md`), and the UI copy plus back-end
   error/validation messages have been swept to match. The OpenAPI surface was
   left alone: ~120 `.describe()`/`summary` strings across
   `packages/shared/src/validators/{config,constant,config-revisions,constant-revisions}.ts`
   and the tag descriptions in `packages/back-end/src/scripts/generate-openapi.ts`
   still say "config"/"constant" lowercase. It is a separate surface with real
   judgment calls (structural jargon like "flavor config", "child config",
   "root config", "mixin config keys" vs. the resource itself), and changing it
   requires regenerating the checked-in `packages/back-end/generated/spec.yaml`
   (needs `stats-ts` built first). Do it as its own change so the spec diff is
   reviewable on its own.
