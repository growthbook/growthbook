import { Permission } from "shared/types/organization";

/**
 * Single source of truth for the per-action permission atoms of revisioned
 * "flag-like" entities. To add one: define its atoms in the scope arrays in
 * permissions.constants.ts, add its row below, and gate with
 * `context.permissions.canRevisionAction(model, action, obj, envs)`.
 *
 * Atoms are per entity, one per (model, action). Policies are what an
 * organization actually grants, and they bundle the three flag entities
 * together — so the granularity here is what the checks need, not what an admin
 * has to reason about.
 *
 * There is deliberately no "edit"/"manage" verb: an edit is a draft plus a
 * publish.
 */

export type RevisionAction =
  | "create" // bring the entity into existence (no revision to draft against yet)
  | "delete" // delete, and archive — both take it out of service
  | "draft" // author a revision: create / edit / discard / rebase / request review
  | "review" // approve / request changes
  | "publish" // write live state: publish a revision, land a direct write, toggle
  | "revert" // restore a previously-published revision
  | "bypass"; // publish without the required review, force-merge a stale base

export type RevisionModel = "feature" | "config" | "constant" | "saved-group";

export interface ActionPermission {
  permission: Permission;
  scope: "project" | "environment";
}

// Which actions touch live state, and so take an environment footprint. Shared
// by the three flag entities; saved groups declare no environments at all.
const FLAG_SCOPES: Record<RevisionAction, ActionPermission["scope"]> = {
  create: "environment",
  delete: "environment",
  publish: "environment",
  revert: "environment",
  // Drafting touches nothing live. Review is a judgement on the whole proposed
  // change, not on any one environment. Bypass only relaxes the review
  // requirement on a publish that was already env-checked.
  draft: "project",
  review: "project",
  bypass: "project",
};

function flagEntity(
  atoms: Record<RevisionAction, Permission>,
): Record<RevisionAction, ActionPermission> {
  return Object.fromEntries(
    (Object.keys(FLAG_SCOPES) as RevisionAction[]).map((action) => [
      action,
      { permission: atoms[action], scope: FLAG_SCOPES[action] },
    ]),
  ) as Record<RevisionAction, ActionPermission>;
}

export const REVISION_PERMISSIONS: Record<
  RevisionModel,
  Record<RevisionAction, ActionPermission>
> = {
  feature: flagEntity({
    create: "createFeatures",
    delete: "deleteFeatures",
    draft: "editFeatureDrafts",
    review: "reviewFeatures",
    publish: "publishFeatures",
    revert: "revertFeatures",
    bypass: "bypassApprovalFeatures",
  }),
  config: flagEntity({
    create: "createConfigs",
    delete: "deleteConfigs",
    draft: "editConfigDrafts",
    review: "reviewConfigs",
    publish: "publishConfigs",
    revert: "revertConfigs",
    bypass: "bypassApprovalConfigs",
  }),
  constant: flagEntity({
    create: "createConstants",
    delete: "deleteConstants",
    draft: "editConstantDrafts",
    review: "reviewConstants",
    publish: "publishConstants",
    revert: "revertConstants",
    bypass: "bypassApprovalConstants",
  }),
  // Saved groups declare no environments, so every action is project-scoped and
  // the footprint argument is ignored. Call sites still pass one so they read
  // identically to the flag entities.
  "saved-group": {
    create: { permission: "createSavedGroups", scope: "project" },
    delete: { permission: "deleteSavedGroups", scope: "project" },
    draft: { permission: "editSavedGroupDrafts", scope: "project" },
    review: { permission: "reviewSavedGroups", scope: "project" },
    publish: { permission: "publishSavedGroups", scope: "project" },
    revert: { permission: "revertSavedGroups", scope: "project" },
    bypass: { permission: "bypassApprovalSavedGroups", scope: "project" },
  },
};

/** Every entity that shares the Feature Flag policy vocabulary. */
export const FLAG_MODELS = ["feature", "config", "constant"] as const;

/** The bypass-approval atom for an entity, named as data (gate metadata). */
export function bypassApprovalPermission(model: RevisionModel): Permission {
  return REVISION_PERMISSIONS[model].bypass.permission;
}

/** Is this atom one of the per-entity bypass-approval atoms? */
export function isBypassApprovalPermission(permission: string): boolean {
  return Object.values(REVISION_PERMISSIONS).some(
    (entity) => entity.bypass.permission === permission,
  );
}

/**
 * The footprint for a change with NO intrinsic environment binding — a base
 * Config, a Constant's base value, any Saved Group. Their reach is
 * consumer-derived and can't be computed in a permission check, so only the
 * project is checked.
 *
 * Named rather than a bare `[]` because an empty footprint SKIPS the
 * environment check: passing one by accident widens access for env-limited
 * roles.
 */
export const NO_ENVIRONMENT_BINDING: string[] = [];
