import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import pick from "lodash/pick";
import {
  ANCHORED_RAMP_SCHEDULE_STATUSES,
  DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS,
  RampStartAction,
  RampStartPatch,
  LockdownConfig,
  RampEvent,
  RampEventType,
  RampMonitoringConfig,
  RampMonitoringMode,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStep,
  RampStepAction,
  RevisionRampDetachAction,
  SafeRolloutInterface,
  isAwaitingStartApproval,
  startApprovalPending,
} from "shared/validators";
import { ResourceEvents } from "shared/types/events/base-types";
import {
  MergeResultChanges,
  filterEnvironmentsByFeature,
  getApplicableEnvIds,
  getEnvsFromRampSchedule,
  isRampScheduleServing,
  rampRuleEnvKey,
  RAMP_PATCH_RULE_FIELDS,
  rampPlanControlledFields,
  rampTargetFootprint,
  detachedRampTargets,
  rampTargetRuleIds,
  stemRuleId,
  stringifyFeatureValue,
  unanchoredRampTargets,
  validateFeatureValue,
} from "shared/util";
import uniqid from "uniqid";
import {
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  getFeatureRuleEnvironmentsByIds,
  getFeature,
  getFeatureProjectsByIds,
  publishRevision,
} from "back-end/src/models/FeatureModel";
// NOTE: rampScheduleEvaluator also imports from this module (advanceStep, etc).
// The cycle is safe: every cross-module reference is a hoisted function
// declaration used only at call time, never at module top-level.
import { isCurrentStepReadyForApproval } from "back-end/src/services/rampScheduleEvaluator";
import {
  createRevision,
  getRevision,
  registerRevisionPublishedHook,
} from "back-end/src/models/FeatureRevisionModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import {
  resolveRampTargets,
  ruleFootprint,
} from "back-end/src/util/flattenRules";
import { logger } from "back-end/src/util/logger";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  RampAdvanceLockBusyError,
} from "back-end/src/util/errors";

const LOCKDOWN_ACTIVE_STATUSES = ["running"] as const;

// A failed acquire means either contention or a deleted document — check so
// callers don't burn retries and report "in progress" for a missing doc.
async function assertScheduleExistsAfterFailedAcquire(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
): Promise<void> {
  const exists = await ctx.models.rampSchedules.getById(scheduleId);
  if (!exists) {
    throw new NotFoundError("Ramp schedule no longer exists");
  }
}

// The heartbeat passed to `fn` throws RampAdvanceLockBusyError when the lease
// was stale-reclaimed, so a robbed holder aborts instead of writing concurrently.
async function runWithAcquiredAdvanceLock<T>(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
  token: string,
  fn: (heartbeat: () => Promise<void>) => Promise<T>,
): Promise<T> {
  try {
    return await fn(async () => {
      const stillHeld =
        await ctx.models.rampSchedules.touchAdvanceLockHeartbeat(
          scheduleId,
          token,
        );
      if (!stillHeld) {
        // Distinct from benign contention: a live holder exceeded the stale
        // threshold and lost its lease — the signal the threshold is mis-sized.
        logger.warn(
          { rampScheduleId: scheduleId },
          "Ramp advance lock lease lost mid-flight; aborting the holder",
        );
        throw new RampAdvanceLockBusyError(
          `Ramp schedule ${scheduleId} advance lock was reclaimed mid-flight`,
        );
      }
    });
  } finally {
    // Never mask fn's error with a release failure; a leaked lock self-heals.
    try {
      await ctx.models.rampSchedules.releaseAdvanceLock(scheduleId, token);
    } catch (releaseErr) {
      logger.warn(
        { rampScheduleId: scheduleId, error: (releaseErr as Error).message },
        "Failed to release ramp advance lock; stale threshold will reclaim it",
      );
    }
  }
}

// Non-reentrant; throws RampAdvanceLockBusyError when held. Callers must
// re-read the schedule *inside* `fn` — acting on a pre-lock snapshot would
// replay steps another advance already applied.
export async function withRampScheduleAdvanceLock<T>(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
  fn: (heartbeat: () => Promise<void>) => Promise<T>,
): Promise<T> {
  return withRampScheduleAdvanceLockRetry(ctx, scheduleId, fn, 1);
}

// For user-initiated actions whose intent the scheduler cannot replay. Only
// the acquisition is retried — `fn` runs exactly once, so publishes can never
// be re-executed by a busy error escaping from inside `fn`.
export async function withRampScheduleAdvanceLockRetry<T>(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
  fn: (heartbeat: () => Promise<void>) => Promise<T>,
  attempts = 4,
): Promise<T> {
  const token = uniqid("ral_");
  for (let attempt = 1; ; attempt++) {
    const acquired = await ctx.models.rampSchedules.acquireAdvanceLock(
      scheduleId,
      token,
    );
    if (acquired) break;
    // Fail fast on a deleted doc rather than sleeping through the ladder.
    await assertScheduleExistsAfterFailedAcquire(ctx, scheduleId);
    if (attempt >= attempts) {
      throw new RampAdvanceLockBusyError(
        `Ramp schedule ${scheduleId} advance already in progress`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  return runWithAcquiredAdvanceLock(ctx, scheduleId, token, fn);
}

// `fn` must re-validate any status preconditions screened on the caller's
// pre-lock read — the schedule may have changed while waiting for the lock.
// Authorization is NOT re-checked here (callers gate differently, and the
// scheduler holds no user authority); control-verb dispatch sites use
// `runControlledRampScheduleAction` below, which does re-check.
export async function runLockedRampScheduleAction<T>(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
  fn: (
    fresh: RampScheduleInterface,
    heartbeat: () => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  return withRampScheduleAdvanceLockRetry(
    ctx,
    scheduleId,
    async (heartbeat) => {
      const fresh = await ctx.models.rampSchedules.getById(scheduleId);
      if (!fresh) {
        throw new NotFoundError("Ramp schedule no longer exists");
      }
      return fn(fresh, heartbeat);
    },
  );
}

/**
 * Locked runner for the control verbs (start/pause/resume/advance/rollback…),
 * which all gate on `assertCanControlRampSchedule`.
 *
 * Control authority derives from the schedule's targets, so a pre-lock check
 * can go stale while waiting for the lock (e.g. a concurrent add-target
 * attaches a flag the caller holds nothing in). The verdict is re-taken on the
 * in-lock document — the one the action actually acts on. Dispatch sites keep
 * their pre-lock assertion so the common case gets a plain 403 without a lock
 * wait.
 */
export async function runControlledRampScheduleAction<T>(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
  fn: (
    fresh: RampScheduleInterface,
    heartbeat: () => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  return runLockedRampScheduleAction(ctx, scheduleId, async (fresh, hb) => {
    await assertCanControlRampSchedule(ctx, fresh);
    return fn(fresh, hb);
  });
}

const MAX_EVENT_HISTORY = 500;
export const MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS =
  DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS * 60 * 60 * 1000;

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

  // Skip the write if nothing actually changed. The four-part guard covers the
  // only fields we ever mutate here:
  //   • status / autoSnapshots — always set; skip if already matching.
  //   • startedAt — only set on the first running transition, so !startedAt
  //     means "not the first transition" (subsequent calls are no-ops for this).
  //   • nextSnapshotAttempt — only set when effective.enabled is true AND the
  //     field is not yet populated. Once set, !nextSnapshotAttempt is false and
  //     this branch correctly forces a write to reset the timestamp.
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

// Distinct class so the bulk planner can tell a lockdown apart from an infra
// failure of the schedule read — a plain Error let a database error become a
// bypassable `ramp-locked` gate.
export class RampLockdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RampLockdownError";
  }
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
      throw new RampLockdownError(
        `Feature is locked by an active ramp schedule ("${s.name}"). Pause the schedule to make immediate changes.`,
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
      judgeTargeting?: boolean;
      // Collects what the step changed beyond its patches, for the step event.
      notes?: string[];
    },
  ): Promise<void>;
}

export function forceMatchesValueType(
  value: unknown,
  valueType: FeatureInterface["valueType"],
): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  // A string is the form rule values are stored in; it matches when the
  // feature's type accepts it ("false" for a boolean flag, "10" for a number).
  if (t === "string") {
    try {
      validateFeatureValue({ valueType }, value as string);
      return true;
    } catch {
      return false;
    }
  }
  if (valueType === "boolean") return t === "boolean";
  if (valueType === "number") return t === "number";
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
    if ("force" in patch) {
      patch.force = stringifyFeatureValue(patch.force);
    }
    return { targetType: "feature-rule" as const, targetId, patch };
  });
}

