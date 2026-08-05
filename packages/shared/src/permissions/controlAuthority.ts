// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import { proposedProjectScope } from "../util/featureDraftPurity";
import { holdsMoveDestination } from "./moveAuthority";
import { NO_ENVIRONMENT_BINDING } from "./revisionPermissions";
import type { RevisionAction, RevisionModel } from "./revisionPermissions";
import type { Permissions } from "./permissionsClass";

// What a control may OFFER: the client-side prediction of the authority decision
// an endpoint is about to make. Every such decision lives here, as a pure function
// with tests.
//
// Inline predictions drift. Most front-end findings in the granular-permissions
// work were a page re-deriving a rule the server already owned and getting a scope
// wrong — asking about the source project of a move, the live entity instead of the
// selected revision, an environment footprint for an action that publishes nothing,
// or the wrong verb at a move's destination.
//
// It lives in `shared` rather than the front end for one reason: the parity test
// (permission-prediction-parity) can then evaluate these against the same oracle
// the endpoint matrix holds the endpoints to, so a control and its endpoint cannot
// disagree without CI failing.

type PermissionsUtil = Pick<
  Permissions,
  | "canAddComment"
  | "canRevisionAction"
  | "canCreateFeature"
  | "canPublishFeature"
>;

type ProjectScoped = { project?: string; projects?: string[] };

// Whether the viewer may comment on a revision, mirroring the server's
// `canCommentOnRevision`: commenting is participation, so the addComments atom
// allows it, and so does draft or review authority.
//
// Decided on the REVISION's snapshot rather than the live entity — a comment
// belongs to the revision, whose project may predate a move, and the server
// authorizes it the same way. Falls back to the live entity when no revision is
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

// Whether the viewer may LAND the selected revision.
//
// The live entity's own project answers the wrong question when the revision
// relocates the entity: landing it is a write to the destination, so authority
// there is required too. Asking only about the source offered a Publish button
// the endpoint then refused.
//
// Runs the same `holdsMoveDestination` the server does, so the button and the
// endpoint cannot disagree.
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

// Whether the viewer holds the DESTINATION of a revision that relocates the
// entity, for one verb. Vacuously true when the revision doesn't move it, so it
// is safe to AND into any landing decision.
//
// Split out from `canPublishRevisionEntity` because the narrow-atom fallbacks
// need it separately: a reverter or a deleter may land a draft the publish atom
// doesn't cover, but neither exemption extends across a move — there is no
// revision in the destination to judge purity against, which is exactly the rule
// the server applies.
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

// Whether the viewer may LAND a revert to a specific target revision.
//
// Two things vary by target and so cannot be answered once per page: the
// environment footprint (only the environments the restore actually changes) and
// the destination (restoring an older snapshot can move the entity back). Mirrors
// the server's revert authority, which checks the revert atom over the footprint
// and then the destination.
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

// Whether the viewer may land an archive/unarchive toggle.
//
// Archiving takes the entity out of service, so the server treats it as
// delete-class over the environments it serves; unarchiving returns it to service
// and is an ordinary publish. Staging either as a draft is a separate, weaker
// question the caller answers itself.
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

// Whether the viewer may permanently delete the entity.
//
// Only reachable once archived, and at that point it carries no environment
// footprint — an archived entity serves nowhere, which is exactly what the server
// checks. Callers add their own structural preconditions (a Config with
// descendants, for instance).
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

// Whether the viewer holds the DESTINATION of a Feature Flag revision that
// relocates the flag. Feature revisions carry a move as `metadata.project`
// rather than a patch op, and the server requires PUBLISH authority there for
// any landing — the narrow-atom exemptions don't cross a move.
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

// Whether an environment may be switched ON while creating a Feature Flag.
//
// Creating takes the create atom in that environment, and a flag that starts
// enabled reaches the SDK payload immediately — so it takes publish there too,
// which is exactly what the create endpoints check. Asking only about create
// offered toggles the server then refused on submit.
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
