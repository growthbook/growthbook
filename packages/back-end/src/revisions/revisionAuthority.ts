import isEqual from "lodash/isEqual";
import { Revision } from "shared/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { isPureArchiveRevision } from "back-end/src/revisions/archiveTransition";
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

  // !!userId: API-key contexts have userId "" (bootstrap revisions can too),
  // so a bare equality calls unrelated API keys "the author".
  if (
    !!context.userId &&
    revision.authorId === context.userId &&
    (hasRevert || hasDelete)
  ) {
    return true;
  }

  if (
    hasDelete &&
    isPureArchiveRevision({
      proposedChanges: revision.target.proposedChanges,
      current: !!(snapshot as { archived?: boolean }).archived,
    })
  ) {
    return true;
  }

  if (!hasRevert) return false;
  return isPureRevertRevision(context, revision);
}

/**
 * Whether rebasing would pull nothing into the draft — the live state has not
 * moved from the snapshot the draft was built on, so the rebase only re-anchors
 * the base version.
 *
 * Asked of base-vs-live directly, not of the merge result: `checkMergeConflicts`
 * only examines fields the DRAFT proposes, so a field the live state changed and
 * the draft never touches produces no conflict and no `fieldsChanged` entry — yet
 * a rebase adopts it. That field is exactly what a narrow atom must not sweep in.
 */
export function rebasePullsInNothing({
  baseSnapshot,
  liveSnapshot,
  updatableFields,
}: {
  baseSnapshot: Record<string, unknown>;
  liveSnapshot: Record<string, unknown>;
  updatableFields: ReadonlySet<string>;
}): boolean {
  // Snapshots drop nullish keys, so absent and null have to read as the same.
  const same = (a: unknown, b: unknown) =>
    (a ?? null) === null ? (b ?? null) === null : isEqual(a, b);
  return [...updatableFields].every((field) =>
    same(baseSnapshot[field], liveSnapshot[field]),
  );
}

/**
 * Who may rebase a draft. Draft authority covers any rebase; a narrow atom
 * covers one that pulls in nothing, over a draft the atom could already advance.
 * That lets a single-purpose role satisfy "rebase before publishing" without
 * gaining a way to sweep someone else's changes in. The generic twin of
 * `canRebaseFeatureDraft`.
 */
export async function canRebaseRevision({
  context,
  revision,
  baseSnapshot,
  liveSnapshot,
  updatableFields,
}: {
  context: Context;
  revision: Revision;
  baseSnapshot: Record<string, unknown>;
  liveSnapshot: Record<string, unknown>;
  updatableFields: ReadonlySet<string>;
}): Promise<boolean> {
  if (
    canDoRevisionAction(revision.target.type, "draft", context, liveSnapshot)
  ) {
    return true;
  }
  if (!rebasePullsInNothing({ baseSnapshot, liveSnapshot, updatableFields })) {
    return false;
  }
  return canAdvanceRevision(context, revision);
}
