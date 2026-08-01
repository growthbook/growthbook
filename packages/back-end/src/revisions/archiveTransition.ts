import { isArchiveTransition as isArchiveTransitionPredicate } from "shared/util";
import type { Permissions, RevisionModel } from "shared/permissions";

/**
 * Archiving is delete-class: it takes the entity out of service, and being
 * archived is what lets it then be deleted freely. Unarchiving only puts it back
 * into service, so it stays an ordinary publish.
 *
 * These are the pure predicates behind that rule, shared by every path that can
 * land the transition (feature publish, bulk publish, the revision engine).
 */

// Defined in shared so the client asks the same question.
export {
  isArchiveTransition,
  isPureArchiveRevision,
  proposedArchivedValue,
} from "shared/util";

/**
 * Authority to land an `archived` flip in either direction. `environments` is
 * the publish footprint, consulted only for the unarchive direction.
 */
export function canLandArchivedState({
  permissions,
  model,
  entity,
  archived,
  environments = [],
}: {
  permissions: Pick<Permissions, "canRevisionAction">;
  model: RevisionModel;
  entity: { project?: string; projects?: string[] };
  archived: boolean;
  environments?: string[];
}): boolean {
  return archived
    ? permissions.canRevisionAction(model, "delete", entity, environments)
    : permissions.canRevisionAction(model, "publish", entity, environments);
}

/**
 * Authority to land a direct entity write: publish-class, except an archiving
 * write, which is delete-class. Every BaseModel `canUpdate` routes through this,
 * and a backstop can't be stricter than the handler that already checked — the
 * handler proves what kind of write this is (e.g. a pure revert); from here they
 * are indistinguishable.
 */
export function canLandEntityUpdate({
  permissions,
  model,
  existing,
  newDoc,
  environments = [],
}: {
  permissions: Pick<Permissions, "canRevisionAction">;
  model: RevisionModel;
  existing: { project?: string; projects?: string[]; archived?: boolean };
  newDoc: { project?: string; projects?: string[]; archived?: boolean };
  environments?: string[];
}): boolean {
  const landing = (entity: {
    project?: string;
    projects?: string[];
    archived?: boolean;
  }): boolean => {
    if (
      isArchiveTransitionPredicate({
        proposed: newDoc.archived,
        current: existing.archived,
      })
    ) {
      return canLandArchivedState({
        permissions,
        model,
        entity,
        archived: true,
        environments,
      });
    }

    return (
      canLandArchivedState({
        permissions,
        model,
        entity,
        archived: false,
        environments,
      }) || permissions.canRevisionAction(model, "revert", entity, environments)
    );
  };

  // A move takes authority on BOTH sides. Taking an entity out of a project is a
  // write to that project, so read access there must not be enough to relocate it
  // somewhere the caller can write — that would hand them an object they could
  // not otherwise touch. Same rule the feature controller applies inline.
  if (!sameProjectScope(existing, newDoc) && !landing(existing)) return false;

  return landing(newDoc);
}

function sameProjectScope(
  a: { project?: string; projects?: string[] },
  b: { project?: string; projects?: string[] },
): boolean {
  if ((a.project ?? "") !== (b.project ?? "")) return false;
  const listA = [...(a.projects ?? [])].sort();
  const listB = [...(b.projects ?? [])].sort();
  return listA.length === listB.length && listA.every((p, i) => p === listB[i]);
}
