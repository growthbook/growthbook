import React, { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import LinkButton from "@/components/Button";
import RadioGroup from "@/ui/RadioGroup";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useAuth } from "@/services/auth";

type ReviewDecision = "Comment" | "Requested Changes" | "Approved";

const REVIEW_DECISIONS: ReviewDecision[] = [
  "Comment",
  "Requested Changes",
  "Approved",
];

// Wire-format decisions for the generic revision system
// (POST /revision/:id/review).
export type GenericReviewDecision = "comment" | "request-changes" | "approve";

const GENERIC_DECISIONS: Record<ReviewDecision, GenericReviewDecision> = {
  Comment: "comment",
  "Requested Changes": "request-changes",
  Approved: "approve",
};

type PersistedReviewDraft = { comment: string; decision: ReviewDecision };

// In-progress review drafts persist in sessionStorage (keyed by feature +
// revision) so closing the popover doesn't lose work. Cleared on submit/cancel.
function readReviewDraft(key: string): PersistedReviewDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedReviewDraft>;
    return {
      comment: typeof parsed.comment === "string" ? parsed.comment : "",
      decision:
        parsed.decision && REVIEW_DECISIONS.includes(parsed.decision)
          ? parsed.decision
          : "Comment",
    };
  } catch {
    return null;
  }
}

function clearReviewDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