// Sparse step patches accumulate through the target step.
export function computeEffectivePatch(
  schedule: Pick<
    RampScheduleInterface,
    "steps" | "endActions" | "startActions"
  >,
  stepIndex: number,
): Map<string, RampStartPatch> {
  // startActions represent the rule's initial state (targeting conditions,
  // coverage, environments, etc.) captured at schedule creation time. They form
  // the base layer — step patches are sparse overlays that only specify fields
  // they change (typically just coverage). Without seeding from startActions,
  // any field present only in startActions (e.g. condition, savedGroups) would
  // never be applied when advancing into step 0.
  const byTarget = new Map<string, RampStartPatch>();

  const merge = (act: RampStepAction) => {
    if (act.targetType !== "feature-rule") return;
    const { ruleId, ...fields } = act.patch;
    const existing = byTarget.get(act.targetId);
    if (existing) {
      for (const [k, v] of Object.entries(fields)) {
        (existing as Record<string, unknown>)[k] = v;
      }
    } else {
      byTarget.set(act.targetId, { ruleId, ...fields } as RampStartPatch);
    }
  };

  // Seed with startActions — the base-layer rule state (condition, savedGroups,
  // coverage, etc.) that all steps inherit from unless explicitly overridden.
  // `enabled` is deliberately dropped from the seed: the engine owns the rule's
  // enabled state while a ramp is live, and a snapshot captured from a disabled
  // rule would otherwise re-disable the rule on every forward publish. Full
  // rollback (-1) applies the raw startActions instead of this function, so a
  // captured enabled state is still honored there.
  for (const a of schedule.startActions ?? []) {
    merge({ ...a, patch: omit(a.patch, "enabled") as RampStepAction["patch"] });
  }

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

type RampForceFeature = Pick<FeatureInterface, "valueType">;

// Bring every feature-rule action's `force` to the string form rule values
// are stored in and, given the feature, reject one its value TYPE rejects —
// the type half of a rule write's check, so a value predating a JSON-schema
// change is never refused. Without a feature, only stringify.
export function normalizeRampActionsForceValues<
  A extends { targetType?: string; patch: { force?: unknown } },
>(
  actions: A[],
  feature?: RampForceFeature | null,
  label = "Ramp value",
  isEcho: (force: string, action: A) => boolean = () => false,
): A[] {
  return actions.map((action, i) => {
    if (action.targetType !== undefined && action.targetType !== "feature-rule")
      return action;
    const { patch } = action;
    if (!patch || !("force" in patch) || patch.force === undefined)
      return action;
    let force = stringifyFeatureValue(patch.force);
    if (feature && !isEcho(force, action)) {
      try {
        force = validateFeatureValue(
          { valueType: feature.valueType },
          force,
          `${label} (action ${i + 1})`,
        );
      } catch (e) {
        throw new BadRequestError(e instanceof Error ? e.message : String(e));
      }
    }
    return { ...action, patch: { ...patch, force } };
  });
}

// The start values each target may echo without being judged: its rule's own
// current value and its stored anchor, keyed by target id. Anything else in
// `startActions` is the caller's and is checked like a step value. "t1" is
// the single-target sentinel the REST body may use.
export function rampStartValuesOf(
  feature: Pick<FeatureInterface, "rules"> | null | undefined,
  targets: { id: string; ruleId?: string | null }[],
  stored?: RampStepAction[] | null,
): Map<string, Set<string>> {
  const known = new Map<string, Set<string>>();
  for (const target of targets) {
    const values = new Set<string>();
    for (const rule of feature?.rules ?? []) {
      const { value } = rule as { value?: unknown };
      if (
        value !== undefined &&
        target.ruleId &&
        stemRuleId(rule.id) === stemRuleId(target.ruleId)
      ) {
        values.add(stringifyFeatureValue(value));
      }
    }
    for (const action of stored ?? []) {
      if (action.targetId === target.id && action.patch.force !== undefined) {
        values.add(stringifyFeatureValue(action.patch.force));
      }
    }
    known.set(target.id, values);
  }
  if (targets.length === 1) known.set("t1", known.get(targets[0].id)!);
  return known;
}

// Same, over a whole plan. Absent parts stay absent. `startActions` are the
// rollback anchor: `validateStartActions: false` only stringifies them (the
// anchor was derived by the server), and `knownStartValues` exempts values
// that echo the rule's own (see rampStartValuesOf) while judging the rest.
export function normalizeRampPlanForceValues<
  A extends { targetType?: string; patch: { force?: unknown } },
  P extends {
    steps?: { actions?: A[] | null }[] | null;
    startActions?: A[] | null;
    endActions?: A[] | null;
  },
>(
  plan: P,
  feature?: RampForceFeature | null,
  opts: {
    validateStartActions?: boolean;
    knownStartValues?: Map<string, Set<string>>;
  } = {},
): P {
  const out = { ...plan };
  if (plan.steps) {
    out.steps = plan.steps.map((s, i) =>
      s.actions
        ? {
            ...s,
            actions: normalizeRampActionsForceValues(
              s.actions,
              feature,
              `Step ${i + 1} value`,
            ),
          }
        : s,
    ) as P["steps"];
  }
  if (plan.startActions) {
    out.startActions = normalizeRampActionsForceValues(
      plan.startActions,
      opts.validateStartActions === false ? undefined : feature,
      "Start value",
      (force, action) =>
        opts.knownStartValues
          ?.get((action as { targetId?: string }).targetId ?? "")
          ?.has(force) ?? false,
    ) as P["startActions"];
  }
  if (plan.endActions) {
    out.endActions = normalizeRampActionsForceValues(
      plan.endActions,
      feature,
      "End value",
    ) as P["endActions"];
  }
  return out;
}

// Apply a patch to a rule. Uses "in" checks so injected undefined values clear the field.
// null clears most fields, but force allows null (valid JSON feature value).
export function applyPatchToRule(
  existing: FeatureRule,
  patch: Omit<RampStartPatch, "ruleId">,
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
  // Process `environments` before `allEnvironments` so that when both appear in
  // the same patch (e.g. from getStartPatchForRule on an allEnvironments rule),
  // the explicit `allEnvironments: true` always wins and is not silently reset
  // to false by the `environments` branch running afterwards.
  if ("environments" in patch) {
    updated.allEnvironments = false;
    updated.environments = patch.environments ?? undefined;
  }
  if ("allEnvironments" in patch) {
    updated.allEnvironments = patch.allEnvironments ?? false;
    if (patch.allEnvironments) {
      updated.environments = undefined;
    }
  }
  if ("force" in patch) {
    // null is a valid JSON value ("null"); undefined clears.
    (updated as { value?: string }).value =
      patch.force === undefined
        ? undefined
        : stringifyFeatureValue(patch.force);
  }
  if ("enabled" in patch) {
    updated.enabled = patch.enabled ?? undefined;
  }
  // The payload reads coverage only on rollout rules, so a force rule the ramp
  // buckets becomes one, as the rule modal does.
  const identity = updated as {
    hashAttribute?: string;
    seed?: string;
    hashVersion?: 1 | 2;
    coverage?: number;
  };
  const hashAttribute = patch.hashAttribute || identity.hashAttribute;
  const coverage = patch.coverage ?? null;
  const partialCoverage = coverage !== null && coverage < 1;
  if (
    updated.type === "force" &&
    hashAttribute &&
    (patch.hashAttribute || partialCoverage)
  ) {
    return {
      ...updated,
      type: "rollout",
      coverage: identity.coverage ?? 1,
      hashAttribute,
      seed: patch.seed || identity.seed || updated.id,
      hashVersion: patch.hashVersion ?? identity.hashVersion ?? 2,
    } as FeatureRule;
  }
  if (updated.type === "rollout") {
    if (patch.hashAttribute) identity.hashAttribute = patch.hashAttribute;
    if (patch.seed) identity.seed = patch.seed;
    const hashVersion = patch.hashVersion ?? null;
    if (hashVersion !== null) identity.hashVersion = hashVersion;
    // A promoted rule's start anchor carries no coverage; replaying it means
    // full coverage, not a rollout with none.
    if ("coverage" in patch && coverage === null) identity.coverage = 1;
  }
  return updated;
}

export function getStartPatchForRule(
  rule: FeatureRule,
): Omit<RampStartPatch, "ruleId"> {
  const ruleState = rule as FeatureRule & {
    coverage?: number;
    value?: unknown;
    hashAttribute?: string;
    seed?: string;
    hashVersion?: 1 | 2;
  };
  const patch: Omit<RampStartPatch, "ruleId"> = {
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
  // A rollout's bucketing is part of its anchor; a force rule has none to copy.
  if (rule.type === "rollout") {
    patch.hashAttribute = ruleState.hashAttribute ?? null;
    patch.seed = ruleState.seed ?? null;
    patch.hashVersion = ruleState.hashVersion ?? null;
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

// Resolves the rollback anchor (startActions) and an optional advisory for the
// REST ramp-schedule create/update flow. Pure given the rule + input.
//
// - Explicit `startState`: merged onto the rule's current state and returned as
//   startActions, so partial input like `{ coverage: 0 }` restores full
//   targeting while anchoring rollback at 0%.
// - Omitted on create: no startActions (the anchor is derived from the rule's
//   current coverage at publish). Returns a warning if that coverage isn't 0%,
//   since rollback would then return there rather than to 0%.
// - Omitted on update: no-op (leave the existing anchor alone).
export function resolveRampStartState({
  rule,
  ruleId,
  startState,
  isCreate,
}: {
  rule: FeatureRule;
  ruleId: string;
  startState?: Partial<Omit<RampStartPatch, "ruleId">>;
  isCreate: boolean;
}): { startActions?: RampStartAction[]; warning?: string } {
  if (startState !== undefined) {
    const patch = { ...getStartPatchForRule(rule), ...startState };
    return {
      startActions: [
        // targetId is a placeholder — the deferred create re-injects the real
        // target id (see normalizeAction in FeatureModel).
        {
          targetType: "feature-rule",
          targetId: "",
          patch: { ruleId, ...patch },
        },
      ],
    };
  }

  if (isCreate) {
    const coverage = (rule as { coverage?: number }).coverage;
    if (typeof coverage === "number" && coverage !== 0) {
      return {
        warning:
          `Ramp start state was inferred from rule "${ruleId}"'s current coverage ` +
          `(${Math.round(coverage * 100)}%); a rollback will return the rule there, ` +
          `not to 0%. Pass startState: { "coverage": 0 } to anchor rollbacks at 0%.`,
      };
    }
  }

  return {};
}

// Rule fields the start anchor carries, minus `enabled` (engine-owned while a
// ramp is live); the two environment fields are compared as one below.
const RAMP_BASE_FIELDS = [
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "value",
  "hashAttribute",
  "seed",
  "hashVersion",
] as const;

// Absent, empty and (for hashVersion) the SDK's implicit v1 all read the same.
function baseFieldValue(field: string, value: unknown): unknown {
  if (field === "hashVersion") return value ?? 1;
  if (value === "" || (Array.isArray(value) && !value.length)) return null;
  return value ?? null;
}

function changedRampBaseFields(live: FeatureRule, next: FeatureRule): string[] {
  const a = live as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const changed: string[] = RAMP_BASE_FIELDS.filter(
    (f) => !isEqual(baseFieldValue(f, a[f]), baseFieldValue(f, b[f])),
  );
  const envs = (r: Record<string, unknown>) => [
    r.allEnvironments ?? null,
    r.environments ?? null,
  ];
  if (!isEqual(envs(a), envs(b))) changed.push("environments");
  return changed;
}

function ruleFieldsAsStartPatch(
  rule: FeatureRule,
  fields: string[],
): Partial<RampStartPatch> {
  const r = rule as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "value") {
      if ("value" in r) patch.force = r.value;
    } else if (f === "environments") {
      patch.allEnvironments = r.allEnvironments ?? null;
      patch.environments = r.environments ?? null;
    } else {
      patch[f] = r[f] ?? null;
    }
  }
  return patch as Partial<RampStartPatch>;
}

// One start action's edited fields, keyed the way the engine binds actions.
type RampStartActionPatch = {
  targetId: string;
  ruleId: string;
  patch: Partial<RampStartPatch>;
};
export type RampBaseStateUpdate = {
  schedule: RampScheduleInterface;
  patches: RampStartActionPatch[];
};
export type RampBaseStateRefusal = {
  kind: "ramp-running" | "ramp-controlled-field" | "ramp-shared-base-state";
  scheduleId: string;
  message: string;
};
export type RampBaseStateSyncPlan = {
  refusals: RampBaseStateRefusal[];
  updates: RampBaseStateUpdate[];
};

// Dashboard wording for the rule fields the API names as-is.
const RAMP_FIELD_LABELS: Record<string, string> = {
  coverage: "rollout %",
  value: "value",
  condition: "attribute targeting",
  savedGroups: "saved groups",
  prerequisites: "prerequisites",
  environments: "environments",
  allEnvironments: "environments",
  hashAttribute: "sample-by attribute",
  seed: "seed",
  hashVersion: "hash version",
};

// Refuse edits under a running ramp or to fields a step sets; carry other
// anchor fields into the start action so every replay keeps them.
export function planRampBaseStateSync({
  featureId,
  schedules,
  liveRules,
  nextRules,
  apiRequest = false,
}: {
  featureId: string;
  schedules: RampScheduleInterface[];
  liveRules: FeatureRule[];
  nextRules: FeatureRule[];
  // API callers get field names and routes; the dashboard gets plain wording.
  apiRequest?: boolean;
}): RampBaseStateSyncPlan {
  const refusals: RampBaseStateRefusal[] = [];
  const updates: RampBaseStateUpdate[] = [];
  const label = (f: string) => (apiRequest ? f : (RAMP_FIELD_LABELS[f] ?? f));
  for (const schedule of schedules) {
    if (!ANCHORED_RAMP_SCHEDULE_STATUSES.includes(schedule.status)) continue;
    const startActions = schedule.startActions ?? [];
    // Keyed like the engine binds actions; legacy env-split siblings share one.
    const patches = new Map<string, RampStartActionPatch>();
    for (const target of schedule.targets) {
      if (
        target.status !== "active" ||
        target.entityType !== "feature" ||
        target.entityId !== featureId
      ) {
        continue;
      }
      const controlled = rampPlanControlledFields(schedule, target.id);
      const setBy = (f: string) =>
        controlled.get(f) ??
        (f === "environments" ? controlled.get("allEnvironments") : undefined);
      const live = resolveRampTargets(
        { ruleId: target.ruleId, environment: target.environment ?? null },
        liveRules,
      );
      const forTarget = (a: RampStartAction) => a.targetId === target.id;
      const anchorFor = (ruleId: string) =>
        startActions.find((a) => forTarget(a) && a.patch.ruleId === ruleId) ??
        startActions.find(
          (a) =>
            forTarget(a) && stemRuleId(a.patch.ruleId) === stemRuleId(ruleId),
        );
      const refusedAnchors = new Set<RampStartAction>();
      for (const liveRule of live) {
        const next = nextRules.find((r) => r.id === liveRule.id);
        if (!next) continue;
        const changed = changedRampBaseFields(liveRule, next);
        if (!changed.length) continue;
        // A schedule with no steps only replays its anchor at the cutoff, so
        // there is nothing to pause for.
        if (schedule.status === "running" && schedule.steps.length > 0) {
          refusals.push({
            kind: "ramp-running",
            scheduleId: schedule.id,
            message: apiRequest
              ? `Rule "${liveRule.id}" is part of the running ramp schedule "${schedule.name}" (${schedule.id}). ` +
                `Pause it before publishing changes to this rule: POST /api/v1/ramp-schedules/${schedule.id}/actions/pause.`
              : `Rule "${liveRule.id}" has a running ramp-up. Pause it before publishing changes to the rule.`,
          });
          continue;
        }
        const owned = changed
          .filter((f) => setBy(f))
          .map((f) => `${label(f)} is set by ${setBy(f)}`);
        if (owned.length) {
          refusals.push({
            kind: "ramp-controlled-field",
            scheduleId: schedule.id,
            message: apiRequest
              ? `Rule "${liveRule.id}": ${owned.join(", ")} of ramp schedule "${schedule.name}" (${schedule.id}). ` +
                `Change it in the plan: PUT /api/v1/ramp-schedules/${schedule.id}, or on a draft with ` +
                `PUT /api/v2/features/${featureId}/revisions/{version}/rules/${liveRule.id}/ramp-schedule.`
              : `Rule "${liveRule.id}": the ${owned.join(", ")} of its ramp-up. Change it in the ramp-up plan.`,
          });
          continue;
        }
        const anchor = anchorFor(liveRule.id);
        if (!anchor || refusedAnchors.has(anchor)) continue;
        // A legacy all-environment target replays one anchor onto every
        // migrated sibling, so it can only carry a value they all end up with.
        const edit = ruleFieldsAsStartPatch(next, changed);
        const diverging = live.filter(
          (r) =>
            r.id !== liveRule.id &&
            anchorFor(r.id) === anchor &&
            !isEqual(
              ruleFieldsAsStartPatch(
                nextRules.find((n) => n.id === r.id) ?? r,
                changed,
              ),
              edit,
            ),
        );
        if (diverging.length) {
          refusedAnchors.add(anchor);
          const others = diverging.map((r) => `"${r.id}"`).join(", ");
          const rules = `${diverging.length === 1 ? "Rule" : "Rules"} ${others}`;
          refusals.push({
            kind: "ramp-shared-base-state",
            scheduleId: schedule.id,
            message: apiRequest
              ? `Rule "${liveRule.id}" shares one base state with ${rules} in the legacy ramp schedule "${schedule.name}" (${schedule.id}), so this change would also apply there. ` +
                `Remove the ramp from the rule (DELETE /api/v2/features/${featureId}/revisions/{version}/rules/${liveRule.id}/ramp-schedule), publish the change, then attach a new ramp schedule.`
              : `Rule "${liveRule.id}" shares its ramp-up with ${rules}, so this change would also apply there. Remove the ramp-up, publish the change, then add a new ramp-up.`,
          });
          continue;
        }
        const key = `${anchor.targetId}:${anchor.patch.ruleId}`;
        const prior = patches.get(key)?.patch ?? {};
        patches.set(key, {
          targetId: anchor.targetId,
          ruleId: anchor.patch.ruleId,
          patch: { ...prior, ...edit },
        });
      }
    }
    if (patches.size) {
      updates.push({ schedule, patches: [...patches.values()] });
    }
  }
  return { refusals, updates };
}

function patchStartActions(
  startActions: RampStartAction[],
  patches: RampStartActionPatch[],
): RampStartAction[] {
  return startActions.map((a) => {
    const p = patches.find(
      (x) => x.targetId === a.targetId && x.ruleId === a.patch.ruleId,
    );
    return p ? { ...a, patch: { ...a.patch, ...p.patch } } : a;
  });
}

const BASE_STATE_SYNC_PREFIX = "Base state updated by publishing revision";
const ruleField = (patchKey: string) =>
  RAMP_PATCH_RULE_FIELDS[patchKey] ?? patchKey;

// "… revision 3: fr_a: condition, value; fr_b: coverage" — the rewind reads
// this back to see which fields a later publish took over.
function baseStateSyncReason(
  revisionVersion: number,
  patches: RampStartActionPatch[],
): string {
  const perRule = patches.map(
    (p) => `${p.ruleId}: ${Object.keys(p.patch).map(ruleField).join(", ")}`,
  );
  return `${BASE_STATE_SYNC_PREFIX} ${revisionVersion}: ${perRule.join("; ")}`;
}

function baseStateSyncFields(reason: string): Map<string, Set<string>> {
  const byRule = new Map<string, Set<string>>();
  for (const entry of reason.slice(reason.indexOf(": ") + 2).split("; ")) {
    const i = entry.indexOf(": ");
    if (i > 0)
      byRule.set(entry.slice(0, i), new Set(entry.slice(i + 2).split(", ")));
  }
  return byRule;
}

export async function planRampBaseStateSyncForPublish(
  ctx: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  result: MergeResultChanges,
  {
    // Bulk reads through a scan context; the wording follows the caller.
    apiRequest = ctx.isApiRequest,
    // Targets this publish detaches (a revert past the ramp's creation): the
    // ramp is leaving the rule, so its edit is neither refused nor anchored.
    detaching = [],
  }: { apiRequest?: boolean; detaching?: RevisionRampDetachAction[] } = {},
): Promise<RampBaseStateSyncPlan> {
  if (!result.rules) return { refusals: [], updates: [] };
  const schedules = await ctx.models.rampSchedules.findAnchoredByTargetFeature(
    feature.id,
  );
  return planRampBaseStateSync({
    featureId: feature.id,
    schedules: schedules.map((schedule) => {
      const detached = detachedRampTargets(schedule, detaching);
      return detached.length
        ? {
            ...schedule,
            targets: schedule.targets.filter((t) => !detached.includes(t)),
          }
        : schedule;
    }),
    liveRules: feature.rules ?? [],
    nextRules: result.rules,
    apiRequest,
  });
}

export type RampBaseStatePreImage = {
  id: string;
  // Per edited start action: the written fields and their values before.
  patches: (RampStartActionPatch & { before: Partial<RampStartPatch> })[];
  event: RampEvent;
};

const sameAction = (a: RampStartAction, p: RampStartActionPatch) =>
  a.targetId === p.targetId && a.patch.ruleId === p.ruleId;

// Writes each planned base state under the advance lock against a fresh read,
// so nothing that landed since planning is overwritten or slipped past.
export async function applyRampBaseStateSync(
  ctx: ReqContext | ApiReqContext,
  updates: RampBaseStateUpdate[],
  revisionVersion: number,
  written: RampBaseStatePreImage[],
): Promise<void> {
  for (const { schedule, patches } of updates) {
    await runLockedRampScheduleAction(ctx, schedule.id, async (fresh) => {
      const actions = fresh.startActions ?? [];
      const anchors = patches.map((p) => actions.find((a) => sameAction(a, p)));
      // The gates ran on a pre-lock snapshot; a resume or re-plan since then
      // must send the publish back through them rather than slip past.
      const stale =
        (fresh.status === "running" && fresh.steps.length > 0) ||
        anchors.some((a) => !a) ||
        !isEqual(
          getEnvsFromRampSchedule(fresh),
          getEnvsFromRampSchedule(schedule),
        ) ||
        patches.some((p) => {
          const controlled = rampPlanControlledFields(fresh, p.targetId);
          return Object.keys(p.patch).some((k) => controlled.has(ruleField(k)));
        });
      if (stale) {
        throw new ConflictError(
          `Ramp schedule "${fresh.name}" changed while publishing; retry the publish`,
        );
      }
      const eventHistory = appendRampEvent(fresh, "config-edited", {
        reason: baseStateSyncReason(revisionVersion, patches),
        userId: ctx.userId,
      });
      written.push({
        id: fresh.id,
        patches: patches.map((p, i) => ({
          ...p,
          before: pick(anchors[i]!.patch, Object.keys(p.patch)),
        })),
        event: eventHistory[eventHistory.length - 1],
      });
      await ctx.models.rampSchedules.updateById(fresh.id, {
        startActions: patchStartActions(actions, patches),
        eventHistory,
      });
    });
  }
}

// Puts back only the fields this publish still owns (a later write wins, even
// one that wrote the same value) and removes only the event row it added.
export async function restoreRampBaseStates(
  ctx: ReqContext | ApiReqContext,
  preImages: RampBaseStatePreImage[],
): Promise<void> {
  for (const { id, patches, event } of preImages) {
    await runLockedRampScheduleAction(ctx, id, async (fresh) => {
      // History is append-only, so position orders writes that share a
      // millisecond. An event already truncated away counts everything as later.
      const history = fresh.eventHistory ?? [];
      const at = (e: RampEvent) => new Date(e.timestamp).getTime();
      const mine = history.findIndex(
        (e) =>
          e.type === event.type &&
          e.reason === event.reason &&
          at(e) === at(event),
      );
      const laterWrites = history
        .slice(mine + 1)
        .filter(
          (e) =>
            e.type === "config-edited" &&
            e.reason?.startsWith(BASE_STATE_SYNC_PREFIX),
        );
      const startActions = (fresh.startActions ?? []).map((a) => {
        const p = patches.find((x) => sameAction(a, x));
        if (!p) return a;
        const takenOver = new Set(
          laterWrites.flatMap((e) => [
            ...(baseStateSyncFields(e.reason ?? "").get(p.ruleId) ?? []),
          ]),
        );
        const patch = { ...a.patch } as Record<string, unknown>;
        const written = p.patch as Record<string, unknown>;
        const before = p.before as Record<string, unknown>;
        for (const key of Object.keys(written)) {
          if (takenOver.has(ruleField(key))) continue;
          if (!isEqual(patch[key], written[key])) continue;
          if (key in before) patch[key] = before[key];
          else delete patch[key];
        }
        return { ...a, patch: patch as RampStartPatch };
      });
      await ctx.models.rampSchedules.updateById(id, {
        startActions,
        eventHistory: mine < 0 ? history : history.filter((_, i) => i !== mine),
      });
    });
  }
}

export const featureEntityHandler: EntityHandler = {
  async applyActions(ctx, entityId, actions, opts) {
    const { stepLabel, user, environment, judgeTargeting, notes } = opts;

    const feature = await getFeature(ctx, entityId);
    if (!feature) throw new Error(`Feature not found: ${entityId}`);

    const updatedRules: FeatureRule[] = (feature.rules ?? []).map((r) => ({
      ...r,
    }));

    if (judgeTargeting) {
      // A patch whose condition no longer parses or whose references are gone
      // would serve everyone once landed; refuse the step instead. Lazy
      // import: the validations module imports this one.
      const { validateRampPlanPatches } = await import(
        "back-end/src/api/features/validations"
      );
      const entries = actions.flatMap((action) => {
        if (action.targetType !== "feature-rule") return [];
        const { ruleId, ...patch } = action.patch;
        return resolveRampTargets(
          { ruleId, environment: environment ?? null },
          updatedRules,
        ).map((rule) => ({
          patch: { ...patch, ruleId: rule.id },
          feature,
          rule,
        }));
      });
      // The effective patch replays the start anchor too; only what the step
      // changes on the live rule is judged.
      await validateRampPlanPatches(ctx, entries, {
        stored: entries.map(({ rule }) => ({
          startActions: [
            { patch: { ...getStartPatchForRule(rule), ruleId: rule.id } },
          ],
        })),
      });
    }

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
        const patched = applyPatchToRule(target, patchFields);
        if (target.type === "force" && patched.type === "rollout") {
          notes?.push(
            `Rule ${target.id} became a rollout bucketed on "${(patched as { hashAttribute?: string }).hashAttribute}"`,
          );
        }
        // A value the feature's type rejects is logged, never refused:
        // rollbacks and restarts re-apply the rule's own earlier value.
        if ("force" in patchFields && patchFields.force !== undefined) {
          const value = (patched as { value?: string }).value ?? "";
          try {
            validateFeatureValue({ valueType: feature.valueType }, value);
          } catch (e) {
            logger.warn(
              {
                featureId: feature.id,
                ruleId,
                valueType: feature.valueType,
                err: e instanceof Error ? e.message : String(e),
              },
              "Ramp step applied a value the feature type does not accept",
            );
          }
        }
        updatedRules[idx] = patched;
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
      // Start/rollback replay a persisted anchor or earlier step. As with the
      // targeting validators above, scope must not prevent that restoration.
      savedGroupScopeBaseline: judgeTargeting
        ? undefined
        : { ...feature, rules: updatedRules },
    });

    const forceResult: MergeResultChanges = { rules: updatedRules };
    await publishRevision({
      context: ctx,
      feature,
      revision,
      result: forceResult,
      comment: stepLabel,
      bypassLockdown: true,
      rampEnginePublish: true,
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
  // Time-gated steps fire at phaseStartedAt + cumulative interval up through
  // stepIndex. Steps with interval=null (pure approval / instant gates) have
  // no time gate and return null so the evaluator drives them on the next tick.
  const step = schedule.steps[stepIndex];
  if (!step) return null;
  if (step.interval == null) return null;

  const phaseStart = schedule.phaseStartedAt ?? schedule.startedAt ?? now;
  let total = 0;
  for (let i = 0; i <= stepIndex; i++) {
    total += schedule.steps[i]?.interval ?? 0;
  }
  return new Date(phaseStart.getTime() + total * 1000);
}

// Tautological today (the schema only allows targetType "feature-rule").
// A future non-feature-rule action type must land individually AND extend
// computeEffectivePatch/executeStepActions, which currently drop it.
export function stepIsCollapsible(step: RampStep): boolean {
  return step.actions.every((a) => a.targetType === "feature-rule");
}

// Returns currentStepIndex when nothing is due, or steps.length to signal
// completion. Jumping straight to the target in one publish equals stepping
// (computeEffectivePatch is cumulative). `currentStepCleared`: the evaluator
// already verified the current step with real data — skip the first-hop gates.
export function computeAutoAdvanceTarget(
  schedule: RampScheduleInterface,
  now: Date,
  opts: { currentStepCleared?: boolean } = {},
): number {
  const startIndex = schedule.currentStepIndex;
  const maxSteps = schedule.steps.length;
  let target = startIndex;

  while (target < maxSteps) {
    const isFirstHop = target === startIndex;
    const firstHopCleared = isFirstHop && opts.currentStepCleared === true;

    // A hold on the step we're currently on gates advancing out of it. There is
    // no current step pre-start (target < 0), so step 0 is always reachable.
    if (target >= 0 && !firstHopCleared) {
      const step = schedule.steps[target];
      const purelyTimeGated =
        !step.monitored &&
        !step.holdConditions?.requiresApproval &&
        !step.holdConditions?.minSampleSize;
      if (!purelyTimeGated) break;
    }

    // Never fold past an unvisited non-collapsible step — land on it so its
    // effects fire. The current step is exempt: its landing already happened,
    // and gating exit on a static property would wedge the schedule.
    if (target > startIndex && !stepIsCollapsible(schedule.steps[target])) {
      break;
    }

    // The stored nextStepAt is authoritative for the current position (it has
    // no recomputable equivalent at index -1); later hops recompute
    // deterministically from the fixed phaseStartedAt.
    const gate = firstHopCleared
      ? now
      : isFirstHop
        ? schedule.nextStepAt
        : computeNextStepAt(schedule, target, now);
    if (!gate || gate > now) break;

    target += 1;
  }

  return target;
}

export function computeNextProcessAt(schedule: {
  status: RampScheduleInterface["status"];
  nextStepAt?: Date | null;
  cutoffDate?: RampScheduleInterface["cutoffDate"];
  startDate?: RampScheduleInterface["startDate"];
  nextSnapshotAt?: Date | null;
  requiresStartApproval?: boolean;
  startApprovedAt?: Date | null;
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
    case "ready":
      // Awaiting approval: never auto-arm, even with a startDate set (the
      // "approve, then wait for date" compose case).
      if (startApprovalPending(schedule)) return null;
      return schedule.startDate ?? null;
    case "paused":
      return cutoff;
    case "pending":
    case "completed":
    case "rolled-back":
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
    total += schedule.steps[i]?.interval ?? 0;
  }
  return new Date(now.getTime() - total * 1000);
}

// NOTE — canPublishFeature is intentionally not checked here.
//
// executeStepActions writes feature-rule patches (coverage, enabled, etc.) on
// behalf of the ramp schedule engine, not on behalf of a human user. Every
// call path that reaches this function — startSchedule, rollbackToStep,
// advanceStep, completeRollout, jumpAheadToStep — is a scheduled or
// system-initiated action that the user already authorised when they started
// (or configured) the schedule. Checking publish permission at execution time
// would silently strand running schedules if the originating user's role is
// later downgraded, which would be worse than the alternative.
//
// The only human-initiated path that does check canPublishFeature is
// approveAndPublishStep, which wraps a publishRevision call directly and
// therefore goes through the normal permission gate.
//
// If per-execution publish-permission enforcement is ever needed it should be
// added here, but treat it as a deliberate new policy change rather than a
// bug fix.
async function executeStepActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  stepIndex: number,
  actions: RampStepAction[],
  // fromStepIndex: position before a catch-up jump, so the published
  // revision's label shows the folded range instead of a normal single advance.
  // judgeTargeting: stored step or end patches are checked before they land.
  // Rollbacks are not: refusing a retreat is worse than replaying a stale step.
  opts: { fromStepIndex?: number; judgeTargeting?: boolean } = {},
): Promise<string[]> {
  const notes: string[] = [];
  const ruleActions = actions.filter((a) => a.targetType === "feature-rule");
  if (!ruleActions.length) return notes;

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

  // Simple schedules (no steps) only fire start and end actions; label them as
  // schedule events rather than ramp steps. For ramp-ups, distinguish the
  // pre-first-step "start" pass (stepIndex < 0, used by applyRampStartActions)
  // from intermediate steps and the final completion pass.
  const isSimpleSchedule = schedule.steps.length === 0;
  const isStartAction = stepIndex < 0;
  const isCompleteAction = stepIndex >= schedule.steps.length;
  // A catch-up jump folds steps (fromStepIndex+1 .. stepIndex) into one
  // publish; 1-based that's (fromStepIndex+2 .. stepIndex+1).
  const isJump =
    opts.fromStepIndex !== undefined && stepIndex > opts.fromStepIndex + 1;
  const jumpRange = isJump
    ? `steps ${(opts.fromStepIndex ?? 0) + 2}–${Math.min(stepIndex, schedule.steps.length - 1) + 1} of ${schedule.steps.length}`
    : "";
  let stepLabel: string;
  if (isSimpleSchedule) {
    stepLabel = isStartAction ? "Schedule started" : "Schedule ended";
  } else if (isStartAction) {
    stepLabel = "Ramp started";
  } else if (isCompleteAction) {
    stepLabel = isJump ? `Ramp complete (${jumpRange})` : "Ramp complete";
  } else if (isJump) {
    stepLabel = `Ramp ${jumpRange}`;
  } else {
    stepLabel = `Ramp step ${stepIndex + 1} of ${schedule.steps.length}`;
  }

  for (const [, group] of byEntity) {
    const handler = getEntityHandler(group.entityType);
    try {
      await handler.applyActions(ctx, group.entityId, group.actions, {
        stepLabel,
        user,
        environment: group.environment,
        judgeTargeting: opts.judgeTargeting,
        notes,
      });
    } catch (e) {
      if ((e as Error).message?.startsWith("Feature not found:")) {
        // The linked feature was deleted while the ramp was running. Skip this
        // target rather than failing the whole step, but leave a trace — this
        // runs in a background agenda job, so a silent skip is hard to correlate
        // to a partial/failed rollout when operators inspect logs afterward.
        logger.warn(
          {
            rampScheduleId: schedule.id,
            entityType: group.entityType,
            entityId: group.entityId,
            stepIndex,
          },
          "Ramp step skipped target: linked feature not found (deleted while ramp was running)",
        );
        continue;
      }
      throw e;
    }
  }
  return notes;
}

// Build an `enabled` patch for each active feature target. `enabled: false`
// forces the rule genuinely off (used when re-entering the pre-start hold),
// independent of the startActions snapshot.
function buildEnabledActions(
  schedule: RampScheduleInterface,
  enabled: boolean,
): RampStepAction[] {
  return schedule.targets
    .filter((t) => t.status === "active" && t.entityType === "feature")
    .map((t) => ({
      targetType: "feature-rule" as const,
      targetId: t.id,
      patch: { ruleId: t.ruleId ?? "", enabled },
    }));
}

// The single start-approval invariant, enforced at every point the rule can be
// enabled out of the -1 hold (advanceStep, jumpAheadToStep, applyRampStartActions).
// The approve flow records the approval BEFORE reaching any of these, so this
// only throws on a path that tried to start past the gate without it.
function assertStartApprovalCleared(schedule: RampScheduleInterface): void {
  if (startApprovalPending(schedule)) {
    throw new Error(
      `Ramp ${schedule.id} requires start approval before it can leave the pre-start hold`,
    );
  }
}

// Injects enabled:true for each active target so the rule becomes visible when
// the ramp fires. For ramps with steps this is a no-op — step 0's apply
// (advanceStep) folds enabled:true into the same revision as its targeting and
// coverage patches, avoiding a brief window where the rule is live with the
// pre-ramp state. Simple schedules (no steps) handle enabling here.
//
// INVARIANT: callers that hand off a steps>0 schedule via this function must
// follow with `advanceUntilBlocked` so step 0's apply runs and actually
// enables the rule. `advanceUntilBlocked` carries a defensive check that
// unsticks the ramp if that invariant is ever violated.
export async function applyRampStartActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  if (schedule.steps.length > 0) return;

  // The 0-step enable path (never routes through advanceStep/jumpAheadToStep).
  assertStartApprovalCleared(schedule);

  const enableActions = buildEnabledActions(schedule, true);
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

  // Both guardrail and signal metric IDs are stored together in the
  // monitoring experiment's `guardrailMetricIds` field. This is intentional:
  // the experiment's analysis pipeline surfaces per-metric results only for
  // registered guardrail metrics. The evaluator then distinguishes between
  // the two roles at decision time using the schedule's own guardrailMetricIds
  // / signalMetricIds sets (see evaluateMonitoredStep). Storing signals as
  // guardrails here is the required mechanism to get them into analysisSummary.
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
  targetStepIndex?: number,
): Promise<RampScheduleInterface> {
  const nextStepIndex = targetStepIndex ?? schedule.currentStepIndex + 1;

  // A backwards/no-op target means the caller's snapshot is stale (another
  // advance moved the playhead); publishing would silently rewind live coverage.
  if (nextStepIndex <= schedule.currentStepIndex) {
    logger.warn(
      {
        rampScheduleId: schedule.id,
        currentStepIndex: schedule.currentStepIndex,
        targetStepIndex: nextStepIndex,
      },
      "Refusing ramp advance to a non-forward step (stale caller snapshot?)",
    );
    return schedule;
  }

  // The rule becomes enabled when the schedule first crosses out of the -1 hold
  // (below); defense-in-depth net for any path that reached here past the gate.
  if (schedule.currentStepIndex < 0) assertStartApprovalCleared(schedule);

  const isJump = nextStepIndex > schedule.currentStepIndex + 1;
  const step = schedule.steps[nextStepIndex];

  if (!step) {
    if (schedule.cutoffDate && schedule.cutoffDate > new Date()) {
      return applyEndActionsAndAwaitCutoff(ctx, schedule, {
        autoCatchUp: true,
      });
    }
    // A cutoffDate here has already lapsed, so honor its disable semantics —
    // otherwise the rule would complete permanently enabled.
    return completeRollout(ctx, schedule, {
      disableActiveTargets: !!schedule.cutoffDate,
      autoCatchUp: isJump,
    });
  }

  const now = new Date();
  const isMonitoredStep = step.monitored === true;
  const hasInterval = step.interval !== null && step.interval !== undefined;

  const effective = computeEffectivePatch(schedule, nextStepIndex);

  // so the rule becomes visible in the same revision as its targeting/coverage.
  // Otherwise the rule would briefly be live with pre-ramp state.
  if (schedule.currentStepIndex < 0) {
    for (const target of schedule.targets) {
      if (target.status !== "active" || target.entityType !== "feature") {
        continue;
      }
      const existing = effective.get(target.id) ?? {
        ruleId: target.ruleId ?? "",
      };
      effective.set(target.id, { ...existing, enabled: true });
    }
  }

  const effectiveActions: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({
      targetType: "feature-rule" as const,
      targetId,
      patch,
    }),
  );
  const notes = await executeStepActions(
    ctx,
    schedule,
    nextStepIndex,
    effectiveActions,
    { judgeTargeting: true, fromStepIndex: schedule.currentStepIndex },
  );
  const reasons = isJump
    ? ["Automatic catch-up of overdue steps", ...notes]
    : notes;

  // `nextStepAt` is the time gate. Steps without an interval (pure approval /
  // instant gates) have no time gate, so nextStepAt is null. For instant
  // non-monitored steps we set nextProcessAt = now (see below) so the agenda
  // re-evaluates on its very next tick and advances through them. Monitored
  // steps use `monitoredStepDueAt` + nextSnapshotAt for tick scheduling instead.
  const nextStepAt =
    !hasInterval || isMonitoredStep
      ? null
      : (computeNextStepAt(schedule, nextStepIndex, now) ?? now);

  // `pending-approval` is no longer a stored status — running steps with
  // requiresApproval are derived as "awaiting approval" via isAwaitingApproval.
  const newStatus = "running" as const;
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
  if (
    isMonitoredStep &&
    step.interval !== null &&
    step.interval !== undefined
  ) {
    monitoredStepDueAt = new Date(now.getTime() + step.interval * 1000);
  }

  const shouldResetMonitoringStart = shouldResetMonitoringStartDate(
    schedule,
    nextStepIndex,
  );
  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: nextStepIndex,
    currentStepEnteredAt: now,
    stepApproval: null,
    healthHold: null,
    ...(shouldResetMonitoringStart ? { monitoringStartDate: now } : {}),
    nextStepAt,
    nextSnapshotAt,
    nextProcessAt: computeNextProcessAt({
      status: newStatus,
      nextStepAt:
        monitoredStepDueAt ?? nextStepAt ?? (!isMonitoredStep ? now : null),
      nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
    }),
    eventHistory: appendRampEvent(
      schedule,
      isJump ? "step-jumped" : "step-advanced",
      {
        stepIndex: nextStepIndex,
        previousStepIndex: schedule.currentStepIndex,
        status: newStatus,
        previousStatus: schedule.status,
        // Distinguishes automatic catch-up jumps from user-initiated
        // jumpSchedule jumps in the timeline/audit view.
        ...(reasons.length ? { reason: reasons.join(" ") } : {}),
      },
    ),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.step.advanced", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      previousStepIndex: schedule.currentStepIndex,
      status: updated.status,
    },
  });

  if (step.holdConditions?.requiresApproval) {
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

// Restores missing rollback anchors from the revision that activated each
// target. Its rules are the pre-step-0 state — the same input publish derives
// the anchor from — because every step publishes its own revision on top.
export async function ensureRampStartActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const unanchored = unanchoredRampTargets(schedule);
  if (!unanchored.length) return schedule;

  const feature = await getFeature(ctx, schedule.entityId);
  if (!feature) return schedule;

  const restored: RampStepAction[] = [];
  for (const target of unanchored) {
    const version = target.activatingRevisionVersion ?? null;
    if (version === null) continue;
    const revision = await getRevision({
      context: ctx,
      organization: ctx.org.id,
      featureId: feature.id,
      feature,
      version,
    });
    if (!revision?.rules) continue;
    restored.push(
      ...getStartActionsFromRules({
        rules: revision.rules,
        targetId: target.id,
        ruleId: target.ruleId ?? "",
        environment: target.environment,
      }),
    );
  }

  if (!restored.length) return schedule;
  return ctx.models.rampSchedules.updateById(schedule.id, {
    startActions: [...(schedule.startActions ?? []), ...restored],
  });
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
  schedule = await ensureRampStartActions(ctx, schedule);
  const isFullRollback = targetStepIndex === -1;
  const unanchored = isFullRollback ? unanchoredRampTargets(schedule) : [];
  if (unanchored.length) {
    logger.warn(
      { rampScheduleId: schedule.id, targetIds: unanchored.map((t) => t.id) },
      "Full rollback has no start actions for some targets; their rules keep the last applied step",
    );
  }
  // An approval-gated schedule returns to the pre-start hold on a full
  // rollback (manual or auto) instead of terminating: it lands back at step -1
  // awaiting a fresh approval. The -1 → 0 edge is always re-gated.
  const reHoldForApproval = isFullRollback && !!schedule.requiresStartApproval;

  let rollbackActions: RampStepAction[] =
    targetStepIndex === -1
      ? (schedule.startActions ?? [])
      : [...computeEffectivePatch(schedule, targetStepIndex).entries()].map(
          ([targetId, patch]) => ({
            targetType: "feature-rule" as const,
            targetId,
            patch,
          }),
        );

  if (reHoldForApproval) {
    // Force the rule genuinely off (zero traffic) in the same publish as the
    // anchor restore — the enabled flip is owned here, not by the startActions
    // snapshot (which may not carry `enabled`). The approve action re-enables
    // via the step-0 apply.
    const targetsCovered = new Set(rollbackActions.map((a) => a.targetId));
    rollbackActions = rollbackActions.map((a) =>
      a.targetType === "feature-rule"
        ? { ...a, patch: { ...a.patch, enabled: false } }
        : a,
    );
    for (const disable of buildEnabledActions(schedule, false)) {
      if (!targetsCovered.has(disable.targetId)) rollbackActions.push(disable);
    }
  }

  const now = new Date();
  if (rollbackActions.length > 0) {
    await executeStepActions(ctx, schedule, targetStepIndex, rollbackActions);
  }

  const emitEvent = options.emitEvent ?? true;
  const syncSafeRollout = options.syncSafeRollout ?? true;
  const terminalRollback =
    !reHoldForApproval && (options.terminal ?? isFullRollback);
  const newStatus = reHoldForApproval
    ? "ready"
    : terminalRollback
      ? "rolled-back"
      : "paused";

  // Record the reason on a terminal rollback AND on a re-hold: a guardrail
  // auto-rollback of an approval-gated ramp lands back in "ready" (awaiting
  // approval), so without this the hold shows no sign a guardrail tripped and a
  // re-approval relaunches straight into the same failure.
  const recordRollbackReason = terminalRollback || reHoldForApproval;
  const fullRollbackFields = recordRollbackReason
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
    stepApproval: null,
    healthHold: null,
    pausedAt: newStatus === "paused" ? now : null,
    nextProcessAt: null,
    // Re-arm the approval gate: clear the marker so the -1 → 0 crossing
    // holds again, and drop the monitoring window (relaunch starts fresh).
    ...(reHoldForApproval
      ? { startApprovedAt: null, monitoringStartDate: null }
      : terminalRollback
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
        ...(reason ? { reason } : {}),
      },
    });
  }

  // Re-entering the pre-start hold (manual or guardrail auto-rollback) emits the
  // awaiting-approval signal so integrations see the ramp is held again. Gated
  // by emitEvent: a caller that suppresses events (e.g. restartSchedule) fires
  // its own awaiting-approval signal afterward, so this would double-fire.
  if (reHoldForApproval && emitEvent) {
    await dispatchAwaitingStartApproval(ctx, updated);
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
    nextProcessAt: computeNextProcessAt({
      status: "paused",
      cutoffDate: schedule.cutoffDate,
    }),
    eventHistory: appendRampEvent(schedule, "paused", {
      stepIndex: schedule.currentStepIndex,
      status: "paused",
      previousStatus: schedule.status,
      reason,
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);
  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.paused", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      ...(reason ? { reason } : {}),
    },
  });

  return updated;
}

