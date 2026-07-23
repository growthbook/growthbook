# Granular Flag Permissions — implementation notes

Branch: `bryce/granular-flag-permissions`. Design doc: `~/Documents/feature-permissions-design.html`.
Working artifact for review — delete before opening the real PR.

## Decisions locked (Bryce)

- Merge **Features + Constants + Configs → one "Flags" permission family**. Saved Groups stays separate.
- Uniform `resource × action` taxonomy, derived from one source-of-truth table.
- New `Flags`/`SavedGroups` atom naming (option B). Back-compat via **shadowing**: deprecated policy ids stay resolvable (mapped to the exact legacy atoms) but are hidden from the picker. No JIT policy-name migration — Features→Flags is not access-equivalent (Flags adds publish), so renaming stored policies would silently escalate; shadowing preserves exact access instead.
- Env-scoped publish/revert across **all** of Flags (decision B) — configs/constants included, using each adapter's existing changed-env computation. Saved Groups publish/revert = project-scoped (no env).
- Additive `permissions[]` on custom roles alongside `policies[]`; effective = union. No deny.
- Solve end-to-end incl. UI (drill-down grid). No backend-only path.

## Atom set (new)

### Flags (features + constants + configs)

| atom                   | scope   | replaces                                                       |
| ---------------------- | ------- | -------------------------------------------------------------- |
| `manageFlags`          | project | manageFeatures / manageConfigs / manageConstants (create+edit) |
| `deleteFlags`          | project | (new — split out)                                              |
| `manageFlagDrafts`     | project | manageFeatureDrafts (+ config/constant draft, was manage\*)    |
| `reviewFlags`          | project | canReview (+ config/constant review, was manage\*)             |
| `publishFlags`         | **env** | publishFeatures (+ config/constant publish, was manage\*)      |
| `revertFlags`          | **env** | (new — split out)                                              |
| `bypassApprovalChecks` | project | **KEPT as single shared atom** (see deviation below)           |

### Saved Groups

| atom                        | scope   | replaces                |
| --------------------------- | ------- | ----------------------- |
| `manageSavedGroups`         | project | (keep name) create+edit |
| `deleteSavedGroups`         | project | (new)                   |
| `manageSavedGroupDrafts`    | project | (new)                   |
| `reviewSavedGroups`         | project | (new)                   |
| `publishSavedGroups`        | project | (new, no env)           |
| `revertSavedGroups`         | project | (new, no env)           |
| `bypassSavedGroupSizeLimit` | project | (keep)                  |

(Saved-group approval bypass continues to use the shared `bypassApprovalChecks`.)

## Deviation from design doc

- **Bypass-approval NOT split per resource.** `bypassApprovalChecks` stays a single shared atom. Reason: it's the `requiresPermission` literal threaded through the entire publish-gate system (publishGates/governanceGates/adapters + ~14 gate sites + ~14 tests + ~20 API docs); splitting it is high-risk/low-value since bypass is an elevated cross-cutting capability. Consequence: the review/publish/delete/revert "coupling wart" is fixed, but saved groups still reach bypass via a flags-family policy (`FlagsBypassApprovals`). Revisit later if a customer needs per-resource bypass.

Kept untouched: `manageArchetype`, `runExperiments`, everything else.

## Policies

New (shown in editor, "Feature Flagging" group):

- `FlagsFullAccess` → readData, manageFlags, deleteFlags, manageFlagDrafts, reviewFlags, publishFlags, revertFlags, manageArchetype
- `FlagsBypassApprovals` → FlagsFullAccess + bypassApprovalChecks

Expanded in place (id kept):

- `SavedGroupsFullAccess` → readData + all 6 saved-group action atoms
- `SavedGroupsBypassSizeLimit` → SavedGroupsFullAccess + bypassSavedGroupSizeLimit
- `SDKPayloadPublish` → readData, publishFlags, runExperiments (publishFeatures renamed)

Deprecated (resolvable, hidden from POLICY_DISPLAY_GROUPS; mapped to new atoms to preserve exact access):

- `FeaturesFullAccess` → readData, manageFlags, deleteFlags, manageFlagDrafts, reviewFlags, manageArchetype (note: no publish — matches old)
- `FeaturesBypassApprovals` → above + bypassApprovalChecks (preserves old bypass, incl. cross-resource since bypass stayed a single shared atom)
- `ConfigsFullAccess` / `ConstantsFullAccess` → readData, manageFlags, deleteFlags, manageFlagDrafts, reviewFlags

