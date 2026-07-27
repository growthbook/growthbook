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

Three are **restrictions** — they can take access away from an existing custom role:

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
the feature archive endpoint's auto-publish branch, both bulk adapters, revision
publish, and the direct reverts. The single definition is `canLandArchivedState`
in `revisions/archiveTransition.ts` — add a path, call that. Either atom is also
sufficient _on its own_ for a pure archive, so neither restriction requires edit
rights alongside it.

3. **Landing a change live now requires publish authority** (was edit) — on the
   internal entity `PUT` and on the REST `PUT /configs|constants|saved-groups/:key`,
   which has no draft mode at all. Those paths merge straight to live, so saving
   _is_ publishing; an editor without `publishFlags` / `publishSavedGroups` routes
   through a draft instead, which is what the split means. In the UI this
   surfaces as the "publish now" option disappearing rather than an error; over
   REST it's a 403 pointing at the revisions endpoint. Inline value edits are
   unaffected — they already always open a draft.

Three are **escalations**, all deliberate:

4. **Merge:** a role holding Configs/Constants access now also manages Features —
   they are one family. Per the "a config only reaches users through a feature
   that references it" decision.
5. **Decouple:** a role with publish but not manage can now publish/toggle
   (previously an AND blocked it). Matches `SDKPayloadPublish`'s own description.
6. **Decision B:** config/constant publish and revert are environment-scoped now,
   so an env-limited role is correctly limited on them (previously unlimited).

One is a **model change** with no access impact:

7. **Bypass-approval is per family.** The single shared `bypassApprovalChecks`
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

**`deleteFlags` is self-standing.** Holding it is enough to archive _and_ delete,
with no edit or draft rights alongside — the same shape as revert, where the
authority for an action is enough to stage it, not just to land it. Since
deleting requires archiving first, any weaker rule would make the atom inert.

The standing-in is scoped to a **pure archive**: a request that changes nothing
but `archived`. That's what the archive endpoints and the archive modal send, so
the real flows qualify; a request bundling an archive with other edits still needs
edit rights for those. Mixed changes are checked field-by-field as before.

The UI matches: an archive menu item appears for anyone holding either the
landing authority or edit rights, since either is now sufficient on its own.

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

## Resolved (were open questions)

- **The delete atom is self-standing.** It grants archive as well as delete, with
  no edit or draft rights alongside, as long as the archive is pure — nothing but
  `archived` changes. Anything less made the atom inert, since deleting requires
  archiving first.
- **Landing requires publish, on every write path.** The internal entity `PUT`
  and the REST entity update both merge to live, so saving is publishing; edit
  rights alone now stage a draft instead. `publishFlags` is authoritative
  everywhere, not just inside the revision engine.

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
| Archive (land it)                  |            ✗             |                 ✗                  |             ✗             |              ✗              |             ✗             |               ✗                |            ✓             |
| Unarchive (land it)                |            ✗             |                 ✗                  |             ✗             |              ✓              |             ✗             |               ✗                |            ✗             |
| Stage an archive as a draft        |            ✗             |                 ✓                  |             ✗             |              ✗              |             ✗             |               ✓                |            ✓             |
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

## `manage` dropped for action-oriented atoms

`manageFlags` / `manageSavedGroups` are removed. Every content change is authored
as a revision and then landed, so an "edit" is a draft plus a publish and there is
no edit verb. What remains is what an org actually governs separately:

| Atom                                                | Flags scope   | Saved Groups scope |
| --------------------------------------------------- | ------------- | ------------------ |
| `createFlags` / `createSavedGroups`                 | project + env | project            |
| `manageFlagDrafts` / `manageSavedGroupDrafts`       | project       | project            |
| `reviewFlags` / `reviewSavedGroups`                 | project + env | project            |
| `publishFlags` / `publishSavedGroups`               | project + env | project            |
| `revertFlags` / `revertSavedGroups`                 | project + env | project            |
| `deleteFlags` / `deleteSavedGroups`                 | project + env | project            |
| `bypassApprovalFlags` / `bypassApprovalSavedGroups` | project       | project            |

**Footprints.** Env-scope only where the entity declares its own environments:
features (`environmentSettings`) and Config flavors
(`scopedConfig.environments`) — those two are wired and real.

