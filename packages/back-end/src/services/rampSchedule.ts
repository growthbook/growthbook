import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import {
  FeatureRulePatch,
  RampEvent,
  RampEventType,
  RampMonitoringMode,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
  SafeRolloutInterface,
} from "shared/validators";
import { ResourceEvents } from "shared/types/events/base-types";
import { filterEnvironmentsByFeature, MergeResultChanges } from "shared/util";
import { getEnvironments } from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import {
  createRevision,
  registerRevisionPublishedHook,
} from "back-end/src/models/FeatureRevisionModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";
import {
  resolveRampTargets,
  ruleFootprint,
  getApplicableEnvIds,
} from "back-end/src/util/flattenRules";

const LOCKDOWN_ACTIVE_STATUSES = ["running", "pending-approval"] as const;

const MAX_EVENT_HISTORY = 500;
export const MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export function getFirstMonitoredStepIndex(
  schedule: Pick<RampScheduleInterface, "steps">,
): number {
  return schedule.steps.findIndex((s) => !!s.monitored);
}

export function shouldResetMonitoringStartDate(
  schedule: Pick<RampScheduleInterface, "steps">,
  stepIndex: number,
): boolean {
  const firstMonitoredStepIndex = getFirstMonitoredStepIndex(schedule);
  return firstMonitoredStepIndex >= 0 && stepIndex === firstMonitoredStepIndex;
}

export function getRampMonitoringMode(
  monitoringConfig:
    | RampScheduleInterface["monitoringConfig"]
    | null
    | undefined,
): RampMonitoringMode {
  if (monitoringConfig?.monitoringMode) return monitoringConfig.monitoringMode;
  return monitoringConfig?.autoUpdate === false ? "manual" : "auto";
}

export function getRampAutoUpdatePreference(
  monitoringConfig:
    | RampScheduleInterface["monitoringConfig"]
    | null
    | undefined,
): boolean {
  return getRampMonitoringMode(monitoringConfig) === "auto";
}

export function getEffectiveRampAutoUpdateState(
  schedule: Pick<
    RampScheduleInterface,
    "status" | "monitoringConfig" | "currentStepIndex" | "steps"
  >,
): {
  enabled: boolean;
  reason: string | null;
  monitoringMode: RampMonitoringMode;
} {
  const monitoringMode = getRampMonitoringMode(schedule.monitoringConfig);
  if (!schedule.monitoringConfig) {
    return {
      enabled: false,
      reason: "Monitoring is not configured",
      monitoringMode,
    };
  }
  if (monitoringMode === "manual") {
    return {
      enabled: false,
      reason: "Manual mode enabled",
      monitoringMode,
    };
  }
  if (schedule.status !== "running") {
    return {
      enabled: false,
      reason: `Ramp is ${schedule.status}`,
      monitoringMode,
    };
  }
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step?.monitored) {
    return {
      enabled: false,
      reason: "Current step is not monitored",
      monitoringMode,
    };
  }
  return { enabled: true, reason: null, monitoringMode };
}

export async function syncLinkedSafeRolloutForRampState(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  terminalStatus?: "stopped" | "released" | "rolled-back",
): Promise<void> {
  if (!schedule.safeRolloutId) return;
  const sr = await ctx.models.safeRollout.getById(schedule.safeRolloutId);
  if (!sr) return;

  const effective = getEffectiveRampAutoUpdateState(schedule);
  const currentStepMonitored =
    schedule.currentStepIndex >= 0 &&
    !!schedule.steps[schedule.currentStepIndex]?.monitored;

  const status = (() => {
    if (terminalStatus) return terminalStatus;
    if (schedule.status === "completed") return "released";
    if (schedule.status === "rolled-back") return "rolled-back";
    if (schedule.status === "running" && currentStepMonitored) return "running";
    return "stopped";
  })();

  const updates: {
    status: SafeRolloutInterface["status"];
    autoSnapshots: boolean;
    startedAt?: Date;
    nextSnapshotAttempt?: Date;
  } = {
    status,
    autoSnapshots: effective.enabled,
  };
  if (status === "running" && sr.status !== "running" && !sr.startedAt) {
    updates.startedAt = new Date();
  }
  if (effective.enabled && (!sr.autoSnapshots || !sr.nextSnapshotAttempt)) {
    updates.nextSnapshotAttempt = new Date();
  }

  if (
    sr.status === updates.status &&
    sr.autoSnapshots === updates.autoSnapshots &&
    !updates.startedAt &&
    !updates.nextSnapshotAttempt
  ) {
    return;
  }

  await ctx.models.safeRollout.update(sr, updates);
}

// Keep event history bounded.
export function appendRampEvent(
  schedule: RampScheduleInterface,
  type: RampEventType,
  opts: {
    stepIndex?: number;
    previousStepIndex?: number;
    status?: RampScheduleInterface["status"];
    previousStatus?: RampScheduleInterface["status"];
    reason?: string;
    userId?: string;
  } = {},
): RampEvent[] {
  const event: RampEvent = {
    type,
    timestamp: new Date(),
    ...(opts.stepIndex !== undefined ? { stepIndex: opts.stepIndex } : {}),
    ...(opts.previousStepIndex !== undefined
      ? { previousStepIndex: opts.previousStepIndex }
      : {}),
    ...(opts.status !== undefined ? { status: opts.status } : {}),
    ...(opts.previousStatus !== undefined
      ? { previousStatus: opts.previousStatus }
      : {}),
    ...(opts.reason ? { reason: opts.reason } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
  };
  const history = [...(schedule.eventHistory ?? []), event];
  return history.slice(-MAX_EVENT_HISTORY);
}

export async function assertFeatureNotLockedByRamp(
  ctx: ReqContext | ApiReqContext,
  featureId: string,
): Promise<void> {
  const schedules = await ctx.models.rampSchedules.getAllByFeatureId(featureId);
  for (const s of schedules) {
    if (
      s.lockdownConfig?.mode === "locked" &&
      (LOCKDOWN_ACTIVE_STATUSES as readonly string[]).includes(s.status)
    ) {
      throw new Error(
        `Feature is locked by an active ramp schedule ("${s.name}"). Pause the schedule to make changes.`,
      );
    }
  }
}

// One entity handler publishes one revision per entity.
interface EntityHandler {
  applyActions(
    ctx: ReqContext | ApiReqContext,
    entityId: string,
    actions: RampStepAction[],
    opts: {
      stepLabel: string;
      user: EventUser;
      environment?: string | null;
    },
  ): Promise<void>;
}

export function forceMatchesValueType(
  value: unknown,
  valueType: FeatureInterface["valueType"],
): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  if (valueType === "boolean") return t === "boolean";
  if (valueType === "number") return t === "number";
  if (valueType === "string") return t === "string";
  if (valueType === "json") return t === "object";
  return false;
}

