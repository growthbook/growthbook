import isEqual from "lodash/isEqual";
import { Revision } from "shared/enterprise";
import {
  canAdvanceDraftWithNarrowAtom,
  canDiscardOrRecallDraft,
  canRebaseWithNarrowAtom,
} from "back-end/src/revisions/landAuthority";
import { Context } from "back-end/src/models/BaseModel";
import { isPureArchiveRevision } from "back-end/src/revisions/archiveTransition";
import { isPureRevertRevision } from "back-end/src/revisions/revertPurity";
import {
  canDoRevisionAction,
  canRevisionOwnedAction,
} from "back-end/src/revisions/revisionActions";
import { getAdapter } from "back-end/src/revisions";

// Identityless API keys cannot claim authorship of authorless revisions.
export function isRevisionAuthor(
  authorId: string | undefined,
  userId: string | undefined,
): boolean {
  return !!userId && !!authorId && authorId === userId;
}

// Author separation must treat two identityless principals as potentially equal.
export function mayBeRevisionAuthor(
  authorId: string | undefined,
  userId: string | undefined,
): boolean {
  if (isRevisionAuthor(authorId, userId)) return true;
  return !userId && !authorId;
}

// Recheck authority against every row read by a CAS retry.
export function draftAuthorityOnRow(
  context: Context,
): (existing: Revision) => void {
  return (existing) => {
    if (isRevisionAuthor(existing.authorId, context.userId)) return;
    if (!canRevisionOwnedAction(context, existing, "draft")) {
      context.permissions.throwPermissionError();
    }
  };
}

export function reviewAuthorityOnRow(
  context: Context,
): (existing: Revision) => void {
  return (existing) => {
    if (!canRevisionOwnedAction(context, existing, "review")) {
      context.permissions.throwPermissionError();
    }
  };
}

// Discarding another user's work requires draft authority, not a narrow landing atom.
export async function canDiscardRevision(
  context: Context,
  revision: Revision,
): Promise<boolean> {
  return canDiscardOrRecallDraft({
    holdsDraftAuthority: canRevisionOwnedAction(context, revision, "draft"),
    isAuthor:
      !!context.userId && isRevisionAuthor(revision.authorId, context.userId),
  });
}

// Narrow atoms may advance only drafts that contain their corresponding pure action.
export async function canAdvanceRevision(
  context: Context,
  revision: Revision,
): Promise<boolean> {
  const type = revision.target.type;
  const snapshot = revision.target.snapshot as Record<string, unknown>;

  // Revert and entity-delete LAND on the entity, so they keep an explicit scope.
  const hasRevert = canDoRevisionAction(type, "revert", context, snapshot);
  const hasDelete =
    getAdapter(type).canDeleteEntity?.(context, snapshot) ?? false;

  return canAdvanceDraftWithNarrowAtom({
    holdsDraftAuthority: canRevisionOwnedAction(context, revision, "draft"),
    isAuthor:
      !!context.userId && isRevisionAuthor(revision.authorId, context.userId),
    holdsAnyLandingAtom: hasRevert || hasDelete,
    matchesNarrowAtom: async () => {
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
    },
  });
}

// Compare base to live directly; merge conflicts omit untouched fields a rebase adopts.
export function liveMatchesRevisionBase({
  baseSnapshot,
  liveSnapshot,
  updatableFields,
}: {
  baseSnapshot: Record<string, unknown>;
  liveSnapshot: Record<string, unknown>;
  updatableFields: ReadonlySet<string>;
}): boolean {
  const same = (a: unknown, b: unknown) =>
    (a ?? null) === null ? (b ?? null) === null : isEqual(a, b);
  return [...updatableFields].every((field) =>
    same(baseSnapshot[field], liveSnapshot[field]),
  );
}

// Narrow atoms may rebase only when doing so adopts no live changes.
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
    // Deliberately on LIVE, not the snapshot: rebasing adopts live's changes, so
    // the question is whether the caller may manage a draft over what they are
    // about to pull in. The one revision-owned verb with a live basis.
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
