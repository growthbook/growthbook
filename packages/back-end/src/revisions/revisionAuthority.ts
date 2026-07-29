import { Revision } from "shared/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import {
  isArchiveTransition,
  proposedArchivedValue,
} from "back-end/src/revisions/archiveTransition";
import { isPureRevertRevision } from "back-end/src/revisions/revertPurity";
import { canDoRevisionAction } from "back-end/src/revisions/revisionActions";
import { getAdapter } from "back-end/src/revisions";

/**
 * Who may move a generic entity's draft along — request review on it, recall
 * that request, discard it.
 *
 * The entity-agnostic twin of `canAdvanceFeatureDraft`. Draft authority covers
 * every draft; beyond that two narrower atoms get a say so a single-purpose role
 * can finish what it was allowed to start:
 *
 * - revert authority, over a draft that only restores a published revision
 * - delete authority, over a draft that only archives the entity
 *
 * and, whatever the draft contains, over one the caller authored: you can always
 * clean up your own mess.
 *
 * The purity checks read a second revision, so they run only after the cheap
 * atom checks fail.
 */
export async function canAdvanceRevision(
  context: Context,
  revision: Revision,
): Promise<boolean> {
  const type = revision.target.type;
  const snapshot = revision.target.snapshot as Record<string, unknown>;

  if (canDoRevisionAction(type, "draft", context, snapshot)) return true;

  const hasRevert = canDoRevisionAction(type, "revert", context, snapshot);
  // The ENTITY delete atom — the adapter's plain `canDelete` governs discarding
  // revision documents and is bypass-tier, which is the wrong authority here.
  const hasDelete =
    getAdapter(type).canDeleteEntity?.(context, snapshot) ?? false;

  // Guarded against falsy ids: API-key contexts have userId "", and an
  // owner-less entity's bootstrap revision can too, so a bare equality would
  // call two unrelated API keys "the author" of the same draft. Mirrors
  // authoredFeatureDraft.
  if (
    !!context.userId &&
    revision.authorId === context.userId &&
    (hasRevert || hasDelete)
  ) {
    return true;
  }

  // Delete authority reaches a draft that only takes the entity out of service.
  if (
    hasDelete &&
    isArchiveTransition({
      proposed: proposedArchivedValue(revision.target.proposedChanges),
      current: !!(snapshot as { archived?: boolean }).archived,
    })
  ) {
    return true;
  }

  if (!hasRevert) return false;
  return isPureRevertRevision(context, revision);
}
