import { Permission } from "shared/types/organization";

// Maps each revision entity/action to its permission atom and scope.

export type RevisionAction =
  | "create" // bring the entity into existence (no revision to draft against yet)
  | "delete" // delete, and archive — both take it out of service
  | "draft" // author a revision: create / edit / discard / rebase / request review
  | "review" // approve / request changes
  | "publish" // write live state: publish a revision, land a direct write, toggle
  | "revert" // restore a previously-published revision
  | "bypass"; // publish without the required review, force-merge a stale base

export type RevisionModel =
  | "feature"
  | "config"
  | "constant"
  | "saved-group"
  | "sdk-connection";

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
  review: "environment",
  // Draft and bypass are project-scoped; bypass does not replace publish.
  draft: "project",
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
  // SDK connections have a single edit atom (`manageSDKConnections`) rather
  // than per-action atoms, so every action maps to it — except bypass, which
  // gets its own so that being able to edit a connection is not by itself
  // enough to skip an approval. A connection declares an environment and
  // `manageSDKConnections` is env-scoped, so it takes the flag scoping: the
  // actions that touch live state carry the environment footprint. Declaring
  // them project-scoped would skip the environment check entirely, letting a
  // dev-limited role publish a revision against a production connection.
  // Unlike the flag entities there is no separate draft atom, so drafting also
  // carries the environment footprint — the scope of each entry has to match
  // its atom's own scope, which the REVISION_PERMISSIONS matrix test enforces.
  "sdk-connection": {
    create: { permission: "manageSDKConnections", scope: "environment" },
    delete: { permission: "manageSDKConnections", scope: "environment" },
    draft: { permission: "manageSDKConnections", scope: "environment" },
    review: { permission: "manageSDKConnections", scope: "environment" },
    publish: { permission: "manageSDKConnections", scope: "environment" },
    revert: { permission: "manageSDKConnections", scope: "environment" },
    bypass: { permission: "bypassApprovalSDKConnections", scope: "project" },
  },
};

export function revisionActionPermission(
  model: RevisionModel,
  action: RevisionAction,
): ActionPermission {
  return REVISION_PERMISSIONS[model][action];
}

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

// No intrinsic environment binding; a bare empty list would skip environment checks.
export const NO_ENVIRONMENT_BINDING: string[] = [];
