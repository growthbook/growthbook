import { useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import { revisionStatusLabel } from "@/components/Reviews/RevisionStatusBadge";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";

/**
 * The whole review surface for a managed Feature Flag: primary CTA, the
 * reviewers who have weighed in, and nothing else. Deliberately thin — a
 * managed flag has one rule and one draft, so the deferral, scheduling and
 * diff machinery on the full Review & Publish modal has nothing to act on.
 *
 * The CTA itself is decided by `getReviewAndPublishState`, the same pure
 * function the full modal uses, so managed mode can't drift from it.
 */

type Props = {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
};

export default function ManagedFlagApproval({
  experiment,
  info,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = info.draftRevisionVersion;
  const { data } = useApi<{ revisions: FeatureRevisionInterface[] }>(
    `/feature/${info.feature.id}`,
    { shouldRun: () => open && version != null },
  );
  const revision = useMemo(
    () => data?.revisions?.find((r) => r.version === version),
    [data, version],
  );

  const status = info.draftRevisionStatus ?? "draft";
  const reviews = revision?.reviews ?? [];
  const isReviewer = reviews.some((r) => r.userId === userId);

  // Starting the experiment IS the publish event for a managed flag — the
  // launch publishes this draft. So a draft experiment never offers Publish
  // separately; only the review cycle runs here, so the draft can be approved
  // and ready by the time someone hits Start. Publishing on its own becomes
  // available once the experiment is live and later edits open a new draft.
  const publishIsLaunch = experiment.status === "draft";

  const state = getReviewAndPublishState({
    requireReviews: !!info.pendingApproval,
    status,
    // A conflicted or polluted draft is surfaced by the card's own callouts and
    // has to be resolved on the Feature Flag page; the popover never offers a
    // CTA that would fail.
    mergeSuccess: !info.hasMergeConflict,
    hasChanges: true,
    hasReviewPermission: permissionsUtil.canReviewFeatureDrafts(info.feature),
    canManageDraft: permissionsUtil.canEditFeatureDrafts(info.feature),
    isReviewRequester: revision?.createdBy?.id === userId,
    isContributor: (revision?.contributors ?? []).includes(userId ?? ""),
    isDraftOwner: revision?.createdBy?.id === userId,
    isReviewer,
    // Bypass authority is about landing a change, and on a draft experiment
    // nothing lands here — the launch does that. Passing it through would send
    // an admin straight to a "publish now" the launch owns, skipping the review
    // cycle the draft still needs to go through before start.
    adminPublish:
      !publishIsLaunch &&
      permissionsUtil.canBypassFlagApprovalChecks(info.feature, "feature"),
    // Managed mode has no pre-launch checklist step of its own — starting the
    // experiment is what runs that, and it publishes this draft itself.
    hasSelectedExperiments: false,
    onlyScheduledSelected: false,
    experimentsStep: false,
    featureLockedByRamp: false,
    featureLockedBySchedule: false,
    checklistIncomplete: false,
    checklistBlocked: false,
    checklistAcknowledged: true,
    governanceCanPublish: true,
    editsResetStatus: true,
  });

  const canReview =
    permissionsUtil.canReviewFeatureDrafts(info.feature) &&
    status === "pending-review" &&
    revision?.createdBy?.id !== userId;

  const submitAction =
    publishIsLaunch && state.submitAction === "publish"
      ? "none"
      : state.submitAction;
  const showSubmit = state.hasSubmit && submitAction !== "none";

  // With nothing to request, approve, retract or publish, the control would be
  // a button that opens a popover offering nothing. Render no trigger at all —
  // the status badge and callout already say where the draft stands.
  const hasAnyAction =
    canReview || showSubmit || state.canUndoReview || state.canRecallReview;

  async function post(path: string, body: Record<string, unknown> = {}) {
    setSubmitting(true);
    setError(null);
    try {
      await apiCall(`/experiment/${experiment.id}/managed-flag/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setComment("");
      setOpen(false);
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const reviewerRows = reviews.map((r) => {
    const user = users.get(r.userId);
    const name = user?.name ?? "";
    const email = user?.email ?? "";
    // "-stale" verdicts still count as this reviewer's position, but the icon
    // mutes to show the draft moved on since they gave it.
    const stale = r.status.endsWith("-stale");
    const verdict = stale
      ? (r.status.replace("-stale", "") as "approved" | "changes-requested")
      : (r.status as "approved" | "changes-requested");
    return (
      <PersonRow
        key={r.userId}
        id={r.userId}
        name={name}
        email={email}
        trailing={
          <ReviewerVerdictIcon
            status={verdict}
            name={name || email}
            timestamp={String(r.timestamp)}
            stale={stale}
          />
        }
      />
    );
  });

  const content = (
    <Box width="320px" p="1">
      <Text size="sm" color="text-low" as="div" mb="2">
        This experiment&apos;s Feature Flag is{" "}
        <strong>{revisionStatusLabel(status)}</strong>.{" "}
        {publishIsLaunch
          ? "It publishes when you start the experiment."
          : "Publish to make these values live."}
      </Text>

      {reviewerRows.length > 0 && (
        <>
          <Separator size="4" my="3" />
          <Text size="sm" weight="semibold" as="div" mb="2">
            Reviewers
          </Text>
          <Flex direction="column" gap="2">
            {reviewerRows}
          </Flex>
        </>
      )}

      {(canReview || submitAction === "request-review") && (
        <>
          <Separator size="4" my="3" />
          <Field
            size="sm"
            textarea
            minRows={2}
            placeholder="Add a comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </>
      )}

      {error && (
        <Callout status="error" mt="2" size="sm">
          {error}
        </Callout>
      )}

      <Separator size="4" my="3" />
      <Flex gap="2" align="center" wrap="wrap">
        {canReview ? (
          <>
            <Button
              disabled={submitting}
              onClick={() =>
                post("submit-review", { comment, review: "Approved" })
              }
            >
              Approve
            </Button>
            <Button
              variant="soft"
              disabled={submitting}
              onClick={() =>
                post("submit-review", {
                  comment,
                  review: "Requested Changes",
                })
              }
            >
              Request changes
            </Button>
          </>
        ) : state.hasSubmit && state.submitAction !== "none" ? (
          <Button
            disabled={!state.ctaEnabled || submitting}
            onClick={() =>
              post(
                state.submitAction === "publish" ? "publish" : "request-review",
                state.submitAction === "publish" ? {} : { comment },
              )
            }
          >
            {state.ctaLabel}
          </Button>
        ) : state.waitingForReview ? (
          <Text size="sm" color="text-low">
            Waiting for another reviewer to approve.
          </Text>
        ) : null}

        {state.canUndoReview && (
          <Link onClick={() => post("undo-review")}>Retract my review</Link>
        )}
        {state.canRecallReview && (
          <Link onClick={() => post("recall-review")}>Return to draft</Link>
        )}
      </Flex>
    </Box>
  );

  if (!hasAnyAction) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      content={content}
      trigger={
        <Button variant="ghost">
          {/* Name the action the popover will actually offer. Deriving this
              from `status` alone drifts: an org that doesn't require approvals
              sits in "draft" but publishes directly, so the trigger read
              "Request review" over a Publish button. */}
          {canReview ? "Review" : state.ctaLabel}
        </Button>
      }
    />
  );
}
