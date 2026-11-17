import { isOpenUserDraft, isScheduledPublishPending } from "shared/enterprise";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  isActiveDraftStatus,
  MinimalFeatureRevisionInterface,
} from "shared/validators";

export type RevisionStatus =
  | "draft"
  | "scheduled"
  | "discarded"
  // Held by a ramp schedule, which publishes it.
  | "held"
  | "superseded"
  | "liveWithDrafts";

/** What the strip under the tabs says about the viewed revision, if anything. */
export function getRevisionStatus({
  revision,
  liveVersion,
  revisionList,
}: {
  revision: Pick<
    FeatureRevisionInterface,
    "status" | "version" | "autoPublishOnApproval" | "scheduledPublishAt"
  >;
  liveVersion: number;
  revisionList: Pick<MinimalFeatureRevisionInterface, "status" | "createdBy">[];
}): RevisionStatus | null {
  if (isActiveDraftStatus(revision.status)) {
    return isScheduledPublishPending(revision) ? "scheduled" : "draft";
  }
  if (revision.status === "discarded") return "discarded";
  if (revision.status === "pending-parent") return "held";
  if (revision.version !== liveVersion) return "superseded";
  return revisionList.some(isOpenUserDraft) ? "liveWithDrafts" : null;
}
