import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef, ReactElement, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { filterEnvironmentsByFeature } from "shared/util";
import { Box, Card, Flex, IconButton } from "@radix-ui/themes";
import { RiAlertLine, RiDraggable } from "react-icons/ri";
import { RxCircleBackslash } from "react-icons/rx";
import {
  PiArrowBendRightDown,
  PiPlayFill,
  PiPauseFill,
  PiFastForward,
  PiRewind,
  PiArrowUUpLeft,
  PiArrowUUpRight,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { format as formatTimeZone } from "date-fns-tz";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  RampScheduleInterface,
} from "shared/validators";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import RampScheduleBadge from "@/components/RampSchedule/RampScheduleBadge";
import RampTimeline, {
  getRampStepsCompleted,
} from "@/components/RampSchedule/RampTimeline";
import Button from "@/ui/Button";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import track from "@/services/track";
import {
  getRules,
  isRuleInactive,
  useEnvironments,
  useAttributeMap,
  getAttributesWithVersionStringMismatches,
} from "@/services/features";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/ui/HelperText";
import Badge from "@/ui/Badge";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Callout from "@/ui/Callout";
import SafeRolloutSummary from "@/components/Features/SafeRolloutSummary";
import SafeRolloutSnapshotProvider from "@/components/SafeRollout/SnapshotProvider";
import SafeRolloutDetails from "@/components/SafeRollout/SafeRolloutDetails";
import SafeRolloutStatusModal from "@/components/Features/SafeRollout/SafeRolloutStatusModal";
import SafeRolloutStatusBadge from "@/components/SafeRollout/SafeRolloutStatusBadge";
import DecisionCTA from "@/components/SafeRollout/DecisionCTA";
import DecisionHelpText from "@/components/SafeRollout/DecisionHelpText";
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
  if (rs.startDate) {
    return `SCHEDULED to start ${fmtScheduleDate(rs.startDate)}`;
  }
  return "USING SCHEDULE";
}

function formatRemainingDuration(totalSeconds: number): string {
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
  if (
    rs.status !== "running" &&
    rs.status !== "paused" &&
    rs.status !== "pending-approval"
  )
    return null;

  const now = Date.now();
  let seconds = 0;
  let manualApprovals = 0;

  const currentIsApproval =
    rs.currentStepIndex >= 0 &&
    rs.steps[rs.currentStepIndex]?.trigger.type === "approval";
  const nextIdx =
    rs.status === "pending-approval" ||
    (rs.status === "paused" && currentIsApproval)
      ? Math.max(0, rs.currentStepIndex) // include current unapproved step
      : rs.currentStepIndex + 1; // works for -1 → 0
  for (let i = nextIdx; i < rs.steps.length; i++) {
    const trigger = rs.steps[i].trigger;
    if (trigger.type === "interval") {
      seconds += trigger.seconds;
    } else if (trigger.type === "approval") {
      manualApprovals++;
    } else if (trigger.type === "scheduled") {
      seconds += Math.max(0, (new Date(trigger.at).getTime() - now) / 1000);
    }
  }

  return { seconds, manualApprovals };
}
import ExperimentSummary from "./ExperimentSummary";
import ExperimentRefSummary, {
  isExperimentRefRuleSkipped,
} from "./ExperimentRefSummary";