// Drop template `force` values whose type does not match the feature.
export function remapTemplateActions(
  actions: RampScheduleTemplateInterface["steps"][number]["actions"],
  targetId: string,
  ruleId: string,
  valueType: FeatureInterface["valueType"],
): RampStepAction[] {
  return (actions ?? []).map((a): RampStepAction => {
    if (a.targetType !== "feature-rule") return a;
    const patch = { ...a.patch, ruleId };
    if ("force" in patch && !forceMatchesValueType(patch.force, valueType)) {
      const { force: _force, ...rest } = patch;
      return { targetType: "feature-rule" as const, targetId, patch: rest };
    }
    return { targetType: "feature-rule" as const, targetId, patch };
  });
}

// Sparse step patches accumulate through the target step.
export function computeEffectivePatch(
  schedule: Pick<RampScheduleInterface, "steps" | "endActions">,
  stepIndex: number,
): Map<string, FeatureRulePatch> {
  // Sparse step patches inherit absent fields from earlier steps.
  const byTarget = new Map<string, FeatureRulePatch>();

  const merge = (act: RampStepAction) => {
    if (act.targetType !== "feature-rule") return;
    const { ruleId, ...fields } = act.patch;
    const existing = byTarget.get(act.targetId);
    if (existing) {
      for (const [k, v] of Object.entries(fields)) {
        (existing as Record<string, unknown>)[k] = v;
      }
    } else {
      byTarget.set(act.targetId, { ruleId, ...fields } as FeatureRulePatch);
    }
  };

  const lastStepIdx = Math.min(stepIndex, schedule.steps.length - 1);
  for (let i = 0; i <= lastStepIdx; i++) {
    for (const a of schedule.steps[i]?.actions ?? []) merge(a);
  }

  // Past the final step, apply end actions on top.
  if (stepIndex >= schedule.steps.length) {
    for (const a of schedule.endActions ?? []) merge(a);
  }

  return byTarget;
}

// Apply a patch to a rule. Uses "in" checks so injected undefined values clear the field.
// null clears most fields, but force allows null (valid JSON feature value).
export function applyPatchToRule(
  existing: FeatureRule,
  patch: Omit<FeatureRulePatch, "ruleId">,
): FeatureRule {
  const updated = { ...existing };
  if ("coverage" in patch) {
    (updated as { coverage?: number }).coverage = patch.coverage ?? undefined;
  }
  if ("condition" in patch) {
    updated.condition = patch.condition ?? undefined;
  }
  if ("savedGroups" in patch) {
    updated.savedGroups = patch.savedGroups ?? undefined;
  }
  if ("prerequisites" in patch) {
    updated.prerequisites = patch.prerequisites ?? undefined;
  }
  if ("allEnvironments" in patch) {
    updated.allEnvironments = patch.allEnvironments ?? false;
    if (patch.allEnvironments) {
      updated.environments = undefined;
    }
  }
  if ("environments" in patch) {
    updated.allEnvironments = false;
    updated.environments = patch.environments ?? undefined;
  }
  if ("force" in patch) {
    (updated as { value?: unknown }).value = patch.force; // null is a valid JSON value
  }
  if ("enabled" in patch) {
    updated.enabled = patch.enabled ?? undefined;
  }
  return updated;
}

export function getStartPatchForRule(
  rule: FeatureRule,
): Omit<FeatureRulePatch, "ruleId"> {
  const ruleState = rule as FeatureRule & {
    coverage?: number;
    value?: unknown;
  };
  const patch: Omit<FeatureRulePatch, "ruleId"> = {
    coverage: ruleState.coverage ?? null,
    condition: ruleState.condition ?? null,
    savedGroups: ruleState.savedGroups ?? null,
    prerequisites: ruleState.prerequisites ?? null,
    allEnvironments: ruleState.allEnvironments ?? null,
    environments: ruleState.environments ?? null,
    enabled: ruleState.enabled ?? null,
  };

  if ("value" in ruleState) {
    patch.force = ruleState.value;
  }

  return patch;
}

export function getStartActionsFromRules({
  rules,
  targetId,
  ruleId,
  environment,
}: {
  rules: FeatureRule[];
  targetId: string;
  ruleId: string;
  environment?: string | null;
}): RampStepAction[] {
  const targets = resolveRampTargets(
    { ruleId, environment: environment ?? null },
    rules,
  );
  return targets.map((rule) => ({
    targetType: "feature-rule" as const,
    targetId,
    patch: {
      ruleId: rule.id ?? ruleId,
      ...getStartPatchForRule(rule),
    },
  }));
}