**Constants are project-scoped in practice.** They _could_ bind through
`environmentValues`, and `constantPublishEnvironments(changedEnvironments?)` is
the seam for it, but every caller today passes nothing, so it always returns
`NO_ENVIRONMENT_BINDING`. Wiring it needs the changed env keys at each site, and
the adapter hooks only receive a snapshot, not the diff — a partial job would
env-scope the PUT while leaving the adapter unscoped, which is worse than uniform.
Treat constants as project-scoped until that's done properly. A base/child Config, a Constant's base value and
every Saved Group reach environments only through consuming features — down to
individual rules — which can't be computed inside a permission check, so they pass
`NO_ENVIRONMENT_BINDING` and fall back to project scope. That constant is named
rather than a bare `[]` because an empty footprint SKIPS the env check.

Create never has a footprint for Configs/Constants/Saved Groups: nothing can
reference an entity that doesn't exist yet. Features supply the envs enabled in
the creation payload.

**Accepted boundary:** an env-limited role can change a base Config, a Constant's
base value, or a Saved Group, and that reaches every environment consuming it.
Closing it needs a cached consumer footprint (the payload builder already computes
exactly this per env via `filterUsedSavedGroups`). Config lock is the durable
per-entity control in the meantime. Saved Groups can also be withheld wholesale
since they're their own family — Configs/Constants can't, which is the known cost
of the merge; the escape hatch is giving them their own family later.

**Call-site mapping rule:** staging a draft → `draft`; landing, direct writes,
entity settings (lock, experiment guard, scoped overrides) → `publish` with a real
footprint; adjacent non-content objects that were project-scoped → keep exact
behaviour with `NO_ENVIRONMENT_BINDING`. Per-decision: holdout → draft, ramp
schedules + templates → draft (rampActions are a draft concern), custom hooks →
publish-adjacent, experiment/bandit linked features → publish.

**What the sweep changed, by class.** Draft-class (authoring): holdout, ramp
schedules and templates, prerequisites, feature sync, `putFeature` staging, the
entity `PUT` staging path, saved-group add/remove items, code refs, and the UI's
"can edit" gates. Publish-class (landing live): the model-layer `canUpdate` hooks,
entity settings (config lock, experiment guard, scoped overrides), REST entity
updates, safe-rollout status, experiment and bandit linked features, and the
adapters' `canCreate`/`canUpdate` — whose only remaining consumers are the
destination-project check on a project-moving publish and the bulk publisher's
move guard. Create-class: the four create endpoints, with features supplying the
envs enabled in the creation payload.

The old move-aware `canUpdateFeature(existing, updated)` is gone rather than
repointed: authoring is project-scoped so a move has no second project to check,
and landing into a different project is a publish checked against both source and
destination at each publish site. Its dedicated test block was removed for the
same reason.

**The two internal approve-and-publish handlers are fixed**: the rule lives in
`planApproveAndPublish` (`revisions/approveAndPublish.ts`), unit-tested, and both
the generic controller and `postFeatureApproveAndPublish` call it. On the armed
path neither publishes inline — the generic one defers to
`maybeAutoPublishRevision` and the feature one to
`maybeAutoPublishFeatureRevision`, so the publish runs under the armer's context
exactly as REST submit-review already did.

**Approve-and-publish on an armed revision.** When a revision is armed for
auto-publish (`autoPublishOnApproval` + `autoPublishEnabledBy`), the publish was
authorized by the armer and the approver is only the trigger — so approving needs
`review` alone. REST already behaves this way: its only review endpoint is submit-
review, gated on `review`, which then calls `maybeAutoPublishRevision` and fires
under the armer's authority. The internal `postApproveAndPublish` /
`postFeatureApproveAndPublish` handlers are the outliers — they demand publish
unconditionally, so the same approver is denied the button while the plain Approve
button publishes anyway. Bring them in line with REST:

- armed → `review` only; approve, then let the auto-publish fire under the armer
  (publishing inline as the approver would fail the downstream publish check)
- unarmed → `review` **and** `publish`; the approver is electing the publish

Done, with `planApproveAndPublish` unit-tested for all six combinations.

## Renaming an atom drops it from stored roles

A custom role stores its additive atoms as **strings** in `permissions[]`, and
nothing reconciles them on read — an unrecognised name is simply absent, so the
role silently loses that capability. Verified by renaming `manageFlagDrafts` to
`editFlagDrafts` mid-QA: a role saved with the old name degraded to read-only
with no error anywhere.

