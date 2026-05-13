import { FeatureInterface, SavedGroupTargeting } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState } from "react";
import {
  RampScheduleInterface,
  RampStep,
  RampStepAction,
  RevisionRampCreateFeatureRolloutAction,
  GateRule,
} from "shared/validators";
import { PiShieldCheckBold, PiLockSimpleBold, PiTrash } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/ui/DropdownMenu";
import FeatureRolloutModal from "@/components/Features/FeatureRolloutModal";
import ConditionDisplay from "@/components/Features/ConditionDisplay";

import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: RampScheduleInterface["status"]) {
  const map: Record<
    string,
    {
      label: string;
      color: "amber" | "green" | "orange" | "gray";
    }
  > = {
    pending: { label: "Pending publish", color: "amber" },
    ready: { label: "Scheduled", color: "amber" },
    running: { label: "Active", color: "green" },
    paused: { label: "Paused", color: "amber" },
    "pending-approval": { label: "Needs approval", color: "orange" },
    completed: { label: "Complete", color: "gray" },
    "rolled-back": { label: "Rolled back", color: "gray" },
  };
  const entry = map[status] ?? { label: status, color: "gray" as const };
  return <Badge label={entry.label} color={entry.color} radius="full" />;
}

function CoverageDisplay({ pct }: { pct: number }) {
  return (
    <Flex gap="3" align="center">
      <Box
        style={{
          width: 200,
          flexShrink: 0,
          border: "1px solid var(--slate-a5)",
          borderRadius: 10,
          backgroundColor: "var(--slate-a3)",
          height: 10,
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            width: `${pct}%`,
            height: "100%",
            backgroundColor: "var(--accent-9)",
          }}
        />
      </Box>
      <Badge
        label={<span style={{ color: "var(--slate-12)" }}>{pct}%</span>}
        color="gray"
      />
      <Text color="text-low">of users</Text>
    </Flex>
  );
}

type StepState =
  | "draft"
  | "complete"
  | "current"
  | "paused"
  | "pending-approval"
  | "rolled-back"
  | "future";

const STEP_COLORS: Record<
  StepState,
  { bg: string; fg: string; border?: string }
> = {
  draft: {
    bg: "transparent",
    fg: "var(--gray-9)",
    border: "1px dashed var(--gray-8)",
  },
  future: {
    bg: "transparent",
    fg: "var(--gray-9)",
    border: "1px solid var(--gray-8)",
  },
  current: { bg: "var(--blue-9)", fg: "white" },
  paused: { bg: "var(--amber-9)", fg: "white" },
  "pending-approval": { bg: "var(--orange-9)", fg: "white" },
  complete: { bg: "var(--green-9)", fg: "white" },
  "rolled-back": { bg: "var(--gray-7)", fg: "var(--gray-11)" },
};

function resolveStepState(
  index: number,
  currentStep: number,
  status: RampScheduleInterface["status"],
): StepState {
  const isComplete =
    index < currentStep || (index === currentStep && status === "completed");
  if (isComplete) return "complete";

  const isCurrent =
    index === currentStep && status !== "completed" && status !== "rolled-back";
  if (isCurrent) {
    if (status === "paused") return "paused";
    if (status === "pending-approval") return "pending-approval";
    return "current";
  }

  if (status === "rolled-back") return "rolled-back";
  return "future";
}

function StepIcon({ num, state }: { num: number; state: StepState }) {
  const c = STEP_COLORS[state];
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: c.bg,
        color: c.fg,
        border: c.border ?? "none",
        fontSize: 14,
        fontWeight: 600,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {num}
    </Flex>
  );
}

// Per-environment gate effect extracted from a set-gate action with environments
interface EnvGateEffect {
  envIds: string[];
  coveragePct?: number;
  condition?: string;
  removedCondition?: boolean;
  savedGroups?: SavedGroupTargeting[];
  removedSavedGroups?: boolean;
  toggle?: boolean; // env toggle merged into this lane
}