export const featureEntityHandler: EntityHandler = {
  async applyActions(ctx, entityId, actions, opts) {
    const { stepLabel, user, environment } = opts;

    const feature = await getFeature(ctx, entityId);
    if (!feature) throw new Error(`Feature not found: ${entityId}`);

    const updatedRules: FeatureRule[] = (feature.rules ?? []).map((r) => ({
      ...r,
    }));

    for (const action of actions) {
      if (action.targetType !== "feature-rule") continue;
      const { patch } = action;
      const { ruleId, ...patchFields } = patch;

      // A legacy no-env target can fan out to env-split sibling rules.
      const targets = resolveRampTargets(
        { ruleId, environment: environment ?? null },
        updatedRules,
      );
      if (!targets.length) {
        const ref =
          `id "${ruleId}"` +
          (environment ? ` in environment "${environment}"` : "");
        throw new Error(
          `Ramp target rule ${ref} not found — it may have been deleted`,
        );
      }

      for (const target of targets) {
        const idx = updatedRules.indexOf(target);
        updatedRules[idx] = applyPatchToRule(target, patchFields);
      }
    }

    const revision = await createRevision({
      context: ctx,
      feature,
      user,
      environments: ctx.environments,
      changes: { rules: updatedRules },
      publish: false,
      comment: stepLabel,
      title: stepLabel,
      org: ctx.org,
    });

    const forceResult: MergeResultChanges = { rules: updatedRules };
    await publishRevision({
      context: ctx,
      feature,
      revision,
      result: forceResult,
      comment: stepLabel,
      bypassLockdown: true,
    });
  },
};

const entityHandlers: Record<string, EntityHandler> = {
  feature: featureEntityHandler,
  // TODO v2: experiment: experimentEntityHandler,
};

function getEntityHandler(entityType: string): EntityHandler {
  const handler = entityHandlers[entityType];
  if (!handler) {
    throw new Error(
      `No EntityHandler registered for entityType "${entityType}"`,
    );
  }
  return handler;
}

export function computeNextStepAt(
  schedule: RampScheduleInterface,
  stepIndex: number,
  now: Date,
): Date | null {
  // Interval steps are cumulative from phaseStartedAt; approval gates are immediate.
  const step = schedule.steps[stepIndex];
  if (!step) return null;

  const trigger = step.trigger;
  if (trigger.type === "approval") return now;
  if (trigger.type === "scheduled") return trigger.at;

  const phaseStart = schedule.phaseStartedAt ?? schedule.startedAt ?? now;
  let total = 0;
  for (let i = 0; i <= stepIndex; i++) {
    const t = schedule.steps[i]?.trigger;
    if (t?.type === "interval") total += t.seconds;
  }
  return new Date(phaseStart.getTime() + total * 1000);
}

export function computeNextProcessAt(schedule: {
  status: RampScheduleInterface["status"];
  nextStepAt?: Date | null;
  cutoffDate?: RampScheduleInterface["cutoffDate"];
  startDate?: RampScheduleInterface["startDate"];
  nextSnapshotAt?: Date | null;
}): Date | null {
  const cutoff = schedule.cutoffDate ?? null;

  switch (schedule.status) {
    case "running": {
      const stepAt = schedule.nextStepAt ?? null;
      const snapshotAt = schedule.nextSnapshotAt ?? null;
      const earliest = [stepAt, snapshotAt, cutoff]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return earliest ?? null;
    }
    case "pending-approval":
      return cutoff ?? null;
    case "ready":
      return schedule.startDate ?? null;
    default:
      return null;
  }
}

async function getMirroredNextSnapshotAt(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  enabled: boolean,
): Promise<Date | null> {
  if (!enabled || !schedule.safeRolloutId) return null;
  const safeRollout = await ctx.models.safeRollout.getById(
    schedule.safeRolloutId,
  );
  return safeRollout?.nextSnapshotAttempt ?? new Date();
}

function sameStringArray(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
) {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

function monitoringConfigRequiresSafeRolloutResync(
  current: RampScheduleInterface["monitoringConfig"],
  next: RampScheduleInterface["monitoringConfig"],
): boolean {
  if (!current || !next) return current !== next;
  return (
    current.datasourceId !== next.datasourceId ||
    current.exposureQueryId !== next.exposureQueryId ||
    current.updateScheduleMinutes !== next.updateScheduleMinutes ||
    !sameStringArray(current.guardrailMetricIds, next.guardrailMetricIds) ||
    !sameStringArray(current.signalMetricIds, next.signalMetricIds)
  );
}

export async function assertCanUpdateLinkedSafeRolloutMonitoringConfig(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  nextMonitoringConfig: RampScheduleInterface["monitoringConfig"],
): Promise<void> {
  if (
    !schedule.safeRolloutId ||
    !monitoringConfigRequiresSafeRolloutResync(
      schedule.monitoringConfig,
      nextMonitoringConfig,
    )
  ) {
    return;
  }

  const safeRollout = await ctx.models.safeRollout.getById(
    schedule.safeRolloutId,
  );
  if (safeRollout?.startedAt) {
    throw new Error(
      "Cannot change SafeRollout-backed monitoring data source, exposure query, metrics, or update cadence after monitoring has started.",
    );
  }
}

export function computePhaseStartAfterApproval(
  now: Date,
  schedule: RampScheduleInterface,
  nextStepIndex: number,
): Date {
  // Rebase so the next interval is measured from approval time.
  let total = 0;
  for (let i = 0; i < nextStepIndex; i++) {
    const t = schedule.steps[i]?.trigger;
    if (t?.type === "interval") total += t.seconds;
  }
  return new Date(now.getTime() - total * 1000);
}

async function executeStepActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  stepIndex: number,
  actions: RampStepAction[],
): Promise<void> {
  const ruleActions = actions.filter((a) => a.targetType === "feature-rule");
  if (!ruleActions.length) return;

  const byEntity = new Map<
    string,
    {
      entityType: string;
      entityId: string;
      actions: RampStepAction[];
      environment: string | null | undefined;
    }
  >();

  for (const action of ruleActions) {
    if (action.targetType !== "feature-rule") continue;
    const target = schedule.targets.find((t) => t.id === action.targetId);
    if (!target || target.status !== "active") continue;

    const key = `${target.entityType}:${target.entityId}`;
    if (!byEntity.has(key)) {
      byEntity.set(key, {
        entityType: target.entityType,
        entityId: target.entityId,
        actions: [],
        environment: target.environment,
      });
    }
    byEntity.get(key)!.actions.push(action);
  }

  const user: EventUser = {
    type: "system",
    subtype: "ramp-schedule",
    id: schedule.id,
  };

  const stepLabel =
    stepIndex >= schedule.steps.length
      ? "Ramp complete"
      : `Ramp step ${stepIndex + 1} of ${schedule.steps.length}`;

  for (const [, group] of byEntity) {
    const handler = getEntityHandler(group.entityType);
    try {
      await handler.applyActions(ctx, group.entityId, group.actions, {
        stepLabel,
        user,
        environment: group.environment,
      });
    } catch (e) {
      if ((e as Error).message?.startsWith("Feature not found:")) {
        logger.warn(
          { entityId: group.entityId },
          "Ramp step: entity not found, skipping",
        );
        continue;
      }
      throw e;
    }
  }
}

