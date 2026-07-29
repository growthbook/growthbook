import { normalizeProposedChanges } from "shared/enterprise";
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

// Defined in shared so the client asks the same question; re-exported here
// because every back-end archive path already imports it from this module.
export { isArchiveTransition } from "shared/util";

/**
 * Authority to land an `archived` flip, in whichever direction. The one place
 * the rule above turns into a permission check, so every archive path — REST,
 * entity PUT, revision publish — asks the same question. `environments` is the
 * publish footprint, only consulted for the unarchive direction.
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
    ? permissions.canRevisionAction(model, "delete", entity)
    : permissions.canRevisionAction(model, "publish", entity, environments);
}

/**
 * Authority to land a direct write to the entity document. Publish-class, except
 * where the write is what takes the entity out of service — then it is
 * delete-class, matching what the archive endpoint would allow in one step.
 *
 * Every BaseModel entity's `canUpdate` routes through this, so the model-layer
 * backstop can't be stricter than the handler that already checked.
 *
 * Which is why an ordinary write takes the union of publish and revert: restoring
 * a previously-published revision is its own atom, and from here a revert is
 * indistinguishable from any other write — the same reason `canTouchRevision`
 * unions its four actions. Narrower would refuse writes the caller was already
 * authorized for, and it is the caller (the entity handler, or
 * `assertCanPublishRevision`) that proves a revert only restores a published
 * pre-image before any write reaches this backstop.
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
  existing: { archived?: boolean };
  newDoc: { project?: string; projects?: string[]; archived?: boolean };
  environments?: string[];
}): boolean {
  if (
    isArchiveTransitionPredicate({
      proposed: newDoc.archived,
      current: existing.archived,
    })
  ) {
    return canLandArchivedState({
      permissions,
      model,
      entity: newDoc,
      archived: true,
      environments,
    });
  }

  return (
    canLandArchivedState({
      permissions,
      model,
      entity: newDoc,
      archived: false,
      environments,
    }) || permissions.canRevisionAction(model, "revert", newDoc, environments)
  );
}

/**
 * The `archived` value a JSON-patch change set would land, or undefined when it
 * doesn't touch the field. Later ops win, matching patch application order.
 */
export function proposedArchivedValue(
  proposedChanges: unknown,
): boolean | undefined {
  let value: boolean | undefined;
  for (const op of normalizeProposedChanges(proposedChanges)) {
    if (op.path !== "/archived") continue;
    if (op.op !== "replace" && op.op !== "add") continue;
    if (typeof op.value === "boolean") value = op.value;
  }
  return value;
}
