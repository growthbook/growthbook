import {
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { pendingDraftApproved } from "shared/util";

/** Which of a flag's drafts its row shows and saves to. */
export type DraftPick = {
  newestVersion: number | null;
  target: number | "new";
};

/** Draft picks per Feature Flag, shared by the rows and the readouts above them. */
export interface FlagDraftPicks {
  value: Record<string, DraftPick>;
  set: (featureId: string, pick: DraftPick) => void;
}

// Only worth it when the newest draft holds changes that can't publish with
// the experiment, and the rule is live for a new draft to start from.
export function canStartSeparateDraft(info: LinkedFeatureInfo): boolean {
  return (
    !!info.liveHasMatchingRule && !!info.pendingDraft?.hasUnrelatedDraftChanges
  );
}

/** A flag's open drafts, newest first. */
export function flagDrafts(
  info: Pick<LinkedFeatureInfo, "pendingDraft" | "otherPendingDrafts">,
): LinkedFeaturePendingDraft[] {
  return info.pendingDraft
    ? [info.pendingDraft, ...(info.otherPendingDrafts ?? [])]
    : [];
}

// A picked draft holds while it's open; "New draft" holds until a newer draft
// appears or starting one stops making sense.
export function resolveDraftPick(
  info: LinkedFeatureInfo,
  pick: DraftPick | undefined,
  // Values staged for a new draft keep it until they're saved or discarded.
  holdsNew = false,
) {
  const drafts = flagDrafts(info);
  const picked = pick?.target;
  const startsNew =
    holdsNew ||
    (picked === "new" &&
      pick?.newestVersion === (drafts[0]?.version ?? null) &&
      canStartSeparateDraft(info));
  const draft =
    (typeof picked === "number"
      ? drafts.find((d) => d.version === picked)
      : undefined) ?? drafts[0];
  return {
    drafts,
    // Kept when starting a new one, so the menu still offers the drafts.
    draft,
    target: startsNew || !draft ? ("new" as const) : ("draft" as const),
    // Only the newest draft that changes the rule publishes at start.
    launches: !draft || draft.version === drafts[0]?.version,
  };
}

/** One of a flag's revisions, on its page. */
export const revisionHref = (featureId: string, version: number) =>
  `/features/${featureId}?v=${version}`;

/** Where a flag's draft is reviewed and published. */
export const draftReviewHref = (featureId: string, version: number) =>
  `${revisionHref(featureId, version)}#review`;

export type DraftReviewState =
  | "changes-requested"
  | "approved"
  | "ready"
  | "needs-approval"
  | "in-review";

// An approval short of a team or an environment is still in review.
export function draftReviewState(
  draft: LinkedFeaturePendingDraft,
): DraftReviewState {
  if (draft.status === "changes-requested") return "changes-requested";
  if (draft.status === "pending-review") return "in-review";
  if (!draft.pendingApproval || pendingDraftApproved(draft)) {
    return draft.status === "approved" ? "approved" : "ready";
  }
  return draft.status === "approved" ? "in-review" : "needs-approval";
}

const NEXT_STEPS: Record<DraftReviewState, string> = {
  "changes-requested": "View feedback",
  approved: "Publish",
  ready: "Publish",
  "needs-approval": "Request review",
  "in-review": "Review",
};

/** What to do next with a draft, on its review section. */
export const draftNextStep = (draft: LinkedFeaturePendingDraft) =>
  NEXT_STEPS[draftReviewState(draft)];