// Applies initial rule state and injects enabled:true so targets become visible when the ramp fires.
export async function applyRampStartActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  const enableActions: RampStepAction[] = schedule.targets
    .filter((t) => t.status === "active" && t.entityType === "feature")
    .map((t) => ({
      targetType: "feature-rule" as const,
      targetId: t.id,
      patch: {
        ruleId: t.ruleId ?? "",
        enabled: true as const,
      },
    }));
  const actions = [...(schedule.startActions ?? []), ...enableActions];
  if (!actions.length) return;
  await executeStepActions(ctx, schedule, -1, actions);
}

export async function ensureSafeRolloutForMonitoredRamp(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const hasMonitoredSteps = schedule.steps.some((s) => s.monitored);
  const mc = schedule.monitoringConfig;
  if (!hasMonitoredSteps || !mc) return schedule;

  const allMetricIds = [
    ...mc.guardrailMetricIds,
    ...(mc.signalMetricIds ?? []),
  ];
  if (allMetricIds.length === 0) return schedule;

  if (schedule.safeRolloutId) {
    await syncLinkedSafeRolloutForRampState(ctx, schedule);
    return schedule;
  }

  const trackingKey = `ramp_${schedule.id}`;

  const sr = await ctx.models.safeRollout.create({
    featureId: schedule.entityId,
    datasourceId: mc.datasourceId,
    exposureQueryId: mc.exposureQueryId,
    guardrailMetricIds: allMetricIds,
    maxDuration: { amount: 90, unit: "days" },
    autoRollback: false,
    autoSnapshots: false,
    status: "running",
    startedAt: new Date(),
    rampScheduleId: schedule.id,
    trackingKey,
    updateScheduleMinutes: mc.updateScheduleMinutes ?? undefined,
    rampUpSchedule: {
      enabled: false,
      step: 0,
      steps: [],
      rampUpCompleted: false,
    },
  });

  return ctx.models.rampSchedules.updateById(schedule.id, {
    safeRolloutId: sr.id,
    eventHistory: appendRampEvent(schedule, "safe-rollout-linked", {
      stepIndex: schedule.currentStepIndex,
      status: schedule.status,
      reason: `Linked safe rollout ${sr.id}`,
    }),
  });
}

export async function transitionLinkedSafeRollout(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  targetStatus: "stopped" | "released" | "rolled-back",
): Promise<void> {
  await syncLinkedSafeRolloutForRampState(ctx, schedule, targetStatus);
}

export async function advanceStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const nextStepIndex = schedule.currentStepIndex + 1;
  const step = schedule.steps[nextStepIndex];

  if (!step) {
    return completeRollout(ctx, schedule);
  }

  const now = new Date();
  const isApprovalStep = step.trigger.type === "approval";
  const isMonitoredStep = step.monitored === true;

  const effective = computeEffectivePatch(schedule, nextStepIndex);
  const effectiveActions: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({
      targetType: "feature-rule" as const,
      targetId,
      patch,
    }),
  );
  await executeStepActions(ctx, schedule, nextStepIndex, effectiveActions);

  const nextStepAt =
    isApprovalStep || isMonitoredStep
      ? null
      : (computeNextStepAt(schedule, nextStepIndex, now) ?? now);

  const newStatus = isApprovalStep
    ? ("pending-approval" as const)
    : ("running" as const);
  const nextSnapshotAt = await getMirroredNextSnapshotAt(
    ctx,
    { ...schedule, status: newStatus, currentStepIndex: nextStepIndex },
    isMonitoredStep &&
      getEffectiveRampAutoUpdateState({
        ...schedule,
        status: newStatus,
        currentStepIndex: nextStepIndex,
      }).enabled,
  );

  let monitoredStepDueAt: Date | null = null;
  if (isMonitoredStep && step?.trigger.type === "interval") {
    monitoredStepDueAt = new Date(now.getTime() + step.trigger.seconds * 1000);
  }

  const shouldResetMonitoringStart = shouldResetMonitoringStartDate(
    schedule,
    nextStepIndex,
  );
  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: nextStepIndex,
    currentStepEnteredAt: now,
    ...(shouldResetMonitoringStart ? { monitoringStartDate: now } : {}),
    nextStepAt,
    nextSnapshotAt,
    nextProcessAt: computeNextProcessAt({
      status: newStatus,
      nextStepAt: monitoredStepDueAt ?? nextStepAt,
      nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
    }),
    eventHistory: appendRampEvent(schedule, "step-advanced", {
      stepIndex: nextStepIndex,
      previousStepIndex: schedule.currentStepIndex,
      status: newStatus,
      previousStatus: schedule.status,
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.step.advanced", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
    },
  });

  if (isApprovalStep) {
    await dispatchRampEvent(
      ctx,
      updated,
      "rampSchedule.actions.step.approvalRequired",
      {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: ctx.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
          approvalNotes: step.approvalNotes ?? undefined,
        },
      },
    );
  }

  return updated;
}

