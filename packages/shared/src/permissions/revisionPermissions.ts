import { Permission } from "shared/types/organization";

/**
 * Single source of truth for the per-action permission atoms of revisioned
 * "flag-like" entities. To give a new entity finer-grained permissions: add its
 * atoms to the scope arrays in permissions.constants.ts, map its model to a
 * family in MODEL_FAMILY, and gate its checks with
 * `context.permissions.canRevisionAction(model, action, obj, envs?)`.
 */

export type RevisionAction =
  | "manage" // create + edit the object
  | "delete"
  | "draft" // author a revision: create / edit / discard / rebase / request review
  | "review" // approve / request changes
  | "publish" // publish a revision to the live entity
  | "revert"; // restore a previously-published revision

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
  },
  savedGroups: {
    manage: { permission: "manageSavedGroups", scope: "project" },
    delete: { permission: "deleteSavedGroups", scope: "project" },
    draft: { permission: "manageSavedGroupDrafts", scope: "project" },
    review: { permission: "reviewSavedGroups", scope: "project" },
    // No environment concept, so publish/revert are project-scoped.
    publish: { permission: "publishSavedGroups", scope: "project" },
    revert: { permission: "revertSavedGroups", scope: "project" },
  },
};