export async function resumeSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  heartbeat?: () => Promise<void>,
): Promise<RampScheduleInterface> {
  // Must be called with the advance lock held and `schedule` read inside it —
  // a pre-lock snapshot could resurrect state a concurrent tick produced
  // (e.g. flipping a just-completed schedule back to running).
  const now = new Date();
  const pauseDurationMs = schedule.pausedAt
    ? now.getTime() - schedule.pausedAt.getTime()
    : 0;
  const newStartedAt = schedule.startedAt ?? now;
  const newPhaseStartedAt = schedule.phaseStartedAt
    ? new Date(schedule.phaseStartedAt.getTime() + Math.max(0, pauseDurationMs))
    : now;

  const currentStep = schedule.steps[schedule.currentStepIndex];
  // A step without an interval (e.g. pure approval gate) has no time gate to
  // resume; `nextProcessAt` is set so the agenda re-evaluates hold conditions
  // on its next tick rather than advancing synchronously here.
  const pausedAtNoIntervalGate =
    currentStep != null && currentStep.interval == null;

  const resumeUpdates: Record<string, unknown> = {
    status: "running",
    pausedAt: null,
    startedAt: newStartedAt,
    phaseStartedAt: newPhaseStartedAt,
    nextStepAt: pausedAtNoIntervalGate ? null : schedule.nextStepAt,
  };

  if (!pausedAtNoIntervalGate) {
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
          sumBefore += schedule.steps[i]?.interval ?? 0;
        }
        const freshPhaseStart = new Date(now.getTime() - sumBefore * 1000);
        resumeUpdates.phaseStartedAt = freshPhaseStart;
        resumeUpdates.nextStepAt = computeNextStepAt(
          { ...schedule, phaseStartedAt: freshPhaseStart },
          currentStepIndex,
          now,
        );
      } else {
        // At the last step (nextStepIndex >= steps.length) with no nextStepAt.
        // If the current step has an interval, honour it so the step actually
        // runs its hold time before advancing to completion. Otherwise set
        // nextStepAt = now so advanceUntilBlocked finishes the schedule.
        if (currentStep?.interval) {
          const currentStepIndex = schedule.currentStepIndex;
          let sumBefore = 0;
          for (let i = 0; i < currentStepIndex; i++) {
            sumBefore += schedule.steps[i]?.interval ?? 0;
          }
          const freshPhaseStart = new Date(now.getTime() - sumBefore * 1000);
          resumeUpdates.phaseStartedAt = freshPhaseStart;
          resumeUpdates.nextStepAt = computeNextStepAt(
            { ...schedule, phaseStartedAt: freshPhaseStart },
            currentStepIndex,
            now,
          );
        } else {
          resumeUpdates.nextStepAt = now;
        }
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
  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.resumed", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
    },
  });

  // Chain through any time-due steps (nextStepAt <= now). Steps with no
  // interval (approval gates, instant steps) have nextStepAt=null and are not
  // traversed here — the agenda re-picks them via nextProcessAt.
  await heartbeat?.();
  await advanceUntilBlocked(ctx, updated, now);
  updated = (await ctx.models.rampSchedules.getById(schedule.id)) ?? updated;

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  return updated;
}