export async function rollbackToStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  targetStepIndex: number,
  reason?: string,
  options: {
    terminal?: boolean;
    emitEvent?: boolean;
    syncSafeRollout?: boolean;
  } = {},
): Promise<RampScheduleInterface> {
  const rollbackActions: RampStepAction[] =
    targetStepIndex === -1
      ? (schedule.startActions ?? [])
      : [...computeEffectivePatch(schedule, targetStepIndex).entries()].map(
          ([targetId, patch]) => ({
            targetType: "feature-rule" as const,
            targetId,
            patch,
          }),
        );

  const now = new Date();
  if (rollbackActions.length > 0) {
    await executeStepActions(ctx, schedule, targetStepIndex, rollbackActions);
  }

  const isFullRollback = targetStepIndex === -1;
  const terminalRollback = options.terminal ?? isFullRollback;
  const emitEvent = options.emitEvent ?? true;
  const syncSafeRollout = options.syncSafeRollout ?? true;
  const newStatus = terminalRollback ? "rolled-back" : "paused";

  const fullRollbackFields = terminalRollback
    ? {
        lastRollbackAt: now,
        lastRollbackReason: reason ?? "Manual",
      }
    : {};
  const shouldResetMonitoringStart = shouldResetMonitoringStartDate(
    schedule,
    targetStepIndex,
  );

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: targetStepIndex,
    nextStepAt: null,
    nextSnapshotAt: null,
    pausedAt: newStatus === "paused" ? now : null,
    nextProcessAt: null,
    ...(terminalRollback
      ? { monitoringStartDate: null }
      : shouldResetMonitoringStart
        ? { monitoringStartDate: now }
        : {}),
    ...fullRollbackFields,
    ...(emitEvent
      ? {
          eventHistory: appendRampEvent(schedule, "rollback", {
            stepIndex: targetStepIndex,
            previousStepIndex: schedule.currentStepIndex,
            status: newStatus,
            previousStatus: schedule.status,
            reason,
          }),
        }
      : {}),
  });

  if (syncSafeRollout) {
    if (terminalRollback) {
      await transitionLinkedSafeRollout(ctx, updated, "rolled-back");
    } else {
      await transitionLinkedSafeRollout(ctx, updated, "stopped");
    }
  }

  if (emitEvent) {
    await dispatchRampEvent(ctx, updated, "rampSchedule.actions.rolledBack", {
      object: {
        rampScheduleId: updated.id,
        rampName: updated.name,
        orgId: ctx.org.id,
        currentStepIndex: updated.currentStepIndex,
        status: updated.status,
        targetStepIndex,
      },
    });
  }

  return updated;
}

export async function rollbackSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  reason: string,
): Promise<RampScheduleInterface> {
  return rollbackToStep(ctx, schedule, -1, reason);
}

