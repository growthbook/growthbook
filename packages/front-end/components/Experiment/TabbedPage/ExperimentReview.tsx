import { Fragment, ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiArrowLeft,
  PiCaretDownBold,
  PiChatCircle,
  PiCode,
  PiFlask,
  PiListChecks,
  PiTag,
} from "react-icons/pi";
import {
  getLatestPhaseVariations,
  hasTargetingConfigured,
} from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { canCommentOnRevisionEntity } from "shared/permissions";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  isPendingApprovalItem,
  summarizeChecklist,
} from "@/components/PreLaunchChecklist/checklistSummary";
import type { CheckListItem } from "@/components/PreLaunchChecklist/PreLaunchChecklistItems";
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
  ChecklistCountBadge,
  PreLaunchChecklistPanel,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import {
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";
import useManagedFlagReview, {
  draftApprovalSatisfied,
  ManagedFlagReview,
} from "@/components/Experiment/LinkedChanges/useManagedFlagReview";
import {
  ManagedFlagReviewers,
  ManagedFlagReviewComments,
  ManagedValues,
} from "@/components/Experiment/LinkedChanges/ManagedFlagReviewParts";
import { useEditsBlockedReason } from "./ExperimentEdits";
import SetupFieldRow from "./SetupFieldRow";
import { scheduledTime } from "./RunningScheduleLink";
import {
  LinkedChangesSummary,
  StartChecklistFailures,
  StartFailures,
  StartSummaryRow,
  StartUpgradeCallout,
  useStartSummaryRows,
} from "./StartSections";
import { getExperimentReviewTitle } from "./startActions";
import useStartGate from "./useStartGate";
import { StartExperiment } from "./useStartExperiment";

export const EXPERIMENT_REVIEW_VALUES_ID = "experiment-review-values";

export function scrollToReviewValues() {
  document
    .getElementById(EXPERIMENT_REVIEW_VALUES_ID)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const EXPERIMENT_REVIEW_CARD_ID = "experiment-review-card";

// "nearest": the sticky card is usually in view already.
export function scrollToReviewCard() {
  document
    .getElementById(EXPERIMENT_REVIEW_CARD_ID)
    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Under the sticky header and tab bar, with a gap.
const CARD_TOP_PX = TABS_HEADER_HEIGHT_PX + TABS_BAR_HEIGHT_PX + 16;

// getAffectedEnvsForExperiment's answer for "every environment".
const ALL_ENVIRONMENTS = "__ALL__";

type StartGate = ReturnType<typeof useStartGate>;
type SummaryRow = Pick<StartSummaryRow, "key" | "label" | "value">;
type ValuesReview = { info: LinkedFeatureInfo; review: ManagedFlagReview };

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  envs: string[];
  mutate: () => void;
  // The Values flag, while it has unpublished values.
  valuesDraft: LinkedFeatureInfo | null;
  start: StartExperiment;
  exit: () => void;
  editSchedule: (() => void) | null;
}

/**
 * What stands between a draft and starting it, or between a running
 * experiment's unpublished values and publishing them.
 */
export default function ExperimentReview(props: Props) {
  return props.valuesDraft ? (
    <WithValuesReview {...props} info={props.valuesDraft} />
  ) : (
    <ReviewPage {...props} values={null} />
  );
}

function WithValuesReview({
  info,
  ...props
}: Props & { info: LinkedFeatureInfo }) {
  const review = useManagedFlagReview({
    experiment: props.experiment,
    info,
    mutate: props.mutate,
  });
  return <ReviewPage {...props} values={{ info, review }} />;
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
  id,
  icon,
  title,
  badge,
  headingInContent = false,
  children,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  // The content draws the heading itself, e.g. in its table's header.
  headingInContent?: boolean;
  children: ReactNode;
}) {
  return (
    <Box id={id} pt="3" pb="4" style={{ scrollMarginTop: "100px" }}>
      {headingInContent ? null : (
        <Flex align="center" gap="2" mb="2">
          <SectionHeading icon={icon} title={title} />
          {badge}
        </Flex>
      )}
      {children}
    </Box>
  );
}

// Sized and spaced to read as the heading of the rows under it.
function GroupTitle({ children }: { children: string }) {
  return (
    <Text as="div" size="lg" weight="semibold" color="text-high" mt="5" mb="1">
      {children}
    </Text>
  );
}

// Spaced like the Values table's rows, so the sections read alike.
function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Box py="1">
      <SetupFieldRow label={label} content="text">
        {children}
      </SetupFieldRow>
    </Box>
  );
}

