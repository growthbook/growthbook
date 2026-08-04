import { Context } from "back-end/src/models/BaseModel";

/**
 * Landing authority for a revision, stated once.
 *
 * Feature Flags and the generic entities each had their own copy of this rule —
 * `assertCanPublishFeatureRevision` and `assertCanPublishRevision` — with the same
 * four arms in the same order. The differences were never the rule; they were two
 * inputs, and both are injected here:
 *
 *  - the environment footprint (the generic path derives it from the adapter, the
 *    feature path receives it from a merge result), and
 *  - how a narrow atom PROVES it covers this change (ops-based for JSON-patch
 *    revisions, merge-result-based for feature revisions).
 *
 * The permission atoms underneath were already shared: canPublishFeature,
 * canRevertFeature and canDeleteFeature all delegate to `canRevisionAction`.
 *
 * The rule: archiving is delete-class wherever it lands; otherwise publish
 * authority covers anything, and a narrow atom covers a change that does only what
 * that atom covers — revert for a pure restoration, delete for a pure archive.
 * Approval is a separate gate, enforced by the caller.
 */
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
  // publish, so it falls through to the arms below.
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

/**
 * Rebase authority, stated once.
 *
 * Feature Flags and the generic entities each had their own copy — the same three
 * steps in the same order. Draft authority covers any rebase. Without it, a narrow
 * atom covers only a rebase that pulls NOTHING new into the draft, so a
 * single-purpose role can satisfy "rebase before publishing" without gaining a way
 * to sweep someone else's changes in.
 *
 * As with landing, the difference was one input: how "pulls in nothing" is proven —
 * comparing the base against live over the updatable fields, or inspecting a merge
 * result.
 */
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
