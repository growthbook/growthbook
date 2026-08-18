import { useMemo, useState } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
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
import RadioGroup from "@/ui/RadioGroup";
import VariationLabel from "@/ui/VariationLabel";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";

/**
 * CTA + reviewers, nothing else: a managed flag has one rule and one draft, so
 * the full modal's deferral, scheduling and diff machinery has nothing to act
 * on. The CTA comes from `getReviewAndPublishState` so it can't drift from it.
 */

type ReviewDecision = "Comment" | "Requested Changes" | "Approved";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
  /** Overrides the trigger label when the surrounding copy already sets it up. */
  ctaLabel?: string;
};

export default function ManagedFlagApproval({
  experiment,
  info,
  mutate,
  ctaLabel,
}: Props) {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("Comment");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = info.draftRevisionVersion;
  // Not gated on `open`: the trigger's label depends on who authored the draft,
  // so the author saw "Review" — an action they can't take — until they clicked.
  const { data } = useApi<{ revisions: FeatureRevisionInterface[] }>(
    `/feature/${info.feature.id}`,
    { shouldRun: () => version != null },
  );
  const revision = useMemo(
    () => data?.revisions?.find((r) => r.version === version),
    [data, version],
  );

  const status = info.draftRevisionStatus ?? "draft";
  const reviews = revision?.reviews ?? [];
  const isReviewer = reviews.some((r) => r.userId === userId);

  // Starting the experiment is the publish event, so a draft experiment runs the
  // review cycle only. Publishing on its own returns once the experiment is live.
  const publishIsLaunch = experiment.status === "draft";

  const state = getReviewAndPublishState({
    requireReviews: !!info.pendingApproval,
    status,
    // Conflicts are surfaced by the card's callouts; never offer a failing CTA.
    mergeSuccess: !info.hasMergeConflict,
    hasChanges: true,
    hasReviewPermission: permissionsUtil.canReviewFeatureDrafts(info.feature),
    canManageDraft: permissionsUtil.canEditFeatureDrafts(info.feature),
    isReviewRequester: revision?.createdBy?.id === userId,
    isContributor: (revision?.contributors ?? []).includes(userId ?? ""),
    isDraftOwner: revision?.createdBy?.id === userId,
    isReviewer,
    // Bypass is about landing, and nothing lands here on a draft experiment —
    // passing it through would skip the review cycle entirely for admins.
    adminPublish:
      !publishIsLaunch &&
      permissionsUtil.canBypassFlagApprovalChecks(info.feature, "feature"),
    // The experiment's own start runs the pre-launch checklist.
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
    !!revision &&
    revision.createdBy?.id !== userId;

  const submitAction =
    publishIsLaunch && state.submitAction === "publish"
      ? "none"
      : state.submitAction;
  const showSubmit = state.hasSubmit && submitAction !== "none";

  // Nothing to offer means no trigger; the badge already shows the status.
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

  const variations = getLatestPhaseVariations(experiment);
  const enabledEnvs = Object.entries(revision?.environmentsEnabled ?? {})
    .filter(([, on]) => on)
    .map(([env]) => env);

  const changesColumn = (
    <Flex direction="column" gap="3" width="50%" minWidth="0">
      <Text size="sm" weight="semibold" color="text-high">
        Changes
      </Text>
      {variations.map((v, i) => (
        <Box key={v.id}>
          <VariationLabel number={i} name={v.name} size="sm" />
          <Box mt="1">
            <ValueDisplay
              value={
                info.values.find((sv) => sv.variationId === v.id)?.value ?? ""
              }
              type={info.feature.valueType}
              sparse={info.sparse}
              defaultValue={info.feature.defaultValue}
              showCopyButton={false}
              fullStyle={{ maxHeight: 60, overflowY: "auto" }}
            />
          </Box>
        </Box>
      ))}
      {enabledEnvs.length > 0 && (
        <Text size="sm" color="text-low">
          Enables {enabledEnvs.join(", ")}
        </Text>
      )}
    </Flex>
  );

  const reviewColumn = (
    <Flex direction="column" gap="3" width="50%" minWidth="0">
      <Text size="sm" weight="semibold" color="text-high">
        Review
      </Text>
      <Text size="sm" color="text-low">
        {revisionStatusLabel(status)}.{" "}
        {publishIsLaunch
          ? "Publishes when you start the experiment."
          : "Publish to make these values live."}
      </Text>

      {reviewerRows.length > 0 && (
        <Flex direction="column" gap="2">
          {reviewerRows}
        </Flex>
      )}

      {canReview && (
        <RadioGroup
          value={decision}
          setValue={(v) => setDecision(v as ReviewDecision)}
          options={[
            { value: "Comment", label: "Comment" },
            { value: "Requested Changes", label: "Request changes" },
            { value: "Approved", label: "Approve" },
          ]}
        />
      )}

      {(canReview || submitAction === "request-review") && (
        <Field
          size="sm"
          textarea
          minRows={2}
          placeholder="Add a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      )}

      {error && (
        <Callout status="error" size="sm">
          {error}
        </Callout>
      )}

      <Flex gap="2" align="center" wrap="wrap">
        {canReview ? (
          <Button
            disabled={
              submitting ||
              (decision === "Comment" && comment.trim().length === 0)
            }
            onClick={() => post("submit-review", { comment, review: decision })}
          >
            Submit review
          </Button>
        ) : showSubmit ? (
          <Button
            disabled={!state.ctaEnabled || submitting}
            onClick={() =>
              post(
                submitAction === "publish" ? "publish" : "request-review",
                submitAction === "publish" ? {} : { comment },
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
    </Flex>
  );

  const content = (
    <Flex gap="4" width="620px">
      {changesColumn}
      {/* Radix vertical separators collapse without an explicit stretch. */}
      <Separator
        orientation="vertical"
        style={{ alignSelf: "stretch", height: "auto" }}
      />
      {reviewColumn}
    </Flex>
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
          {/* Name what the popover will actually offer: `status` alone drifts,
              and a primary label with only secondary actions available lies. */}
          {ctaLabel ??
            (canReview
              ? "Review"
              : showSubmit
                ? state.ctaLabel
                : "Manage review")}
        </Button>
      }
    />
  );
}