export async function restartSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  heartbeat?: () => Promise<void>,
): Promise<RampScheduleInterface> {
  if (schedule.currentStepIndex >= 0) {
    // Suppress the rolledBack webhook — this is a user-initiated restart, not
    // an automated rollback. The started event fired by startSchedule below is
    // the authoritative signal for external consumers.
    await rollbackToStep(ctx, schedule, -1, "Restart from terminal", {
      emitEvent: false,
    });
  }

  const readied = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "ready",
    currentStepIndex: -1,
    startedAt: null,
    phaseStartedAt: null,
    pausedAt: null,
    healthHold: null,
    nextStepAt: null,
    nextSnapshotAt: null,
    nextProcessAt: null,
    monitoringStartDate: null,
    stepApproval: null,
    // Re-arm the start-approval gate — a relaunch must be re-approved.
    startApprovedAt: null,
    // Clear rollback metadata written by the defensive rewind above so a
    // schedule restarted from "completed" does not surface a phantom rollback
    // reason via the /status endpoint.
    lastRollbackAt: null,
    lastRollbackReason: null,
    eventHistory: appendRampEvent(schedule, "restart", {
      stepIndex: -1,
      previousStepIndex: schedule.currentStepIndex,
      status: "ready",
      previousStatus: schedule.status,
    }),
  });

  // Roll the linked SR's analysis floor forward so the new run isn't gated
  // by prior-run snapshots; reset notification dedupe so the new run can
  // re-notify on the same kinds of issues.
  if (readied.safeRolloutId) {
    const sr = await ctx.models.safeRollout.getById(readied.safeRolloutId);
    if (sr) {
      const now = new Date();
      await ctx.models.safeRollout.update(sr, {
        analysisStartedAt: now,
        nextSnapshotAttempt: now,
        pastNotifications: [],
      });
    }
  }

  // An approval-gated schedule must be re-approved before it relaunches: leave
  // it held at step -1 (the rollback above disabled the rule) awaiting approval,
  // rather than auto-starting. The user approves via approve-step to launch.
  if (readied.requiresStartApproval) {
    await dispatchAwaitingStartApproval(ctx, readied);
    return readied;
  }

  await heartbeat?.();
  return startSchedule(ctx, readied, heartbeat);
}

