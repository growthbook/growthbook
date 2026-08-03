import { RevisionTargetType } from "shared/validators";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type PermissionsUtil = ReturnType<typeof usePermissionsUtil>;

type ProjectScoped = { project?: string; projects?: string[] };

/**
 * Whether the viewer may comment on a revision, mirroring the server's
 * `canCommentOnRevision`: commenting is participation, so the addComments atom
 * allows it, and so does draft or review authority.
 *
 * Decided on the REVISION's snapshot rather than the live entity — a comment
 * belongs to the revision, whose project may predate a move, and the server
 * authorizes it the same way. Falls back to the live entity when no revision is
 * selected.
 */
export function canCommentOnRevisionEntity(
  permissionsUtil: PermissionsUtil,
  type: RevisionTargetType,
  revision: { target?: { snapshot?: unknown } } | null | undefined,
  liveEntity: ProjectScoped,
): boolean {
  const basis =
    (revision?.target?.snapshot as ProjectScoped | undefined) ?? liveEntity;
  const projects = basis.projects ?? (basis.project ? [basis.project] : []);
  return (
    permissionsUtil.canAddComment(projects) ||
    permissionsUtil.canRevisionAction(type, "draft", basis) ||
    permissionsUtil.canRevisionAction(type, "review", basis)
  );
}