function ReviewPage({
  experiment,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  envs,
  values,
  start,
  exit,
  editSchedule,
}: Props & { values: ValuesReview | null }) {
  const gate = useStartGate({ experiment, linkedFeatures, start });
  const editsBlocked = useEditsBlockedReason();
  const review = values?.review ?? null;
  const isDraft = experiment.status === "draft";
  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  const title = getExperimentReviewTitle(experiment, new Date());
  const dateLabel = gate.scheduledStartAt
    ? scheduledTime(gate.scheduledStartAt)
    : null;

  const scheduleLink = (text: string) =>
    editSchedule ? <Link onClick={editSchedule}>{text}</Link> : text;
  const pastSchedule =
    isDraft &&
    !startApproved &&
    gate.schedule === "past" &&
    start.canRunExperiment &&
    dateLabel;

  const managedId = values?.info.feature.id ?? null;
  // Approving the values is what this page is for, so its To Do skips the row
  // that would only link back here. The start still counts it.
  const { checklist } = usePreLaunchChecklist();
  const omitTodo = (item: CheckListItem) =>
    isPendingApprovalItem(item) && item.featureId === managedId;
  const todoSummary = summarizeChecklist(checklist, omitTodo);
  // Their container only takes room when one of them shows.
  const hasCallouts =
    start.pendingDraftFailures.length > 0 ||
    start.checklistFailures.length > 0 ||
    !!pastSchedule ||
    (isDraft && !!gate.upgrade);
  const hasOtherChanges =
    linkedFeatures.some((f) => f.feature.id !== managedId) ||
    visualChangesets.length > 0 ||
    urlRedirects.length > 0;

  const sections: { key: string; node: ReactNode }[] = [];
  if (isDraft) {
    sections.push({
      key: "todo",
      node: (
        <Section
          icon={<PiListChecks />}
          title="To Do"
          badge={
            <ChecklistCountBadge
              remaining={gate.checklistLoading ? null : todoSummary.remaining}
              blocking={todoSummary.blocking > 0}
            />
          }
        >
          <Flex direction="column" gap="3">
            <PreLaunchChecklistPanel size="md" layout="rows" omit={omitTodo} />
          </Flex>
        </Section>
      ),
    });
    sections.push({
      key: "summary",
      node: (
        <Section
          icon={<PiFlask />}
          title={
            experiment.type === "multi-armed-bandit"
              ? "Bandit summary"
              : "Experiment summary"
          }
        >
          <ReviewSummary
            experiment={experiment}
            // The Values section shows where the Values flag runs.
            envs={values ? [] : envs}
          />
        </Section>
      ),
    });
  }
  if (values) {
    sections.push({
      key: "values",
      node: (
        <Section
          id={EXPERIMENT_REVIEW_VALUES_ID}
          icon={<PiTag />}
          title="Values"
          // A live flag's diff has a header row to carry it.
          headingInContent={!isDraft}
        >
          <ManagedValues
            info={values.info}
            variations={getLatestPhaseVariations(experiment)}
            showChanges={!isDraft}
            heading={<SectionHeading icon={<PiTag />} title="Values" />}
          />
        </Section>
      ),
    });
  }
  if (isDraft && hasOtherChanges) {
    sections.push({
      key: "implementation",
      node: (
        <Section icon={<PiCode />} title="Implementation">
          <LinkedChangesSummary
            experiment={experiment}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            urlRedirects={urlRedirects}
            scheduledInFuture={gate.schedule === "future"}
          />
        </Section>
      ),
    });
  }
  if (values) {
    sections.push({
      key: "comments",
      node: (
        <Section icon={<PiChatCircle />} title="Comments">
          <Flex direction="column" gap="4">
            <ManagedFlagReviewComments review={values.review} />
            <AddReviewComment
              experimentId={experiment.id}
              info={values.info}
              review={values.review}
            />
          </Flex>
        </Section>
      ),
    });
  }

  const actions = getCardActions({
    experiment,
    review,
    gate,
    start,
    editsBlocked,
  });

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
              {title}
            </Heading>
          </Flex>
          {gate.schedule === "future" && !startApproved && dateLabel ? (
            <Text as="div" color="text-low" mt="1">
              Scheduled to start {dateLabel}
            </Text>
          ) : null}
          <Flex direction="column" gap="3" mt={hasCallouts ? "3" : "0"}>
            <StartFailures
              failures={start.pendingDraftFailures}
              managedFeatureId={managedId}
              onReviewValues={values ? scrollToReviewValues : null}
            />
            <StartChecklistFailures items={start.checklistFailures} />
            {pastSchedule ? (
              <Callout status="warning">
                The scheduled start date{" "}
                <Text weight="semibold">{dateLabel}</Text> has passed.{" "}
                {gate.checklistLoading || gate.upgrade ? (
                  <>{scheduleLink("Update the schedule")}.</>
                ) : gate.actions.hardBlocked ? (
                  <>
                    Resolve the items below, or{" "}
                    {scheduleLink("update the schedule")}.
                  </>
                ) : (
                  <>
                    Click <Text weight="semibold">{gate.actions.label}</Text> to
                    start the experiment immediately, or{" "}
                    {scheduleLink("update the schedule")}.
                  </>
                )}
              </Callout>
            ) : null}
            {isDraft ? <StartUpgradeCallout upgrade={gate.upgrade} /> : null}
          </Flex>
          {sections.map((section, i) => (
            <Fragment key={section.key}>
              {i > 0 ? <Separator size="4" my="3" /> : null}
              {section.node}
            </Fragment>
          ))}
        </Box>
        {review || actions.primary || actions.startNote ? (
          <Box
            id={EXPERIMENT_REVIEW_CARD_ID}
            width={{ initial: "100%", md: "360px" }}
            minWidth={{ initial: "0", md: "360px" }}
            flexShrink="0"
            style={{ position: "sticky", top: CARD_TOP_PX }}
          >
            <ReviewCard
              experiment={experiment}
              values={values}
              actions={actions}
              editsBlocked={editsBlocked}
            />
          </Box>
        ) : null}
      </Flex>
    </Box>
  );
}