// Move the schedule to `targetStepIndex` (forward or backward) and leave it
// paused. Re-applies (forward) or rolls back (backward) rule patches between
// the old and new step, stops the linked SafeRollout, and emits
// `rampSchedule.actions.jumped`. Use -1 for pre-start.
export async function jumpSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  targetStepIndex: number,
): Promise<RampScheduleInterface> {
  // Owns its bounds precondition: an out-of-range playhead reads as past-end
  // (unintended completion) downstream, and callers' pre-lock checks can be
  // stale against a concurrent steps edit.
  if (targetStepIndex < -1 || targetStepIndex >= schedule.steps.length) {
    throw new ConflictError(
      `Cannot jump: step ${targetStepIndex} does not exist on this schedule`,
    );
  }
  // A schedule held for start approval must not be jumped forward into a live
  // step — that crosses -1 → 0 (enabling the rule) without recording approval.
  // Require the approve action instead. Jumping to -1 stays allowed (pre-start).
  if (targetStepIndex >= 0 && isAwaitingStartApproval(schedule)) {
    throw new ConflictError(
      "This schedule requires start approval — approve it to begin, rather than jumping to a step.",
    );
  }
  const now = new Date();
  const freshPhaseStartedAt = (() => {
    if (targetStepIndex <= 0) return now;
    let elapsed = 0;
    for (let i = 0; i < targetStepIndex; i++) {
      elapsed += schedule.steps[i]?.interval ?? 0;
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
    // A jump to -1 on an approval-gated schedule re-holds it awaiting approval:
    // rollbackToStep put it in "ready", cleared startApprovedAt, and disabled
    // the rule. Preserve that instead of forcing "paused" — otherwise the
    // awaiting-approval state is hidden and resume/advance could cross -1 → 0
    // without an approval.
    if (targetStepIndex === -1 && rolled.requiresStartApproval) {
      updated = rolled;
    } else {
      updated = await ctx.models.rampSchedules.updateById(rolled.id, {
        status: "paused",
        pausedAt: now,
        phaseStartedAt: freshPhaseStartedAt,
        nextStepAt: null,
        nextSnapshotAt: null,
        nextProcessAt: null,
        stepApproval: null,
        healthHold: null,
      });
    }
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
      stepApproval: null,
      healthHold: null,
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
      requiresStartApproval: schedule.requiresStartApproval,
      startApprovedAt: schedule.startApprovedAt,
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
  const wasPaused = schedule.status === "paused";
  if (wasPaused) {
    const now = new Date();
    const nextStepIndex = schedule.currentStepIndex + 1;
    let elapsed = 0;
    for (let i = 0; i < nextStepIndex; i++) {
      elapsed += schedule.steps[i]?.interval ?? 0;
    }
    const freshPhaseStart = new Date(now.getTime() - elapsed * 1000);
    scheduleToAdvance = await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "running",
      phaseStartedAt: freshPhaseStart,
      pausedAt: null,
    });
  }

  try {
    if (wasPaused) {
      await syncLinkedSafeRolloutForRampState(ctx, scheduleToAdvance);
    }
    scheduleToAdvance = await ensureSafeRolloutForMonitoredRamp(
      ctx,
      scheduleToAdvance,
    );

    const now = new Date();
    // Fold the user-cleared advance and any due backlog behind it into one
    // publish, like the scheduler paths — advanceStep(+1) followed by a
    // catch-up would publish twice.
    const target = Math.max(
      computeAutoAdvanceTarget(scheduleToAdvance, now, {
        currentStepCleared: true,
      }),
      scheduleToAdvance.currentStepIndex + 1,
    );
    const advanced = await advanceStep(ctx, scheduleToAdvance, target);
    return (await ctx.models.rampSchedules.getById(advanced.id)) ?? advanced;
  } catch (e) {
    // If we transitioned from paused→running and then failed, revert to paused
    // so the agenda doesn't strand the schedule in running with no nextProcessAt.
    if (wasPaused) {
      logger.warn(
        { scheduleId: schedule.id, error: (e as Error).message },
        "advanceScheduleManually failed after paused→running transition; reverting to paused",
      );
      await errorPauseRampSchedule(
        ctx,
        schedule.id,
        `Manual advance failed: ${(e as Error).message}`,
      );
    }
    throw e;
  }
}

// Transient errors are retried on the next scheduler tick; structural ones
// pause the schedule so they surface in the UI.
export function isTransientRampError(e: unknown): boolean {
  if (e instanceof RampAdvanceLockBusyError) return true;
  // Mongo network / topology errors surface as generic Errors whose name or
  // message contains well-known driver strings.
  if (e instanceof Error) {
    const name = e.name ?? "";
    const msg = e.message ?? "";
    if (
      name.includes("MongoNetwork") ||
      name.includes("MongoTopology") ||
      name.includes("MongoServerSelection") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("connection timed out")
    ) {
      return true;
    }
  }
  return false;
}

// Pause a schedule the engine cannot advance and record why, so the next tick
// does not retry it and the UI shows the reason.
export async function errorPauseRampSchedule(
  ctx: ReqContext | ApiReqContext,
  scheduleId: string,
  reason: string,
): Promise<void> {
  const schedule = await ctx.models.rampSchedules.getById(scheduleId);
  if (!schedule) return;
  const updated = await ctx.models.rampSchedules.updateById(scheduleId, {
    status: "paused",
    pausedAt: new Date(),
    nextSnapshotAt: null,
    nextProcessAt: null,
    eventHistory: appendRampEvent(schedule, "error-paused", {
      stepIndex: schedule.currentStepIndex,
      status: "paused",
      previousStatus: schedule.status,
      reason,
    }),
  });
  try {
    await syncLinkedSafeRolloutForRampState(ctx, updated);
  } catch (syncErr) {
    logger.warn(
      { rampScheduleId: scheduleId, error: (syncErr as Error).message },
      "Failed to sync SafeRollout after error-pausing schedule; SafeRollout may be temporarily diverged",
    );
  }
  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.errorPaused", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      reason,
    },
  });
}

