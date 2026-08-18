import { useMemo, useState } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import { datetime } from "shared/dates";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { BsThreeDotsVertical } from "react-icons/bs";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import { revisionStatusLabel } from "@/components/Reviews/RevisionStatusBadge";
import { rowVisual } from "@/components/Reviews/RevisionTimeline";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import CommentCard from "@/components/Comments/CommentCard";
import Avatar from "@/ui/Avatar";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
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
  /** "inherit" lets the trigger take its surroundings' accent (e.g. a Callout). */
  triggerColor?: "inherit";
};

export default function ManagedFlagApproval({
  experiment,
  info,
  mutate,
  ctaLabel,
  triggerColor,
}: Props) {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("Comment");
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
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

  // Editing values is the review request, and starting the experiment is the
  // publish — so the only primary action left here is a publish on a running
  // experiment.
  const submitAction =
    state.submitAction === "publish" && !publishIsLaunch ? "publish" : "none";
  const showSubmit = state.hasSubmit && submitAction !== "none";

  async function post(
    path: string,
    body: Record<string, unknown> = {},
    method: "POST" | "PUT" = "POST",
  ) {
    setSubmitting(true);
    setError(null);
    try {
      await apiCall(`/experiment/${experiment.id}/managed-flag/${path}`, {
        method,
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

  // Verdicts carry the reviewer's comment in the revision log, not on the
  // verdict itself, so the conversation needs its own fetch.
  const { data: logData } = useApi<{ log: RevisionLog[] }>(
    `/feature/${info.feature.id}/${version}/log`,
    { shouldRun: () => open && version != null },
  );
  // Comments, plus verdicts that are still active. `revision.reviews` is the
  // live verdict set — a retracted approval is dropped from it — so matching
  // against it excludes withdrawn reviews without replaying the log. Lifecycle
  // events (requested, withdrawn, new revision) are state the status line
  // already carries.
  const verdictStatusForAction: Record<string, string> = {
    Approved: "approved",
    "Requested Changes": "changes-requested",
  };
  const reviewComments = (logData?.log ?? [])
    .filter((l) => {
      if (l.action === "Comment") return true;
      const wanted = verdictStatusForAction[l.action];
      if (!wanted) return false;
      const logUserId =
        l.user && "id" in l.user ? (l.user as { id: string }).id : null;
      return reviews.some(
        (r) => r.userId === logUserId && r.status.startsWith(wanted),
      );
    })
    .map((l) => {
      let comment: string | undefined;
      try {
        comment = JSON.parse(l.value)?.comment;
      } catch {
        // not JSON
      }
      return { ...l, comment };
    });

  const variations = getLatestPhaseVariations(experiment);
  const enabledEnvs = Object.entries(revision?.environmentsEnabled ?? {})
    .filter(([, on]) => on)
    .map(([env]) => env);

  const changesColumn = (
    <Flex direction="column" gap="3" width="50%" minWidth="0">
      <Text size="md" weight="semibold" color="text-high">
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
      <Text size="md" weight="semibold" color="text-high">
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

      {canReview && (
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
            onClick={() => post("publish")}
          >
            {state.ctaLabel}
          </Button>
        ) : state.waitingForReview ? (
          <Text size="sm" color="text-low">
            Waiting for another reviewer to approve.
          </Text>
        ) : null}
      </Flex>

      {reviewComments.length > 0 && (
        <>
          <Separator size="4" />
          <Flex direction="column" gap="3">
            {reviewComments.map((l, i) => {
              // Same visual vocabulary as the Review & Publish tab, so an
              // approval, a change request and a plain comment stay
              // distinguishable rather than collapsing into one card style.
              const visual = rowVisual(l.action);
              const verdictColor =
                l.action === "Approved"
                  ? "green"
                  : l.action === "Requested Changes"
                    ? "red"
                    : null;
              const logUserId =
                l.user && "id" in l.user ? (l.user as { id: string }).id : null;
              const isOwn = !!logUserId && logUserId === userId;
              const isActiveVerdict = !!verdictColor;
              return (
                <CommentCard
                  key={l.id ?? i}
                  user={l.user}
                  metadata={`${visual.verb} on ${datetime(l.timestamp)}`}
                  stripeColor={visual.color}
                  leading={
                    verdictColor ? (
                      <Avatar size="sm" color={verdictColor} variant="solid">
                        <>{visual.icon}</>
                      </Avatar>
                    ) : undefined
                  }
                  avatarSize="sm"
                  compact
                  actions={
                    isOwn && (l.id || isActiveVerdict) ? (
                      <DropdownMenu
                        trigger={
                          <IconButton
                            variant="ghost"
                            color="gray"
                            radius="full"
                            size="1"
                            highContrast
                          >
                            <BsThreeDotsVertical size={14} />
                          </IconButton>
                        }
                        menuPlacement="end"
                      >
                        {l.id && l.comment && (
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingLogId(l.id ?? null);
                              setEditText(l.comment ?? "");
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                        )}
                        {isActiveVerdict && state.canUndoReview && (
                          <DropdownMenuItem
                            color="red"
                            onClick={() => post("undo-review")}
                          >
                            Retract review
                          </DropdownMenuItem>
                        )}
                      </DropdownMenu>
                    ) : undefined
                  }
                  // A bare verdict has no body — same chrome, just the header
                  // line, so it stays distinguishable from a comment.
                  body={
                    editingLogId && editingLogId === l.id ? (
                      <Flex direction="column" gap="2">
                        <Field
                          size="sm"
                          textarea
                          minRows={2}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <Flex gap="2">
                          <Button
                            size="sm"
                            disabled={submitting || !editText.trim()}
                            onClick={async () => {
                              await post(
                                `log/${l.id}`,
                                {
                                  comment: editText,
                                },
                                "PUT",
                              );
                              setEditingLogId(null);
                            }}
                          >
                            Save
                          </Button>
                          <Link onClick={() => setEditingLogId(null)}>
                            Cancel
                          </Link>
                        </Flex>
                      </Flex>
                    ) : l.comment ? (
                      <MarkdownWithDiffRefs className="speech-bubble">
                        {l.comment}
                      </MarkdownWithDiffRefs>
                    ) : undefined
                  }
                />
              );
            })}
          </Flex>
        </>
      )}
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

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      content={content}
      trigger={
        <Button variant="ghost" color={triggerColor}>
          {/* Name what the popover will actually offer: `status` alone drifts,
              and a primary label with only secondary actions available lies. */}
          {/* With no action available — the author can't approve their own
              draft, and starting the experiment is what publishes it — the
              popover is still worth opening to see the changes and who has
              reviewed. Say that rather than promising an action. */}
          {canReview
            ? "Review"
            : showSubmit
              ? (ctaLabel ?? state.ctaLabel)
              : "Review changes"}
        </Button>
      }
    />
  );
}