export async function pauseSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  reason?: string,
): Promise<RampScheduleInterface> {
  const now = new Date();
  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "paused",
    pausedAt: now,
    nextSnapshotAt: null,
    nextProcessAt: null,
    eventHistory: appendRampEvent(schedule, "paused", {
      stepIndex: schedule.currentStepIndex,
      status: "paused",
      previousStatus: schedule.status,
      reason,
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  return updated;
}

export async function resumeSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const now = new Date();
  const pauseDurationMs = schedule.pausedAt
    ? now.getTime() - schedule.pausedAt.getTime()
    : 0;
  const newStartedAt = schedule.startedAt ?? now;
  const newPhaseStartedAt = schedule.phaseStartedAt
    ? new Date(schedule.phaseStartedAt.getTime() + Math.max(0, pauseDurationMs))
    : now;

  const currentStep = schedule.steps[schedule.currentStepIndex];
  const pausedAtApproval = currentStep?.trigger?.type === "approval";

  const resumeUpdates: Record<string, unknown> = {
    status: pausedAtApproval ? "pending-approval" : "running",
    pausedAt: null,
    startedAt: newStartedAt,
    phaseStartedAt: newPhaseStartedAt,
    nextStepAt: pausedAtApproval ? null : schedule.nextStepAt,
  };

  if (!pausedAtApproval) {
    if (schedule.nextStepAt) {
      resumeUpdates.nextStepAt = new Date(
        schedule.nextStepAt.getTime() + pauseDurationMs,
      );
    } else {
      const nextStepIndex = schedule.currentStepIndex + 1;
      if (schedule.currentStepIndex === -1) {
        resumeUpdates.nextStepAt = schedule.steps.length > 0 ? now : null;
      } else if (nextStepIndex < schedule.steps.length) {
        const currentStepIndex = schedule.currentStepIndex;
        let sumBefore = 0;
        for (let i = 0; i < currentStepIndex; i++) {
          const t = schedule.steps[i]?.trigger;
          if (t?.type === "interval") sumBefore += t.seconds;
        }
        const freshPhaseStart = new Date(now.getTime() - sumBefore * 1000);
        resumeUpdates.phaseStartedAt = freshPhaseStart;
        resumeUpdates.nextStepAt = computeNextStepAt(
          { ...schedule, phaseStartedAt: freshPhaseStart },
          currentStepIndex,
          now,
        );
      }
    }
  }

  const resumedForMonitoring = {
    ...schedule,
    status: resumeUpdates.status as RampScheduleInterface["status"],
  };
  const nextSnapshotAt = await getMirroredNextSnapshotAt(
    ctx,
    resumedForMonitoring,
    getEffectiveRampAutoUpdateState(resumedForMonitoring).enabled,
  );
  resumeUpdates.nextSnapshotAt = nextSnapshotAt;
  resumeUpdates.nextProcessAt = computeNextProcessAt({
    status: resumeUpdates.status as RampScheduleInterface["status"],
    nextStepAt: resumeUpdates.nextStepAt as Date | null | undefined,
    nextSnapshotAt,
    cutoffDate: schedule.cutoffDate,
    startDate: schedule.startDate,
  });

  resumeUpdates.eventHistory = appendRampEvent(schedule, "resumed", {
    stepIndex: schedule.currentStepIndex,
    status: resumeUpdates.status as RampScheduleInterface["status"],
    previousStatus: schedule.status,
  });

  let updated = await ctx.models.rampSchedules.updateById(
    schedule.id,
    resumeUpdates,
  );

  if (!pausedAtApproval) {
    await advanceUntilBlocked(ctx, updated, now);
    updated = (await ctx.models.rampSchedules.getById(schedule.id)) ?? updated;
  }

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  return updated;
}

export async function restartSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  if (schedule.currentStepIndex >= 0) {
    await rollbackToStep(ctx, schedule, -1, "Restart from terminal");
  }

  const readied = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "ready",
    currentStepIndex: -1,
    startedAt: null,
    phaseStartedAt: null,
    pausedAt: null,
    nextStepAt: null,
    nextSnapshotAt: null,
    nextProcessAt: null,
    monitoringStartDate: null,
    eventHistory: appendRampEvent(schedule, "restart", {
      stepIndex: -1,
      previousStepIndex: schedule.currentStepIndex,
      status: "ready",
      previousStatus: schedule.status,
    }),
  });

  return startSchedule(ctx, readied);
}

export async function jumpSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  targetStepIndex: number,
): Promise<RampScheduleInterface> {
  const now = new Date();
  const freshPhaseStartedAt = (() => {
    if (targetStepIndex <= 0) return now;
    let elapsed = 0;
    for (let i = 0; i < targetStepIndex; i++) {
      const t = schedule.steps[i]?.trigger;
      if (t?.type === "interval") elapsed += t.seconds;
    }
    return new Date(now.getTime() - elapsed * 1000);
  })();

  let updated: RampScheduleInterface;
  if (targetStepIndex < schedule.currentStepIndex) {
    const rolled = await rollbackToStep(
      ctx,
      schedule,
      targetStepIndex,
      undefined,
      {
        terminal: false,
        emitEvent: false,
        syncSafeRollout: false,
      },
    );
    updated = await ctx.models.rampSchedules.updateById(rolled.id, {
      status: "paused",
      pausedAt: now,
      phaseStartedAt: freshPhaseStartedAt,
      nextStepAt: null,
      nextSnapshotAt: null,
      nextProcessAt: null,
    });
  } else if (targetStepIndex > schedule.currentStepIndex) {
    updated = await jumpAheadToStep(ctx, schedule, targetStepIndex);
  } else {
    updated = await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "paused",
      pausedAt: now,
      phaseStartedAt: freshPhaseStartedAt,
      nextStepAt: null,
      nextSnapshotAt: null,
      nextProcessAt: null,
      ...(shouldResetMonitoringStartDate(schedule, targetStepIndex)
        ? { monitoringStartDate: now }
        : {}),
      eventHistory: appendRampEvent(schedule, "step-jumped", {
        stepIndex: targetStepIndex,
        previousStepIndex: schedule.currentStepIndex,
        status: "paused",
        previousStatus: schedule.status,
        reason: "Re-entered current step",
      }),
    });
  }

  await syncLinkedSafeRolloutForRampState(ctx, updated, "stopped");

  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.jumped", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      targetStepIndex,
    },
  });

  return updated;
}

export async function setRampMonitoringMode(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  monitoringMode: RampMonitoringMode,
): Promise<RampScheduleInterface> {
  const monitoringConfig = schedule.monitoringConfig;
  if (!monitoringConfig) {
    throw new Error(
      "Cannot change monitoring mode on a schedule without monitoring configuration",
    );
  }

  const nextMonitoringConfig = {
    ...monitoringConfig,
    monitoringMode,
    autoUpdate: monitoringMode === "auto",
  };
  const effective = getEffectiveRampAutoUpdateState({
    ...schedule,
    monitoringConfig: nextMonitoringConfig,
  });
  const nextSnapshotAt = await getMirroredNextSnapshotAt(
    ctx,
    { ...schedule, monitoringConfig: nextMonitoringConfig },
    effective.enabled,
  );
  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    monitoringConfig: nextMonitoringConfig,
    nextSnapshotAt,
    nextProcessAt: computeNextProcessAt({
      status: schedule.status,
      nextStepAt: schedule.nextStepAt,
      nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
      startDate: schedule.startDate,
    }),
    eventHistory: appendRampEvent(schedule, "auto-update-toggled", {
      stepIndex: schedule.currentStepIndex,
      status: schedule.status,
      reason:
        monitoringMode === "auto"
          ? "Monitoring mode set to auto"
          : "Monitoring mode set to manual",
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  return updated;
}

export async function advanceScheduleManually(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  let scheduleToAdvance = schedule;
  if (schedule.status === "paused") {
    const now = new Date();
    const nextStepIndex = schedule.currentStepIndex + 1;
    let elapsed = 0;
    for (let i = 0; i < nextStepIndex; i++) {
      const t = schedule.steps[i]?.trigger;
      if (t?.type === "interval") elapsed += t.seconds;
    }
    const freshPhaseStart = new Date(now.getTime() - elapsed * 1000);
    scheduleToAdvance = await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "running",
      phaseStartedAt: freshPhaseStart,
      pausedAt: null,
    });
    await syncLinkedSafeRolloutForRampState(ctx, scheduleToAdvance);
  }

  return advanceStep(ctx, scheduleToAdvance);
}