Harmless on this branch, because `permissions[]` is new here and no stored role
predates it — policies, which is what everything shipped uses, remap fine. But
once this ships, renaming an atom is a breaking change for any org that composed
a role from it, and it fails _silently_ rather than loudly. Either settle the
vocabulary before release (what we did), or add a rename map if one is ever
needed after.

## Parallelism audit

Built the model × action × surface matrix rather than spot-checking. **The engine
REST surface is exactly parallel**: every lifecycle endpoint shared by Configs,
Constants and Saved Groups resolves to the same atom (draft for create/discard/
rebase/request-review/archive/metadata/value, review for submit-review,
delete+draft+revert for revert, `assertCanPublishRevision` for publish,
`canLandArchivedState` for archive, publish for the entity update). The internal
`put` handler is identical across all three. Feature REST v1/v2 pairs match on
every endpoint that exists in both.

Four defects found and fixed:

1. **Approvals page reviewed the wrong atom.** `canReviewRow` asked features for
   `review` but saved groups for `draft` (my regression — `main` used the edit
   atom, which _was_ the review rule then), and returned a hardcoded `false` for
   Constants and Configs, hiding their rows from every reviewer (pre-existing).
   All four now ask their own family's review atom.
2. **Feature project moves weren't checked at land.** The engine re-checks the
   destination on publish via `ownershipChanged`; features only checked it when
   the move was _staged_. Since the stager and the publisher needn't be the same
   person, a move could land into a project the publisher had no authority over.
   `assertCanPublishFeatureRevision` now checks the destination too.
3. **Config delete footprint disagreed across surfaces.** The front end passed the
   flavor's environments, the back end passed none — front end stricter than
   server. The flavor envs are correct; the REST handler, controller and model
   hook now all use `configPublishEnvironments`.
4. **Stale vocabulary.** Page-level `canUpdate` locals (already resolving to
   `draft`) renamed to `canDraft`, and two comments still describing "manage" or
   "can edit = can review" corrected. Naming a variable after a verb the model no
   longer has is what made `manageFlags` unreadable.

Checked and clean: no back-end file lost all its gating vs `main`; every 2→1 drop
in the features controller is the intended `canUpdateFeature && X` → `X` decouple
and no handler is ungated; no REST handler that had a gate on `main` is now
ungated; no new REST handlers were added; and no env-scoped atom is called with an
empty footprint anywhere except the documented no-binding cases.

Known non-defects: Constants have no internal-controller delete gate (the model
hook enforces it, same as `main`); Constants and Saved Groups lack the
recall-review / reopen / schedule-publish REST endpoints Configs have (feature
surface, not permissions); Feature delete additionally requires publish because
it can delete a _live_ flag via the REST bypass, which the engine models can't.

## Authoring vs landing: where each gate belongs

Every write answers two questions, and they take different atoms:

- **Who may author this content?** → `draft`, project-scoped.
- **Who may put it in front of users?** → `publish`, environment-scoped.

An endpoint needs whichever it actually does. Revision-scoped handlers author
only, so they take `draft` alone. Toggling an environment, publishing a draft
and unarchiving land only, so they take `publish` alone. A **direct update does
both**, so it takes both — that is what the `editor` persona is.

The model `canUpdate` hooks stay publish-only on purpose. They are the floor for
_any_ write to the live document, including the write that publishing someone
else's draft performs; requiring `draft` there would stop a publisher from
publishing. The authoring gate belongs at the endpoint, which is the only layer
that knows whether the caller is authoring or landing.

A second round found the direct-update REST handlers for all four models
checking `publish` twice — the comments said "publish authority on top of edit",
but the edit half was never wired. Net effect versus `main`, whose single
`canUpdateFeature`/`canUpdateConfig`/… covered authoring: a publish-only role
could write new content straight to the payload. All four now gate authoring
first, on both sides of a project move (matching `main`'s
`checkProjectFilterUpdatePermission`), and land second. Feature metadata never
reaches the payload, so a metadata-only update stays draft-only — what
`manageFeatures` allowed before the split. `deleteLinkedFeature` had the same
comment/code mismatch and is now `canEditFeatureDrafts`, matching the holdout
controller's identical unlink.

Create stays asymmetric on purpose: a new feature enables its own environments,
so it takes `create` + `publish`; a new Config, Constant or Saved Group declares
no environments and reaches no one until something consumes it, so it takes
`create` alone. That is the footprint rule, not an oversight.
