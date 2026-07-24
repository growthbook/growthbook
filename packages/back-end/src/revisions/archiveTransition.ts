import { normalizeProposedChanges } from "shared/enterprise";

/**
 * Archiving is delete-class: it takes the entity out of service, and being
 * archived is what lets it then be deleted freely. Unarchiving only puts it back
 * into service, so it stays an ordinary publish.
 *
 * These are the pure predicates behind that rule, shared by every path that can
 * land the transition (feature publish, bulk publish, the revision engine).
 */

/** True only for the false -> true transition. */
export function isArchiveTransition({
  proposed,
  current,
}: {
  proposed: boolean | undefined;
  current: boolean | undefined;
}): boolean {
  return proposed === true && !current;
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