export async function startSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const now = new Date();
  const initialNextStepAt = schedule.steps.length > 0 ? now : null;

  let current = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    monitoringStartDate: null,
    nextStepAt: initialNextStepAt,
    nextProcessAt: computeNextProcessAt({
      status: "running",
      nextStepAt: initialNextStepAt,
      cutoffDate: schedule.cutoffDate,
    }),
    eventHistory: appendRampEvent(schedule, "started", {
      stepIndex: -1,
      status: "running",
      previousStatus: schedule.status,
    }),
  });

  await applyRampStartActions(ctx, current);
  current = await ensureSafeRolloutForMonitoredRamp(ctx, current);
  await advanceUntilBlocked(ctx, current, now);
  current = (await ctx.models.rampSchedules.getById(schedule.id)) ?? current;
  await syncLinkedSafeRolloutForRampState(ctx, current);

  await dispatchRampEvent(ctx, current, "rampSchedule.actions.started", {
    object: {
      rampScheduleId: current.id,
      rampName: current.name,
      orgId: ctx.org.id,
      currentStepIndex: current.currentStepIndex,
      status: current.status,
    },
  });

  return current;
}

export async function jumpAheadToStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  jumpTarget: number,
): Promise<RampScheduleInterface> {
  const effective = computeEffectivePatch(schedule, jumpTarget);
  const jumpActions: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({
      targetType: "feature-rule" as const,
      targetId,
      patch,
    }),
  );
  const now = new Date();
  const shouldResetMonitoringStart = shouldResetMonitoringStartDate(
    schedule,
    jumpTarget,
  );

  if (jumpActions.length > 0) {
    await executeStepActions(ctx, schedule, jumpTarget, jumpActions);
  }

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "paused",
    currentStepIndex: jumpTarget,
    nextStepAt: null,
    nextSnapshotAt: null,
    pausedAt: now,
    nextProcessAt: null,
    ...(shouldResetMonitoringStart ? { monitoringStartDate: now } : {}),
    eventHistory: appendRampEvent(schedule, "step-jumped", {
      stepIndex: jumpTarget,
      previousStepIndex: schedule.currentStepIndex,
      status: "paused",
      previousStatus: schedule.status,
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated, "stopped");

  return updated;
}

export async function completeRollout(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const effective = computeEffectivePatch(schedule, schedule.steps.length);
  const actionsToApply: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({
      targetType: "feature-rule" as const,
      targetId,
      patch,
    }),
  );

  if (actionsToApply.length > 0) {
    await executeStepActions(
      ctx,
      schedule,
      schedule.steps.length,
      actionsToApply,
    );
  }

  const finalStepIndex =
    schedule.steps.length > 0
      ? schedule.steps.length - 1
      : schedule.currentStepIndex;

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "completed",
    currentStepIndex: finalStepIndex,
    nextStepAt: null,
    nextSnapshotAt: null,
    nextProcessAt: null,
    eventHistory: appendRampEvent(schedule, "completed", {
      stepIndex: finalStepIndex,
      previousStepIndex: schedule.currentStepIndex,
      status: "completed",
      previousStatus: schedule.status,
    }),
  });

  await transitionLinkedSafeRollout(ctx, updated, "released");

  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.completed", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
    },
  });

  return updated;
}

export async function onActivatingRevisionPublished(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  if (schedule.status !== "pending") return;

  const now = new Date();
  const isImmediate = !schedule.startDate || schedule.startDate <= now;

  if (isImmediate) {
    const initialNextStepAt = schedule.steps.length > 0 ? now : null;

    let current = await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "running",
      startedAt: now,
      phaseStartedAt: now,
      monitoringStartDate: null,
      nextStepAt: initialNextStepAt,
      nextProcessAt: computeNextProcessAt({
        status: "running",
        nextStepAt: initialNextStepAt,
        cutoffDate: schedule.cutoffDate,
      }),
      eventHistory: appendRampEvent(schedule, "started", {
        stepIndex: -1,
        status: "running",
        previousStatus: schedule.status,
      }),
    });

    await applyRampStartActions(ctx, current);
    current = await ensureSafeRolloutForMonitoredRamp(ctx, current);

    if (current.steps.length > 0) {
      await advanceUntilBlocked(ctx, current, now);
      current = (await ctx.models.rampSchedules.getById(current.id)) ?? current;
    }
    await syncLinkedSafeRolloutForRampState(ctx, current);

    await dispatchRampEvent(ctx, current, "rampSchedule.actions.started", {
      object: {
        rampScheduleId: current.id,
        rampName: current.name,
        orgId: ctx.org.id,
        currentStepIndex: current.currentStepIndex,
        status: current.status,
      },
    });
  } else {
    await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "ready",
      nextProcessAt: computeNextProcessAt({ ...schedule, status: "ready" }),
    });
  }
}

export async function onRevisionPublished(
  ctx: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
): Promise<void> {
  const activatingRamps =
    await ctx.models.rampSchedules.findByActivatingRevision(
      revision.featureId,
      revision.version,
    );
  for (const schedule of activatingRamps) {
    await onActivatingRevisionPublished(ctx, schedule);
  }
}

