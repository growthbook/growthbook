import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiArrowLeft,
  PiCaretDownBold,
  PiChatCircle,
  PiTag,
} from "react-icons/pi";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { canCommentOnRevisionEntity } from "shared/permissions";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import EventUser from "@/components/Avatar/EventUser";
import CommentComposer from "@/components/Comments/CommentComposer";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import ApprovalStatusBand from "@/components/Reviews/ApprovalStatusBand";
import CardHeader from "@/components/Reviews/CardHeader";
import DivergenceNotice from "@/components/Reviews/DivergenceNotice";
import ReviewCommentPopover from "@/components/Reviews/ReviewCommentPopover";
import {
  revisionStatusColor,
  revisionStatusIcon,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import {
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";
import useManagedFlagReview, {
  ManagedFlagReview,
} from "@/components/Experiment/LinkedChanges/useManagedFlagReview";
import {
  ManagedFlagReviewers,
  ManagedFlagReviewComments,
  ManagedValues,
} from "@/components/Experiment/LinkedChanges/ManagedFlagReviewParts";
import { getExperimentReviewTitle } from "./startActions";
import { useEditsBlockedReason } from "./ExperimentEdits";

// Under the sticky header and tab bar, with a gap.
const CARD_TOP_PX = TABS_HEADER_HEIGHT_PX + TABS_BAR_HEIGHT_PX + 16;

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  // The Values flag, while it has unpublished values.
  info: LinkedFeatureInfo;
  mutate: () => void;
  exit: () => void;
}

function SectionHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Heading as="h4" size="sm" color="text-high" mb="0">
      <Flex as="span" align="center" gap="2">
        {icon}
        {title}
      </Flex>
    </Heading>
  );
}

function Section({
  icon,
  title,
  headingInContent = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  // The content draws the heading itself, e.g. in its table's header.
  headingInContent?: boolean;
  children: ReactNode;
}) {
  return (
    <Box pt="3" pb="4">
      {headingInContent ? null : (
        <Box mb="2">
          <SectionHeading icon={icon} title={title} />
        </Box>
      )}
      {children}
    </Box>
  );
}

/**
 * The Values flag's unpublished values and their review. A draft's go live
 * when it starts, from the header's Start; a running one's publish here.
 */
export default function ExperimentReview({
  experiment,
  info,
  mutate,
  exit,
}: Props) {
  const review = useManagedFlagReview({ experiment, info, mutate });
  const editsBlocked = useEditsBlockedReason();
  const isDraft = experiment.status === "draft";

  return (
    <Box pt="3" pb="6">
      <Flex gap="5" align="start" direction={{ initial: "column", md: "row" }}>
        <Box
          width={{ initial: "100%", md: "auto" }}
          flexGrow={{ initial: "0", md: "1" }}
          style={{ minWidth: 0 }}
        >
          <Flex align="center" gap="3">
            {/* Inline, since an underline doesn't reach into a flex box. */}
            <Link onClick={exit} underline="hover" size="lg">
              <PiArrowLeft
                style={{ verticalAlign: "-0.125em", marginRight: 4 }}
              />
              Setup
            </Link>
            <Separator orientation="vertical" size="2" />
            <Heading as="h3" size="sm" mb="0">
              {getExperimentReviewTitle(experiment)}
            </Heading>
          </Flex>
          <Section
            icon={<PiTag />}
            title="Values"
            // A live flag's diff has a header row to carry it.
            headingInContent={!isDraft}
          >
            <ManagedValues
              info={info}
              variations={getLatestPhaseVariations(experiment)}
              showChanges={!isDraft}
              heading={<SectionHeading icon={<PiTag />} title="Values" />}
            />
          </Section>
          <Separator size="4" my="3" />
          <Section icon={<PiChatCircle />} title="Comments">
            <Flex direction="column" gap="4">
              <ManagedFlagReviewComments review={review} />
              <AddReviewComment
                experimentId={experiment.id}
                info={info}
                review={review}
              />
            </Flex>
          </Section>
        </Box>
        <Box
          width={{ initial: "100%", md: "360px" }}
          minWidth={{ initial: "0", md: "360px" }}
          flexShrink="0"
          style={{ position: "sticky", top: CARD_TOP_PX }}
        >
          <ReviewCard
            experimentId={experiment.id}
            info={info}
            review={review}
            editsBlocked={editsBlocked}
          />
        </Box>
      </Flex>
    </Box>
  );
}