/** What the start changes for live traffic: who, where, and when. */
function ReviewSummary({
  experiment,
  envs,
}: {
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
}) {
  const phase = experiment.phases?.[experiment.phases.length - 1];
  const startRows = useStartSummaryRows(experiment);
  // The schedule modal's own words for no date.
  const schedule = experiment.statusUpdateSchedule;
  const scheduleRows: SummaryRow[] = [
    {
      key: "start",
      label: "Start",
      value: schedule?.startAt
        ? scheduledTime(schedule.startAt)
        : "Immediately",
    },
    {
      key: "end",
      label: "End",
      value: schedule?.stopAt
        ? scheduledTime(schedule.stopAt)
        : schedule?.stopAfter
          ? `${schedule.stopAfter.value} ${schedule.stopAfter.unit} after start`
          : "When stopped",
    },
  ];
  const traffic: SummaryRow[] = [...startRows];
  if (phase) {
    if (!hasTargetingConfigured(phase)) {
      traffic.push({
        key: "targeting",
        label: "Targeting",
        value: (
          <Text color="text-mid">
            <em>Everyone</em>
          </Text>
        ),
      });
    }
    traffic.push({
      key: "assignmentAttribute",
      label: "Assignment attribute",
      value: (
        <Text color="text-high">
          {[experiment.hashAttribute || "id", experiment.fallbackAttribute]
            .filter(Boolean)
            .join(", ")}
        </Text>
      ),
    });
  }
  // Visual Editor changes and redirects serve everywhere.
  const allEnvs = envs.includes(ALL_ENVIRONMENTS);
  if (envs.length > 0) {
    traffic.push({
      key: "environments",
      label: envs.length === 1 && !allEnvs ? "Environment" : "Environments",
      value: (
        <Text color="text-high">
          {allEnvs ? "All environments" : envs.join(", ")}
        </Text>
      ),
    });
  }

  return (
    <>
      {traffic.length > 0 ? (
        <>
          <GroupTitle>Traffic and targeting</GroupTitle>
          {traffic.map((row) => (
            <SummaryRow key={row.key} label={row.label}>
              {row.value}
            </SummaryRow>
          ))}
        </>
      ) : null}
      <GroupTitle>Schedule</GroupTitle>
      {scheduleRows.map((row) => (
        <SummaryRow key={row.key} label={row.label}>
          <Text color="text-high">{row.value}</Text>
        </SummaryRow>
      ))}
    </>
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

type CardActions = ReturnType<typeof getCardActions>;

/** Which of the card's actions this viewer gets, and what the primary does. */
function getCardActions({
  experiment,
  review,
  gate,
  start,
  editsBlocked,
}: {
  experiment: ExperimentInterfaceStringDates;
  review: ManagedFlagReview | null;
  gate: StartGate;
  start: StartExperiment;
  editsBlocked: string | null;
}) {
  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  const canStart =
    experiment.status === "draft" && start.canRunExperiment && !startApproved;
  // As the feature hides Publish before approval, unless an admin can bypass.
  const showStart =
    canStart && (!gate.awaitingApproval || gate.actions.waivesApproval);
  const valuesAwaitApproval =
    !!review?.requireReviews && !draftApprovalSatisfied(review);
  const requestReview =
    review?.submit?.action === "request-review" ? review.submit : null;
  const publish = review?.submit?.action === "publish" ? review.submit : null;
  const showPublish =
    !!review &&
    !review.publishIsLaunch &&
    (!!publish || review.adminBypassAvailable);

  // One bypass: a draft's is the start's, a running experiment's the publish's.
  const bypass = showStart
    ? gate.actions.bypassLabel
      ? {
          label: gate.actions.bypassLabel,
          waivesApproval: gate.actions.waivesApproval,
          value: gate.bypassed,
          set: gate.setBypassed,
        }
      : null
    : showPublish && review?.adminBypassAvailable
      ? {
          label: "Bypass remaining checks and publish now",
          waivesApproval: true,
          value: review.adminBypass,
          set: review.setAdminBypass,
        }
      : null;
  // Starting publishes what's stored, not what's staged.
  const blockedReason =
    editsBlocked ?? (showStart ? start.banditBlockedReason : null);
  const primary = showStart
    ? {
        label: gate.actions.label,
        disabled: gate.actions.disabled || !!blockedReason,
        run: gate.runPrimary,
      }
    : showPublish
      ? {
          label: "Publish now",
          disabled: !publish?.enabled || !!blockedReason,
          run: () => publish?.run(),
        }
      : null;

  return {
    requestReview,
    bypass,
    blockedReason,
    primary,
    // Where Start will be, since the header's is hidden here.
    startNote:
      canStart && !showStart
        ? valuesAwaitApproval
          ? "Start is available once the values are approved."
          : "Start is available once the Feature Flag drafts are approved."
        : experiment.status === "draft" &&
            start.canRunExperiment &&
            startApproved
          ? "Approved to start on the scheduled date. Edit the schedule to start sooner."
          : null,
  };
}

/**
 * The feature review's actions card, lighter: the values' status and people,
 * their next step, then starting (or, once running, publishing).
 */
function ReviewCard({
  experiment,
  values,
  actions,
  editsBlocked,
}: {
  experiment: ExperimentInterfaceStringDates;
  values: ValuesReview | null;
  actions: CardActions;
  editsBlocked: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const review = values?.review ?? null;
  const { requestReview, bypass, blockedReason, primary, startNote } = actions;

  const statusColor = review ? revisionStatusColor(review.status) : null;
  const statusIcon = review ? revisionStatusIcon(review.status) : null;
  // Mirrors DivergenceNotice, which draws nothing for a current draft.
  const diverged =
    !!review?.governance &&
    (review.governance.divergence !== "current" ||
      review.governance.staleApproval);
  // A conflicted draft can't be updated from live, so discarding is the fix.
  const canDiscard =
    !!review?.canManage && review.governance?.divergence === "conflict";
  const reviewLinks =
    !!review && (review.state.canRecallReview || review.state.canUndoReview);
  const hasBody =
    !!review?.requireReviews ||
    reviewLinks ||
    !!requestReview ||
    !!review?.canReview ||
    !!review?.showApprovalBand ||
    diverged ||
    !!primary ||
    !!startNote ||
    !!error ||
    !!review?.error;

  return (
    <Box className="appbox" mb="0" style={{ overflow: "hidden" }}>
      {discardConfirm && review ? (
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
      {review && statusColor ? (
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
          {review ? <ManagedFlagReviewers review={review} /> : null}
          {requestReview ? (
            <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
              <Button
                variant="soft"
                style={{ width: "100%" }}
                onClick={requestReview.run}
                setError={setError}
                disabled={!requestReview.enabled || !!editsBlocked}
              >
                {requestReview.label}
              </Button>
            </Tooltip>
          ) : null}
          {review?.canReview &&
          values &&
          !(bypass?.waivesApproval && bypass.value) ? (
            <ReviewCommentPopover
              submitUrl={`/experiment/${experiment.id}/managed-flag/submit-review`}
              storageKey={`review-comment:${values.info.feature.id}:${review.version}`}
              isBlockedContributor={review.isBlockedContributor}
              onSuccess={() => review.refresh()}
              trigger={
                <Button
                  variant={primary && !primary.disabled ? "outline" : "solid"}
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
          {review && reviewLinks ? (
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
          {review?.showApprovalBand ? (
            <Box>
              <ApprovalStatusBand
                // Nobody need wait for a reviewer an admin can bypass.
                phase={
                  review.approvalBandPhase === "waiting" &&
                  bypass?.waivesApproval
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
          {diverged && review?.governance && values ? (
            <DivergenceNotice
              governance={review.governance}
              onUpdateFromLive={review.updateFromLive}
              updating={review.rebasing}
              canRebase={review.canManage}
              liveVersion={values.info.feature.version}
              baseVersion={
                review.revision?.baseVersion ?? values.info.feature.version
              }
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
          {startNote ? (
            <Box
              pt={review ? "4" : "0"}
              style={
                review ? { borderTop: "1px solid var(--gray-a5)" } : undefined
              }
            >
              <Text size="sm" color="text-low">
                {startNote}
              </Text>
            </Box>
          ) : null}
          {primary ? (
            <Flex
              direction="column"
              gap="3"
              pt={review ? "4" : "0"}
              style={
                review ? { borderTop: "1px solid var(--gray-a5)" } : undefined
              }
            >
              {bypass ? (
                <Checkbox
                  label={
                    bypass.waivesApproval ? (
                      <span style={{ color: "var(--red-11)" }}>
                        {bypass.label}
                      </span>
                    ) : (
                      bypass.label
                    )
                  }
                  weight="regular"
                  value={bypass.value}
                  setValue={(val) => bypass.set(!!val)}
                />
              ) : null}
              <Tooltip content={blockedReason} enabled={!!blockedReason}>
                <Button
                  style={{ width: "100%" }}
                  onClick={primary.run}
                  setError={setError}
                  disabled={primary.disabled}
                >
                  {primary.label}
                </Button>
              </Tooltip>
            </Flex>
          ) : null}
          {error || review?.error ? (
            <Flex direction="column" gap="2">
              {error ? (
                <Callout status="error" size="sm">
                  {error}
                </Callout>
              ) : null}
              {review?.error ? (
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
