import { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef, ReactElement, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { RxCircleBackslash } from "react-icons/rx";
import {
  PiArrowBendRightDown,
  PiPlayFill,
  PiPauseFill,
  PiFastForward,
  PiRewind,
  PiArrowUUpLeft,
  PiArrowUUpRight,
  PiTrash,
  PiCaretUp,
  PiCaretDown,
  PiLockSimple,
  PiCaretDoubleUp,
  PiCaretDoubleDown,
  PiSpinnerGapBold,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { format as formatTimeZone } from "date-fns-tz";
import {
  isReadyForApproval,
  isAwaitingStartApproval,
  SafeRolloutInterface,
  HoldoutInterface,
  RampScheduleInterface,
} from "shared/validators";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import RampScheduleBadge from "@/components/RampSchedule/RampScheduleBadge";
import SafeRolloutRuleDashboard from "@/components/RampSchedule/SafeRolloutRuleDashboard";
import RampTimeline, {
  getRampStepsCompleted,
} from "@/components/RampSchedule/RampTimeline";
import Button from "@/ui/Button";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import ContextualBanditRefSummary from "@/components/ContextualBandit/ContextualBanditRefSummary";
import track from "@/services/track";
import {
  isRuleInactive,
  useEnvironments,
  useAttributeMap,
  getAttributesWithVersionStringMismatches,
} from "@/services/features";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import {
  ConflictBanner,
  ConflictCallout,
  getConflictBadge,
} from "@/services/rule-conflicts";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import HelperText from "@/ui/HelperText";
import Badge from "@/ui/Badge";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RuleEnvScopeBadges from "@/components/Features/RuleEnvScopeBadges";
import RuleCard from "@/components/Features/RuleCard";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Callout from "@/ui/Callout";
import SafeRolloutSummary from "@/components/Features/SafeRolloutSummary";
import SafeRolloutSnapshotProvider from "@/components/SafeRollout/SnapshotProvider";
import SafeRolloutDetails from "@/components/SafeRollout/SafeRolloutDetails";
import SafeRolloutStatusModal from "@/components/Features/SafeRollout/SafeRolloutStatusModal";
import SafeRolloutStatusBadge from "@/components/SafeRollout/SafeRolloutStatusBadge";
import DecisionCTA from "@/components/SafeRollout/DecisionCTA";
import DecisionHelpText from "@/components/SafeRollout/DecisionHelpText";
import {
  isOnMonitoredStep,
  RampMonitoringBadges,
  RampMonitoringCTAs,
  useApprovalTimerTick,
} from "@/components/RampSchedule/RampMonitoringSignals";
import { formatRollbackReason } from "@/components/RampSchedule/rollbackReason";
import TruncatedConditionDisplay from "@/components/SavedGroups/TruncatedConditionDisplay";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";

function fmtScheduleDate(d: Date | string): string {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSimpleScheduleLabel(rs: RampScheduleInterface): string {
  const parts: string[] = [];
  if (rs.startDate) {
    parts.push(`Starts ${fmtScheduleDate(rs.startDate)}`);
  }
  const endAt = rs.cutoffDate ?? null;
  if (endAt) {
    parts.push(`Disables ${fmtScheduleDate(endAt)}`);
  }
  if (parts.length > 0) return parts.join(" · ");
  return "USING SCHEDULE";
}

// Returns the scheduled enable date for a rule whose ramp is queued to flip it
// from disabled → enabled. We don't filter by past-vs-future: a pending draft
// schedule whose startDate has drifted into the past is still "queued to enable
// on publish", and we want to surface that date in the disabled badge and
// require confirmation before manual enable.
function getRampEnableDate(
  rampSchedule: RampScheduleInterface | undefined,
): Date | null {
  if (!rampSchedule) return null;
  const { status, startDate } = rampSchedule;
  if (!startDate) return null;
  if (status !== "ready" && status !== "pending") return null;
  return new Date(startDate);
}

export function formatRemainingDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = totalSeconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = totalSeconds / 3600;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = totalSeconds / 86400;
  const d = Math.floor(days);
  const h = Math.round((days - d) * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function computeRemainingTime(
  rs: RampScheduleInterface,
): { seconds: number; manualApprovals: number } | null {
  if (rs.status !== "running" && rs.status !== "paused") return null;

  let seconds = 0;
  let manualApprovals = 0;

  // The current step can have two holds that clear in sequence: the interval
  // timer first, then a manual approval. Count both remaining components — the
  // time still left on the timer plus the approval, which only becomes
  // actionable once the timer elapses — so the estimate reflects all the work
  // left before the step can advance.
  const currentStep =
    rs.currentStepIndex >= 0 ? rs.steps[rs.currentStepIndex] : undefined;
  const currentNeedsApproval =
    !!currentStep?.holdConditions?.requiresApproval &&
    rs.stepApproval?.stepIndex !== rs.currentStepIndex;
  // nextStepAt is the current step's timer; it is frozen (null) while paused.
  const currentTimerRemainingMs = rs.nextStepAt
    ? new Date(rs.nextStepAt).getTime() - Date.now()
    : 0;
  if (currentNeedsApproval) manualApprovals++;
  if (currentTimerRemainingMs > 0) {
    seconds += Math.ceil(currentTimerRemainingMs / 1000);
  }

  // Future steps still contribute their full interval and approval holds.
  for (let i = rs.currentStepIndex + 1; i < rs.steps.length; i++) {
    const step = rs.steps[i];
    if (step?.interval) {
      seconds += step.interval;
    }
    if (step?.holdConditions?.requiresApproval) {
      manualApprovals++;
    }
  }

  return { seconds, manualApprovals };
}
import ExperimentSummary from "./ExperimentSummary";
import ExperimentRefSummary, {
  isExperimentRefRuleSkipped,
} from "./ExperimentRefSummary";

interface SortableProps {
  // Global flat index into `feature.rules`; fallback addressing for the modal.
  i: number;
  rule: FeatureRule;
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  setRuleModal: (args: {
    environment: string;
    i: number;
    ruleId?: string;
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
    detachRampOnSave?: boolean;
  }) => void;
  unreachable?: boolean;
  // Conflict banners for the callout. One per shared status; in the all-envs
  // view each names the environments it covers (hard = "will not reach", soft =
  // "may not reach", unreachable = the rule(s) consuming it).
  conflictBanners?: ConflictBanner[];
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
  // `locked` is caused by a pending scheduled publish. Ramp runtime controls act
  // on live state, not draft content, so they stay interactive.
  lockedBySchedule?: boolean;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  hideInactive?: boolean;
  isDraft: boolean;
  holdout: HoldoutInterface | undefined;
  revisionList: MinimalFeatureRevisionInterface[];
  rampSchedule?: RampScheduleInterface;
  draftRevision?: FeatureRevisionInterface | null;
  // True when rendered under the all-environments view. The `environment`
  // prop is then a cosmetic placeholder and must NOT promote a "current env"
  // in the env-scope badges.
  isAllEnvsView?: boolean;
  // Provided by RuleList to support keyboard/menu reordering. Each callback
  // moves the rule by one position in the current visible projection and
  // posts the equivalent flat-index reorder to the API. Undefined when the
  // rule cannot move in that direction.
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToTop?: () => void;
  onMoveToBottom?: () => void;
  // True when the draft intentionally disabled a rule that's enabled in live —
  // publishing would revert a schedule-driven enable (aggressive warning).
  willRevertScheduleEnable?: boolean;
  // True when the draft is behind live and this rule's shown state differs from
  // live for a reason a rebase would reconcile — a gentle "behind live" hint.
  draftBehindLiveStale?: boolean;
}

type RuleProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

function isRuleSkipped({
  rule,
  linkedExperiment,
  isDraft,
}: {
  rule: FeatureRule;
  isDraft: boolean;
  linkedExperiment?: ExperimentInterfaceStringDates;
}): boolean {
  // Not live yet
  const upcomingScheduleRule = getUpcomingScheduleRule(rule);
  if (upcomingScheduleRule?.enabled && rule?.scheduleRules?.length) return true;

  if (
    !upcomingScheduleRule &&
    rule?.scheduleRules?.length &&
    rule.scheduleRules.at(-1)?.timestamp !== null
  ) {
    return true;
  }

  if (
    linkedExperiment &&
    isExperimentRefRuleSkipped(linkedExperiment, isDraft)
  ) {
    return true;
  }

  return false;
}

// eslint-disable-next-line
export const Rule = forwardRef<HTMLDivElement, RuleProps>(
  (
    {
      i,
      rule,
      feature,
      environment,
      setRuleModal,
      mutate,
      handle,
      unreachable,
      conflictBanners,
      version,
      setVersion,
      locked,
      lockedBySchedule,
      experimentsMap,
      safeRolloutsMap,
      hideInactive,
      isDraft,
      holdout,
      revisionList,
      rampSchedule,
      draftRevision,
      isAllEnvsView,
      onMoveUp,
      onMoveDown,
      onMoveToTop,
      onMoveToBottom,
      willRevertScheduleEnable,
      draftBehindLiveStale,
      ...props
    },
    ref,
  ) => {
    const { apiCall } = useAuth();

    // A scheduled-publish edit lock leaves ramp runtime controls interactive;
    // other lock reasons (old/discarded revisions) still disable them.
    const rampControlsLocked = locked && !lockedBySchedule;

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const [safeRolloutStatusModalOpen, setSafeRolloutStatusModalOpen] =
      useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showDeleteRuleModal, setShowDeleteRuleModal] = useState(false);
    const [rampApproveLoading, setRampApproveLoading] = useState(false);
    const [rampApproveError, setRampApproveError] = useState("");
    useApprovalTimerTick(rampSchedule);
    const rollbackToStart = async (reason = "rolled back to start") => {
      if (!rampSchedule) return;
      await apiCall(`/ramp-schedule/${rampSchedule.id}/actions/rollback`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await mutate();
    };

    const defaultDraft = useDefaultDraft(revisionList);
    const [deleteMode, setDeleteMode] = useState<DraftMode>(
      defaultDraft !== null ? "existing" : "new",
    );
    const [deleteSelectedDraft, setDeleteSelectedDraft] = useState<
      number | null
    >(defaultDraft);
    const settings = useOrgSettings();

    const toggleRuleEnabled = async () => {
      setDropdownOpen(false);
      track(rule.enabled ? "Disable Feature Rule" : "Enable Feature Rule", {
        ruleIndex: i,
        environment,
        type: rule.type,
      });
      const res = await apiCall<{ version: number }>(
        `/feature/${feature.id}/${version}/rule`,
        {
          method: "PUT",
          body: JSON.stringify({
            ruleId: rule.id,
            rule: {
              ...rule,
              enabled: !rule.enabled,
            },
          }),
        },
      );
      await mutate();
      res.version && setVersion(res.version);
    };

    const attributeMap = useAttributeMap(feature.project);
    const attributesWithVersionStringOperatorMismatches =
      getAttributesWithVersionStringMismatches(
        rule.condition || "",
        attributeMap,
      );

    // Number by global flat index; fall back to `i` mid-drag.
    const flatIdx = rule.id
      ? (feature.rules ?? []).findIndex((r) => r.id === rule.id)
      : -1;
    const globalRuleIdx = flatIdx === -1 ? i : flatIdx;

    let title: string | ReactElement =
      rule.description || rule.type[0].toUpperCase() + rule.type.slice(1);
    if (rule.type !== "rollout") {
      title += " Rule";
    }
    if (rule.type === "experiment") {
      title = (
        <div className="d-flex align-items-center">
          {title}
          <Tooltip
            body={`This is a legacy "inline experiment" feature rule. New experiment rules must be created as references to experiments.`}
          >
            <HelperText status="info" size="sm" ml="3">
              legacy
            </HelperText>
          </Tooltip>
        </div>
      );
    }

    const linkedExperiment =
      rule.type === "experiment-ref" && experimentsMap.get(rule.experimentId);

    const permissionsUtil = usePermissionsUtil();
    const router = useRouter();
    const useDummyData = router.query["dummy"] === "true";

    const canEdit =
      permissionsUtil.canViewFeatureModal(feature.project) &&
      permissionsUtil.canManageFeatureDrafts(feature);

    const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
      const raw = settings?.requireReviews;
      if (raw === true) return "all";
      if (!Array.isArray(raw)) return "none";
      const reviewSetting = getReviewSetting(raw, feature);
      if (!reviewSetting?.requireReviewOn) return "none";
      const envList = reviewSetting.environments ?? [];
      return envList.length === 0 ? "all" : new Set(envList);
    }, [settings?.requireReviews, feature]);

    const isInactive = isRuleInactive(rule, experimentsMap);

    const hasCondition =
      (rule.condition && rule.condition !== "{}") ||
      !!rule.savedGroups?.length ||
      !!rule.prerequisites?.length;

    let safeRollout: SafeRolloutInterface | undefined;

    if (rule.type === "safe-rollout") {
      safeRollout = safeRolloutsMap.get(rule.safeRolloutId);
    } else if (rampSchedule?.safeRolloutId) {
      safeRollout = safeRolloutsMap.get(rampSchedule.safeRolloutId);
    }

    const hasPendingDetach =
      isDraft &&
      draftRevision?.rampActions?.some(
        (action) => action.mode === "detach" && action.ruleId === rule.id,
      );

    const info = getRuleMetaInfo({
      rule,
      experimentsMap,
      isDraft,
      unreachable,
      conflictBanners,
      rampSchedule,
      rampPendingDetach: !!hasPendingDetach,
    });

    if (hideInactive && isInactive) {
      return null;
    }

    const rampIsTerminal =
      rampSchedule !== undefined &&
      ["completed", "rolled-back"].includes(rampSchedule.status);
    const isSimpleSchedule = !!rampSchedule && rampSchedule.steps.length === 0;
    const hasMonitoringStatusRow =
      !!rampSchedule?.safeRolloutId &&
      rampSchedule.steps.some((s) => s.monitored);
    // Synthetic schedules (synthesized client-side from a pending draft create
    // action) carry a placeholder id and have no server-side counterpart, so
    // ramp action CTAs (Start/Resume/Approve) must be suppressed.
    const isSyntheticRamp =
      !!rampSchedule && rampSchedule.id.startsWith("pending-");

    const ruleTags: React.ReactNode[] = [];
    const ruleCtas: React.ReactNode[] = [];

    if (rampSchedule) {
      ruleTags.push(
        <RampScheduleBadge
          key="ramp-badge"
          rs={rampSchedule}
          pendingDetach={!!hasPendingDetach}
          simpleSchedule={isSimpleSchedule}
          featureRuleContext
        />,
      );
    }

    if (useDummyData && hasMonitoringStatusRow) {
      ruleTags.push(
        <Badge
          key="demo-badge"
          label="Using dummy data"
          color="cyan"
          variant="soft"
        />,
      );
    }

    if (
      rampSchedule &&
      !rampControlsLocked &&
      !rampIsTerminal &&
      !hasPendingDetach &&
      // Simple (stepless) schedules have no step CTAs, but a stepless schedule
      // genuinely awaiting start approval still needs its "Approve & start"
      // button — otherwise the "awaiting approval" badge has no way to clear.
      (!isSimpleSchedule || isAwaitingStartApproval(rampSchedule)) &&
      !isSyntheticRamp
    ) {
      if (rampSchedule.status === "ready" && rampSchedule.targets.length > 0) {
        // An approval-gated hold uses the shared approve-step action (which
        // clears whichever gate is pending — here the pre-start hold, starting
        // the ramp); a plain scheduled ready schedule uses start (start-early).
        const awaitingStartApproval = isAwaitingStartApproval(rampSchedule);
        ruleCtas.push(
          <Button
            key="ramp-start"
            size="xs"
            variant="solid"
            onClick={async () => {
              await apiCall(
                `/ramp-schedule/${rampSchedule.id}/actions/${
                  awaitingStartApproval ? "approve-step" : "start"
                }`,
                { method: "POST" },
              );
              await mutate();
            }}
          >
            {awaitingStartApproval ? "Approve & start" : "Start"}
          </Button>,
        );
      }
      if (rampSchedule.status === "paused" && rampSchedule.targets.length > 0) {
        ruleCtas.push(
          <Button
            key="ramp-resume"
            size="xs"
            variant="solid"
            onClick={async () => {
              await apiCall(
                `/ramp-schedule/${rampSchedule.id}/actions/resume`,
                { method: "POST" },
              );
              await mutate();
            }}
          >
            Resume
          </Button>,
        );
      }
      // RampMonitoringCTAs owns the "Approve Step" CTA when the current step is
      // monitored — skip adding it here to avoid a duplicate button.
      const approvalHandledByMonitoringCTAs =
        !!safeRollout && !rampControlsLocked && isOnMonitoredStep(rampSchedule);
      // Only surface the approval CTA once the step's interval has elapsed —
      // approval is the final gate, so we don't prompt while the timer counts.
      if (
        isReadyForApproval(rampSchedule) &&
        !approvalHandledByMonitoringCTAs
      ) {
        ruleCtas.push(
          <Button
            key="ramp-approve"
            size="xs"
            variant="solid"
            loading={rampApproveLoading}
            onClick={async () => {
              setRampApproveError("");
              setRampApproveLoading(true);
              try {
                await apiCall(
                  `/ramp-schedule/${rampSchedule.id}/actions/approve-step`,
                  { method: "POST" },
                );
                await mutate();
              } catch (e) {
                setRampApproveError(e instanceof Error ? e.message : String(e));
              } finally {
                setRampApproveLoading(false);
              }
            }}
          >
            Approve Step
          </Button>,
        );
      }
    }

    // Terminal "rolled-back" gets an inline Restart CTA so the user can bring
    // the schedule back to a startable state without hunting through the
    // dropdown menu. The "Start" CTA above will pick up once it's `ready`.
    if (
      rampSchedule &&
      !rampControlsLocked &&
      !hasPendingDetach &&
      !isSimpleSchedule &&
      !isSyntheticRamp &&
      rampSchedule.status === "rolled-back"
    ) {
      const cutoffPast =
        rampSchedule.cutoffDate &&
        new Date(rampSchedule.cutoffDate) <= new Date();
      ruleCtas.push(
        cutoffPast ? (
          <Tooltip
            key="ramp-restart"
            body="The scheduled end date has already passed. Edit the schedule to remove or update the end date before restarting."
          >
            <Button size="xs" variant="solid" disabled>
              Restart
            </Button>
          </Tooltip>
        ) : (
          <Button
            key="ramp-restart"
            size="xs"
            variant="solid"
            onClick={async () => {
              await apiCall(
                `/ramp-schedule/${rampSchedule.id}/actions/restart`,
                { method: "POST" },
              );
              await mutate();
            }}
          >
            Restart
          </Button>
        ),
      );
    }

    if (
      rule.type === "safe-rollout" &&
      !rampControlsLocked &&
      rule.enabled !== false
    ) {
      ruleCtas.push(
        <DecisionCTA
          key="safe-rollout-decision"
          rule={rule}
          openStatusModal={() => {
            setSafeRolloutStatusModalOpen(true);
          }}
        />,
      );
    }

    const contents = (
      <Box {...props} ref={ref}>
        {showDeleteRuleModal && (
          <ModalStandard
            trackingEventModalType="delete-feature-rule"
            header="Delete rule"
            size="lg"
            close={() => setShowDeleteRuleModal(false)}
            open={true}
            cta="Save deletion"
            ctaColor="red"
            submit={async () => {
              track("Delete Feature Rule", {
                ruleIndex: i,
                environment,
                type: rule.type,
              });
              const targetVersion =
                deleteMode === "existing" && deleteSelectedDraft !== null
                  ? deleteSelectedDraft
                  : feature.version;
              const res = await apiCall<{ version: number }>(
                `/feature/${feature.id}/${targetVersion}/rule`,
                {
                  method: "DELETE",
                  body: JSON.stringify({ ruleId: rule.id }),
                },
              );
              await mutate();
              res.version && setVersion(res.version);
            }}
          >
            <Box>
              <DraftSelectorForChanges
                feature={feature}
                revisionList={revisionList}
                mode={deleteMode}
                setMode={setDeleteMode}
                selectedDraft={deleteSelectedDraft}
                setSelectedDraft={setDeleteSelectedDraft}
                canAutoPublish={false}
                gatedEnvSet={gatedEnvSet}
                triggerPrefix="Rule deletion will be"
              />
              <Text color="text-high" as="p">
                This rule will be removed when the revision is published. The
                live feature will not change until then.
              </Text>
            </Box>
          </ModalStandard>
        )}
        <RuleCard
          index={holdout ? globalRuleIdx + 2 : globalRuleIdx + 1}
          sideColor={info.sideColor}
          dragHandleProps={
            (feature.rules?.length ?? 0) > 1 && canEdit && !locked
              ? handle
              : undefined
          }
        >
          <Flex
            justify="between"
            align="start"
            mb="3"
            gap="8"
            style={{ maxWidth: "100%" }}
          >
            <Flex
              align="center"
              gap="2"
              style={{ flex: "0 1 auto", flexWrap: "wrap" }}
            >
              <Heading as="h4" size="medium" weight="medium" mb="0">
                {linkedExperiment ? (
                  <>
                    {linkedExperiment.type === "multi-armed-bandit"
                      ? "Bandit"
                      : "Experiment"}
                    :{" "}
                    <Link
                      href={`/${
                        linkedExperiment.type === "multi-armed-bandit"
                          ? "bandit"
                          : "experiment"
                      }/${linkedExperiment.id}`}
                      style={{ marginRight: "var(--space-2)" }}
                    >
                      {linkedExperiment.name}
                    </Link>
                    {linkedExperiment && (
                      <span style={{ verticalAlign: "1px" }}>
                        <ExperimentStatusIndicator
                          experimentData={linkedExperiment}
                        />
                      </span>
                    )}
                  </>
                ) : rule.type === "safe-rollout" ? (
                  <span>Safe Rollout</span>
                ) : (
                  <span>{title}</span>
                )}
              </Heading>

              {rule.type === "safe-rollout" && (
                <SafeRolloutStatusBadge rule={rule} />
              )}

              {ruleTags}

              {rampSchedule &&
                safeRollout &&
                isOnMonitoredStep(rampSchedule) && (
                  <RampMonitoringBadges rampSchedule={rampSchedule} />
                )}
            </Flex>

            <Flex align="center" gap="3" flexShrink="0">
              {rampSchedule &&
                safeRollout &&
                !rampControlsLocked &&
                isOnMonitoredStep(rampSchedule) && (
                  <RampMonitoringCTAs
                    rampSchedule={rampSchedule}
                    onRollback={async (reason?: string) => {
                      await apiCall(
                        `/ramp-schedule/${rampSchedule.id}/actions/rollback`,
                        {
                          method: "POST",
                          body: JSON.stringify(reason ? { reason } : {}),
                        },
                      );
                      await mutate();
                    }}
                    onAdvance={async () => {
                      await apiCall(
                        `/ramp-schedule/${rampSchedule.id}/actions/advance`,
                        { method: "POST" },
                      );
                      await mutate();
                    }}
                    onApproveStep={async () => {
                      await apiCall(
                        `/ramp-schedule/${rampSchedule.id}/actions/approve-step`,
                        { method: "POST" },
                      );
                      await mutate();
                    }}
                  />
                )}
              {ruleCtas}

              {info.pill}

              {/* Shown when rule-edit OR ramp runtime actions are available.
                Under a scheduled-publish lock the rule-edit group is hidden but
                ramp/schedule actions remain. */}
              {canEdit &&
                !rampControlsLocked &&
                (!locked || !!rampSchedule) && (
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                        style={{ margin: 0 }}
                      >
                        <BsThreeDotsVertical size={16} />
                      </IconButton>
                    }
                    open={dropdownOpen}
                    onOpenChange={setDropdownOpen}
                    menuPlacement="end"
                    variant="soft"
                  >
                    {!locked && (
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => {
                            setRuleModal({
                              environment,
                              i,
                              ruleId: rule.id,
                              mode: "edit",
                            });
                            setDropdownOpen(false);
                          }}
                        >
                          Edit
                        </DropdownMenuItem>
                        {rule.type !== "experiment-ref" && (
                          <DropdownMenuItem
                            onClick={() => {
                              setRuleModal({
                                environment,
                                i,
                                ruleId: rule.id,
                                mode: "duplicate",
                              });
                              setDropdownOpen(false);
                            }}
                          >
                            Duplicate rule
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={
                            !rule.enabled && getRampEnableDate(rampSchedule)
                              ? undefined
                              : toggleRuleEnabled
                          }
                          confirmation={(() => {
                            const d = !rule.enabled
                              ? getRampEnableDate(rampSchedule)
                              : null;
                            if (!d) return undefined;
                            return {
                              confirmationTitle: "Enable rule now?",
                              getConfirmationContent: async () =>
                                `This rule is scheduled to go live on ${fmtScheduleDate(d)}. Enabling now bypasses the schedule and will set the rule live immediately.`,
                              cta: "Enable now",
                              ctaColor: "violet",
                              submit: toggleRuleEnabled,
                            };
                          })()}
                        >
                          {rule.enabled ? "Disable" : "Enable"}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    )}
                    {!locked &&
                      (onMoveUp ||
                        onMoveDown ||
                        onMoveToTop ||
                        onMoveToBottom) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            {onMoveToTop && (
                              <DropdownMenuItem
                                onClick={() => {
                                  onMoveToTop();
                                  setDropdownOpen(false);
                                }}
                              >
                                <PiCaretDoubleUp /> Move to top
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              disabled={!onMoveUp}
                              onClick={() => {
                                if (onMoveUp) {
                                  onMoveUp();
                                  setDropdownOpen(false);
                                }
                              }}
                            >
                              <PiCaretUp /> Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!onMoveDown}
                              onClick={() => {
                                if (onMoveDown) {
                                  onMoveDown();
                                  setDropdownOpen(false);
                                }
                              }}
                            >
                              <PiCaretDown /> Move down
                            </DropdownMenuItem>
                            {onMoveToBottom && (
                              <DropdownMenuItem
                                onClick={() => {
                                  onMoveToBottom();
                                  setDropdownOpen(false);
                                }}
                              >
                                <PiCaretDoubleDown /> Move to bottom
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                        </>
                      )}
                    {rampSchedule &&
                      isSimpleSchedule &&
                      !!rampSchedule.cutoffDate &&
                      ["running", "paused"].includes(rampSchedule.status) && (
                        <>
                          {!locked && <DropdownMenuSeparator />}
                          <DropdownMenuGroup label="Schedule">
                            <DropdownMenuItem
                              onClick={async () => {
                                await apiCall(
                                  `/ramp-schedule/${rampSchedule.id}/actions/complete`,
                                  { method: "POST" },
                                );
                                await mutate();
                                setDropdownOpen(false);
                              }}
                            >
                              <Flex align="center" gap="2">
                                <PiFastForward /> Complete schedule and disable
                              </Flex>
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    {!locked &&
                      rampSchedule &&
                      isSimpleSchedule &&
                      !!rampSchedule.cutoffDate &&
                      ["completed", "rolled-back"].includes(
                        rampSchedule.status,
                      ) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup label="Schedule">
                            <DropdownMenuItem
                              onClick={async () => {
                                const res = await apiCall<{
                                  version: number;
                                }>(`/feature/${feature.id}/${version}/rule`, {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    ruleId: rule.id,
                                    rule,
                                    rampSchedule: {
                                      mode: "detach",
                                      rampScheduleId: rampSchedule.id,
                                      deleteScheduleWhenEmpty: true,
                                    },
                                  }),
                                });
                                if (res.version) setVersion(res.version);
                                await mutate();
                                setDropdownOpen(false);
                              }}
                            >
                              <Flex align="center" gap="2">
                                <PiTrash /> Remove schedule
                              </Flex>
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    {rampSchedule && !isSimpleSchedule && !isSyntheticRamp && (
                      <>
                        {!locked && <DropdownMenuSeparator />}
                        <DropdownMenuGroup label="Ramp-up schedule">
                          {hasPendingDetach ? (
                            // Canceling a pending removal edits the draft, so it's
                            // gated by the edit-lock; runtime actions below are not.
                            !locked && (
                              <DropdownMenuItem
                                onClick={async () => {
                                  const res = await apiCall<{
                                    version: number;
                                  }>(`/feature/${feature.id}/${version}/rule`, {
                                    method: "PUT",
                                    body: JSON.stringify({
                                      ruleId: rule.id,
                                      rule,
                                      rampSchedule: { mode: "clear" },
                                    }),
                                  });
                                  if (res.version) setVersion(res.version);
                                  await mutate();
                                  setDropdownOpen(false);
                                }}
                              >
                                Cancel removal of schedule
                              </DropdownMenuItem>
                            )
                          ) : (
                            <>
                              {/* pending: blocked Start */}
                              {rampSchedule.status === "pending" && (
                                <Tooltip
                                  tipPosition="left"
                                  body={`Cannot start while ramp is pending.${
                                    rampSchedule.targets.find(
                                      (t) => !!t.activatingRevisionVersion,
                                    )?.activatingRevisionVersion
                                      ? ` Publish Revision ${rampSchedule.targets.find((t) => !!t.activatingRevisionVersion)?.activatingRevisionVersion} first.`
                                      : ""
                                  }`}
                                >
                                  <div style={{ cursor: "not-allowed" }}>
                                    <DropdownMenuItem disabled>
                                      <Flex align="center" gap="2">
                                        <PiPlayFill /> Start now
                                      </Flex>
                                    </DropdownMenuItem>
                                  </div>
                                </Tooltip>
                              )}
                              {/* ready: Start now */}
                              {rampSchedule.status === "ready" &&
                                (rampSchedule.targets.length === 0 ? (
                                  <Tooltip
                                    body="No implementations linked"
                                    tipPosition="left"
                                  >
                                    <div style={{ cursor: "not-allowed" }}>
                                      <DropdownMenuItem disabled>
                                        <Flex align="center" gap="2">
                                          <PiPlayFill /> Start now
                                        </Flex>
                                      </DropdownMenuItem>
                                    </div>
                                  </Tooltip>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      await apiCall(
                                        `/ramp-schedule/${rampSchedule.id}/actions/start`,
                                        { method: "POST" },
                                      );
                                      await mutate();
                                      setDropdownOpen(false);
                                    }}
                                  >
                                    <Flex align="center" gap="2">
                                      <PiPlayFill /> Start now
                                    </Flex>
                                  </DropdownMenuItem>
                                ))}
                              {/* Pause */}
                              {rampSchedule.status === "running" && (
                                <DropdownMenuItem
                                  onClick={async () => {
                                    await apiCall(
                                      `/ramp-schedule/${rampSchedule.id}/actions/pause`,
                                      { method: "POST" },
                                    );
                                    await mutate();
                                    setDropdownOpen(false);
                                  }}
                                >
                                  <Flex align="center" gap="2">
                                    <PiPauseFill /> Pause
                                  </Flex>
                                </DropdownMenuItem>
                              )}
                              {/* Resume */}
                              {rampSchedule.status === "paused" &&
                                (rampSchedule.targets.length === 0 ? (
                                  <Tooltip
                                    body="No implementations linked"
                                    tipPosition="left"
                                  >
                                    <div style={{ cursor: "not-allowed" }}>
                                      <DropdownMenuItem disabled>
                                        <Flex align="center" gap="2">
                                          <PiPlayFill /> Resume
                                        </Flex>
                                      </DropdownMenuItem>
                                    </div>
                                  </Tooltip>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      await apiCall(
                                        `/ramp-schedule/${rampSchedule.id}/actions/resume`,
                                        { method: "POST" },
                                      );
                                      await mutate();
                                      setDropdownOpen(false);
                                    }}
                                  >
                                    <Flex align="center" gap="2">
                                      <PiPlayFill /> Resume
                                    </Flex>
                                  </DropdownMenuItem>
                                ))}
                              {/* Roll back / Jump ahead / Complete — active ramps */}
                              {["running", "paused"].includes(
                                rampSchedule.status,
                              ) && (
                                <>
                                  {rampSchedule.currentStepIndex >= 0 &&
                                    (() => {
                                      const backSteps = rampSchedule.steps
                                        .map((_, idx) => idx)
                                        .filter(
                                          (idx) =>
                                            idx < rampSchedule.currentStepIndex,
                                        );
                                      return (
                                        <DropdownSubMenu
                                          trigger={
                                            <Flex align="center" gap="2">
                                              <PiArrowUUpLeft /> Roll back to
                                            </Flex>
                                          }
                                        >
                                          <DropdownMenuItem
                                            onClick={async () => {
                                              await rollbackToStart();
                                              setDropdownOpen(false);
                                            }}
                                          >
                                            <Flex align="center" gap="2">
                                              <PiRewind /> Start
                                            </Flex>
                                          </DropdownMenuItem>
                                          {backSteps.length > 0 && (
                                            <DropdownMenuSeparator />
                                          )}
                                          {backSteps.map((stepIdx) => (
                                            <DropdownMenuItem
                                              key={stepIdx}
                                              onClick={async () => {
                                                await apiCall(
                                                  `/ramp-schedule/${rampSchedule.id}/actions/jump`,
                                                  {
                                                    method: "POST",
                                                    body: JSON.stringify({
                                                      targetStepIndex: stepIdx,
                                                    }),
                                                  },
                                                );
                                                await mutate();
                                                setDropdownOpen(false);
                                              }}
                                            >
                                              Step {stepIdx + 1}
                                            </DropdownMenuItem>
                                          ))}
                                        </DropdownSubMenu>
                                      );
                                    })()}
                                  {rampSchedule.currentStepIndex <
                                    rampSchedule.steps.length - 1 && (
                                    <DropdownSubMenu
                                      trigger={
                                        <Flex align="center" gap="2">
                                          <PiArrowUUpRight /> Jump ahead to
                                        </Flex>
                                      }
                                    >
                                      {rampSchedule.steps
                                        .map((_, idx) => idx)
                                        .filter(
                                          (idx) =>
                                            idx > rampSchedule.currentStepIndex,
                                        )
                                        .map((stepIdx) => (
                                          <DropdownMenuItem
                                            key={stepIdx}
                                            onClick={async () => {
                                              await apiCall(
                                                `/ramp-schedule/${rampSchedule.id}/actions/jump`,
                                                {
                                                  method: "POST",
                                                  body: JSON.stringify({
                                                    targetStepIndex: stepIdx,
                                                  }),
                                                },
                                              );
                                              await mutate();
                                              setDropdownOpen(false);
                                            }}
                                          >
                                            Step {stepIdx + 1}
                                          </DropdownMenuItem>
                                        ))}
                                    </DropdownSubMenu>
                                  )}
                                  {(() => {
                                    const hasCutoff = !!rampSchedule.cutoffDate;
                                    const allStepsDone =
                                      rampSchedule.currentStepIndex >=
                                      rampSchedule.steps.length;
                                    return (
                                      <>
                                        {!allStepsDone && (
                                          <DropdownMenuItem
                                            onClick={async () => {
                                              await apiCall(
                                                `/ramp-schedule/${rampSchedule.id}/actions/complete`,
                                                { method: "POST" },
                                              );
                                              await mutate();
                                              setDropdownOpen(false);
                                            }}
                                          >
                                            <Flex align="center" gap="2">
                                              <PiFastForward /> Complete ramp
                                            </Flex>
                                          </DropdownMenuItem>
                                        )}
                                        {hasCutoff && (
                                          <DropdownMenuItem
                                            onClick={async () => {
                                              await apiCall(
                                                `/ramp-schedule/${rampSchedule.id}/actions/complete`,
                                                {
                                                  method: "POST",
                                                  body: JSON.stringify({
                                                    disableRule: true,
                                                  }),
                                                },
                                              );
                                              await mutate();
                                              setDropdownOpen(false);
                                            }}
                                          >
                                            <Flex align="center" gap="2">
                                              <PiFastForward /> Complete ramp
                                              and disable rule
                                            </Flex>
                                          </DropdownMenuItem>
                                        )}
                                      </>
                                    );
                                  })()}
                                </>
                              )}
                              {/* Restart / Remove — terminal states */}
                              {rampIsTerminal && (
                                <>
                                  {rampSchedule.cutoffDate &&
                                  new Date(rampSchedule.cutoffDate) <=
                                    new Date() ? (
                                    <Tooltip
                                      tipPosition="left"
                                      body="The scheduled end date has already passed. Edit the schedule to remove or update the end date before restarting."
                                    >
                                      <div style={{ cursor: "not-allowed" }}>
                                        <DropdownMenuItem disabled>
                                          <Flex align="center" gap="2">
                                            <PiRewind /> Restart ramp
                                          </Flex>
                                        </DropdownMenuItem>
                                      </div>
                                    </Tooltip>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        await apiCall(
                                          `/ramp-schedule/${rampSchedule.id}/actions/restart`,
                                          { method: "POST" },
                                        );
                                        await mutate();
                                        setDropdownOpen(false);
                                      }}
                                    >
                                      <Flex align="center" gap="2">
                                        <PiRewind /> Restart ramp
                                      </Flex>
                                    </DropdownMenuItem>
                                  )}
                                  {!locked && (
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        const res = await apiCall<{
                                          version: number;
                                        }>(
                                          `/feature/${feature.id}/${version}/rule`,
                                          {
                                            method: "PUT",
                                            body: JSON.stringify({
                                              ruleId: rule.id,
                                              rule,
                                              rampSchedule: {
                                                mode: "detach",
                                                rampScheduleId: rampSchedule.id,
                                                deleteScheduleWhenEmpty: true,
                                              },
                                            }),
                                          },
                                        );
                                        if (res.version)
                                          setVersion(res.version);
                                        await mutate();
                                        setDropdownOpen(false);
                                      }}
                                    >
                                      <Flex align="center" gap="2">
                                        <PiTrash /> Remove schedule
                                      </Flex>
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </DropdownMenuGroup>
                      </>
                    )}
                    {!locked && (
                      <DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          color="red"
                          onClick={() => {
                            setDeleteMode(
                              defaultDraft !== null ? "existing" : "new",
                            );
                            setDeleteSelectedDraft(defaultDraft);
                            setShowDeleteRuleModal(true);
                            setDropdownOpen(false);
                          }}
                        >
                          Delete rule
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    )}
                  </DropdownMenu>
                )}
            </Flex>
          </Flex>
          <Box>{info.callout}</Box>
          {willRevertScheduleEnable ? (
            <Callout status="warning" mt="3" size="sm">
              This rule is <strong>enabled</strong> in the live feature but{" "}
              <strong>disabled</strong> in this draft. Publishing may revert a
              schedule-driven enable.
            </Callout>
          ) : draftBehindLiveStale ? (
            <Box mt="3">
              <HelperText status="info" size="sm">
                This draft is behind live — rebase (Review and Publish tab) to
                compare
              </HelperText>
            </Box>
          ) : null}
          {rampSchedule &&
            isReadyForApproval(rampSchedule) &&
            rampSchedule.steps[rampSchedule.currentStepIndex]
              ?.approvalNotes && (
              <Callout
                status="attention"
                mt="3"
                size="sm"
                icon={<PiSpinnerGapBold />}
              >
                <strong>Approval Notes:</strong>{" "}
                {
                  rampSchedule.steps[rampSchedule.currentStepIndex]
                    ?.approvalNotes
                }
              </Callout>
            )}
          {attributesWithVersionStringOperatorMismatches &&
            attributesWithVersionStringOperatorMismatches.length > 0 && (
              <Callout status="warning" mt="3">
                <Flex direction="column" gap="2">
                  <Text>
                    This rule uses string operators on version attributes, which
                    can have unintended effects. Edit this rule and change{" "}
                    <strong>
                      {attributesWithVersionStringOperatorMismatches.join(", ")}
                    </strong>{" "}
                    to use version operators ($vgt, $vlt, etc.) instead.
                  </Text>
                </Flex>
              </Callout>
            )}
          <RuleEnvScopeBadges
            activeEnvironmentIds={
              rule.allEnvironments === true || rule.environments === undefined
                ? "all"
                : rule.environments
            }
            environments={environments}
            currentEnvironment={isAllEnvsView ? undefined : environment}
          />
          <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
            {rule.type === "safe-rollout" && safeRollout ? (
              <>
                <DecisionHelpText rule={rule} />
                {rule.description ? <Box pb="3">{rule.description}</Box> : null}
              </>
            ) : null}
            <Box mb="3">
              {hasCondition && rule.type !== "experiment-ref" ? (
                <TruncatedConditionDisplay
                  condition={rule.condition || ""}
                  savedGroups={rule.savedGroups}
                  prerequisites={rule.prerequisites}
                  maxLength={500}
                  prefix={<Text weight="medium">IF</Text>}
                />
              ) : rule.type !== "experiment-ref" &&
                rule.type !== "rollout" &&
                rule.type !== "safe-rollout" ? (
                <em>No targeting (all traffic will be included)</em>
              ) : null}
            </Box>
            {rule.type === "force" && (
              <ForceSummary
                value={rule.value}
                feature={feature}
                sparse={rule.sparse}
              />
            )}
            {rule.type === "rollout" && (
              <RolloutSummary
                value={rule.value ?? ""}
                coverage={rule.coverage ?? 1}
                feature={feature}
                hashAttribute={rule.hashAttribute || ""}
                sparse={rule.sparse}
                monitored={
                  rampSchedule?.currentStepIndex !== undefined &&
                  rampSchedule.currentStepIndex >= 0 &&
                  rampSchedule.steps[rampSchedule.currentStepIndex]?.monitored
                }
              />
            )}
            {rule.type === "safe-rollout" &&
              (safeRollout ? (
                <Box>
                  <SafeRolloutSummary
                    safeRollout={safeRollout}
                    rule={rule}
                    feature={feature}
                  />
                  {safeRollout?.startedAt && (
                    <SafeRolloutStatusModal
                      safeRollout={safeRollout}
                      rule={rule}
                      feature={feature}
                      environment={environment}
                      setVersion={setVersion}
                      mutate={mutate}
                      open={safeRolloutStatusModalOpen}
                      setStatusModalOpen={setSafeRolloutStatusModalOpen}
                      valueType={feature.valueType}
                    />
                  )}
                  {safeRollout?.startedAt && (
                    <Flex direction="column" mt="4" gap="4">
                      <SafeRolloutDetails
                        safeRollout={safeRollout}
                        projectId={feature.project}
                      />
                    </Flex>
                  )}
                  {!safeRollout?.startedAt && (
                    <Callout status="info" mt="4">
                      This Safe Rollout rule is in a draft state and will start
                      when this feature revision is published.
                    </Callout>
                  )}
                </Box>
              ) : (
                <div>
                  {/* Better error state if safe rollout is not found */}
                  <p>Safe Rollout not found</p>
                </div>
              ))}
            {rule.type === "experiment" && (
              <ExperimentSummary
                feature={feature}
                experiment={Array.from(experimentsMap.values()).find(
                  (exp) => exp.trackingKey === (rule.trackingKey || feature.id),
                )}
                rule={rule}
              />
            )}
            {rule.type === "experiment-ref" && (
              <ExperimentRefSummary
                feature={feature}
                experiment={experimentsMap.get(rule.experimentId)}
                rule={rule}
                isDraft={isDraft}
              />
            )}
            {rule.type === "contextual-bandit-ref" && (
              <ContextualBanditRefSummary rule={rule} feature={feature} />
            )}
            {rampSchedule && (
              <Box mt="4">
                {!isSimpleSchedule && (
                  <Flex gapX="3" gapY="1" align="center" mb="4" wrap="wrap">
                    <span style={{ display: "inline-block" }}>
                      <Text weight="medium">RAMP-UP SCHEDULE</Text>
                    </span>
                    {!["pending", "ready", "completed", "rolled-back"].includes(
                      rampSchedule.status,
                    ) && (
                      <Text>
                        Step {getRampStepsCompleted(rampSchedule)} of{" "}
                        {rampSchedule.steps.length}
                      </Text>
                    )}
                    {(() => {
                      const remaining = computeRemainingTime(rampSchedule);
                      if (!remaining) return null;
                      const { seconds, manualApprovals } = remaining;
                      if (seconds <= 0 && manualApprovals === 0) return null;
                      let label: string;
                      const approvalStr =
                        manualApprovals > 0
                          ? `${manualApprovals} manual approval${manualApprovals > 1 ? "s" : ""}`
                          : "";
                      if (seconds <= 0) {
                        label = approvalStr;
                      } else {
                        label = formatRemainingDuration(seconds);
                        if (approvalStr) label += ` + ${approvalStr}`;
                      }
                      return <Text color="text-low">({label} remaining)</Text>;
                    })()}
                    {rampSchedule.lockdownConfig?.mode === "locked" && (
                      <Box style={{ flexBasis: "100%" }}>
                        <HelperText
                          status="warning"
                          icon={<PiLockSimple size={15} />}
                        >
                          {rampSchedule.status === "running"
                            ? "Feature locked during ramp-up"
                            : "Feature will be locked while ramp-up is running"}
                        </HelperText>
                      </Box>
                    )}
                  </Flex>
                )}
                {isSimpleSchedule && (
                  <Text weight="medium" mb="4">
                    {formatSimpleScheduleLabel(rampSchedule)}
                  </Text>
                )}
                {rampApproveError && (
                  <Callout
                    status="error"
                    mb="2"
                    action={
                      <Button
                        size="xs"
                        variant="ghost"
                        color="inherit"
                        onClick={() => setRampApproveError("")}
                      >
                        Dismiss
                      </Button>
                    }
                  >
                    {rampApproveError}
                  </Callout>
                )}
                {rampSchedule.status === "rolled-back" &&
                  !hasMonitoringStatusRow &&
                  rampSchedule.lastRollbackReason && (
                    <Callout status="error" mb="2">
                      <Text weight="semibold">Rolled back:</Text>{" "}
                      {formatRollbackReason(rampSchedule.lastRollbackReason)}
                    </Callout>
                  )}
                {isAwaitingStartApproval(rampSchedule) &&
                  !hasMonitoringStatusRow &&
                  rampSchedule.lastRollbackReason && (
                    <Callout status="warning" mb="2">
                      <Text weight="semibold">Rolled back by monitoring:</Text>{" "}
                      {formatRollbackReason(rampSchedule.lastRollbackReason)} —
                      review before re-approving.
                    </Callout>
                  )}
                <RampTimeline
                  rs={rampSchedule}
                  pendingDetach={!!hasPendingDetach}
                  onJump={async (targetStepIndex) => {
                    if (targetStepIndex === -1) {
                      await rollbackToStart();
                      return;
                    }
                    await apiCall(
                      `/ramp-schedule/${rampSchedule.id}/actions/jump`,
                      {
                        method: "POST",
                        body: JSON.stringify({ targetStepIndex }),
                      },
                    );
                    await mutate();
                  }}
                  onComplete={async () => {
                    await apiCall(
                      `/ramp-schedule/${rampSchedule.id}/actions/complete`,
                      { method: "POST" },
                    );
                    await mutate();
                  }}
                  onCompleteAndDisable={async () => {
                    await apiCall(
                      `/ramp-schedule/${rampSchedule.id}/actions/complete`,
                      {
                        method: "POST",
                        body: JSON.stringify({ disableRule: true }),
                      },
                    );
                    await mutate();
                  }}
                />
                {rampSchedule.steps.some((s) => s.monitored) && (
                  <SafeRolloutRuleDashboard
                    safeRolloutId={rampSchedule.safeRolloutId ?? undefined}
                    rampSchedule={rampSchedule}
                    mutateRule={mutate}
                  />
                )}
              </Box>
            )}
          </Box>
        </RuleCard>
      </Box>
    );

    return safeRollout ? (
      <SafeRolloutSnapshotProvider
        safeRollout={safeRollout}
        feature={feature}
        mutateSafeRollout={mutate}
      >
        {contents}
      </SafeRolloutSnapshotProvider>
    ) : (
      contents
    );
  },
);

export function SortableRule(props: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: props.rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === props.rule.id ? 0.3 : 1,
    margin: -1,
  };

  return (
    <Rule
      {...props}
      ref={setNodeRef}
      style={style}
      handle={{ ...attributes, ...listeners }}
    />
  );
}

function SkippedPill() {
  return (
    <Badge
      color="amber"
      label={
        <>
          <PiArrowBendRightDown />
          Skipped
        </>
      }
    />
  );
}

export type RuleMetaInfo = {
  pill?: ReactElement;
  callout?: ReactElement;
  sideColor: "active" | "skipped" | "disabled" | "unreachable";
};

export function getRuleMetaInfo({
  rule,
  experimentsMap,
  isDraft,
  unreachable,
  conflictBanners,
  rampSchedule,
  rampPendingDetach,
}: {
  rule: FeatureRule;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  isDraft: boolean;
  unreachable?: boolean;
  conflictBanners?: ConflictBanner[];
  rampSchedule?: RampScheduleInterface;
  // The draft queues this rule's ramp for removal — so it won't enable on publish.
  rampPendingDetach?: boolean;
}): RuleMetaInfo {
  const linkedExperiment =
    rule.type === "experiment-ref"
      ? experimentsMap.get(rule.experimentId)
      : undefined;
  const ruleInactive = isRuleInactive(rule, experimentsMap);
  const ruleSkipped = isRuleSkipped({
    rule,
    linkedExperiment,
    isDraft,
  });

  const upcomingScheduleRule = getUpcomingScheduleRule(rule);

  const scheduleCompletedAndDisabled =
    !upcomingScheduleRule &&
    rule?.scheduleRules?.length &&
    rule.scheduleRules.at(-1)?.timestamp !== null;

  if (!rule.enabled) {
    // An approval-gated ramp holds the rule off (zero traffic) until someone
    // approves the start — surface that instead of a bare "Disabled" so it's
    // clear the rule is staged, not turned off by hand.
    if (rampSchedule && isAwaitingStartApproval(rampSchedule)) {
      return {
        pill: (
          <Badge
            color="gray"
            title="This rule is staged and serving no traffic. It will go live when someone approves the ramp's start."
            label={
              <>
                <RxCircleBackslash />
                Disabled · awaiting approval
              </>
            }
          />
        ),
        sideColor: "disabled",
      };
    }
    const rampEnableDate = getRampEnableDate(rampSchedule);
    if (rampEnableDate) {
      // A pending draft schedule whose startDate has drifted into the past
      // still hasn't fired — once published, the backend treats startDate as
      // a one-shot gate and enables immediately. Showing the stale date is
      // confusing; surface the actual semantics instead.
      const inPast = rampEnableDate.getTime() <= Date.now();
      const label = inPast
        ? "Disabled · enables on publish"
        : `Disabled \u00b7 enables ${fmtScheduleDate(rampEnableDate)}`;
      const title = inPast
        ? "Rule will be enabled by its schedule on the next publish"
        : `Rule will be enabled by its schedule on ${rampEnableDate.toLocaleDateString()}`;
      return {
        pill: (
          <Badge
            color="gray"
            title={title}
            label={
              <>
                <RxCircleBackslash />
                {label}
              </>
            }
          />
        ),
        sideColor: "disabled",
      };
    }
    // A pre-start ramp with no start date and no approval gate (both handled
    // above) starts — and enables the rule — immediately on publish. Disabling
    // the rule here does NOT hold the rollout, so say so instead of a bare
    // "Disabled" and point at the option that actually holds it. Only in a draft
    // ("on publish" framing), and not when the ramp is queued for removal (then
    // the rule really does stay disabled).
    const rampEnablesOnPublish =
      isDraft &&
      !rampPendingDetach &&
      !!rampSchedule &&
      (rampSchedule.status === "pending" || rampSchedule.status === "ready") &&
      !rampSchedule.startDate;
    if (rampEnablesOnPublish) {
      return {
        pill: (
          <Badge
            color="gray"
            title="This rule's ramp schedule starts on publish and will re-enable it — disabling here won't hold the rollout. Use Start → On approval to stage it with zero traffic until approved."
            label={
              <>
                <RxCircleBackslash />
                Disabled · enables on publish
              </>
            }
          />
        ),
        sideColor: "disabled",
      };
    }
    return {
      pill: (
        <Badge
          color="gray"
          title="Rule is not enabled"
          label={
            <>
              <RxCircleBackslash />
              Disabled
            </>
          }
        />
      ),
      sideColor: "disabled",
    };
  }

  if (
    scheduleCompletedAndDisabled &&
    rule.scheduleRules &&
    rule.scheduleRules.length > 0
  ) {
    const lastRule = rule.scheduleRules[rule.scheduleRules.length - 1];
    if (lastRule && lastRule.timestamp) {
      return {
        pill: <SkippedPill />,
        callout: (
          <Callout status="warning">
            Disabled by a schedule on{" "}
            {new Date(lastRule.timestamp).toLocaleDateString()} at{" "}
            {formatTimeZone(new Date(lastRule.timestamp), "h:mm a z")}
          </Callout>
        ),
        sideColor: "skipped",
      };
    }
  }

  if (ruleInactive) {
    return {
      pill: <SkippedPill />,
      sideColor: "skipped",
    };
  }

  if (
    upcomingScheduleRule &&
    upcomingScheduleRule.enabled &&
    upcomingScheduleRule.timestamp
  ) {
    return {
      pill: <SkippedPill />,
      callout: (
        <Callout status="warning">
          Will be enabled on{" "}
          {new Date(upcomingScheduleRule.timestamp).toLocaleDateString()} at{" "}
          {formatTimeZone(new Date(upcomingScheduleRule.timestamp), "h:mm a z")}
        </Callout>
      ),
      sideColor: "skipped",
    };
  }

  if (ruleSkipped) {
    return {
      pill: <SkippedPill />,
      sideColor: "skipped",
    };
  }

  // One callout per conflict banner (in the all-envs view there can be several,
  // each scoped to the environments that share a status).
  const callouts: ReactElement[] = (conflictBanners ?? []).map((banner, i) => (
    <ConflictCallout
      key={`conflict-${i}`}
      isUnreachable={banner.isUnreachable}
      conflicts={banner.conflicts}
      environments={banner.environments}
      allEnvironments={banner.allEnvironments}
    />
  ));

  // The status badge is derived from the same banners as the callouts, so its
  // colour + icon always mirror the callout: orange/octagon for unreachable,
  // amber/triangle for a softer "may not reach" conflict.
  const conflictBadge = getConflictBadge(conflictBanners);
  const conflictPill = conflictBadge ? (
    <Badge
      color={conflictBadge.color}
      title={conflictBadge.title}
      label={
        <>
          {conflictBadge.icon}
          {conflictBadge.label}
        </>
      }
    />
  ) : undefined;

  if (unreachable) {
    return {
      pill: conflictPill,
      callout:
        callouts.length > 0 ? (
          <Flex direction="column" gap="2">
            {callouts}
          </Flex>
        ) : undefined,
      sideColor: "unreachable",
    };
  }

  if (upcomingScheduleRule && upcomingScheduleRule.timestamp) {
    callouts.push(
      <Callout key="schedule" status="info">
        Will be disabled on{" "}
        {new Date(upcomingScheduleRule.timestamp).toLocaleDateString()} at{" "}
        {formatTimeZone(new Date(upcomingScheduleRule.timestamp), "h:mm a z")}
      </Callout>,
    );
  }

  return {
    pill: conflictPill,
    callout:
      callouts.length > 0 ? (
        <Flex direction="column" gap="2">
          {callouts}
        </Flex>
      ) : undefined,
    sideColor: "active",
  };
}
