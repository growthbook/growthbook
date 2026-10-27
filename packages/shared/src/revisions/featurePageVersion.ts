import { EventUser, eventUserPersonId } from "../validators/event-user";

// The version a flag page opens on, decided the same way by the server (so the
// first response already includes it) and by the page itself.

const ACTIVE_DRAFT_STATUSES = new Set<string>([
  "draft",
  "approved",
  "changes-requested",
  "pending-review",
]);

export type FeaturePageRevisionSummary = {
  version: number;
  status: string;
  createdBy?: EventUser;
  contributors?: string[];
};

function isOpenUserDraft(revision: FeaturePageRevisionSummary): boolean {
  const createdBy = revision.createdBy;
  // Drafts a ramp schedule makes for itself aren't anyone's work in progress
  if (createdBy?.type === "system" && createdBy.subtype === "ramp-schedule") {
    return false;
  }
  return ACTIVE_DRAFT_STATUSES.has(revision.status);
}

/** An open, non-ramp draft the user made or contributed to. */
export function isUsersOpenDraft(
  revision: FeaturePageRevisionSummary,
  userId: string | null,
): boolean {
  return (
    userId !== null &&
    isOpenUserDraft(revision) &&
    (eventUserPersonId(revision.createdBy ?? null) === userId ||
      (revision.contributors ?? []).includes(userId))
  );
}

/**
 * A requested version that exists, then the viewer's newest open draft (made
 * or contributed to), then live. `revisionList` is newest first.
 */
export function getFeaturePageDefaultVersion({
  revisionList,
  liveVersion,
  requestedVersion,
  userId,
}: {
  revisionList: FeaturePageRevisionSummary[];
  liveVersion: number;
  requestedVersion: number | null;
  userId: string | null;
}): number {
  if (
    requestedVersion !== null &&
    revisionList.some((r) => r.version === requestedVersion)
  ) {
    return requestedVersion;
  }
  const ownDraft = revisionList.find((r) => isUsersOpenDraft(r, userId));
  return ownDraft?.version ?? liveVersion;
}
