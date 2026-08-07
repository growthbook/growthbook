import isEqual from "lodash/isEqual";
import { Revision } from "shared/enterprise";
import { canRebaseWithNarrowAtom } from "back-end/src/revisions/landAuthority";
import { Context } from "back-end/src/models/BaseModel";
import { isPureArchiveRevision } from "back-end/src/revisions/archiveTransition";
import { isPureRevertRevision } from "back-end/src/revisions/revertPurity";
import { canDoRevisionAction } from "back-end/src/revisions/revisionActions";
import { getAdapter } from "back-end/src/revisions";

// Whether the caller authored this revision.
//
// Never true without an identifiable user. An API-key context carries userId "",
// and a revision authored by an API key stores authorId "" — so comparing them
// directly made every key the author of every key-authored revision, and
// authorship alone permits discarding and updating a draft.
export function isRevisionAuthor(
  authorId: string | undefined,
  userId: string | undefined,
): boolean {
  return !!userId && !!authorId && authorId === userId;
}

// Whether the caller COULD be the author — the question author separation has to ask.
//
// `isRevisionAuthor` answers the opposite one ("provably the author") and so returns
// false for an identityless caller, which is right where authorship GRANTS something
// and wrong where it withholds. An org-scoped API key has userId "" and authors
// revisions with authorId "": indistinguishable from every other such key, so a key
// holding draft and review could open a revision and approve it, which is the whole
// of author separation.
export function mayBeRevisionAuthor(
  authorId: string | undefined,
  userId: string | undefined,
): boolean {
  if (isRevisionAuthor(authorId, userId)) return true;
  // Neither side identifies anyone: we cannot tell this key from the one that wrote
  // the revision, so we must assume they are the same principal.
  return !userId && !authorId;
}

// The verdict authority re-check every review path hands to `addReview`, so the
// decision is judged against the row the write is conditioned on rather than a
// read a concurrent rebase may have invalidated. A rebase re-snapshots the
// revision, so a move shows up here as a snapshot in a project the reviewer may
// hold nothing in.
export function reviewAuthorityOnRow(
  context: Context,
): (existing: Revision) => void {
  return (existing) => {
    if (
      !canDoRevisionAction(
        existing.target.type,
        "review",
        context,
        existing.target.snapshot as Record<string, unknown>,
      )
    ) {
      context.permissions.throwPermissionError();
    }
  };
}

/**
 * Whether the caller may DISCARD a draft.
 *
 * Narrower than advancing it, deliberately. `canAdvanceRevision` lets a narrow atom
 * act on a draft that only does what that atom covers — a deleter over a pure
 * archive — which is right for moving your own work along, and wrong for destroying
 * someone else's. A qa-style delete-only role could discard another author's archive
 * draft, including one already in review.
 *
 * So: draft authority (the role that manages drafts generally), or authorship. A
 * narrow-atom holder can still publish or decline to publish the draft; they just
 * cannot throw away work that isn't theirs.
 */
export async function canDiscardRevision(
  context: Context,
  revision: Revision,
): Promise<boolean> {
  const type = revision.target.type;
  const snapshot = revision.target.snapshot as Record<string, unknown>;
  if (canDoRevisionAction(type, "draft", context, snapshot)) return true;
  return (
    !!context.userId && isRevisionAuthor(revision.authorId, context.userId)
  );
}

// Who may move a generic entity's draft along — request review on it, recall
// that request, discard it.
//
// Draft authority covers every draft. Beyond that, a narrower atom gets a say so a
// single-purpose role can finish what it was allowed to start: revert over a draft
// that only restores a published revision, delete over one that only archives. The
// author can always advance their own draft.
//
// The purity checks read a second revision, so they run only after the cheap atom
// checks fail.
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
    isRevisionAuthor(revision.authorId, context.userId) &&
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

// Whether the live state still matches the snapshot the draft was built on, so a
// rebase would pull nothing in and only re-anchor the base version.
//
// Deliberately NOT named like `featureDraftAuthority`'s `rebasePullsInNothing`,
// which answers the same question from a MergeResult. The two are not
// interchangeable — see below for why this one cannot use that basis.
//
// Asked of base-vs-live directly, not of the merge result: `checkMergeConflicts`
// only examines fields the DRAFT proposes, so a field the live state changed and
// the draft never touches produces no conflict and no `fieldsChanged` entry — yet
// a rebase adopts it. That field is exactly what a narrow atom must not sweep in.
export function liveMatchesRevisionBase({
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

// Who may rebase a draft. Draft authority covers any rebase; a narrow atom
// covers one that pulls in nothing, over a draft the atom could already advance.
// That lets a single-purpose role satisfy "rebase before publishing" without
// gaining a way to sweep someone else's changes in. The generic twin of
// `canRebaseFeatureDraft`.
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
  return canRebaseWithNarrowAtom({
    holdsDraftAuthority: canDoRevisionAction(
      revision.target.type,
      "draft",
      context,
      liveSnapshot,
    ),
    // Ops-based proof: the draft's base already equals live over every field a
    // revision may write, so rebasing carries nothing across.
    pullsInNothing: liveMatchesRevisionBase({
      baseSnapshot,
      liveSnapshot,
      updatableFields,
    }),
    canAdvance: () => canAdvanceRevision(context, revision),
  });
}