// A refused first step must not leave the schedule running for the poller to
// retry: pause it with the reason, then rethrow.
async function advanceOrErrorPause(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<void> {
  try {
    await advanceUntilBlocked(ctx, schedule, now);
  } catch (e) {
    if (!isTransientRampError(e)) {
      await errorPauseRampSchedule(
        ctx,
        schedule.id,
        e instanceof Error ? e.message : String(e),
      );
    }
    throw e;
  }
}

export async function startSchedule(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  heartbeat?: () => Promise<void>,
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
  await heartbeat?.();
  await advanceOrErrorPause(ctx, current, now);
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
  // A forward jump out of the -1 hold enables the rule — same gate as advanceStep.
  if (schedule.currentStepIndex < 0) assertStartApprovalCleared(schedule);

  const effective = computeEffectivePatch(schedule, jumpTarget);

  // Mirror advanceStep: if the schedule hasn't started yet, inject enabled:true
  // so the rule becomes visible in the same patch as its first coverage value.
  if (schedule.currentStepIndex < 0) {
    for (const target of schedule.targets) {
      if (target.status !== "active" || target.entityType !== "feature") {
        continue;
      }
      const existing = effective.get(target.id) ?? {
        ruleId: target.ruleId ?? "",
      };
      effective.set(target.id, { ...existing, enabled: true });
    }
  }

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

  const notes = jumpActions.length
    ? await executeStepActions(ctx, schedule, jumpTarget, jumpActions, {
        judgeTargeting: true,
      })
    : [];

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "paused",
    currentStepIndex: jumpTarget,
    nextStepAt: null,
    nextSnapshotAt: null,
    pausedAt: now,
    nextProcessAt: null,
    healthHold: null,
    stepApproval: null,
    ...(shouldResetMonitoringStart ? { monitoringStartDate: now } : {}),
    eventHistory: appendRampEvent(schedule, "step-jumped", {
      stepIndex: jumpTarget,
      previousStepIndex: schedule.currentStepIndex,
      status: "paused",
      previousStatus: schedule.status,
      ...(notes.length ? { reason: notes.join(" ") } : {}),
    }),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated, "stopped");

  return updated;
}

/**
 * Applies end-state patches (final coverage, etc.) and transitions the
 * schedule to "running" so the cutoff-date-driven disable still fires.
 *
 * Shared by `advanceStep` (automatic) and `completeRampKeepCutoff` (manual).
 */
async function applyEndActionsAndAwaitCutoff(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  // Only the advanceStep route sets this — a manual completeRampKeepCutoff
  // spanning multiple steps must not be recorded as an automatic catch-up.
  opts: { autoCatchUp?: boolean } = {},
): Promise<RampScheduleInterface> {
  const now = new Date();
  const effective = computeEffectivePatch(schedule, schedule.steps.length);

  // A never-started schedule (catch-up jump from -1 past the end) has its rule
  // still disabled — fold enabled:true into this publish or the rule would sit
  // at end-state coverage without ever serving traffic.
  if (schedule.currentStepIndex < 0 && schedule.steps.length > 0) {
    // Enabling here crosses -1 → serving, so it must clear the start-approval
    // gate like the start/advance/jump paths — a manual completion can't bypass it.
    assertStartApprovalCleared(schedule);
    for (const target of schedule.targets) {
      if (target.status !== "active" || target.entityType !== "feature") {
        continue;
      }
      const existing = effective.get(target.id) ?? {
        ruleId: target.ruleId ?? "",
      };
      effective.set(target.id, { ...existing, enabled: true });
    }
  }

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
      {
        judgeTargeting: true,
        ...(opts.autoCatchUp
          ? { fromStepIndex: schedule.currentStepIndex }
          : {}),
      },
    );
  }

  const pastEndIndex = schedule.steps.length;
  const isJump =
    !!opts.autoCatchUp && pastEndIndex > schedule.currentStepIndex + 1;
  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: "running",
    currentStepIndex: pastEndIndex,
    currentStepEnteredAt: now,
    nextStepAt: null,
    nextSnapshotAt: null,
    nextProcessAt: computeNextProcessAt({
      status: "running",
      cutoffDate: schedule.cutoffDate,
    }),
    eventHistory: appendRampEvent(
      schedule,
      isJump ? "step-jumped" : "step-advanced",
      {
        stepIndex: pastEndIndex,
        previousStepIndex: schedule.currentStepIndex,
        status: "running",
        previousStatus: schedule.status,
        ...(isJump ? { reason: "Automatic catch-up of overdue steps" } : {}),
      },
    ),
  });

  await syncLinkedSafeRolloutForRampState(ctx, updated);

  await dispatchRampEvent(ctx, updated, "rampSchedule.actions.step.advanced", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      previousStepIndex: schedule.currentStepIndex,
      status: updated.status,
    },
  });

  return updated;
}

/**
 * Applies end-state patches but keeps the schedule "running" so the
 * cutoff-date-driven disable still fires on time. Use when the user
 * wants to skip remaining steps but honour the cutoff.
 */
export async function completeRampKeepCutoff(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  return applyEndActionsAndAwaitCutoff(ctx, schedule);
}

export async function completeRollout(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  // `disableActiveTargets` folds `enabled: false` into the same publish as
  // `endActions` so callers (e.g. cutoffDate-driven completion) don't have
  // to fire a second revision publish for the disable.
  opts: { disableActiveTargets?: boolean; autoCatchUp?: boolean } = {},
): Promise<RampScheduleInterface> {
  const effective = computeEffectivePatch(schedule, schedule.steps.length);

  // Mirror advanceStep: if the schedule was never started (currentStepIndex < 0)
  // and it has actual ramp steps, inject enabled:true so the rule is not left
  // permanently disabled after completion. Zero-step schedules are excluded on
  // purpose: their natural flow enables via applyRampStartActions in the same
  // tick, and injecting here would add a redundant completion publish (the
  // effective patch no longer carries `enabled` from the startActions seed).
  if (schedule.currentStepIndex < 0 && schedule.steps.length > 0) {
    // This crosses -1 → serving, so honor the start-approval gate. Skipped when
    // disableActiveTargets is set — that path disables (e.g. cutoff-driven
    // completion) and the injected enabled:true is overridden to false below.
    if (!opts.disableActiveTargets) assertStartApprovalCleared(schedule);
    for (const target of schedule.targets) {
      if (target.status !== "active" || target.entityType !== "feature") {
        continue;
      }
      const existing = effective.get(target.id) ?? {
        ruleId: target.ruleId ?? "",
      };
      effective.set(target.id, { ...existing, enabled: true });
    }
  }

  if (opts.disableActiveTargets) {
    for (const target of schedule.targets) {
      if (target.status !== "active" || !target.ruleId) continue;
      if (effective.has(target.id)) continue;
      effective.set(target.id, { ruleId: target.ruleId });
    }
  }

  const actionsToApply: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => {
      if (!opts.disableActiveTargets) {
        return { targetType: "feature-rule" as const, targetId, patch };
      }
      const target = schedule.targets.find((t) => t.id === targetId);
      const disable = target?.status === "active" && !!target.ruleId;
      return {
        targetType: "feature-rule" as const,
        targetId,
        patch: disable ? { ...patch, enabled: false } : patch,
      };
    },
  );

  if (actionsToApply.length > 0) {
    await executeStepActions(
      ctx,
      schedule,
      schedule.steps.length,
      actionsToApply,
      {
        judgeTargeting: true,
        ...(opts.autoCatchUp
          ? { fromStepIndex: schedule.currentStepIndex }
          : {}),
      },
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
      previousStepIndex: schedule.currentStepIndex,
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
  // An approval-gated launch never auto-starts on publish (even with a past
  // startDate) — it holds at step -1 until approved. The rule is already
  // published disabled by the rule edit.
  const holdForApproval = startApprovalPending(schedule);
  const isImmediate =
    !holdForApproval && (!schedule.startDate || schedule.startDate <= now);

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

    // Always advance — for 0-step schedules this is the entry point to the
    // auto-complete check; for multi-step ramps it fires due steps.
    await advanceOrErrorPause(ctx, current, now);
    current = (await ctx.models.rampSchedules.getById(current.id)) ?? current;
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
    const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "ready",
      nextProcessAt: computeNextProcessAt({ ...schedule, status: "ready" }),
      ...(holdForApproval
        ? {
            eventHistory: appendRampEvent(schedule, "awaiting-start-approval", {
              stepIndex: -1,
              status: "ready",
              previousStatus: schedule.status,
            }),
          }
        : {}),
    });
    if (holdForApproval) {
      await dispatchAwaitingStartApproval(ctx, updated);
    }
  }
}

// Transition a `ready` schedule to `running` immediately (the "start now"
// path). Called from `createRampSchedulesForRevision` when an update action
// explicitly clears `startDate` on a schedule that has not yet started.
//
// Content-level fields (name, steps, cutoffDate, etc.) should already be
// applied to `schedule` before this is called, or passed in via
// `contentUpdates` so they land atomically in a single write.
//
// Returns false when the start did NOT run (schedule no longer ready, or the
// lock stayed busy) so the caller can apply its content edits through the
// normal update path instead of silently dropping them.
export async function startReadyScheduleNow(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  contentUpdates: StartNowContentUpdates = {},
): Promise<boolean> {
  if (schedule.status !== "ready") return false;

  try {
    // Re-verify "ready" and start from the in-lock read so an edit that landed
    // while waiting isn't overwritten with the caller's stale snapshot.
    return await withRampScheduleAdvanceLockRetry(
      ctx,
      schedule.id,
      async () => {
        const fresh = await ctx.models.rampSchedules.getById(schedule.id);
        if (!fresh || fresh.status !== "ready") return false;
        await startReadyScheduleNowLocked(ctx, fresh, contentUpdates);
        return true;
      },
    );
  } catch (e) {
    if (!(e instanceof RampAdvanceLockBusyError)) throw e;
    // Lock stayed busy: startDate=now defers the start to the scheduler
    // instead of losing the user's "start now". Status-guarded so it can't
    // re-arm a schedule that left "ready" while waiting; content edits are
    // the caller's responsibility on the false return.
    const deferred = await ctx.models.rampSchedules.deferReadyScheduleStart(
      schedule.id,
    );
    logger.warn(
      { rampScheduleId: schedule.id, deferred },
      "Start-now lock stayed busy; deferred the start to the scheduler via startDate",
    );
    return false;
  }
}

type StartNowContentUpdates = Partial<
  Pick<
    RampScheduleInterface,
    | "name"
    | "steps"
    | "startActions"
    | "endActions"
    | "cutoffDate"
    | "monitoringConfig"
    | "lockdownConfig"
    // Cleared start-approval must land in the same write that flips the schedule
    // to running, or the start tripwire (assertStartApprovalCleared) throws.
    | "requiresStartApproval"
    | "startApprovedAt"
  >
> & {
  // Recorded beneath the "started" event; appended onto the in-lock history
  // so concurrently appended events aren't clobbered by a caller-built array.
  auditEvent?: RampEvent;
};