interface Props {
  // Feature-revision endpoint; posts `{ comment, review }`. Either this or
  // `onSubmit` must be provided.
  submitUrl?: string;
  // Generic submission handler (e.g. the RevisionModel-backed
  // POST /revision/:id/review). Takes precedence over `submitUrl`.
  onSubmit?: (
    decision: GenericReviewDecision,
    comment: string,
  ) => Promise<void>;
  // When true, a "Submit and Publish" option appears when "Approve" is
  // selected. If `autoPublishArmed` is also true the primary CTA becomes
  // "Submit and Publish"; otherwise a secondary outline button appears.
  allowPublishOnApprove?: boolean;
  // Whether the auto-publish checkbox is checked on the revision.
  autoPublishArmed?: boolean;
  // Armed publish is deferred to a date, so approving doesn't publish now — the
  // CTA stays "Submit" instead of "Submit and Publish".
  autoPublishScheduled?: boolean;
  // Whether the current reviewer can publish under their own authority. Gates
  // the non-armed "Submit and Publish" option, which publishes as the reviewer.
  // Irrelevant to armed drafts (those publish under the arming user's authority).
  canReviewerPublish?: boolean;
  // Publishing is currently blocked (merge conflict, required rebase, ramp
  // lockdown, etc.). Suppresses every "Submit and Publish" affordance so a
  // reviewer isn't offered a publish that can't go through.
  publishBlocked?: boolean;
  // When true, publish CTAs use a trailing arrow to signal a follow-on step
  // (e.g. the pre-launch checklist before the final publish).
  publishHasMoreSteps?: boolean;
  trigger: React.ReactNode | ((state: { open: boolean }) => React.ReactNode);
  /** Prevents self-approval when blockSelfApproval is set. */
  isBlockedContributor?: boolean;
  // sessionStorage key for persisting the in-progress draft (comment +
  // decision). When omitted, the draft isn't persisted across popover closes.
  storageKey?: string;
  // Called after a successful submit-review. `publish` is true when the user
  // chose "Submit and Publish" so the parent can proceed with its publish flow.
  onSuccess: (opts?: { publish?: boolean }) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export default function ReviewCommentPopover({
  submitUrl,
  onSubmit,
  allowPublishOnApprove = false,
  autoPublishArmed = false,
  autoPublishScheduled = false,
  canReviewerPublish = false,
  publishBlocked = false,
  publishHasMoreSteps = false,
  trigger,
  isBlockedContributor = false,
  onSuccess,
  side = "bottom",
  align = "end",
  storageKey,
}: Props) {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState<string>(
    () => (storageKey ? readReviewDraft(storageKey)?.comment : "") ?? "",
  );
  const [decision, setDecision] = useState<ReviewDecision>(
    () =>
      (storageKey ? readReviewDraft(storageKey)?.decision : "Comment") ??
      "Comment",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist the in-progress draft as it changes. An empty/default draft is
  // removed so we don't leave stale keys around.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      if (comment.trim().length === 0 && decision === "Comment") {
        window.sessionStorage.removeItem(storageKey);
      } else {
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({ comment, decision }),
        );
      }
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }, [comment, decision, storageKey]);

  // Reset everything and drop the persisted draft (submit / cancel).
  const clearDraft = () => {
    setComment("");
    setDecision("Comment");
    setError(null);
    if (storageKey) clearReviewDraft(storageKey);
  };

  // Verdicts (Approve / Request changes) may stand alone, but a plain
  // "Comment" decision with no text would create an empty log entry.
  const canSubmit = decision !== "Comment" || comment.trim().length > 0;

  const isApproval = decision === "Approved";
  // A future-dated schedule fires later, so approving it isn't an immediate publish.
  const willPublish =
    isApproval &&
    autoPublishArmed &&
    !autoPublishScheduled &&
    allowPublishOnApprove &&
    !publishBlocked;
  // Non-armed publish-on-approve runs under the reviewer's own authority, so
  // only offer it when they can actually publish — otherwise the approval lands
  // but the follow-on publish is rejected by the backend. Also suppressed when
  // publishing is blocked (conflicts, required rebase, etc.).
  const showPublishOption =
    isApproval &&
    !autoPublishArmed &&
    allowPublishOnApprove &&
    canReviewerPublish &&
    !publishBlocked;

  const publishCtaLabel = publishHasMoreSteps
    ? "Submit and Publish →"
    : "Submit and Publish";

  const doSubmit = async (publish: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit(GENERIC_DECISIONS[decision], comment);
      } else if (submitUrl) {
        await apiCall(submitUrl, {
          method: "POST",
          body: JSON.stringify({ comment, review: decision }),
        });
      }
      clearDraft();
      setOpen(false);
      onSuccess({ publish });
    } catch (e) {
      setError((e as Error).message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <Box>
      <Heading as="h5" size="small" mb="3">
        Submit review
      </Heading>

      <MarkdownInput
        value={comment}
        setValue={setComment}
        placeholder="Leave a comment…"
        showButtons={false}
      />

      <Box mt="5">
        <RadioGroup
          value={decision}
          setValue={(val: ReviewDecision) => setDecision(val)}
          options={[
            {
              value: "Comment",
              label: "Comment",
              description: "General feedback, no decision.",
            },
            {
              value: "Requested Changes",
              label: "Request changes",
              description: "Must be addressed before publishing.",
            },
            {
              value: "Approved",
              label: "Approve",
              description: isBlockedContributor
                ? "You contributed to this draft and cannot approve it."
                : "Approve for publishing.",
              disabled: isBlockedContributor,
            },
          ]}
        />
      </Box>

      {error && (
        <HelperText status="error" mt="2">
          {error}
        </HelperText>
      )}

      <Flex gap="2" mt="3" justify="end">
        <LinkButton
          color="link"
          onClick={() => {
            clearDraft();
            setOpen(false);
          }}
        >
          Cancel
        </LinkButton>
        {showPublishOption && (
          <Button
            variant="outline"
            onClick={() => doSubmit(true)}
            loading={loading}
            disabled={!canSubmit}
          >
            {publishCtaLabel}
          </Button>
        )}
        <Button
          onClick={() => doSubmit(willPublish)}
          loading={loading}
          disabled={!canSubmit}
        >
          {willPublish ? publishCtaLabel : "Submit"}
        </Button>
      </Flex>
    </Box>
  );

  const resolvedTrigger =
    typeof trigger === "function" ? trigger({ open }) : trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Closing the popover keeps the in-progress draft (persisted in
        // sessionStorage); only clear the transient error.
        if (!o) setError(null);
        setOpen(o);
      }}
      trigger={resolvedTrigger}
      content={content}
      side={side}
      align={align}
      showArrow={false}
      contentStyle={{ padding: 16, width: 560, maxWidth: "calc(100vw - 32px)" }}
    />
  );
}
