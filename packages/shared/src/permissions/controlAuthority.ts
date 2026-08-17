// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import { proposedProjectScope } from "../util/featureDraftPurity";
import { holdsMoveDestination } from "./moveAuthority";
import { NO_ENVIRONMENT_BINDING } from "./revisionPermissions";
import type { RevisionAction, RevisionModel } from "./revisionPermissions";
import type { Permissions } from "./permissionsClass";

// Pure client-side predictions of endpoint authority decisions.

type PermissionsUtil = Pick<
  Permissions,
  | "canAddComment"
  | "canRevisionAction"
  | "canCreateFeature"
  | "canPublishFeature"
>;

type ProjectScoped = { project?: string; projects?: string[] };

// Revision-scoped actions use the snapshot, falling back to live when none is selected.
export function canCommentOnRevisionEntity(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  revision: { target?: { snapshot?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
): boolean {
  const basis =
    (revision?.target?.snapshot as ProjectScoped | undefined) ?? liveEntity;
  const projects = basis.projects ?? (basis.project ? [basis.project] : []);
  return (
    permissionsUtil.canAddComment(projects) ||
    permissionsUtil.canRevisionAction(model, "draft", basis) ||
    permissionsUtil.canRevisionAction(model, "review", basis)
  );
}

export function canReviewRevisionEntity(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  revision: { target?: { snapshot?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
  environments: string[] = NO_ENVIRONMENT_BINDING,
): boolean {
  const basis =
    (revision?.target?.snapshot as ProjectScoped | undefined) ?? liveEntity;
  return permissionsUtil.canRevisionAction(
    model,
    "review",
    basis,
    environments,
  );
}

// Landing a move requires authority in both source and destination.
export function canPublishRevisionEntity(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  revision: { target?: { proposedChanges?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
  environments: string[],
): boolean {
  return (
    permissionsUtil.canRevisionAction(
      model,
      "publish",
      liveEntity,
      environments,
    ) &&
    holdsRevisionDestination(
      permissionsUtil,
      model,
      "publish",
      revision,
      liveEntity,
      environments,
    )
  );
}

export function holdsRevisionDestination(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  action: RevisionAction,
  revision: { target?: { proposedChanges?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
  environments: string[],
): boolean {
  return holdsMoveDestination({
    permissions: permissionsUtil,
    model,
    action,
    existing: liveEntity,
    proposed: {
      ...liveEntity,
      ...proposedProjectScope(revision?.target?.proposedChanges),
    },
    environments,
  });
}

// Revert authority depends on the selected target's footprint and destination.
export function canLandRevertToTarget(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  liveEntity: ProjectScoped,
  targetScope: ProjectScoped,
  footprint: string[],
): boolean {
  return (
    permissionsUtil.canRevisionAction(model, "revert", liveEntity, footprint) &&
    holdsMoveDestination({
      permissions: permissionsUtil,
      model,
      action: "revert",
      existing: liveEntity,
      proposed: { ...liveEntity, ...targetScope },
      environments: footprint,
    })
  );
}

// Staging an archive is project-scoped; restoring service requires draft authority.
export function canStageArchiveDraft({
  permissions,
  model,
  entity,
  archived,
}: {
  permissions: PermissionsUtil;
  model: RevisionModel;
  entity: ProjectScoped;
  archived: boolean;
}): boolean {
  return (
    permissions.canRevisionAction(
      model,
      "draft",
      entity,
      NO_ENVIRONMENT_BINDING,
    ) ||
    (archived &&
      permissions.canRevisionAction(
        model,
        "delete",
        entity,
        NO_ENVIRONMENT_BINDING,
      ))
  );
}

// Archiving is delete-class; restoring service is publish-class.
export function canLandArchiveToggle(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  entity: ProjectScoped & { archived?: boolean },
  footprint: string[],
): boolean {
  return entity.archived
    ? permissionsUtil.canRevisionAction(model, "publish", entity, footprint)
    : permissionsUtil.canRevisionAction(model, "delete", entity, footprint);
}

// Archived entities carry no serving-environment footprint.
export function canDeleteArchivedEntity(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  entity: ProjectScoped & { archived?: boolean },
): boolean {
  return (
    !!entity.archived &&
    permissionsUtil.canRevisionAction(
      model,
      "delete",
      entity,
      NO_ENVIRONMENT_BINDING,
    )
  );
}

export function holdsFeatureMoveDestination(
  permissionsUtil: PermissionsUtil,
  feature: { project?: string },
  destination: string | undefined,
  environments: string[],
): boolean {
  if (destination === undefined) return true;
  if ((destination || "") === (feature.project || "")) return true;
  return permissionsUtil.canPublishFeature(
    { project: destination },
    environments,
  );
}

// Enabling an environment at creation reaches the SDK payload immediately.
export function canEnableEnvironmentOnCreate(
  permissionsUtil: PermissionsUtil,
  project: string | undefined,
  environmentId: string,
): boolean {
  const envs = [environmentId];
  return (
    permissionsUtil.canCreateFeature({ project }, envs) &&
    permissionsUtil.canPublishFeature({ project }, envs)
  );
}

// Existing drafts require draft authority or identifiable authorship.
export function canWriteArchiveIntoDraft({
  permissions,
  model,
  entity,
  revision,
  userId,
}: {
  permissions: PermissionsUtil;
  model: RevisionModel;
  entity: { project?: string; projects?: string[] };
  revision: { authorId?: string; contributors?: string[] };
  userId?: string;
}): boolean {
  if (permissions.canRevisionAction(model, "draft", entity, [])) return true;
  // Authorship credit requires an identifiable user.
  if (!userId) return false;
  return (
    revision.authorId === userId || !!revision.contributors?.includes(userId)
  );
}
