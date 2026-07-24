import { isEqual } from "lodash";
import { Revision, normalizeProposedChanges } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";

/**
 * Whether a revision restores a previously-published state and nothing else —
 * the narrower write that revert authority covers. Only consulted on the revert
 * fallback, never for callers who can already publish.
 *
 * Compared against the target revision, not live: live may have drifted since
 * the revert was drafted, and restoring a drifted field is the point.
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
 * Default-deny: empty change sets, non-value ops, nested paths, and differing
 * values are all "not a pure restoration".
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