## Behavior changes to release-note

1. **Merge escalation (by design):** a custom role that granted Configs/Constants access but _not_ Features now also manages Features (they're one family). Per the "configs express through features anyway" decision.
2. **Decouple escalation:** a role with publish but not manage can now publish/toggle (previously blocked by an AND). Aligns with the policy's stated intent.
3. **Decision-B tightening (the one reduction):** env-limited roles become env-limited on config/constant publish too (were project-scoped/unlimited). Correct behavior; chosen handling = accept + release-note (not grandfathering).

## Enforcement surfaces

- **Shared revision engine** (configs, constants, saved groups): add `canManageDrafts / canReview / canPublishRevision / canRevert` to `EntityRevisionAdapter` (default → `canUpdate`); each adapter maps to its atoms; publish/revert receive the revision's changed-env set.
- **Bespoke `features.ts`**: repoint ~30 endpoint gates to specific atoms; decouple the AND-fusions.

## Layer checklist (status as of overnight pass)

- [x] L1 shared constants: atoms, scope arrays, policies (new + deprecated-shadow), metadata, display groups (renamed "Feature Flagging", Saved Groups moved in), DEFAULT_ROLES updated. `DEPRECATED_POLICIES` exported.
- [~] L1 JIT policy migration — **not done, intentionally.** Migrating Features→Flags policy names is NOT access-equivalent (Flags adds publish), so instead deprecated policies are kept resolvable (mapped to exact legacy atoms) + hidden from the editor (shadow). Stored roles keep exact access with no migration.
- [x] L2 permissionsClass: repointed create/edit→manageFlags, delete→deleteFlags(/deleteSavedGroups), drafts→manageFlagDrafts, review→reviewFlags, publish→publishFlags; added canRevertFeature + generic canManageFlagDrafts/canReviewFlag/canPublishFlag/canRevertFlag + saved-group equivalents. Existing method names preserved as the callable interface.
- [x] L3 custom-role model/API: Role.permissions[], customRoleValidator accepts permissions, resolver union (permissionsFromRole), env-limit applicability (roleSupportsEnvLimitFromRole).
- [x] L4 revision adapter hooks (canManageDrafts/canReview/canRevert added; canPublishRevision already existed) + config/constant/saved-group adapter impls; generic revision controller + revisionActions routed to action hooks; publish decoupled from manage (project-move-only recheck).
- [x] L5 features.ts: decoupled draft/publish/toggle gates; revert → canRevertFeature.
- [x] L6 front-end: RoleForm drill-down (expand a policy → grant individual atoms via permissions[]); GRANULAR_PERMISSION_METADATA.
- [x] L7 (partial): fixed broken tests (policy-display-groups invariant, 3 back-end atom literals); added granular-flag-permissions.test.ts (resolver union, env-limit, policy mapping). All shared permission tests green (31).

## Type-check / test status

- `pnpm --filter shared|back-end|front-end type-check` — all green.
- Shared permission jest suites — green.

## Remaining work (NOT done — for review/follow-up)

1. **External REST per-endpoint sweep for configs/constants/saved-groups** (~68 handlers under `src/api/{configs,constants,saved-groups}/*Revision*.ts`). They still double-gate on `canUpdate*` (= manageFlags) directly, so granular publish/review/revert-only roles work through the INTERNAL app (generic revision controller) but not yet through the external REST API for these three. Feature REST endpoints (`src/api/features/*`) similarly need review. Sweep each to the action-specific method.
2. **OpenAPI regen** (`pnpm --filter back-end generate-openapi`) once the REST validators reference the new atoms; the ~20 `bypassApprovalChecks` doc strings are unaffected (atom kept).
3. **Env footprint precision (decision B):** config/constant publish/revert currently use a conservative env footprint (config flavor scope; all-envs for constants/base configs) rather than the exact per-revision changed-env diff. Tighten against `proposedChanges`.
4. **Archive semantics:** feature archive was swept into the draft-authoring decouple (now manageFlagDrafts-only). Confirm archive should be draft-authoring vs manage.
5. **Broader test runs:** full back-end/front-end jest suites not run here; run before PR. Watch config/constant/saved-group revision-publish tests.
6. **Manual QA:** create a review-only / publish-only / revert-only custom role via the editor and verify enforcement end to end.
7. Delete this NOTES file before opening the real PR.
