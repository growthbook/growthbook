import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState } from "react";
import {
  RampScheduleInterface,
  RampStep,
  RampStepAction,
  RevisionRampCreateFeatureRolloutAction,
} from "shared/validators";
import { PiShieldCheckBold, PiLockSimpleBold, PiTrash } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Tooltip from "@/ui/Tooltip";
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
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: RampScheduleInterface["status"]) {
  const map: Record<
    string,
    {
      label: string;
      color: "blue" | "yellow" | "purple" | "green" | "red" | "gray";
    }
  > = {
    running: { label: "Running", color: "blue" },
    paused: { label: "Paused", color: "yellow" },
    "pending-approval": { label: "Pending Approval", color: "purple" },
    completed: { label: "Completed", color: "green" },
    "rolled-back": { label: "Rolled Back", color: "red" },
    ready: { label: "Ready", color: "gray" },
    pending: { label: "Pending", color: "gray" },
  };
  const entry = map[status] ?? { label: status, color: "gray" as const };
  return <Badge label={entry.label} color={entry.color} />;
}

function CoverageBar({ pct }: { pct: number }) {
  return (
    <Box
      style={{
        width: 80,
        height: 6,
        borderRadius: 3,
        background: "var(--gray-4)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <Box
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 3,
          background:
            pct >= 100
              ? "var(--blue-9)"
              : pct > 0
                ? "var(--blue-9)"
                : "var(--gray-6)",
          transition: "width 300ms ease",
        }}
      />
    </Box>
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

// Extract per-step display rows from actions. A step may affect multiple
// environments and/or the gate, so each gets its own sub-row.
interface StepDisplayRow {
  envId?: string;
  enableEnv?: boolean;
  coveragePct?: number;
  condition?: string;
  removedCondition?: boolean;
  savedGroupCount?: number;
  isGlobal?: boolean; // gate-only row, applies to all enabled environments
  label?: string; // fallback label for non-standard actions
}

function extractStepRows(actions: RampStepAction[]): StepDisplayRow[] {
  const rows: StepDisplayRow[] = [];
  const envActions = actions.filter(
    (a) => a.type === "set-environment-enabled",
  );
  const gateAction = actions.find((a) => a.type === "set-gate");
  const detachAction = actions.find((a) => a.type === "detach-monitoring");
  const completeAction = actions.find((a) => a.type === "complete-rollout");

  // Environment toggles — each gets its own row
  for (const ea of envActions) {
    if (ea.type !== "set-environment-enabled") continue;
    rows.push({
      envId: ea.environment,
      enableEnv: ea.enabled,
    });
  }

  // Gate coverage/targeting — separate row
  if (gateAction && gateAction.type === "set-gate") {
    const patch = gateAction.patch;
    rows.push({
      isGlobal: true,
      coveragePct:
        patch.coverage !== undefined
          ? Math.round(patch.coverage * 100)
          : undefined,
      condition:
        patch.condition !== undefined && patch.condition !== null
          ? patch.condition
          : undefined,
      removedCondition: patch.condition === null,
      savedGroupCount: patch.savedGroups?.length,
    });
  }

  if (detachAction) {
    rows.push({ label: "Stop guardrail monitoring" });
  }
  if (completeAction) {
    rows.push({ label: "Complete rollout" });
  }

  if (rows.length === 0) {
    rows.push({});
  }

  return rows;
}

// Normalized view shared by both active schedules and pending draft rollouts
interface ScheduleView {
  steps: RampStep[];
  monitoringConfig?: { guardrailMetricIds: string[] } | null;
  lockdownConfig?: { mode: string } | null;
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
    status: "draft",
    currentStepIndex: -1,
  };
}

function scheduleToView(s: RampScheduleInterface): ScheduleView {
  return {
    steps: s.steps,
    monitoringConfig: s.monitoringConfig,
    lockdownConfig: s.lockdownConfig,
    status: s.status,
    currentStepIndex: s.currentStepIndex,
    scheduleId: s.id,
  };
}

function formatTrigger(step: RampScheduleInterface["steps"][number]) {
  if (step.trigger.type === "approval") {
    return step.approvalNotes
      ? `\u{1F4CB} ${step.approvalNotes}`
      : "\u{1F4CB} Approval required";
  }
  if (step.trigger.type === "interval") {
    const secs = step.trigger.seconds;
    if (secs >= 86400) {
      const d = Math.round(secs / 86400);
      return `then hold ${d}d`;
    }
    if (secs >= 3600) {
      const h = Math.round(secs / 3600);
      return `then hold ${h}h`;
    }
    const m = Math.round(secs / 60);
    return `then hold ${m}m`;
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
          {isDraft && <Badge label="Draft" color="purple" variant="soft" />}
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
            <PiLockSimpleBold size={14} style={{ color: "var(--amber-9)" }} />
            <Text size="small" color="text-mid">
              Locked
            </Text>
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
            <TableColumnHeader style={{ width: 180 }}>
              <Text size="small" weight="medium" color="text-low">
                ENVIRONMENTS
              </Text>
            </TableColumnHeader>
            <TableColumnHeader>
              <Text size="small" weight="medium" color="text-low">
                EFFECT
              </Text>
            </TableColumnHeader>
            <TableColumnHeader style={{ width: 140 }}>
              <Text size="small" weight="medium" color="text-low">
                WAIT / STATUS
              </Text>
            </TableColumnHeader>
            <TableColumnHeader style={{ width: 100 }}>
              <Text size="small" weight="medium" color="text-low">
                MONITOR
              </Text>
            </TableColumnHeader>
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

              const rows = extractStepRows(step.actions);
              const envsAfterStep = [...runningEnvs];

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

                  {/* ENABLED ENVIRONMENTS */}
                  <TableCell style={{ verticalAlign: "top" }}>
                    {envsAfterStep.length > 0 ? (
                      <Flex gap="1" wrap="wrap">
                        {envsAfterStep.map((eid) => (
                          <Tooltip key={eid} content={`${eid} is enabled`}>
                            <Badge
                              label={
                                <OverflowText maxWidth={140}>
                                  {eid}
                                </OverflowText>
                              }
                              color="violet"
                              variant="outline"
                              radius="full"
                              size="sm"
                            />
                          </Tooltip>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="small" color="text-low">
                        —
                      </Text>
                    )}
                  </TableCell>

                  {/* EFFECT */}
                  <TableCell style={{ verticalAlign: "middle" }}>
                    <Flex direction="column" gap="3">
                      {rows.map((row, ri) => (
                        <Flex key={ri} align="center" gap="2" wrap="wrap">
                          {row.envId !== undefined &&
                            row.enableEnv !== undefined && (
                              <Badge
                                label={`${row.enableEnv ? "Enable" : "Disable"} ${row.envId}`}
                                color={row.enableEnv ? "green" : "red"}
                                variant="soft"
                              />
                            )}
                          {row.coveragePct !== undefined && (
                            <>
                              <Text size="small" weight="medium">
                                {row.coveragePct}%
                              </Text>
                              <Text size="small" color="text-low">
                                rollout
                              </Text>
                              <CoverageBar pct={row.coveragePct} />
                            </>
                          )}
                          {row.condition && row.condition !== "{}" && (
                            <Badge
                              label={`where ${summarizeCondition(row.condition)}`}
                              color="orange"
                              variant="soft"
                            />
                          )}
                          {row.removedCondition && (
                            <Text size="small" color="text-low">
                              – Remove targeting
                            </Text>
                          )}
                          {row.label && <Text size="small">{row.label}</Text>}
                        </Flex>
                      ))}
                    </Flex>
                  </TableCell>

                  {/* WAIT / STATUS */}
                  <TableCell style={{ verticalAlign: "top" }}>
                    <Text size="small" color="text-mid">
                      {formatTrigger(step)}
                    </Text>
                  </TableCell>

                  {/* MONITOR */}
                  <TableCell style={{ verticalAlign: "top" }}>
                    {step.monitored ? (
                      <Flex align="center" gap="1">
                        <PiShieldCheckBold
                          size={12}
                          style={{ color: "var(--blue-9)" }}
                        />
                        <Text size="small" color="text-mid">
                          monitored
                        </Text>
                      </Flex>
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

      {isDraft && (
        <Callout status="info" size="sm" mt="3" mb="0">
          This rollout is pending on this draft. Publish to activate.
        </Callout>
      )}

      {isLive && lockdown && lockdown.mode === "locked" && !isTerminalView && (
        <Callout status="warning" size="sm" mt="3" mb="0">
          Feature rules are locked while this rollout is active. Admins can
          override.
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

// Best-effort condition summary for display
function summarizeCondition(condition: string): string {
  try {
    const parsed = JSON.parse(condition);
    if (!parsed || typeof parsed !== "object") return condition;
    const keys = Object.keys(parsed);
    if (keys.length === 0) return "all users";
    // Simple $or / $and / single attribute
    if (keys.length === 1 && !keys[0].startsWith("$")) {
      const val = parsed[keys[0]];
      if (typeof val === "object" && val !== null) {
        const op = Object.keys(val)[0];
        const v = val[op];
        if (op === "$in" && Array.isArray(v)) {
          return `${keys[0]} in [${v.join(", ")}]`;
        }
        if (op === "$eq" || op === "$is") {
          return `${keys[0]} = ${v}`;
        }
        return `${keys[0]} ${op} ${JSON.stringify(v)}`;
      }
      return `${keys[0]} = ${JSON.stringify(val)}`;
    }
    return `${keys.length} condition${keys.length !== 1 ? "s" : ""}`;
  } catch {
    return condition;
  }
}
