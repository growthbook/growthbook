// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import { proposedProjectScope } from "../util/featureDraftPurity";
import { holdsMoveDestination } from "./moveAuthority";
import { NO_ENVIRONMENT_BINDING } from "./revisionPermissions";
import type { RevisionAction, RevisionModel } from "./revisionPermissions";
import type { Permissions } from "./permissionsClass";

// What a control may OFFER: the client-side prediction of an endpoint's authority
// decision, as pure tested functions. Inline predictions drift — the recurring failure
// is a page asking about the source project of a move, the live entity instead of the
// selected revision, or a footprint for an action that publishes nothing.
//
// In `shared` so `permission-prediction-parity` can hold these to the same oracle the
// endpoint matrix holds the endpoints to.

// NOT here, deliberately: the ramp-schedule footprint rules live in
// `shared/util/features.ts` — `rampTargetFootprint`, `rampTargetRuleIds`,
// `getEnvsForRampTarget`, `getEnvsFromRampSchedule`, `rampControlFootprint`. They are
// not MIRRORS of a server rule; the gate and the control call the same functions, so
// there is no second implementation to drift. Splitting them from each other to satisfy
// this module's naming would separate pieces whose division of responsibility took four
// review rounds to get right, which is the drift risk this module exists to prevent.

type PermissionsUtil = Pick<
  Permissions,
  | "canAddComment"
  | "canRevisionAction"
  | "canCreateFeature"
  | "canPublishFeature"
>;

type ProjectScoped = { project?: string; projects?: string[] };

// Commenting is participation: the addComments atom allows it, and so does draft or
// review authority. Decided on the REVISION's snapshot — a comment belongs to the
// revision, whose project may predate a move — falling back to live when none is
// selected.
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

// Approve or request changes. Snapshot basis like commenting: the server asserts the
// verdict against the row its write is conditioned on, whose project may predate a move.
export function canReviewRevisionEntity(
  permissionsUtil: PermissionsUtil,
  model: RevisionModel,
  revision: { target?: { snapshot?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
): boolean {
  const basis =
    (revision?.target?.snapshot as ProjectScoped | undefined) ?? liveEntity;
  return permissionsUtil.canRevisionAction(model, "review", basis);
}

// Landing a relocating revision is a write to the DESTINATION, so authority there is
// required too — asking only about the source offered a Publish the endpoint refused.
// Runs the server's own `holdsMoveDestination`.
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

// The DESTINATION of a relocating revision, for one verb. Vacuously true when nothing
// moves, so it is safe to AND into any landing decision. Split out because the
// narrow-atom fallbacks need it separately: a reverter or deleter may land a draft the
// publish atom doesn't cover, but neither exemption crosses a move.
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

// Landing a revert to a specific target. Two things vary BY TARGET and so can't be
// answered once per page: the footprint, and the destination (an older snapshot can move
// the entity back).
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

// Archiving is delete-class over the environments the entity serves; unarchiving returns
// it to service and is an ordinary publish. Staging either as a draft is a separate,
// weaker question the caller answers itself.
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

// Permanent delete. Only reachable once archived, and an archived entity serves nowhere,
// so it carries no environment footprint. Callers add structural preconditions of their
// own (a Config with descendants, say).
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

// The destination of a relocating Feature Flag revision. Features carry a move as
// `metadata.project` rather than a patch op, and any landing takes PUBLISH there.
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

// A flag that starts ENABLED reaches the SDK payload immediately, so switching an
// environment on at create time takes publish there as well as create.
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

/**
 * Whether this caller may write an archive flip into an EXISTING draft.
 *
 * The delete atom stages a NEW archive draft, which is fair: it could land the
 * same change in one step. It must not reach into a draft someone else authored —
 * writing `archived` into another author's content draft makes that draft
 * delete-class, and its author (a publisher without delete) can then no longer
 * publish their own work. Authorship or draft authority, the same pairing every
 * other narrow-atom reach uses.
 */
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
  // An identityless caller (org-scoped API key) gets NO authorship credit: it cannot
  // prove which authorless revision is its own, so crediting it with all of them let
  // any such key write `archived` into any other key's draft — making that draft
  // delete-class, and without resetting review, so an approved draft kept approvals
  // that never saw the archive. The cost is that a key must hold the draft atom to
  // archive-write into a draft it created itself, which is the safe direction.
  if (!userId) return false;
  return (
    revision.authorId === userId || !!revision.contributors?.includes(userId)
  );
}