interface StepEffects {
  // Default (non-env-scoped) gate coverage
  coveragePct?: number;
  condition?: string;
  removedCondition?: boolean;
  savedGroups?: SavedGroupTargeting[];
  removedSavedGroups?: boolean;
  // Per-environment gate effects (toggles merged in when they match)
  envGates: EnvGateEffect[];
  labels: string[];
}

function extractStepEffects(
  actions: RampStepAction[],
  gateRules?: GateRule[],
): StepEffects {
  const effects: StepEffects = { envGates: [], labels: [] };
  const pendingToggles: { envId: string; enabled: boolean }[] = [];

  for (const a of actions) {
    switch (a.type) {
      case "set-environment-enabled":
        pendingToggles.push({ envId: a.environment, enabled: a.enabled });
        break;
      case "set-gate": {
        const p = a.patch;
        const matchedRule = gateRules?.find((r) => r.id === a.ruleId);
        if (matchedRule) {
          const envGate: EnvGateEffect = {
            envIds: matchedRule.environments,
          };
          if (p.coverage !== undefined)
            envGate.coveragePct = Math.round(p.coverage * 100);
          if (p.condition !== undefined) {
            if (p.condition === null) envGate.removedCondition = true;
            else envGate.condition = p.condition;
          }
          if (p.savedGroups !== undefined) {
            if (p.savedGroups === null || p.savedGroups.length === 0)
              envGate.removedSavedGroups = true;
            else envGate.savedGroups = p.savedGroups;
          }
          effects.envGates.push(envGate);
        } else {
          if (p.coverage !== undefined)
            effects.coveragePct = Math.round(p.coverage * 100);
          if (p.condition !== undefined) {
            if (p.condition === null) effects.removedCondition = true;
            else effects.condition = p.condition;
          }
          if (p.savedGroups !== undefined) {
            if (p.savedGroups === null || p.savedGroups.length === 0)
              effects.removedSavedGroups = true;
            else effects.savedGroups = p.savedGroups;
          }
        }
        break;
      }
      case "detach-monitoring":
        effects.labels.push("Stop guardrail monitoring");
        break;
      case "complete-rollout":
        effects.labels.push("Complete rollout");
        break;
    }
  }

  // Merge toggles into matching envGate lanes only when the lane targets
  // exactly that single environment. Otherwise create a standalone lane.
  for (const t of pendingToggles) {
    const gate = effects.envGates.find(
      (eg) => eg.envIds.length === 1 && eg.envIds[0] === t.envId,
    );
    if (gate) {
      gate.toggle = t.enabled;
    } else {
      effects.envGates.push({ envIds: [t.envId], toggle: t.enabled });
    }
  }

  return effects;
}

// Normalized view shared by both active schedules and pending draft rollouts
interface ScheduleView {
  steps: RampStep[];
  monitoringConfig?: { guardrailMetricIds: string[] } | null;
  lockdownConfig?: { mode: string } | null;
  gateRules?: GateRule[];
  status: RampScheduleInterface["status"] | "draft";
  currentStepIndex: number;
  scheduleId?: string;
}

function pendingRolloutToView(
  r: RevisionRampCreateFeatureRolloutAction,
): ScheduleView {
  return {
    steps: r.steps ?? [],
    monitoringConfig: r.monitoringConfig,
    lockdownConfig: r.lockdownConfig,
    gateRules: r.gateConfig?.rules,
    status: "draft",
    currentStepIndex: -1,
  };
}

function scheduleToView(s: RampScheduleInterface): ScheduleView {
  return {
    steps: s.steps,
    monitoringConfig: s.monitoringConfig,
    lockdownConfig: s.lockdownConfig,
    gateRules: s.gateConfig?.rules,
    status: s.status,
    currentStepIndex: s.currentStepIndex,
    scheduleId: s.id,
  };
}

