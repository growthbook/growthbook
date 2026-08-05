import {
  holdsMoveDestination,
  NO_ENVIRONMENT_BINDING,
  RevisionModel,
} from "shared/permissions";
import { proposedProjectScope } from "shared/util";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

// Every front-end decision that mirrors a server authority rule lives here, as a
// pure function with tests.
//
// The rule exists because inline decisions drift: most of the front-end findings
// in the granular-permissions work were a page re-deriving a rule the server
// already owned and getting a scope wrong — asking about the source project of a
// move, the live entity instead of the selected revision, or an environment
// footprint where the action publishes nothing. A control the UI offers and the
// endpoint behind it must not be able to disagree.

type PermissionsUtil = ReturnType<typeof usePermissionsUtil>;

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
  if (
    !permissionsUtil.canRevisionAction(
      model,
      "publish",
      liveEntity,
      environments,
    )
  ) {
    return false;
  }
  return holdsMoveDestination({
    permissions: permissionsUtil,
    model,
    action: "publish",
    existing: liveEntity,
    proposed: {
      ...liveEntity,
      ...proposedProjectScope(revision?.target?.proposedChanges),
    },
    environments,
  });
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
