import { Context } from "back-end/src/models/BaseModel";

// Landing authority for every revisioned entity: archiving is delete-class
// wherever it lands, publish covers anything, and a narrow atom covers a change
// that does only what that atom covers. Approval is a separate gate.
//
// Callers inject the footprint and the purity proofs, which is all that differs
// between JSON-patch revisions and feature revisions.
export async function assertCanLandRevision({
  context,
  /** Entity-level authority for a verb, already scoped to the change's footprint. */
  holds,
  /** True when the change takes the entity out of service. */
  archives,
  /** Proof the change only restores a previously published state. */
  isPureRevert,
  /** Proof the change only archives, and nothing else. */
  isPureArchive,
}: {
  context: Context;
  holds: (action: "publish" | "revert" | "delete") => boolean;
  archives: boolean;
  isPureRevert: () => Promise<boolean>;
  isPureArchive: () => boolean;
}): Promise<void> {
  // Archiving is delete-class wherever the transition lands, not only via an
  // archive endpoint. Unarchiving returns the entity to service and is an
  // ordinary publish.
  if (archives && !holds("delete")) {
    context.permissions.throwPermissionError();
  }

  if (holds("publish")) return;

  if (holds("revert") && (await isPureRevert())) return;

  // Staging an archive as a draft must not require an atom that landing it in one
  // step doesn't: archiving is delete-class, so the delete atom alone lands a
  // revision that archives and changes nothing else.
  if (holds("delete") && isPureArchive()) return;

  context.permissions.throwPermissionError();
}

// Rebase authority. Draft authority covers any rebase; without it, a narrow atom
// covers only a rebase that pulls NOTHING new in, so a single-purpose role can
// satisfy "rebase before publishing" without gaining a way to sweep other people's
// changes in. Callers prove "pulls in nothing" their own way.
export async function canRebaseWithNarrowAtom({
  holdsDraftAuthority,
  pullsInNothing,
  canAdvance,
}: {
  holdsDraftAuthority: boolean;
  pullsInNothing: boolean;
  canAdvance: () => Promise<boolean>;
}): Promise<boolean> {
  if (holdsDraftAuthority) return true;
  if (!pullsInNothing) return false;
  return canAdvance();
}

/** Narrow landing authority cannot discard or recall another author's draft. */
export function canDiscardOrRecallDraft({
  holdsDraftAuthority,
  isAuthor,
}: {
  holdsDraftAuthority: boolean;
  isAuthor: boolean;
}): boolean {
  return holdsDraftAuthority || isAuthor;
}

/**
 * Advancing a draft: submitting it for review, editing it, moving it along.
 *
 * Draft authority covers any draft. Without it, an author may advance their own
 * work when they hold ANY landing atom for it, and a non-author may advance a draft
 * that does only what their atom covers. Both engines, one rule.
 */
export async function canAdvanceDraftWithNarrowAtom({
  holdsDraftAuthority,
  isAuthor,
  holdsAnyLandingAtom,
  matchesNarrowAtom,
}: {
  holdsDraftAuthority: boolean;
  isAuthor: boolean;
  holdsAnyLandingAtom: boolean;
  matchesNarrowAtom: () => Promise<boolean>;
}): Promise<boolean> {
  if (holdsDraftAuthority) return true;
  if (isAuthor && holdsAnyLandingAtom) return true;
  return matchesNarrowAtom();
}

// Callers must stage the archive flip ALONE — the delete atom is weaker than the
// draft atom, so any other change riding along would be staged on authority that
// doesn't cover it. The archive endpoints take only `archived` from the body.
//
// Defined in `shared` so the archive CONTROLS ask exactly what these
// endpoints enforce.
export {
  canStageArchiveDraft,
  canWriteArchiveIntoDraft,
} from "shared/permissions";