function formatTrigger(step: RampScheduleInterface["steps"][number]) {
  if (step.trigger.type === "approval") {
    return step.approvalNotes
      ? `await approval: ${step.approvalNotes}`
      : "await approval";
  }
  if (step.trigger.type === "interval") {
    const secs = step.trigger.seconds;
    if (secs >= 86400) {
      const d = Math.round(secs / 86400);
      return `hold ${d}d`;
    }
    if (secs >= 3600) {
      const h = Math.round(secs / 3600);
      return `hold ${h}h`;
    }
    const m = Math.round(secs / 60);
    return `hold ${m}m`;
  }
  return "—";
}

// ── Main component ──────────────────────────────────────────────────────────

export default function FeatureRolloutSection({
  feature,
  revision,
  mutate,
  canEdit,
  currentVersion,
  setVersion,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface | null;
  mutate: () => Promise<unknown>;
  canEdit: boolean;
  currentVersion: number;
  setVersion: (v: number) => void;
}) {
  const { apiCall } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);

  const { data: scheduleData } = useApi<{
    rampSchedule: RampScheduleInterface;
  }>(`/ramp-schedule/${feature.activeRampScheduleId ?? ""}`, {
    shouldRun: () => !!feature.activeRampScheduleId,
  });

  const { data: allSchedulesData } = useApi<{
    rampSchedules: RampScheduleInterface[];
  }>(`/ramp-schedule?featureId=${feature.id}`);

  const activeSchedule = scheduleData?.rampSchedule;
  const featureSchedules = useMemo(() => {
    return (allSchedulesData?.rampSchedules ?? []).filter(
      (s) => s.scope === "feature",
    );
  }, [allSchedulesData]);

  const pendingRollout = useMemo(() => {
    if (!revision?.rampActions) return null;
    return (revision.rampActions.find(
      (a) => a.mode === "create-feature-rollout",
    ) ?? null) as RevisionRampCreateFeatureRolloutAction | null;
  }, [revision?.rampActions]);

  const hasActiveRollout = !!activeSchedule;

  const isFeatureLiveInAnyEnv = Object.values(
    feature.environmentSettings || {},
  ).some((s) => s.enabled);

  // ── Resolve a single ScheduleView from pending draft or active schedule ─

  const view: ScheduleView | null = useMemo(() => {
    if (!hasActiveRollout && pendingRollout) {
      return pendingRolloutToView(pendingRollout);
    }
    const schedule = activeSchedule ?? featureSchedules[0] ?? null;
    if (schedule) return scheduleToView(schedule);
    return null;
  }, [hasActiveRollout, pendingRollout, activeSchedule, featureSchedules]);

  const isDraft = view?.status === "draft";
  const isLive = view && !isDraft;
  const isTerminalView =
    view && ["completed", "rolled-back"].includes(view.status);

  // ── Empty state: no schedule ────────────────────────────────────────────

  if (!view) {
    return (
      <>
        <Flex align="center" justify="between">
          <Heading as="h4" size="small" mb="0">
            Feature Rollout
          </Heading>
          {canEdit && (
            <Tooltip
              content={
                isFeatureLiveInAnyEnv
                  ? "Feature is already enabled. Controlled rollouts are for first-time publishing."
                  : "Plan a staged rollout with monitoring and approval gates"
              }
            >
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCreateModal(true)}
              >
                Plan Rollout
              </Button>
            </Tooltip>
          )}
        </Flex>
        {showCreateModal && (
          <FeatureRolloutModal
            feature={feature}
            version={currentVersion}
            onClose={() => setShowCreateModal(false)}
            onSuccess={async (v) => {
              setShowCreateModal(false);
              await mutate();
              setVersion(v);
            }}
          />
        )}
      </>
    );
  }

  // ── Shared schedule table (draft or live) ──────────────────────────────

  const {
    steps,
    monitoringConfig: monitoring,
    lockdownConfig: lockdown,
  } = view;
  const totalSteps = steps.length;
  const monitoredCount = steps.filter((s) => s.monitored).length;

  return (
    <Box>
      {/* Header row */}
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <Heading size="small" as="h4" mb="0">
            Feature Rollout
          </Heading>
          <Text size="small" color="text-mid">
            · {totalSteps} step{totalSteps !== 1 ? "s" : ""}
            {monitoredCount > 0 ? ` · ${monitoredCount} monitored` : ""}
          </Text>
          {isDraft && (
            <Badge label="Pending publish" color="amber" radius="full" />
          )}
          {isLive &&
            statusBadge(view.status as RampScheduleInterface["status"])}
        </Flex>
        <Flex gap="2" align="center">
          {isLive &&
            canEdit &&
            !isTerminalView &&
            view.status === "pending-approval" &&
            view.scheduleId && (
              <Button
                size="sm"
                onClick={async () => {
                  await apiCall(
                    `/ramp-schedule/${view.scheduleId}/actions/approve-step`,
                    { method: "POST" },
                  );
                  await mutate();
                }}
              >
                Approve Step
              </Button>
            )}
          {isLive &&
            canEdit &&
            !isTerminalView &&
            view.status === "running" &&
            view.scheduleId && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await apiCall(
                    `/ramp-schedule/${view.scheduleId}/actions/pause`,
                    { method: "POST" },
                  );
                  await mutate();
                }}
              >
                Pause
              </Button>
            )}
          {isLive && canEdit && view.status === "paused" && view.scheduleId && (
            <Button
              size="sm"
              onClick={async () => {
                await apiCall(
                  `/ramp-schedule/${view.scheduleId}/actions/resume`,
                  { method: "POST" },
                );
                await mutate();
              }}
            >
              Resume
            </Button>
          )}
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCreateModal(true)}
              >
                Edit plan
              </Button>
              <DropdownMenu
                trigger={
                  <IconButton
                    type="button"
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                  >
                    <BsThreeDotsVertical size={16} />
                  </IconButton>
                }
                variant="soft"
                menuPlacement="end"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    color="red"
                    onClick={async () => {
                      if (isDraft) {
                        await apiCall(
                          `/feature/${feature.id}/${currentVersion}/rollout`,
                          { method: "DELETE" },
                        );
                        await mutate();
                      } else if (view.scheduleId) {
                        await apiCall(`/ramp-schedule/${view.scheduleId}`, {
                          method: "DELETE",
                        });
                        await mutate();
                      }
                    }}
                  >
                    <PiTrash /> Remove schedule
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenu>
            </>
          )}
        </Flex>
      </Flex>

      {/* Metadata row */}
      <Flex gap="4" wrap="wrap" mb="3">
        {monitoring && (
          <Flex align="center" gap="1">
            <PiShieldCheckBold size={14} style={{ color: "var(--blue-9)" }} />
            <Text size="small" color="text-mid">
              {monitoring.guardrailMetricIds.length} guardrail
              {monitoring.guardrailMetricIds.length !== 1 ? "s" : ""}
            </Text>
          </Flex>
        )}
        {lockdown && lockdown.mode === "locked" && (
          <Flex align="center" gap="1">
            <PiLockSimpleBold
              size={14}
              style={{
                color: "var(--amber-11)",
              }}
            />
            <span style={{ color: "var(--amber-12)" }}>
              <Text size="small">
                {isDraft
                  ? "Feature will be locked during rollout"
                  : "Feature is locked during rollout"}
              </Text>
            </span>
          </Flex>
        )}
      </Flex>

      {/* Step schedule table */}
      <Table variant="surface" size="2">
        <TableHeader>
          <TableRow>
            <TableColumnHeader style={{ width: 56 }}>
              <Text size="small" weight="medium" color="text-low">
                STEP
              </Text>
            </TableColumnHeader>
            <TableColumnHeader>
              <Text size="small" weight="medium" color="text-low">
                APPLY EFFECT
              </Text>
            </TableColumnHeader>
            <TableColumnHeader style={{ width: 140 }}>
              <Text size="small" weight="medium" color="text-low">
                THEN
              </Text>
            </TableColumnHeader>
            <TableColumnHeader style={{ width: 100 }} />
            {isLive && !isTerminalView && (
              <TableColumnHeader style={{ width: 36 }} />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(() => {
            const runningEnvs = new Set<string>();
            for (const [envId, s] of Object.entries(
              feature.environmentSettings || {},
            )) {
              if (s.enabled) runningEnvs.add(envId);
            }

            return steps.map((step, stepIdx) => {
              for (const action of step.actions) {
                if (action.type === "set-environment-enabled") {
                  if (action.enabled) runningEnvs.add(action.environment);
                  else runningEnvs.delete(action.environment);
                }
              }

              const fx = extractStepEffects(step.actions, view.gateRules);

              return (
                <TableRow key={stepIdx}>
                  {/* STEP */}
                  <TableCell
                    style={{
                      verticalAlign: "top",
                      paddingTop: 8,
                      paddingBottom: 8,
                    }}
                  >
                    <StepIcon
                      num={stepIdx + 1}
                      state={
                        isDraft
                          ? "draft"
                          : resolveStepState(
                              stepIdx,
                              view.currentStepIndex,
                              view.status as RampScheduleInterface["status"],
                            )
                      }
                    />
                  </TableCell>

                  {/* EFFECT */}
                  <TableCell style={{ verticalAlign: "middle" }}>
                    <Flex direction="column" gap="3">
                      {/* Default coverage (non-env-scoped) */}
                      {fx.coveragePct !== undefined && (
                        <CoverageDisplay pct={fx.coveragePct} />
                      )}

                      {/* Per-env gate effects */}
                      {fx.envGates.map((eg, gi) => (
                        <Flex
                          key={gi}
                          gap="2"
                          align="start"
                          style={
                            gi > 0
                              ? {
                                  borderTop: "1px dashed var(--gray-a5)",
                                  paddingTop: 8,
                                }
                              : undefined
                          }
                        >
                          {/* Left: env badges */}
                          <Flex
                            gap="1"
                            wrap="wrap"
                            style={{
                              minWidth: 160,
                              maxWidth: 240,
                              flexShrink: 0,
                            }}
                          >
                            {eg.envIds.map((id) => {
                              const enabled = runningEnvs.has(id);
                              return (
                                <Badge
                                  key={id}
                                  label={
                                    <OverflowText maxWidth={100}>
                                      {id}
                                    </OverflowText>
                                  }
                                  color={enabled ? "violet" : "amber"}
                                  variant="outline"
                                  radius="full"
                                  size="xs"
                                />
                              );
                            })}
                          </Flex>
                          {/* Right: coverage + targeting */}
                          <Flex
                            direction="column"
                            gap="1"
                            style={{ flex: 1, minWidth: 0 }}
                          >
                            {eg.coveragePct !== undefined && (
                              <CoverageDisplay pct={eg.coveragePct} />
                            )}
                            {eg.toggle !== undefined && (
                              <Flex gap="1" align="center">
                                {eg.toggle ? (
                                  <FaCircleCheck
                                    size={14}
                                    style={{
                                      color: "var(--green-10)",
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <FaCircleXmark
                                    size={14}
                                    style={{
                                      color: "var(--color-text-low)",
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                                <span
                                  style={{
                                    fontSize: "var(--font-size-1)",
                                    color: eg.toggle
                                      ? "var(--green-10)"
                                      : undefined,
                                  }}
                                >
                                  toggled {eg.toggle ? "on" : "off"}
                                </span>
                              </Flex>
                            )}
                            {((eg.condition && eg.condition !== "{}") ||
                              (eg.savedGroups &&
                                eg.savedGroups.length > 0)) && (
                              <ConditionDisplay
                                condition={
                                  eg.condition && eg.condition !== "{}"
                                    ? eg.condition
                                    : undefined
                                }
                                savedGroups={eg.savedGroups}
                                prefix={<Text weight="medium">WHERE</Text>}
                              />
                            )}
                            {eg.removedCondition && (
                              <Text size="small" color="text-low">
                                – Remove targeting
                              </Text>
                            )}
                          </Flex>
                        </Flex>
                      ))}

                      {/* Default gate targeting (non-env-scoped) */}
                      {((fx.condition && fx.condition !== "{}") ||
                        (fx.savedGroups && fx.savedGroups.length > 0)) && (
                        <ConditionDisplay
                          condition={
                            fx.condition && fx.condition !== "{}"
                              ? fx.condition
                              : undefined
                          }
                          savedGroups={fx.savedGroups}
                          prefix={<Text weight="medium">WHERE</Text>}
                        />
                      )}
                      {fx.removedCondition && (
                        <Text size="small" color="text-low">
                          – Remove attribute targeting
                        </Text>
                      )}
                      {fx.removedSavedGroups && (
                        <Text size="small" color="text-low">
                          – Remove saved group targeting
                        </Text>
                      )}

                      {/* Other labels */}
                      {fx.labels.map((label, li) => (
                        <Text key={li} size="small">
                          {label}
                        </Text>
                      ))}

                      {/* Disabled env warning (deduped) */}
                      {fx.envGates.some((eg) =>
                        eg.envIds.some((id) => !runningEnvs.has(id)),
                      ) && (
                        <HelperText status="warning" size="sm">
                          Some environments are not enabled in this step. Enable
                          them in the schedule or manually before starting.
                        </HelperText>
                      )}
                    </Flex>
                  </TableCell>

                  {/* WAIT FOR */}
                  <TableCell style={{ verticalAlign: "top" }}>
                    <Text size="small" color="text-mid">
                      {formatTrigger(step)}
                    </Text>
                  </TableCell>

                  {/* MONITOR */}
                  <TableCell style={{ verticalAlign: "top" }}>
                    {step.monitored ? (
                      <Text size="small" color="text-mid">
                        <Flex
                          align="center"
                          gap="1"
                          style={{ display: "inline-flex" }}
                        >
                          <PiShieldCheckBold
                            size={12}
                            style={{ color: "var(--blue-9)" }}
                          />
                          monitored
                        </Flex>
                      </Text>
                    ) : (
                      <Text size="small" color="text-low">
                        —
                      </Text>
                    )}
                  </TableCell>

                  {/* Menu (live only) */}
                  {isLive && !isTerminalView && (
                    <TableCell style={{ verticalAlign: "top" }}>
                      {canEdit && (
                        <DropdownMenu
                          open={openMenuIndex === stepIdx}
                          onOpenChange={(o) =>
                            setOpenMenuIndex(o ? stepIdx : null)
                          }
                          trigger={
                            <IconButton
                              type="button"
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="1"
                              highContrast
                            >
                              <BsThreeDotsVertical size={14} />
                            </IconButton>
                          }
                          variant="soft"
                          menuPlacement="end"
                        >
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => {
                                setOpenMenuIndex(null);
                              }}
                            >
                              Jump to this step
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            });
          })()}
        </TableBody>
      </Table>

      {isLive && lockdown && lockdown.mode === "locked" && !isTerminalView && (
        <Callout status="warning" size="sm" mt="3" mb="0">
          This feature is locked from edits while the rollout is active. Admins
          can override.
        </Callout>
      )}

      {showCreateModal && (
        <FeatureRolloutModal
          feature={feature}
          version={currentVersion}
          existing={isDraft ? pendingRollout : undefined}
          onClose={() => setShowCreateModal(false)}
          onSuccess={async (v) => {
            setShowCreateModal(false);
            await mutate();
            setVersion(v);
          }}
        />
      )}
    </Box>
  );
}
