import type { RevisionAction, RevisionModel } from "shared/permissions";
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
  // archive endpoint. Unarchiving returns the entity to service and is an ordinary
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

// Staging an archive as a draft must not require an atom that landing it in one
// step doesn't: archiving is delete-class, so the delete atom alone stages one.
// Project-scoped, because staging publishes nothing.
//
// Callers must stage the archive flip ALONE — this atom is weaker than the draft
// atom, so any other change riding along would be staged on authority that
// doesn't cover it. The three archive endpoints take only `archived` from the
// body; audited 2026-08-05.
//
// This decides whether the caller may stage an archive AT ALL. Which draft it may
// be written into is a second question — see `canWriteArchiveIntoDraft`.
//
// The delete arm is DIRECTIONAL, matching `canLandArchivedState`: taking an entity out
// of service is delete-class, returning it to service is publish-class. Without the
// direction, a delete-only role could stage an unarchive it has no authority to land.
export function canStageArchiveDraft({
  permissions,
  model,
  entity,
  archived,
}: {
  permissions: {
    canRevisionAction: (
      model: RevisionModel,
      action: RevisionAction,
      obj: { project?: string; projects?: string[] },
      environments?: string[],
    ) => boolean;
  };
  model: RevisionModel;
  entity: { project?: string; projects?: string[] };
  /** The state being staged: `true` archives, `false` returns to service. */
  archived: boolean;
}): boolean {
  if (permissions.canRevisionAction(model, "draft", entity, [])) return true;
  return archived && permissions.canRevisionAction(model, "delete", entity, []);
}

// Lives in `shared` so the archive CONTROLS filter their draft pickers by the same
// rule this endpoint enforces; re-exported here because callers look for it here.
export { canWriteArchiveIntoDraft } from "shared/permissions";