async function startReadyScheduleNowLocked(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  contentUpdates: StartNowContentUpdates = {},
): Promise<void> {
  const now = new Date();
  const { auditEvent, ...contentFields } = contentUpdates;
  const steps = contentFields.steps ?? schedule.steps;
  const cutoffDate =
    "cutoffDate" in contentFields
      ? contentFields.cutoffDate
      : schedule.cutoffDate;
  const initialNextStepAt = steps.length > 0 ? now : null;

  const eventBase = auditEvent
    ? {
        ...schedule,
        eventHistory: [...(schedule.eventHistory ?? []), auditEvent],
      }
    : schedule;

  let current = await ctx.models.rampSchedules.updateById(schedule.id, {
    ...contentFields,
    startDate: null,
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    monitoringStartDate: null,
    nextStepAt: initialNextStepAt,
    nextProcessAt: computeNextProcessAt({
      status: "running",
      nextStepAt: initialNextStepAt,
      cutoffDate: cutoffDate ?? null,
    }),
    eventHistory: appendRampEvent(eventBase, "started", {
      stepIndex: -1,
      status: "running",
      previousStatus: schedule.status,
    }),
  });

  await applyRampStartActions(ctx, current);
  current = await ensureSafeRolloutForMonitoredRamp(ctx, current);
  await advanceOrErrorPause(ctx, current, now);
  current = (await ctx.models.rampSchedules.getById(current.id)) ?? current;
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
    try {
      // Without the lock, this hook and the scheduler's pending branch can
      // both observe "pending" and double-start the ramp.
      await withRampScheduleAdvanceLock(ctx, schedule.id, async () => {
        const fresh = await ctx.models.rampSchedules.getById(schedule.id);
        if (!fresh || fresh.status !== "pending") return;
        await onActivatingRevisionPublished(ctx, fresh);
      });
    } catch (e) {
      // Deleted mid-loop: nothing to activate; don't abort the sibling ramps.
      if (e instanceof NotFoundError) continue;
      if (!(e instanceof RampAdvanceLockBusyError)) throw e;
      // The scheduler is already processing this schedule; its pending branch
      // re-checks activation every tick, so the start is not lost.
      logger.info(
        { rampScheduleId: schedule.id },
        "Deferring ramp activation to scheduler — advance already in progress",
      );
    }
  }
}

type RampFeatureEvent = Extract<
  ResourceEvents<"feature">,
  `rampSchedule.${string}`
>;

// Fire the "awaiting start approval" signal — emitted from every path that
// leaves a schedule held at the pre-start gate (publish, restart, rollback/jump
// re-hold, standalone create) so integrations get one consistent event.
export async function dispatchAwaitingStartApproval(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  await dispatchRampEvent(
    ctx,
    schedule,
    "rampSchedule.actions.awaitingStartApproval",
    {
      object: {
        rampScheduleId: schedule.id,
        rampName: schedule.name,
        orgId: ctx.org.id,
        currentStepIndex: schedule.currentStepIndex,
        status: schedule.status,
      },
    },
  );
}

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
          feature,
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
    logger.warn(
      e,
      `Non-fatal ramp event dispatch failure (event=${event}, schedule=${schedule.id})`,
    );
    // Dispatch failures are non-fatal for the calling lifecycle action.
  }
}

export function initRampScheduleHooks(): void {
  registerRevisionPublishedHook(onRevisionPublished);
}

export async function advanceUntilBlocked(
  ctx: ReqContext | ApiReqContext,
  current: RampScheduleInterface,
  now: Date,
): Promise<void> {
  // A running schedule with no remaining work (no steps and no cutoffDate)
  // is terminal — auto-complete so it doesn't sit in "running" forever after
  // its start action fired. Schedules with a cutoffDate still wait for it;
  // multi-step ramps still progress through advanceStep below.
  //
  // For these "enable on date" schedules, the schedule has no future role once
  // its start action fires (the rule is just enabled). Delete it so the rule
  // ends up cleanly schedule-less rather than carrying a tombstone in the UI.
  if (
    current.status === "running" &&
    current.steps.length === 0 &&
    !current.cutoffDate
  ) {
    await completeRollout(ctx, current);
    await ctx.models.rampSchedules.dangerousDeleteByIdBypassPermission(
      current.id,
    );
    return;
  }

  // Must run even for 0-step "enable on publish, disable on date" schedules.
  if (
    current.cutoffDate &&
    current.cutoffDate <= now &&
    isRampScheduleServing(current)
  ) {
    await completeRollout(ctx, current, { disableActiveTargets: true });
    return;
  }

  // Defensive unstuck: a multi-step ramp that transitioned to "running"
  // without `nextStepAt = now` would have its rule stuck disabled, because
  // `applyRampStartActions` no-ops for steps>0 (assuming step 0's advanceStep
  // will fold enabled:true). Every current callsite sets nextStepAt=now
  // before calling us, but if a future callsite forgets, fire the enable
  // actions now so the rule isn't silently broken. `advanceStep` will
  // re-apply enabled:true when step 0 eventually fires; that's idempotent.
  if (
    current.status === "running" &&
    current.steps.length > 0 &&
    current.currentStepIndex < 0 &&
    (!current.nextStepAt || current.nextStepAt > now)
  ) {
    const enableActions = buildEnabledActions(current, true);
    if (enableActions.length) {
      logger.warn(
        { rampScheduleId: current.id, nextStepAt: current.nextStepAt },
        "Ramp schedule reached advanceUntilBlocked in 'running' state without step 0 being due; firing enable actions defensively",
      );
      await executeStepActions(ctx, current, -1, enableActions);
    }
  }

  if (current.status !== "running") return;

  // Collapse the overdue backlog into a single jump publish — publishing once
  // per due step regenerates the full SDK payload and fires webhooks per step,
  // the storm that took down pods when a large backlog replayed in one request.
  const target = computeAutoAdvanceTarget(current, now);
  if (target > current.currentStepIndex) {
    await advanceStep(ctx, current, target);
  }
}

type ApproveStepError =
  | { code: "feature_not_found" }
  | { code: "permission_denied"; detail: string }
  | { code: "not_ready"; detail: string }
  | { code: "error"; detail: string };

export async function approveAndPublishStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  context: "ui" | "api" = "ui",
): Promise<ApproveStepError | null> {
  const stepIndex = schedule.currentStepIndex;

  const feature = await getFeature(ctx, schedule.entityId);
  if (!feature) return { code: "feature_not_found" };

  if (!ctx.permissions.canEditFeatureDrafts(feature)) {
    return { code: "permission_denied", detail: "Cannot update this feature" };
  }
  // Granting an approval, so this must not use `any`. The step's footprint
  // needs the revision this path never loads, so it fails closed for now.
  if (
    !ctx.permissions.canReviewFeatureDrafts(feature, { scope: "everywhere" })
  ) {
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

  const step = schedule.steps[stepIndex];
  if (!step?.holdConditions?.requiresApproval) {
    return {
      code: "error",
      detail: "This step does not require approval",
    };
  }
  if (schedule.status !== "running") {
    return {
      code: "error",
      detail: `Cannot approve a step on a schedule in status "${schedule.status}"`,
    };
  }
  if (schedule.stepApproval?.stepIndex === schedule.currentStepIndex) {
    return null;
  }

  const now = new Date();

  // Approval is the *final* gate. We refuse to record an approval until every
  // other hold has cleared: the interval timer must have elapsed and — for
  // monitored steps — fresh analysis covering the step must be available with
  // no active rollback/hold signal. This keeps the UX honest (the user is only
  // ever asked to approve a step whose results they can actually review) and
  // prevents an early approval from short-circuiting the interval timer.
  const readiness = await isCurrentStepReadyForApproval(ctx, schedule, now);
  if (!readiness.ready) {
    return {
      code: "not_ready",
      detail: readiness.reason ?? "Step is not ready for approval yet",
    };
  }

  // Rebase phaseStartedAt so the *next* step's interval is measured from
  // approval time. This matters because approval is the final gate: the
  // readiness check above guarantees the step's own interval has already
  // elapsed, so any further time spent waiting for a human to approve is pure
  // latency. phaseStartedAt anchors the cumulative step-timer math in
  // computeNextStepAt, so without this rebase a late approval would leave the
  // next step's nextStepAt in the past — collapsing its interval to zero and
  // skipping straight through it (and any steps after). Rebasing applies to
  // both pure-approval steps (interval == null) and composite steps
  // (interval + approval); computePhaseStartAfterApproval subtracts the
  // cumulative interval of steps up to and including this one, so the next
  // step gets its full interval starting now.
  const rebasedPhaseStart = computePhaseStartAfterApproval(
    now,
    schedule,
    stepIndex + 1,
  );

  const updates: Record<string, unknown> = {
    stepApproval: {
      stepIndex,
      approvedAt: now,
      approvedBy: ctx.userId,
      context,
    },
    phaseStartedAt: rebasedPhaseStart,
    // Approval was the last remaining gate, so re-evaluate immediately.
    nextProcessAt: now,
    eventHistory: appendRampEvent(schedule, "approval-granted", {
      stepIndex,
      status: schedule.status,
      previousStatus: schedule.status,
    }),
  };

  const approved = await ctx.models.rampSchedules.updateById(
    schedule.id,
    updates,
  );

  // All of this step's holds have cleared, so advance now. Non-monitored steps
  // advance synchronously for immediate UI feedback. Monitored steps are left
  // to the agenda tick (nextProcessAt is now) so the evaluator re-checks the
  // latest analysis/health one more time before progressing — a late-breaking
  // regression should still block advancement even after approval.
  if (!step.monitored) {
    const afterApproval = await advanceStep(ctx, approved);
    await advanceUntilBlocked(ctx, afterApproval, now);
  }

  return null;
}

type ApproveStartError =
  | { code: "feature_not_found" }
  | { code: "permission_denied"; detail: string }
  | { code: "error"; detail: string };

// Approves the one-time "start on approval" hold on the -1 → step 0 edge.
// Sets the transient startApprovedAt marker, then either arms for a future
// startDate (the "approve, then wait for date" compose case) or starts now.
//
// Idempotent: a schedule that's already been approved (or already left the
// ready hold) returns null without side effects.
export async function approveScheduleStart(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<ApproveStartError | null> {
  const feature = await getFeature(ctx, schedule.entityId);
  if (!feature) return { code: "feature_not_found" };

  if (!ctx.permissions.canEditFeatureDrafts(feature)) {
    return { code: "permission_denied", detail: "Cannot update this feature" };
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

  if (!schedule.requiresStartApproval) {
    return {
      code: "error",
      detail: "This schedule does not require start approval",
    };
  }
  // Already approved, or already past the pre-start hold — nothing to do.
  if (schedule.startApprovedAt || schedule.currentStepIndex >= 0) return null;
  if (schedule.status !== "ready") {
    return {
      code: "error",
      detail: `Cannot approve start on a schedule in status "${schedule.status}"`,
    };
  }

  const now = new Date();
  const startInFuture = !!schedule.startDate && schedule.startDate > now;

  if (startInFuture) {
    // Approve now but keep waiting for the scheduled date: record the marker and
    // arm nextProcessAt (computeNextProcessAt now returns startDate since it's
    // approved). The poller starts it when the date arrives.
    const approvedSchedule = { ...schedule, startApprovedAt: now };
    const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
      startApprovedAt: now,
      nextProcessAt: computeNextProcessAt(approvedSchedule),
      eventHistory: appendRampEvent(schedule, "start-approved", {
        stepIndex: -1,
        status: schedule.status,
        previousStatus: schedule.status,
        userId: ctx.userId,
      }),
    });
    await dispatchRampEvent(
      ctx,
      updated,
      "rampSchedule.actions.startApproved",
      {
        object: {
          rampScheduleId: updated.id,
          rampName: updated.name,
          orgId: ctx.org.id,
          currentStepIndex: updated.currentStepIndex,
          status: updated.status,
        },
      },
    );
    return null;
  }

  // Start now. This function already runs INSIDE the advance lock (both the
  // controller and the API wrap it in runLockedRampScheduleAction), so call the
  // non-locking start body directly — using startReadyScheduleNow here would
  // try to re-acquire the same lock, spin through the retry window, and fall
  // back to deferring the start (the "stuck loading then starts a minute later"
  // bug). Record the approval marker + event first, then cross -1 → 0.
  const approved = await ctx.models.rampSchedules.updateById(schedule.id, {
    startApprovedAt: now,
    eventHistory: appendRampEvent(schedule, "start-approved", {
      stepIndex: -1,
      status: schedule.status,
      previousStatus: schedule.status,
      userId: ctx.userId,
    }),
  });
  await startReadyScheduleNowLocked(ctx, approved);
  const started = await ctx.models.rampSchedules.getById(schedule.id);
  await dispatchRampEvent(
    ctx,
    started ?? schedule,
    "rampSchedule.actions.startApproved",
    {
      object: {
        rampScheduleId: schedule.id,
        rampName: schedule.name,
        orgId: ctx.org.id,
        currentStepIndex: started?.currentStepIndex ?? -1,
        status: started?.status ?? "running",
      },
    },
  );
  return null;
}

export async function updateRampMonitoringConfig(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  newConfig: RampMonitoringConfig,
): Promise<RampScheduleInterface> {
  // A started SafeRollout freezes its metrics and cadence too, not just its
  // data source. Enforced here so the internal and REST surfaces can't drift.
  await assertCanUpdateLinkedSafeRolloutMonitoringConfig(
    ctx,
    schedule,
    newConfig,
  );

  // Datasource and exposureQuery are baked into the linked SafeRollout at
  // creation and cannot be changed post-start. Reject early to avoid silent
  // drift between the schedule config and what the SafeRollout actually queries.
  if (schedule.safeRolloutId && schedule.monitoringConfig) {
    const existing = schedule.monitoringConfig;
    if (
      newConfig.datasourceId !== existing.datasourceId ||
      newConfig.exposureQueryId !== existing.exposureQueryId
    ) {
      throw new Error(
        "Cannot change datasourceId or exposureQueryId while a SafeRollout is active. " +
          "Stop the schedule and create a new one to change the data source.",
      );
    }
  }

  const nextConfig: RampMonitoringConfig = { ...newConfig };
  const effective = getEffectiveRampAutoUpdateState({
    ...schedule,
    monitoringConfig: nextConfig,
  });
  const nextSnapshotAt = await getMirroredNextSnapshotAt(
    ctx,
    { ...schedule, monitoringConfig: nextConfig },
    effective.enabled,
  );

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    monitoringConfig: nextConfig,
    nextSnapshotAt,
    nextProcessAt: computeNextProcessAt({
      status: schedule.status,
      nextStepAt: schedule.nextStepAt,
      nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
      startDate: schedule.startDate,
      requiresStartApproval: schedule.requiresStartApproval,
      startApprovedAt: schedule.startApprovedAt,
    }),
    eventHistory: appendRampEvent(schedule, "config-edited", {
      stepIndex: schedule.currentStepIndex,
      status: schedule.status,
      reason: "Monitoring config updated via API",
    }),
  });

  // Sync metric IDs onto the linked monitoring experiment so the next
  // snapshot run evaluates the updated set. Signal metrics are intentionally
  // stored alongside guardrail metrics here — see ensureSafeRolloutForMonitoredRamp
  // for the reasoning.
  if (updated.safeRolloutId) {
    const sr = await ctx.models.safeRollout.getById(updated.safeRolloutId);
    if (sr) {
      const allMetricIds = [
        ...newConfig.guardrailMetricIds,
        ...(newConfig.signalMetricIds ?? []),
      ];
      await ctx.models.safeRollout.update(sr, {
        guardrailMetricIds: allMetricIds,
      });
    }
  } else {
    // Lazily attach a SafeRollout if none exists and conditions are now met.
    await ensureSafeRolloutForMonitoredRamp(ctx, updated);
  }

  await syncLinkedSafeRolloutForRampState(ctx, updated);
  return updated;
}

