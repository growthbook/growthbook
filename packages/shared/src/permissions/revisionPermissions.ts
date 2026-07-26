import { Permission } from "shared/types/organization";

/**
 * Single source of truth for the per-action permission atoms of revisioned
 * "flag-like" entities. To add one: define its atoms in the scope arrays in
 * permissions.constants.ts, map its model to a family in MODEL_FAMILY, and gate
 * with `context.permissions.canRevisionAction(model, action, obj, envs)`.
 *
 * There is deliberately no "edit"/"manage" verb. Every content change is
 * authored as a revision and then landed, so an edit is a draft plus a publish.
 * What remains are the actions an org actually governs separately.
 */

export type RevisionAction =
  | "create" // bring the entity into existence (no revision to draft against yet)
  | "delete" // delete, and archive — both take it out of service
  | "draft" // author a revision: create / edit / discard / rebase / request review
  | "review" // approve / request changes
  | "publish" // write live state: publish a revision, land a direct write, toggle
  | "revert" // restore a previously-published revision
  | "bypass"; // publish without the required review, force-merge a stale base

// Entities sharing one permission vocabulary. Features, constants and configs
// are all "flags"; saved groups have their own atoms.
export type PermissionFamily = "flags" | "savedGroups";

// The models callers name at the check site; each maps to a family.
export type RevisionModel = "feature" | "config" | "constant" | "saved-group";

export const MODEL_FAMILY: Record<RevisionModel, PermissionFamily> = {
  feature: "flags",
  config: "flags",
  constant: "flags",
  "saved-group": "savedGroups",
};

export interface ActionPermission {
  permission: Permission;
  scope: "project" | "environment";
}

export const REVISION_PERMISSIONS: Record<
  PermissionFamily,
  Record<RevisionAction, ActionPermission>
> = {
  // Everything that touches live state is env-scoped; the caller supplies the
  // footprint. Drafting touches nothing live, and bypass only relaxes the review
  // requirement on a publish that was already env-checked (and covers
  // entity-level acts like unlocking a Config, which have no env at all).
  flags: {
    create: { permission: "createFlags", scope: "environment" },
    delete: { permission: "deleteFlags", scope: "environment" },
    draft: { permission: "manageFlagDrafts", scope: "project" },
    review: { permission: "reviewFlags", scope: "environment" },
    publish: { permission: "publishFlags", scope: "environment" },
    revert: { permission: "revertFlags", scope: "environment" },
    bypass: { permission: "bypassApprovalFlags", scope: "project" },
  },
  // Saved groups declare no environments anywhere in their schema — their reach
  // is entirely consumer-derived — so every action is project-scoped and the
  // footprint argument is ignored. Call sites still pass one, so they read
  // identically to the flags family.
  savedGroups: {
    create: { permission: "createSavedGroups", scope: "project" },
    delete: { permission: "deleteSavedGroups", scope: "project" },
    draft: { permission: "manageSavedGroupDrafts", scope: "project" },
    review: { permission: "reviewSavedGroups", scope: "project" },
    publish: { permission: "publishSavedGroups", scope: "project" },
    revert: { permission: "revertSavedGroups", scope: "project" },
    bypass: { permission: "bypassApprovalSavedGroups", scope: "project" },
  },
};

/**
 * The bypass-approval atom for an entity's family. Use it wherever a permission
 * has to be named as data rather than checked — the gate metadata a blocked
 * publish reports back, for instance.
 */
export function bypassApprovalPermission(model: RevisionModel): Permission {
  return REVISION_PERMISSIONS[MODEL_FAMILY[model]].bypass.permission;
}

/** Is this atom one of the per-family bypass-approval atoms? */
export function isBypassApprovalPermission(permission: string): boolean {
  return Object.values(REVISION_PERMISSIONS).some(
    (family) => family.bypass.permission === permission,
  );
}

/**
 * The footprint to pass when a change has NO intrinsic environment binding —
 * a base Config, a Constant's base value, any Saved Group. Their reach is
 * consumer-derived (down to individual rules), which can't be computed inside a
 * permission check, so the env limit doesn't apply and the check falls back to
 * project scope.
 *
 * Named rather than a bare `[]` so it reads as a decision: an empty footprint
 * SKIPS the environment check, and passing one by accident silently widens
 * access for env-limited roles.
 */
export const NO_ENVIRONMENT_BINDING: string[] = [];
