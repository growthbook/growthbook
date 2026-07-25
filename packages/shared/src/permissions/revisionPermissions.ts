import { Permission } from "shared/types/organization";

/**
 * Single source of truth for the per-action permission atoms of revisioned
 * "flag-like" entities. To add one: define its atoms in the scope arrays in
 * permissions.constants.ts, map its model to a family in MODEL_FAMILY, and gate
 * with `context.permissions.canRevisionAction(model, action, obj, envs?)`.
 */

export type RevisionAction =
  | "manage" // create + edit the object
  | "delete"
  | "draft" // author a revision: create / edit / discard / rebase / request review
  | "review" // approve / request changes
  | "publish" // publish a revision to the live entity
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
  flags: {
    manage: { permission: "manageFlags", scope: "project" },
    delete: { permission: "deleteFlags", scope: "project" },
    draft: { permission: "manageFlagDrafts", scope: "project" },
    review: { permission: "reviewFlags", scope: "project" },
    publish: { permission: "publishFlags", scope: "environment" },
    revert: { permission: "revertFlags", scope: "environment" },
    // Bypass is project-scoped even though publish/revert are env-scoped: it
    // relaxes the review requirement, which the org configures per project.
    bypass: { permission: "bypassApprovalFlags", scope: "project" },
  },
  savedGroups: {
    manage: { permission: "manageSavedGroups", scope: "project" },
    delete: { permission: "deleteSavedGroups", scope: "project" },
    draft: { permission: "manageSavedGroupDrafts", scope: "project" },
    review: { permission: "reviewSavedGroups", scope: "project" },
    // No environment concept, so publish/revert are project-scoped.
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
