import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { draftApprovalSatisfied } from "@/components/Reviews/reviewAndPublishState";

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

/**
 * A second draft is only worth starting when the newest also holds changes
 * that can't publish with the experiment; otherwise start would stack both.
 * A new one needs the rule live.
 */
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

/**
 * The drafts a flag's row chooses among, newest first, and the one it's on. A
 * picked draft holds while it's open; "New draft" holds until a newer draft
 * appears, as saving one does, or starting one stops making sense.
 */
export function resolveDraftPick(
  info: LinkedFeatureInfo,
  pick: DraftPick | undefined,
) {
  const drafts = flagDrafts(info);
  const picked = pick?.target;
  const startsNew =
    picked === "new" &&
    pick?.newestVersion === (drafts[0]?.version ?? null) &&
    canStartSeparateDraft(info);
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

/** The flag with the draft its row picked in place of the newest, or none when starting one. */
export function withPickedDraft(
  info: LinkedFeatureInfo,
  pick: DraftPick | undefined,
): LinkedFeatureInfo {
  const { draft, target } = resolveDraftPick(info, pick);
  const pendingDraft = target === "draft" ? draft : undefined;
  return pendingDraft === info.pendingDraft ? info : { ...info, pendingDraft };
}

/**
 * Whether a confirmed start publishes this draft past its approval: the start
 * was scheduled with the bypass, and the draft is the one pinned then,
 * unchanged since.
 */
export function startBypassCovers(
  experiment: Pick<ExperimentInterfaceStringDates, "nextScheduledStatusUpdate">,
  featureId: string,
  draft: Pick<LinkedFeaturePendingDraft, "version" | "dateUpdated">,
): boolean {
  const staged = experiment.nextScheduledStatusUpdate;
  if (staged?.type !== "start" || !staged.bypassApproval) return false;
  const { dateUpdated } = draft;
  if (!dateUpdated) return false;
  return (staged.pinnedDrafts ?? []).some(
    (pin) =>
      pin.featureId === featureId &&
      pin.revisionVersion === draft.version &&
      new Date(pin.dateUpdated).getTime() === new Date(dateUpdated).getTime(),
  );
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

/**
 * Where a draft stands on its way to publishing. One whose flag needs no review
 * is ready, as is one the publish gate already lets through.
 */
export function draftReviewState(
  draft: LinkedFeaturePendingDraft,
): DraftReviewState {
  if (draft.status === "changes-requested") return "changes-requested";
  if (draft.status === "approved") return "approved";
  if (draft.status === "pending-review") return "in-review";
  return !draft.pendingApproval || draftApprovalSatisfied(draft)
    ? "ready"
    : "needs-approval";
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