export async function updateRampLockdownConfig(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  lockdownConfig: LockdownConfig,
): Promise<RampScheduleInterface> {
  return ctx.models.rampSchedules.updateById(schedule.id, {
    lockdownConfig,
    eventHistory: appendRampEvent(schedule, "config-edited", {
      stepIndex: schedule.currentStepIndex,
      status: schedule.status,
      reason: `Lockdown mode set to '${lockdownConfig.mode}' via API`,
    }),
  });
}

export type StepMergeResult = {
  /** Future steps — all fields replaced from incoming. */
  appliedIndices: number[];
  /** Current step — only `holdConditions` and `approvalNotes` were applied; `interval`, `monitored`, and `actions` are preserved from the existing step. */
  partialIndices: number[];
  /** Past steps (index < currentStepIndex) — incoming changes were ignored entirely. */
  skippedIndices: number[];
};

// Merges an incoming steps array onto a running schedule with per-position guards:
// - past steps  : frozen — incoming changes are dropped
// - current step: only `holdConditions` and `approvalNotes` may change
// - future steps: full replacement from incoming (preserving existing `actions`
// when the caller omits them, to avoid wiping coverage patches)
export function mergeStepsForRunningSchedule(
  schedule: RampScheduleInterface,
  incomingSteps: RampScheduleInterface["steps"],
): { steps: RampScheduleInterface["steps"]; result: StepMergeResult } {
  const currentIdx = schedule.currentStepIndex;

  // The incoming array is a full replacement for the future portion of the
  // schedule. Past steps are immutable and must remain addressable, so the
  // caller must include at least currentIdx+1 steps (positions 0..currentIdx).
  const minRequired = Math.max(0, currentIdx + 1);
  if (incomingSteps.length < minRequired) {
    throw new Error(
      `Steps array must contain at least ${minRequired} step(s) — schedule is at step index ${currentIdx} and past/current steps cannot be truncated.`,
    );
  }

  const appliedIndices: number[] = [];
  const partialIndices: number[] = [];
  const skippedIndices: number[] = [];

  // Past steps: always taken from the existing schedule; caller-provided values
  // at these positions are silently discarded and reported in skippedIndices.
  for (let i = 0; i < currentIdx; i++) {
    if (incomingSteps[i]) skippedIndices.push(i);
  }
  // Math.max guards currentIdx === -1 (schedule "running" but not yet advanced
  // past the pre-first-step state): slice(0, -1) would return all-but-last
  // instead of an empty array, interleaving stale step definitions into the
  // merged result and corrupting future coverage patches.
  const pastSteps = schedule.steps.slice(0, Math.max(0, currentIdx));

  // Current step: only holdConditions and approvalNotes are editable.
  let currentStep = schedule.steps[currentIdx];
  const incomingCurrent = incomingSteps[currentIdx];
  if (currentStep && incomingCurrent) {
    partialIndices.push(currentIdx);
    currentStep = {
      ...currentStep,
      holdConditions: incomingCurrent.holdConditions,
      approvalNotes: incomingCurrent.approvalNotes,
    };
  }

  // Future steps: full replacement from incoming (including appending new steps).
  const futureSteps = incomingSteps.slice(currentIdx + 1).map((step, rel) => {
    appliedIndices.push(currentIdx + 1 + rel);
    return step;
  });

  const merged: RampScheduleInterface["steps"] = currentStep
    ? [...pastSteps, currentStep, ...futureSteps]
    : [...pastSteps, ...futureSteps];

  return {
    steps: merged,
    result: { appliedIndices, partialIndices, skippedIndices },
  };
}

export async function updateRampSteps(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  incomingSteps: RampScheduleInterface["steps"],
): Promise<{ schedule: RampScheduleInterface }> {
  if (schedule.status === "running") {
    throw new Error(
      `Cannot edit steps on a running schedule. Pause the schedule first.`,
    );
  }
  if (["completed", "rolled-back"].includes(schedule.status)) {
    throw new Error(
      `Cannot edit steps on a terminal schedule (status: "${schedule.status}"). Restart the schedule first.`,
    );
  }
  const finalSteps = incomingSteps;

  // Q9: clamp currentStepIndex when editing a paused schedule whose step
  // count shrank below the current index.
  const clamp =
    schedule.status === "paused" &&
    schedule.currentStepIndex >= finalSteps.length
      ? {
          currentStepIndex: Math.max(finalSteps.length - 1, -1),
          nextStepAt: null,
        }
      : {};

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    steps: finalSteps,
    ...clamp,
    eventHistory: appendRampEvent(schedule, "config-edited", {
      stepIndex: schedule.currentStepIndex,
      status: schedule.status,
      reason: "Steps updated via API",
    }),
  });

  // Re-sync SafeRollout status/autoSnapshots in case monitored-step membership
  // changed, and lazily attach a SafeRollout if conditions are now met.
  const ensured = await ensureSafeRolloutForMonitoredRamp(ctx, updated);
  await syncLinkedSafeRolloutForRampState(ctx, ensured);

  return { schedule: ensured };
}

// Live ramp control — start/pause/resume/advance/rewind/complete/restart and
// target attach/eject — changes what users are served right now, so it takes
// publish authority over the environments the schedule reaches. Shared by the
// internal controller and the REST handlers so the two can't drift.
export async function assertCanControlRampSchedule(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  const scheduleEnvs =
    context.models.rampSchedules.publishEnvironments(schedule);
  // The strictest answer available: every environment the org has.
  const orgEnvironmentIds = getEnvironmentIdsFromOrg(context.org);
  // A multi-target schedule mutates every attached flag, so control takes
  // publish over each target's project against that target's OWN environments —
  // a union across targets would demand authority the schedule never acts on.
  // Keyed by feature so two targets on different rules of the same feature
  // union their environments instead of the later replacing the earlier.
  const checks = new Map<string, Set<string>>();
  // Every rule id this schedule could touch for a target: the target's own AND
  // every `patch.ruleId` its actions name — the executor resolves rules from the
  // patch, not `target.ruleId`, so a dev-only target can carry a production patch.
  const ruleIdsForTarget = (target: { id: string; ruleId?: string | null }) =>
    rampTargetRuleIds(schedule, target);

  // Footprint is what each rule CURRENTLY serves, not what the patch names: a
  // patch's `environments` REPLACES the field, so narrowing production → dev is
  // still a production change the patch alone never mentions.
  const ruleEnvs = await getFeatureRuleEnvironmentsByIds(
    context,
    (schedule.targets ?? []).flatMap((t) =>
      ruleIdsForTarget(t).map((ruleId) => ({
        featureId: t.entityId,
        ruleId,
        // Same env scoping as `resolveRampTargets`, so the gate resolves the
        // sibling set the write will patch.
        environment: t.environment ?? undefined,
      })),
    ),
  );
  for (const target of schedule.targets ?? []) {
    // Union across every rule this target can reach: if ANY of them serves
    // production, the footprint says production.
    const reachable = ruleIdsForTarget(target).map((ruleId) =>
      ruleEnvs.get(
        rampRuleEnvKey(
          target.entityId,
          ruleId,
          target.environment ?? undefined,
        ),
      ),
    );
    const currentRuleEnvs: string[] | "all" = reachable.some((r) => r === "all")
      ? "all"
      : reachable.flatMap((r) => (Array.isArray(r) ? r : []));
    // The same shared per-target footprint call the Publish control makes, so
    // the two gates can't drift.
    const envs = rampTargetFootprint({
      schedule,
      target,
      currentRuleEnvs,
      allEnvironments: orgEnvironmentIds,
    });
    const existing = checks.get(target.entityId) ?? new Set<string>();
    // "all" has already been resolved against the organization's environments.
    for (const env of envs) existing.add(env);
    checks.set(target.entityId, existing);
  }
  // The anchor feature is always checked, against the schedule-wide footprint
  // when it isn't itself a target.
  if (!checks.has(schedule.entityId)) {
    // As in the per-target arm, an unscoped "all" resolves to every org
    // environment, never the patch list.
    const anchorEnvs =
      getEnvsFromRampSchedule(schedule) === "all"
        ? orgEnvironmentIds
        : scheduleEnvs;
    checks.set(schedule.entityId, new Set(anchorEnvs));
  }

  // Raw projects, not a read-filtered fetch: `getFeature` returns null for a
  // feature the CALLER cannot read, and an unreadable target is precisely the
  // one that must still be checked. A target that is truly gone contributes no
  // project and is checked against the global scope — the strictest answer.
  const projectsById = await getFeatureProjectsByIds(context, [
    ...checks.keys(),
  ]);
  for (const [featureId, envSet] of checks) {
    const environments = Array.from(envSet);
    if (
      !context.permissions.canPublishFeature(
        { project: projectsById.get(featureId) },
        environments,
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }
}

// Config-edit gate for PUT-style updates of a not-yet-running schedule, shared
// by the dashboard PUT /ramp-schedule/:id and the REST PUT /ramp-schedules/:id.
// Fields the poller executes — fire times and the actions/steps it will apply —
// are publish-class to touch on an ARMABLE schedule, for the same reason the
// arm itself is: editing them re-aims a live transition the /actions endpoints
// would refuse this caller. Name and monitoring edits stay draft-class.
//
// Armable is `computeNextProcessAt` answering non-null — the same function the
// poller keys off. Checked BOTH before (`existing.nextProcessAt`) and after
// (`updates.nextProcessAt`, which the caller has already recomputed): a
// dateless or approval-gated schedule fires nothing, so editing its steps is
// draft-class; but disarming a schedule that IS armed re-aims a live transition
// just as arming one does. Both the PRE-edit and POST-edit aim are asserted:
// checking `existing` alone would let a dateless schedule with dev-only steps
// be armed in ONE put that also swapped in production steps — the incoming
// steps are what will fire, so they answer too.
export const RAMP_EXECUTION_FIELDS = [
  "startDate",
  "cutoffDate",
  "startActions",
  "steps",
  "endActions",
] as const;
export async function assertCanEditRampScheduleConfig(
  context: ReqContext | ApiReqContext,
  existing: RampScheduleInterface,
  updates: Record<string, unknown>,
): Promise<void> {
  const touchesExecution = RAMP_EXECUTION_FIELDS.some((k) => k in updates);
  if (!touchesExecution) return;
  if (!existing.nextProcessAt && !updates.nextProcessAt) return;
  await assertCanControlRampSchedule(context, existing);
  await assertCanControlRampSchedule(context, {
    ...existing,
    ...updates,
  } as RampScheduleInterface);
}