interface SortableProps {
  i: number;
  rule: FeatureRule;
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  setRuleModal: (args: {
    environment: string;
    i: number;
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
    detachRampOnSave?: boolean;
  }) => void;
  setCopyRuleModal: (args: {
    environment: string;
    rules: FeatureRule[];
  }) => void;
  unreachable?: boolean;
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  hideInactive?: boolean;
  isDraft: boolean;
  holdout: HoldoutInterface | undefined;
  rampSchedule?: RampScheduleInterface;
  draftRevision?: FeatureRevisionInterface | null;
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
      setCopyRuleModal,
      mutate,
      handle,
      unreachable,
      version,
      setVersion,
      locked,
      experimentsMap,
      safeRolloutsMap,
      hideInactive,
      isDraft,
      holdout,
      rampSchedule,
      draftRevision,
      ...props
    },
    ref,
  ) => {
    const { apiCall } = useAuth();

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const [safeRolloutStatusModalOpen, setSafeRolloutStatusModalOpen] =
      useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [rampApproveLoading, setRampApproveLoading] = useState(false);
    const [rampApproveError, setRampApproveError] = useState("");

    const attributeMap = useAttributeMap(feature.project);
    const attributesWithVersionStringOperatorMismatches =
      getAttributesWithVersionStringMismatches(
        rule.condition || "",
        attributeMap,
      );

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

    const rules = getRules(feature, environment);
    const permissionsUtil = usePermissionsUtil();

    const canEdit =
      permissionsUtil.canViewFeatureModal(feature.project) &&
      permissionsUtil.canManageFeatureDrafts(feature);

    const isInactive = isRuleInactive(rule, experimentsMap);

    const hasCondition =
      (rule.condition && rule.condition !== "{}") ||
      !!rule.savedGroups?.length ||
      !!rule.prerequisites?.length;

    let safeRollout: SafeRolloutInterface | undefined;

    if (rule.type === "safe-rollout") {
      safeRollout = safeRolloutsMap.get(rule.safeRolloutId);
    }

    const info = getRuleMetaInfo({
      rule,
      experimentsMap,
      isDraft,
      unreachable,
    });

    if (hideInactive && isInactive) {
      return null;
    }

    const rampIsTerminal =
      rampSchedule !== undefined &&
      ["completed", "rolled-back"].includes(rampSchedule.status);
    const isSimpleSchedule = !!rampSchedule && rampSchedule.steps.length === 0;
    const hasPendingDetach =
      isDraft &&
      draftRevision?.rampActions?.some(
        (action) => action.mode === "detach" && action.ruleId === rule.id,
      );

    const ruleTags: React.ReactNode[] = [];
    const ruleCtas: React.ReactNode[] = [];

    if (rampSchedule) {
      ruleTags.push(
        <RampScheduleBadge
          key="ramp-badge"
          rs={rampSchedule}
          pendingDetach={!!hasPendingDetach}
          simpleSchedule={isSimpleSchedule}
        />,
      );
    }

    if (
      rampSchedule &&
      !locked &&
      !rampIsTerminal &&
      !hasPendingDetach &&
      !isSimpleSchedule
    ) {
      if (rampSchedule.status === "ready" && rampSchedule.targets.length > 0) {
        ruleCtas.push(
          <Button
            key="ramp-start"
            size="xs"
            variant="solid"
            onClick={async () => {
              await apiCall(`/ramp-schedule/${rampSchedule.id}/actions/start`, {
                method: "POST",
              });
              await mutate();
            }}
          >
            Start
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
      if (rampSchedule.status === "pending-approval") {
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
            Approve and Resume
          </Button>,
        );
      }
    }

    if (rule.type === "safe-rollout" && !locked && rule.enabled !== false) {
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
        <Box mt="3">
          <Card>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "4px",
                backgroundColor:
                  info.sideColor === "disabled"
                    ? "var(--gray-5)"
                    : info.sideColor === "unreachable"
                      ? "var(--orange-7)"
                      : info.sideColor === "skipped"
                        ? "var(--amber-7)"
                        : "var(--green-9)",
              }}
            ></div>
            <Flex align="start" justify="between" gap="3" p="1" pr="2">
              <Box>
                {rules.length > 1 && canEdit && !locked && (
                  <div
                    {...handle}
                    title="Drag and drop to re-order rules"
                    style={{ cursor: "grab" }}
                  >
                    <RiDraggable />
                  </div>
                )}
              </Box>
              <Box>
                <Badge
                  label={<>{holdout ? i + 2 : i + 1}</>}
                  radius="full"
                  color="gray"
                />
              </Box>
              <Box flexGrow="1" pr="2" style={{ maxWidth: "100%" }}>
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
                            <ExperimentStatusIndicator
                              experimentData={linkedExperiment}
                            />
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
                  </Flex>

                  <Flex align="center" gap="3" flexShrink="0">
                    {ruleCtas}

                    {info.pill}

                    {/* Dropdown Menu */}
                    {canEdit && !locked && (
                      <DropdownMenu
                        trigger={
                          <IconButton
                            variant="ghost"
                            color="gray"
                            radius="full"
                            size="2"
                            highContrast
                          >
                            <BsThreeDotsVertical size={18} />
                          </IconButton>
                        }
                        open={dropdownOpen}
                        onOpenChange={setDropdownOpen}
                        menuPlacement="end"
                        variant="soft"
                      >
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => {
                              setRuleModal({ environment, i, mode: "edit" });
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
                                  mode: "duplicate",
                                });
                                setDropdownOpen(false);
                              }}
                            >
                              Duplicate rule
                            </DropdownMenuItem>
                          )}
                          {environments.length > 1 && (
                            <DropdownMenuItem
                              onClick={() => {
                                setCopyRuleModal({
                                  environment,
                                  rules: [rule],
                                });
                                setDropdownOpen(false);
                              }}
                            >
                              Copy rule to environment(s)
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={async () => {
                              track(
                                rule.enabled
                                  ? "Disable Feature Rule"
                                  : "Enable Feature Rule",
                                {
                                  ruleIndex: i,
                                  environment,
                                  type: rule.type,
                                },
                              );
                              const res = await apiCall<{ version: number }>(
                                `/feature/${feature.id}/${version}/rule`,
                                {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    environment,
                                    rule: {
                                      ...rule,
                                      enabled: !rule.enabled,
                                    },
                                    i,
                                  }),
                                },
                              );
                              await mutate();
                              res.version && setVersion(res.version);
                              setDropdownOpen(false);
                            }}
                          >
                            {rule.enabled ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {rampSchedule && !isSimpleSchedule && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup label="Ramp-up schedule">
                              {hasPendingDetach ? (
                                /* When removal is pending: cancel it directly via API (no modal) */
                                <DropdownMenuItem
                                  onClick={async () => {
                                    const res = await apiCall<{
                                      version: number;
                                    }>(
                                      `/feature/${feature.id}/${version}/rule`,
                                      {
                                        method: "PUT",
                                        body: JSON.stringify({
                                          environment,
                                          rule,
                                          i,
                                          rampSchedule: { mode: "clear" },
                                        }),
                                      },
                                    );
                                    if (res.version) setVersion(res.version);
                                    await mutate();
                                    setDropdownOpen(false);
                                  }}
                                >
                                  Cancel removal of schedule
                                </DropdownMenuItem>
                              ) : (
                                <>
                                  {/* pending: blocked Start */}
                                  {rampSchedule.status === "pending" && (
                                    <Tooltip
                                      tipPosition="left"
                                      body={`Cannot start while ramp is pending.${
                                        rampSchedule.targets.find(
                                          (t) =>
                                            t.activatingRevisionVersion != null,
                                        )?.activatingRevisionVersion != null
                                          ? ` Publish Revision ${rampSchedule.targets.find((t) => t.activatingRevisionVersion != null)?.activatingRevisionVersion} first.`
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
                                  {["running", "pending-approval"].includes(
                                    rampSchedule.status,
                                  ) && (
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
                                  {[
                                    "running",
                                    "paused",
                                    "pending-approval",
                                  ].includes(rampSchedule.status) && (
                                    <>
                                      {rampSchedule.currentStepIndex >= 0 &&
                                        (() => {
                                          const backSteps = rampSchedule.steps
                                            .map((_, idx) => idx)
                                            .filter(
                                              (idx) =>
                                                idx <
                                                rampSchedule.currentStepIndex,
                                            );
                                          return (
                                            <DropdownSubMenu
                                              trigger={
                                                <Flex align="center" gap="2">
                                                  <PiArrowUUpLeft /> Roll back
                                                  to
                                                </Flex>
                                              }
                                            >
                                              <DropdownMenuItem
                                                onClick={async () => {
                                                  await apiCall(
                                                    `/ramp-schedule/${rampSchedule.id}/actions/jump`,
                                                    {
                                                      method: "POST",
                                                      body: JSON.stringify({
                                                        targetStepIndex: -1,
                                                      }),
                                                    },
                                                  );
                                                  await mutate();
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
                                                          targetStepIndex:
                                                            stepIdx,
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
                                                idx >
                                                rampSchedule.currentStepIndex,
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
                                                        targetStepIndex:
                                                          stepIdx,
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
                                    </>
                                  )}
                                  {/* Restart — terminal states */}
                                  {rampIsTerminal && (
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        await apiCall(
                                          `/ramp-schedule/${rampSchedule.id}/actions/reset`,
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
                                </>
                              )}
                            </DropdownMenuGroup>
                          </>
                        )}
                        <DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            color="red"
                            confirmation={{
                              confirmationTitle: "Delete Rule",
                              cta: "Delete",
                              submit: async () => {
                                track("Delete Feature Rule", {
                                  ruleIndex: i,
                                  environment,
                                  type: rule.type,
                                });
                                const res = await apiCall<{ version: number }>(
                                  `/feature/${feature.id}/${version}/rule`,
                                  {
                                    method: "DELETE",
                                    body: JSON.stringify({
                                      environment,
                                      i,
                                    }),
                                  },
                                );
                                await mutate();
                                res.version && setVersion(res.version);
                              },
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenu>
                    )}
                  </Flex>
                </Flex>
                <Box>{info.callout}</Box>
                {rampSchedule?.status === "pending-approval" &&
                  rampSchedule.currentStepIndex >= 0 &&
                  rampSchedule.steps[rampSchedule.currentStepIndex]
                    ?.approvalNotes && (
                    <Callout status="info" mt="3" color="orange" size="sm">
                      <strong>Approval Notes:</strong>{" "}
                      {
                        rampSchedule.steps[rampSchedule.currentStepIndex]
                          .approvalNotes
                      }
                    </Callout>
                  )}
                {attributesWithVersionStringOperatorMismatches &&
                  attributesWithVersionStringOperatorMismatches.length > 0 && (
                    <Callout status="warning" mt="3">
                      <Flex direction="column" gap="2">
                        <Text>
                          This rule uses string operators on version attributes,
                          which can have unintended effects. Edit this rule and
                          change{" "}
                          <strong>
                            {attributesWithVersionStringOperatorMismatches.join(
                              ", ",
                            )}
                          </strong>{" "}
                          to use version operators ($vgt, $vlt, etc.) instead.
                        </Text>
                      </Flex>
                    </Callout>
                  )}
                <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
                  {rule.type === "safe-rollout" && safeRollout ? (
                    <>
                      <DecisionHelpText rule={rule} />
                      {rule.description ? (
                        <Box pb="3">{rule.description}</Box>
                      ) : null}
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
                    <ForceSummary value={rule.value} feature={feature} />
                  )}
                  {rule.type === "rollout" && (
                    <RolloutSummary
                      value={rule.value ?? ""}
                      coverage={rule.coverage ?? 1}
                      feature={feature}
                      hashAttribute={rule.hashAttribute || ""}
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
                            i={i}
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
                            This Safe Rollout rule is in a draft state and will
                            start when this feature revision is published.
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
                        (exp) =>
                          exp.trackingKey === (rule.trackingKey || feature.id),
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
                  {rampSchedule && (
                    <Box mt="4">
                      {!isSimpleSchedule && (
                        <Flex gap="3" align="center" mb="4" wrap="wrap">
                          <Text weight="medium">RAMP-UP SCHEDULE</Text>
                          {![
                            "pending",
                            "ready",
                            "completed",
                            "rolled-back",
                          ].includes(rampSchedule.status) && (
                            <Text>
                              Step {getRampStepsCompleted(rampSchedule)} of{" "}
                              {rampSchedule.steps.length}
                            </Text>
                          )}
                          {(() => {
                            const remaining =
                              computeRemainingTime(rampSchedule);
                            if (!remaining) return null;
                            const { seconds, manualApprovals } = remaining;
                            if (seconds <= 0 && manualApprovals === 0)
                              return null;
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
                            return (
                              <Text color="text-low">({label} remaining)</Text>
                            );
                          })()}
                        </Flex>
                      )}
                      {isSimpleSchedule && (
                        <Text weight="medium" mb="4">
                          {formatSimpleScheduleLabel(rampSchedule)}
                        </Text>
                      )}
                      {rampApproveError && (
                        <Callout status="error" mb="2">
                          <Flex justify="between" align="start" gap="3">
                            <Text>{rampApproveError}</Text>
                            <Flex gap="2" flexShrink="0">
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setRampApproveError("")}
                              >
                                Dismiss
                              </Button>
                            </Flex>
                          </Flex>
                        </Callout>
                      )}
                      <RampTimeline
                        rs={rampSchedule}
                        pendingDetach={!!hasPendingDetach}
                        onJump={async (targetStepIndex) => {
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
                      />
                    </Box>
                  )}
                </Box>
              </Box>
            </Flex>
          </Card>
        </Box>
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
}: {
  rule: FeatureRule;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  isDraft: boolean;
  unreachable?: boolean;
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

  if (unreachable) {
    return {
      pill: (
        <Badge
          color="orange"
          title="Rule not reachable"
          label={
            <>
              <RiAlertLine />
              Unreachable
            </>
          }
        />
      ),
      callout: (
        <Callout status="warning" size="sm">
          Rules above will serve 100% of traffic and this rule will never be
          used
        </Callout>
      ),
      sideColor: "unreachable",
    };
  }

  if (upcomingScheduleRule && upcomingScheduleRule.timestamp) {
    return {
      callout: (
        <Callout status="info">
          Will be disabled on{" "}
          {new Date(upcomingScheduleRule.timestamp).toLocaleDateString()} at{" "}
          {formatTimeZone(new Date(upcomingScheduleRule.timestamp), "h:mm a z")}
        </Callout>
      ),
      sideColor: "active",
    };
  }

  return {
    sideColor: "active",
  };
}
