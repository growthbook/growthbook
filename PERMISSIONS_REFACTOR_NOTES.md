# Granular Flag Permissions — implementation notes

Branch: `bryce/granular-flag-permissions`. Design doc: `~/Documents/feature-permissions-design.html`.
Working artifact for review — delete before opening the real PR.

## Decisions locked (Bryce)

- Merge **Features + Constants + Configs → one "Flags" permission family**. Saved Groups stays separate.
- Uniform `resource × action` taxonomy, derived from one source-of-truth table.
- New `Flags`/`SavedGroups` atom naming (option B). Back-compat via: keep deprecated **policy** ids resolvable (mapped to new atoms) + hidden from the picker; JIT-normalize stored custom-role policy arrays on org load.
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
- `FlagsBypassApprovals` → FlagsFullAccess + bypassApprovalFlags

Expanded in place (id kept):

- `SavedGroupsFullAccess` → readData + all 6 saved-group action atoms
- `SavedGroupsBypassSizeLimit` → SavedGroupsFullAccess + bypassSavedGroupSizeLimit
- `SDKPayloadPublish` → readData, publishFlags, runExperiments (publishFeatures renamed)

Deprecated (resolvable, hidden from POLICY_DISPLAY_GROUPS; mapped to new atoms to preserve exact access):

- `FeaturesFullAccess` → readData, manageFlags, deleteFlags, manageFlagDrafts, reviewFlags, manageArchetype (note: no publish — matches old)
- `FeaturesBypassApprovals` → above + bypassApprovalFlags + bypassApprovalSavedGroups (preserves old cross-resource bypass)
- `ConfigsFullAccess` / `ConstantsFullAccess` → readData, manageFlags, deleteFlags, manageFlagDrafts, reviewFlags

## Behavior changes to release-note

1. **Merge escalation (by design):** a custom role that granted Configs/Constants access but _not_ Features now also manages Features (they're one family). Per the "configs express through features anyway" decision.
2. **Decouple escalation:** a role with publish but not manage can now publish/toggle (previously blocked by an AND). Aligns with the policy's stated intent.
3. **Decision-B tightening (the one reduction):** env-limited roles become env-limited on config/constant publish too (were project-scoped/unlimited). Correct behavior; chosen handling = accept + release-note (not grandfathering).

## Enforcement surfaces

- **Shared revision engine** (configs, constants, saved groups): add `canManageDrafts / canReview / canPublishRevision / canRevert` to `EntityRevisionAdapter` (default → `canUpdate`); each adapter maps to its atoms; publish/revert receive the revision's changed-env set.
- **Bespoke `features.ts`**: repoint ~30 endpoint gates to specific atoms; decouple the AND-fusions.

## Layer checklist

- [ ] L1 shared constants: atoms, scope arrays, policies (new+deprecated), metadata, display groups, DEFAULT_ROLES
- [ ] L1 JIT policy migration (deprecated → new) on org/role load
- [ ] L2 permissionsClass: repoint + split methods; add review/publish/revert/draft per family; keep existing method names as callable interface
- [ ] L3 custom-role model/API: Role.permissions[], customRoleValidator, resolver union, env-limit applicability, openapi
- [ ] L4 revision adapter hooks + config/constant/saved-group adapters
- [ ] L5 features.ts gate sweep + decouple
- [ ] L6 front-end: usePermissions/usePermissionsUtil methods + RoleForm drill-down grid
- [ ] L7 util tests (matrix/derivation/resolver/JIT) + finalize release notes
