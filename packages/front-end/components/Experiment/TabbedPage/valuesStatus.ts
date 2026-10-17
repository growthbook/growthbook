import type {
  ExperimentInterfaceStringDates,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import type { EventUser } from "shared/types/events/event-types";
import { draftApprovalSatisfied } from "@/components/Reviews/reviewAndPublishState";

type StatusDraft = Pick<
  LinkedFeaturePendingDraft,
  | "status"
  | "pendingApproval"
  | "approval"
  | "hasMergeConflict"
  | "rebaseRequired"
  | "staleApproval"
>;

/** Where the Values flag's draft stands, its trouble with live first. */
export type ValuesDraftStage =
  | "conflict"
  | "stale"
  // No review required.
  | "unreviewed"
  | "unsent"
  | "pending-review"
  | "changes-requested"
  | "short-of-approval"
  | "approved";

export function getValuesDraftStage(draft: StatusDraft): ValuesDraftStage {
  if (draft.hasMergeConflict) return "conflict";
  if (draft.rebaseRequired) return "stale";
  if (!draft.pendingApproval) return "unreviewed";
  if (draft.status === "pending-review") return "pending-review";
  if (draft.status === "changes-requested") return "changes-requested";
  if (draft.status === "approved") {
    return draftApprovalSatisfied(draft) ? "approved" : "short-of-approval";
  }
  return "unsent";
}

/**
 * Whether the Values flag's draft has a review to open: once it's been sent
 * for one, or while it's stuck on live.
 */
export function hasValuesReview(draft: StatusDraft): boolean {
  const stage = getValuesDraftStage(draft);
  return stage !== "unreviewed" && stage !== "unsent";
}

// Who acted on the review, and how long ago, formatted.
export type ReviewEvent = { user: EventUser | null; ago: string };

export type ValuesStatus = {
  // What the banner is tinted as: what's shown, or how the review stands.
  tone: "draft" | "live" | "approved" | "error";
  // One sentence, with its key phrase in bold.
  message: { before: string; strong: string; after: string };
  byline: { verb: string; event: ReviewEvent } | null;
  // Offered beside the message, not as the next step.
  link: "switch-to-unpublished" | "view-feedback" | null;
  // The next step, in the header and the pinned banner.
  cta: {
    label:
      | "Request review"
      | "Review and approve"
      | "Review changes"
      | "View review"
      | "Publish changes";
    // Request and publish happen in place; the rest open the review.
    action: "request" | "publish" | "open";
  } | null;
};

const say = (before: string, strong: string, after = "") => ({
  before,
  strong,
  after,
});

/**
 * What the page says about its unpublished Feature Flag changes, and the
 * viewer's next step with them. Null when there's nothing to say.
 */
export function getValuesStatus({
  experimentStatus,
  viewingLive,
  hasUnpublished,
  managed,
}: {
  experimentStatus: ExperimentInterfaceStringDates["status"];
  viewingLive: boolean;
  // Any linked Feature Flag's draft moves what the page shows.
  hasUnpublished: boolean;
  // The Values flag's draft and this viewer's standing on it.
  managed: {
    draft: StatusDraft;
    canRequestReview: boolean;
    canPublish: boolean;
    canReview: boolean;
    viewerRequested: boolean;
    requested: ReviewEvent | null;
    verdict: ReviewEvent | null;
  } | null;
}): ValuesStatus | null {
  const launches = experimentStatus === "draft";
  const base = { byline: null, link: null, cta: null };
  const open = (
    label: "Review and approve" | "Review changes" | "View review",
  ) => ({ label, action: "open" }) as const;

  if (!launches && viewingLive) {
    return hasUnpublished
      ? {
          ...base,
          tone: "live",
          message: say("Viewing ", "live", "."),
          link: "switch-to-unpublished",
        }
      : null;
  }

  if (!managed) {
    return !launches && hasUnpublished
      ? {
          ...base,
          tone: "draft",
          message: say(
            "Viewing ",
            "unpublished changes",
            ". Publish them from each Feature Flag.",
          ),
        }
      : null;
  }

  const { draft } = managed;
  const stage = getValuesDraftStage(draft);
  const subject = launches ? "Variation values" : "Unpublished changes";
  if (stage === "conflict") {
    return {
      ...base,
      tone: "error",
      message: say(`${subject} `, "conflict with live"),
      cta: open("Review changes"),
    };
  }
  if (stage === "stale") {
    return {
      ...base,
      tone: "draft",
      message: say(
        "The Feature Flag ",
        draft.staleApproval
          ? "changed after approval"
          : "changed since drafting",
      ),
      cta: open("Review changes"),
    };
  }

  if (stage === "unreviewed") {
    // Before launch they simply go live with the start.
    if (launches || !hasUnpublished) return null;
    return {
      ...base,
      tone: "draft",
      message: say("Viewing ", "unpublished changes"),
      cta: managed.canPublish
        ? { label: "Publish changes", action: "publish" }
        : null,
    };
  }

  if (stage === "pending-review") {
    return {
      ...base,
      tone: "draft",
      message: say(`${subject} `, "awaiting review"),
      byline: managed.requested
        ? { verb: "Requested by", event: managed.requested }
        : null,
      cta:
        managed.canReview && !managed.viewerRequested
          ? open("Review and approve")
          : open("View review"),
    };
  }
  if (stage === "changes-requested") {
    const canResend = managed.canRequestReview;
    return {
      ...base,
      tone: "draft",
      message: say("", "Changes requested"),
      byline: managed.verdict ? { verb: "By", event: managed.verdict } : null,
      link: canResend ? "view-feedback" : null,
      cta: canResend
        ? { label: "Request review", action: "request" }
        : open("View review"),
    };
  }
  if (stage === "short-of-approval" || stage === "approved") {
    const byline = managed.verdict
      ? { verb: "Approved by", event: managed.verdict }
      : null;
    if (stage === "short-of-approval") {
      return {
        ...base,
        tone: "draft",
        message: say("", "More approvals needed"),
        byline,
        cta: open("View review"),
      };
    }
    return {
      ...base,
      tone: "approved",
      message: say(`${subject} `, "approved"),
      byline,
      // Before launch the start publishes them.
      cta:
        !launches && managed.canPublish
          ? { label: "Publish changes", action: "publish" }
          : open("View review"),
    };
  }

  // Not yet sent.
  if (!launches && !hasUnpublished) return null;
  return {
    ...base,
    tone: "draft",
    message: say(`${subject} `, "need approval"),
    cta: managed.canRequestReview
      ? { label: "Request review", action: "request" }
      : null,
  };
}
