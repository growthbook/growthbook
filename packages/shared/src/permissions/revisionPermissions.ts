import { Permission } from "shared/types/organization";

/**
 * Declarative source of truth for the finer-grained, per-action permission
 * atoms of revisioned "flag-like" entities.
 *
 * ─── HAPPY PATH: giving a new entity finer-grained permissions ───────────────
 * 1. Add the entity's atoms to the scope arrays in permissions.constants.ts
 *    (PROJECT_SCOPED_PERMISSIONS / ENV_SCOPED_PERMISSIONS) so they exist on the
 *    `Permission` union, and expose them through a policy in POLICY_PERMISSION_MAP.
 * 2. Add a `PermissionFamily` entry below (or reuse an existing one — e.g.
 *    features, constants and configs all share the "flags" family), filling in
 *    the atom + scope for each action.
 * 3. Point the entity's checks at `context.permissions.canRevisionAction(family,
 *    action, { projects }, environments?)`. For entities on the shared revision
 *    engine that means the adapter's canManageDrafts/canReview/canPublishRevision/
 *    canRevert hooks; for bespoke entities (features) it means the thin
 *    canX helpers that delegate here.
 *
 * Nothing else needs to change — the generic revision controller, the REST
 * endpoints, and bulk publish all route through `canRevisionAction`.
 */

// The lifecycle actions a revisioned entity gates independently.
export type RevisionAction =
  | "manage" // create + edit the object itself
  | "delete"
  | "draft" // author a revision: create / edit / discard / rebase / request review
  | "review" // approve / request changes on a revision
  | "publish" // publish a revision to the live entity
  | "revert"; // restore a previously-published revision

// A family groups entities that share one permission vocabulary. Features,
// constants and configs are all expressions of the same thing ("flags"); saved
// groups have their own atoms.
export type PermissionFamily = "flags" | "savedGroups";

export interface ActionPermission {
  permission: Permission;
  // project-scoped atoms ignore environments; environment-scoped atoms gate on
  // the specific environments a change touches.
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
    // Saved groups have no environment concept, so publish/revert are project-scoped.
    publish: { permission: "publishSavedGroups", scope: "project" },
    revert: { permission: "revertSavedGroups", scope: "project" },
  },
};

export function getActionPermission(
  family: PermissionFamily,
  action: RevisionAction,
): ActionPermission {
  return REVISION_PERMISSIONS[family][action];
}