/**
 * The thread's composer, as the feature review has it: anyone who can comment
 * on the flag, its author included.
 */
function AddReviewComment({
  experimentId,
  info,
  review,
}: {
  experimentId: string;
  info: LinkedFeatureInfo;
  review: ManagedFlagReview;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const { userId, name, email } = useUser();
  if (
    !canCommentOnRevisionEntity(permissionsUtil, "feature", null, {
      project: info.feature.project,
    })
  ) {
    return null;
  }
  return (
    <Flex align="start" gap="3">
      <Box flexShrink="0">
        <EventUser
          user={{
            type: "dashboard",
            id: userId || "",
            name: name || "",
            email: email || "",
          }}
          display="avatar"
          size="md"
        />
      </Box>
      <Box flexGrow="1" style={{ minWidth: 0 }}>
        <Flex align="center" style={{ height: 32 }}>
          <Heading as="h4" size="sm" mb="0">
            Add a comment
          </Heading>
        </Flex>
        <CommentComposer
          placeholder="Leave a comment…"
          onSubmit={async (comment) => {
            // No verdict: a plain comment on the flag's draft.
            await apiCall(
              `/experiment/${experimentId}/managed-flag/submit-review`,
              { method: "POST", body: JSON.stringify({ comment }) },
            );
            await review.refresh();
          }}
        />
      </Box>
    </Flex>
  );
}

/**
 * The feature review's actions card, lighter: the values' status and people,
 * their next step, and once running, publishing them.
 */
function ReviewCard({
  experimentId,
  info,
  review,
  editsBlocked,
}: {
  experimentId: string;
  info: LinkedFeatureInfo;
  review: ManagedFlagReview;
  editsBlocked: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const publish = review.submit?.action === "publish" ? review.submit : null;
  // A draft's values publish when it starts.
  const showPublish =
    !review.publishIsLaunch && (!!publish || review.adminBypassAvailable);
  const bypass = showPublish && review.adminBypassAvailable;
  const bypassing = bypass && review.adminBypass;

  const statusColor = revisionStatusColor(review.status);
  const statusIcon = revisionStatusIcon(review.status);
  // Mirrors DivergenceNotice, which draws nothing for a current draft.
  const diverged =
    !!review.governance &&
    (review.governance.divergence !== "current" ||
      review.governance.staleApproval);
  // A conflicted draft can't be updated from live, so discarding is the fix.
  const canDiscard =
    review.canManage && review.governance?.divergence === "conflict";
  const reviewLinks =
    review.state.canRecallReview || review.state.canUndoReview;
  const hasBody =
    review.requireReviews ||
    reviewLinks ||
    review.canReview ||
    review.showApprovalBand ||
    diverged ||
    showPublish ||
    !!error ||
    !!review.error;

  return (
    <Box className="appbox" mb="0" style={{ overflow: "hidden" }}>
      {discardConfirm ? (
        <ConfirmDialog
          title="Discard unpublished variation values?"
          content="This throws away the unpublished draft. Live values are unchanged."
          yesText="Discard"
          onConfirm={async () => {
            setDiscardConfirm(false);
            await review.post("discard");
          }}
          onCancel={() => setDiscardConfirm(false)}
        />
      ) : null}
      {statusColor ? (
        <CardHeader background={`var(--${statusColor}-a3)`}>
          <Flex
            align="center"
            gap="2"
            style={{ color: `var(--${statusColor}-11)` }}
          >
            {statusIcon ? (
              <Box style={{ fontSize: 18, lineHeight: 1, display: "flex" }}>
                {statusIcon}
              </Box>
            ) : null}
            <Heading as="h4" size="sm" mb="0">
              <span style={{ color: `var(--${statusColor}-11)` }}>
                {revisionStatusLabel(review.status)}
              </span>
            </Heading>
          </Flex>
        </CardHeader>
      ) : null}
      {hasBody ? (
        <Flex direction="column" gap="4" p="4">
          <ManagedFlagReviewers review={review} />
          {review.canReview && !bypassing ? (
            <ReviewCommentPopover
              submitUrl={`/experiment/${experimentId}/managed-flag/submit-review`}
              storageKey={`review-comment:${info.feature.id}:${review.version}`}
              isBlockedContributor={review.isBlockedContributor}
              onSuccess={() => review.refresh()}
              trigger={
                <Button
                  variant={publish?.enabled ? "outline" : "solid"}
                  style={{ width: "100%" }}
                  icon={<PiCaretDownBold />}
                  iconPosition="right"
                >
                  Submit review
                </Button>
              }
              side="bottom"
              align="center"
            />
          ) : null}
          {reviewLinks ? (
            <Flex direction="column" gap="1">
              {review.state.canRecallReview ? (
                <Text size="sm" color="text-mid">
                  Not ready for review?{" "}
                  <Link
                    onClick={() =>
                      !review.submitting && review.post("recall-review")
                    }
                  >
                    Return to draft
                  </Link>
                </Text>
              ) : null}
              {review.state.canUndoReview ? (
                <Text size="sm" color="text-mid">
                  Changed your mind?{" "}
                  <Link
                    onClick={() =>
                      !review.submitting && review.post("undo-review")
                    }
                  >
                    Retract your review
                  </Link>
                </Text>
              ) : null}
            </Flex>
          ) : null}
          {review.showApprovalBand ? (
            <Box>
              <ApprovalStatusBand
                // Nobody need wait for a reviewer an admin can bypass.
                phase={
                  review.approvalBandPhase === "waiting" && bypass
                    ? "draft"
                    : review.approvalBandPhase
                }
                // Which environments a values draft reaches says little here;
                // who must approve is what the card needs.
                unmet={review.approval?.unmetTeams ?? []}
                coverageMessage={review.coverageBlockMessage}
                startsExperiment={review.publishIsLaunch}
                showSelfApprovalNote={
                  review.isBlockedContributor && review.canReview
                }
              />
            </Box>
          ) : null}
          {diverged && review.governance ? (
            <DivergenceNotice
              governance={review.governance}
              onUpdateFromLive={review.updateFromLive}
              updating={review.rebasing}
              canRebase={review.canManage}
              liveVersion={info.feature.version}
              baseVersion={review.revision?.baseVersion ?? info.feature.version}
            />
          ) : null}
          {canDiscard ? (
            <Text size="sm" color="text-mid">
              <Link onClick={() => setDiscardConfirm(true)}>
                Discard the draft
              </Link>{" "}
              to start over from the live values.
            </Text>
          ) : null}
          {showPublish ? (
            <Flex
              direction="column"
              gap="3"
              pt="4"
              style={{ borderTop: "1px solid var(--gray-a5)" }}
            >
              {bypass ? (
                <Checkbox
                  label={
                    <span style={{ color: "var(--red-11)" }}>
                      Bypass remaining checks and publish now
                    </span>
                  }
                  weight="regular"
                  value={review.adminBypass}
                  setValue={(val) => review.setAdminBypass(!!val)}
                />
              ) : null}
              <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
                <Button
                  style={{ width: "100%" }}
                  onClick={() => publish?.run()}
                  setError={setError}
                  disabled={!publish?.enabled || !!editsBlocked}
                >
                  Publish now
                </Button>
              </Tooltip>
            </Flex>
          ) : null}
          {error || review.error ? (
            <Flex direction="column" gap="2">
              {error ? (
                <Callout status="error" size="sm">
                  {error}
                </Callout>
              ) : null}
              {review.error ? (
                <Callout status="error" size="sm">
                  {review.error}
                </Callout>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
      ) : null}
    </Box>
  );
}
