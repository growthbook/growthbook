import { isEqual } from "lodash";
import { Revision, normalizeProposedChanges } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";

/**
 * Whether a revision restores a previously-published state and nothing else.
 *
 * Only consulted when the caller is relying on revert authority instead of
 * publish authority: a pure revert can only put back values that were already
 * live, so it is a strictly narrower write than publishing arbitrary new state.
 * Callers with publish authority never reach this check.
 *
 * The test is on CONTENT, not on a marker the edit paths have to remember to
 * clear — every value the revision proposes must equal the corresponding value
 * in the target revision's published state. That fails closed: any edit (now or
 * from an edit path added later) changes a proposed value, the comparison stops
 * matching, and the revision falls back to needing publish authority.
 *
 * Note this deliberately does NOT compare against the live entity. Live may have
 * drifted since the revert was drafted, and restoring a drifted field is exactly
 * what a revert is for.
 */
export async function isPureRevertRevision(
  context: Context,
  revision: Revision,
): Promise<boolean> {
  if (!revision.revertedFrom) return false;

  const target = await context.models.revisions.getById(revision.revertedFrom);
  if (!target) return false;
  if (target.target.type !== revision.target.type) return false;
  if (target.target.id !== revision.target.id) return false;

  // The state the target revision left behind when it was published.
  const targetState = applyPatchToSnapshot(
    target.target.snapshot as Record<string, unknown>,
    target.target.proposedChanges,
  );

  return proposedChangesOnlyRestore(
    revision.target.proposedChanges,
    targetState,
  );
}

/**
 * Every proposed change must set a field to the value it holds in `targetState`.
 * Default-deny: an empty change set, an op that isn't a plain value set, a
 * non-top-level path, or any value that differs all read as "not a pure
 * restoration".
 */
export function proposedChangesOnlyRestore(
  proposedChanges: unknown,
  targetState: Record<string, unknown>,
): boolean {
  const ops = normalizeProposedChanges(proposedChanges);
  if (!ops.length) return false;

  return ops.every((op) => {
    // Only value-setting ops can be verified against the target state; anything
    // else (move/copy/test, or a malformed path) is not provably a restoration.
    if (op.op !== "replace" && op.op !== "add") return false;
    const field = topLevelField(op.path);
    if (!field) return false;
    return isEqual(op.value, targetState[field]);
  });
}

// Proposed changes are top-level field patches ("/value", "/rules"). Reject
// anything deeper rather than guessing at nested equality.
function topLevelField(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const segments = path.slice(1).split("/");
  if (segments.length !== 1 || !segments[0]) return null;
  return decodeURIComponent(
    segments[0].replace(/~1/g, "/").replace(/~0/g, "~"),
  );
}