type RampFeatureEvent = Extract<
  ResourceEvents<"feature">,
  `rampSchedule.${string}`
>;

export async function dispatchRampEvent<T extends RampFeatureEvent>(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface | { id: string },
  event: T,
  data: CreateEventData<"feature", T>,
): Promise<void> {
  try {
    // Resolve project + environments for Slack/webhook filtering.
    // environments come directly from targets; project requires a feature lookup.
    let projects: string[] = [];
    let environments: string[] = [];
    let tags: string[] = [];
    if ("targets" in schedule && schedule.entityType === "feature") {
      const feature = await getFeature(ctx, schedule.entityId);
      if (feature) {
        projects = feature.project ? [feature.project] : [];
        tags = feature.tags ?? [];
        // Resolve each target to its v2 rule(s) and union their footprints.
        // For unified rules that span multiple envs (`environments: [...]` or
        // `allEnvironments: true`), this yields the full set rather than the
        // legacy single `target.environment`. Orphaned targets (rule id no
        // longer present) fall back to `target.environment`.
        const orgEnvIds = getApplicableEnvIds(
          getEnvironments(ctx.org),
          feature.project,
        );
        const collected = new Set<string>();
        for (const target of schedule.targets) {
          const matches = resolveRampTargets(target, feature.rules ?? []);
          if (matches.length === 0) {
            if (target.environment) collected.add(target.environment);
            continue;
          }
          for (const rule of matches) {
            for (const env of ruleFootprint(rule, orgEnvIds)) {
              collected.add(env);
            }
          }
        }
        environments =
          collected.size > 0
            ? [...collected]
            : Object.keys(feature.environmentSettings ?? {});
      }
    }
    await createEvent({
      context: ctx,
      object: "feature",
      objectId: schedule.id,
      event,
      data,
      projects,
      tags,
      environments,
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, `Error dispatching ramp schedule event ${event}`);
  }
}

export function initRampScheduleHooks(): void {
  registerRevisionPublishedHook(onRevisionPublished);
}

export async function advanceUntilBlocked(
  ctx: ReqContext | ApiReqContext,
  initial: RampScheduleInterface,
  now: Date,
): Promise<void> {
  let current = initial;
  const maxSteps = current.steps.length;

  for (let i = 0; i < maxSteps; i++) {
    if (
      current.cutoffDate &&
      current.cutoffDate <= now &&
      ["running", "paused", "pending-approval"].includes(current.status)
    ) {
      const completed = await completeRollout(ctx, current);
      const disableActions: RampStepAction[] = completed.targets
        .filter((target) => target.status === "active" && !!target.ruleId)
        .map((target) => ({
          targetType: "feature-rule" as const,
          targetId: target.id,
          patch: {
            ruleId: target.ruleId ?? "",
            enabled: false,
          },
        }));
      if (disableActions.length > 0) {
        await executeStepActions(
          ctx,
          completed,
          completed.steps.length,
          disableActions,
        );
      }
      return;
    }

    if (current.status !== "running") return;
    if (!current.nextStepAt || current.nextStepAt > now) return;

    current = await advanceStep(ctx, current);
  }
}

type ApproveStepError =
  | { code: "feature_not_found" }
  | { code: "permission_denied"; detail: string }
  | { code: "error"; detail: string };

export async function approveAndPublishStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<ApproveStepError | null> {
  const stepIndex = schedule.currentStepIndex;

  const feature = await getFeature(ctx, schedule.entityId);
  if (!feature) return { code: "feature_not_found" };

  if (!ctx.permissions.canUpdateFeature(feature, {})) {
    return { code: "permission_denied", detail: "Cannot update this feature" };
  }
  if (!ctx.permissions.canReviewFeatureDrafts(feature)) {
    return {
      code: "permission_denied",
      detail: "Cannot review drafts for this feature",
    };
  }

  const allEnvironments = getEnvironments(ctx.org);
  const environmentIds = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  ).map((e) => e.id);
  if (
    environmentIds.length > 0 &&
    !ctx.permissions.canPublishFeature(feature, environmentIds)
  ) {
    return {
      code: "permission_denied",
      detail: "Cannot publish to one or more affected environments",
    };
  }

  const now = new Date();
  const wasApprovalGate =
    schedule.steps[stepIndex]?.trigger.type === "approval";

  const nextStepIndex = stepIndex + 1;
  const newPhaseStart = wasApprovalGate
    ? computePhaseStartAfterApproval(now, schedule, nextStepIndex)
    : schedule.phaseStartedAt;

  const nextStepAt = schedule.steps[nextStepIndex]
    ? computeNextStepAt(
        { ...schedule, phaseStartedAt: newPhaseStart },
        nextStepIndex,
        now,
      )
    : null;

  const isCompleting = !nextStepAt;

  if (isCompleting) {
    await completeRollout(ctx, schedule);
    return null;
  }

  const approvalDraft = {
    ...schedule,
    status: "running" as const,
  };
  const nextSnapshotAt = await getMirroredNextSnapshotAt(
    ctx,
    approvalDraft,
    getEffectiveRampAutoUpdateState(approvalDraft).enabled,
  );

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "running",
    nextStepAt,
    nextSnapshotAt,
    ...(wasApprovalGate ? { phaseStartedAt: newPhaseStart } : {}),
    nextProcessAt: computeNextProcessAt({
      status: "running",
      nextStepAt,
      nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
    }),
    eventHistory: appendRampEvent(schedule, "approval-granted", {
      stepIndex: schedule.currentStepIndex,
      status: "running",
      previousStatus: schedule.status,
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  return null;
}
