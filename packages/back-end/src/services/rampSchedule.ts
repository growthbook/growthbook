import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import {
  FeatureRulePatch,
  RampAttribution,
  RampScheduleInterface,
  RampStepAction,
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
// type: userId → "manual"; source "system" → "system"; otherwise → "schedule".
export function makeAttribution(
  userId?: string,
  reason?: string,
  source?: string,
): RampAttribution {
  const type = userId ? "manual" : source === "system" ? "system" : "schedule";
  return {
    type,
    ...(userId !== undefined && { userId }),
    ...(reason !== undefined && { reason }),
    ...(source !== undefined && { source }),
  };
}

// Applies actions for one entity: computes a fresh patch against live state and publishes immediately.
interface EntityHandler {
  applyActions(
    ctx: ReqContext | ApiReqContext,
    entityId: string,
    actions: RampStepAction[],
    opts: { stepLabel: string; user: EventUser },
  ): Promise<void>;
}

// Apply a sparse FeatureRulePatch onto an existing rule — only present fields are overwritten.
export function applyPatchToRule(
  existing: FeatureRule,
  patch: Omit<FeatureRulePatch, "ruleId">,
): FeatureRule {
  const updated = { ...existing };
  if (patch.coverage != null) {
    (updated as { coverage?: number }).coverage = patch.coverage;
  }
  if (patch.condition != null) updated.condition = patch.condition;
  if (patch.savedGroups != null) updated.savedGroups = patch.savedGroups;
  if (patch.prerequisites != null) updated.prerequisites = patch.prerequisites;
  if ("force" in patch && patch.force !== undefined) {
    (updated as { value?: unknown }).value = patch.force;
  }
  if ("enabled" in patch && patch.enabled !== undefined) {
    updated.enabled = patch.enabled ?? undefined;
  }
  return updated;
}

export const featureEntityHandler: EntityHandler = {
  async applyActions(ctx, entityId, actions, opts) {
    const { stepLabel, user } = opts;

    const feature = await getFeature(ctx, entityId);
    if (!feature) throw new Error(`Feature not found: ${entityId}`);

    const patchedRules: Record<string, FeatureRule[]> = {};
    for (const [env, envSettings] of Object.entries(
      feature.environmentSettings ?? {},
    )) {
      patchedRules[env] = [...(envSettings.rules ?? [])];
    }

    for (const action of actions) {
      if (action.targetType !== "feature-rule") continue;
      const { patch } = action;
      const { ruleId, ...patchFields } = patch;
      let foundInAnyEnv = false;

      for (const env of Object.keys(patchedRules)) {
        const ruleIdx = patchedRules[env].findIndex((r) => r.id === ruleId);
        if (ruleIdx === -1) continue;
        foundInAnyEnv = true;
        patchedRules[env][ruleIdx] = applyPatchToRule(
          patchedRules[env][ruleIdx],
          patchFields,
        );
      }

      if (!foundInAnyEnv) {
        throw new Error(
          `Ramp target rule "${ruleId}" not found in any environment — it may have been deleted`,
        );
      }
    }

    const revision = await createRevision({
      context: ctx,
      feature: feature as FeatureInterface,
      user,
      environments: ctx.environments,
      changes: { rules: patchedRules },
      publish: false,
      comment: stepLabel,
      title: stepLabel,
      org: ctx.org,
    });

    const forceResult: MergeResultChanges = { rules: patchedRules };
    await publishRevision(
      ctx,
      feature as FeatureInterface,
      revision,
      forceResult,
      stepLabel,
    );
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

// Compute nextStepAt after step `stepIndex` applies its effects (apply-first).
// nextStepAt = phaseStartedAt + cumulative sum of interval seconds[0..stepIndex].
// Approval steps return `now` (gate is human, not time-based).
// After an approval gate, phaseStartedAt is reset via computePhaseStartAfterApproval
// so subsequent interval steps fire relative to approval time.
export function computeNextStepAt(
  schedule: RampScheduleInterface,
  stepIndex: number,
  now: Date,
): Date | null {
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

// Compute phaseStartedAt after an approval gate so that the next interval step
// fires exactly steps[nextStepIndex].seconds after the approval time.
// phaseStart = now - sum(interval seconds of steps[0..nextStepIndex-1])
export function computePhaseStartAfterApproval(
  now: Date,
  schedule: RampScheduleInterface,
  nextStepIndex: number,
): Date {
  let total = 0;
  for (let i = 0; i < nextStepIndex; i++) {
    const t = schedule.steps[i]?.trigger;
    if (t?.type === "interval") total += t.seconds;
  }
  return new Date(now.getTime() - total * 1000);
}

// Merge actions from startCondition + steps[0..targetStepIndex] into a single
// absolute state. Each step is a complete state spec (not a delta), so last-write-wins.
// targetStepIndex === -1 → startCondition only.
function buildCumulativeActions(
  schedule: RampScheduleInterface,
  targetStepIndex: number,
): RampStepAction[] {
  const merged = new Map<string, FeatureRulePatch>();

  const absorb = (actions: RampStepAction[]) => {
    for (const action of actions) {
      const prev = merged.get(action.targetId) ?? {
        ruleId: action.patch.ruleId,
      };
      merged.set(action.targetId, { ...prev, ...action.patch });
    }
  };

  absorb(schedule.startCondition?.actions ?? []);
  for (let i = 0; i <= targetStepIndex; i++) {
    absorb(schedule.steps[i]?.actions ?? []);
  }

  return Array.from(merged.entries()).map(([targetId, patch]) => ({
    targetType: "feature-rule" as const,
    targetId,
    patch,
  }));
}

// Group actions by entity and publish one revision per entity.
// Multi-entity note: each entity publishes independently; partial failure leaves
// earlier entities already published with no rollback path.
async function executeStepActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  stepIndex: number,
  actions: RampStepAction[],
): Promise<void> {
  const byEntity = new Map<
    string,
    { entityType: string; entityId: string; actions: RampStepAction[] }
  >();

  for (const action of actions) {
    const target = schedule.targets.find((t) => t.id === action.targetId);
    if (!target || target.status !== "active") continue;

    const key = `${target.entityType}:${target.entityId}`;
    if (!byEntity.has(key)) {
      byEntity.set(key, {
        entityType: target.entityType,
        entityId: target.entityId,
        actions: [],
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
      ? `Ramp complete: ${schedule.name}`
      : `Ramp [${stepIndex + 1} of ${schedule.steps.length}]: ${schedule.name}`;

  for (const [, group] of byEntity) {
    const handler = getEntityHandler(group.entityType);
    try {
      await handler.applyActions(ctx, group.entityId, group.actions, {
        stepLabel,
        user,
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

export async function applyStartConditionActions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  const actions = schedule.startCondition?.actions ?? [];
  if (!actions.length) return;
  await executeStepActions(ctx, schedule, -1, actions);
}

export async function advanceStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  attribution: RampAttribution = { type: "schedule" },
): Promise<RampScheduleInterface> {
  const nextStepIndex = schedule.currentStepIndex + 1;
  const step = schedule.steps[nextStepIndex];

  if (!step) {
    // No more steps — apply endCondition and complete.
    const endActions = schedule.endCondition?.actions ?? [];
    if (endActions.length) {
      await executeStepActions(
        ctx,
        schedule,
        schedule.steps.length,
        endActions,
      );
    }
    return ctx.models.rampSchedules.updateById(schedule.id, {
      status: "completed",
      nextStepAt: null,
    });
  }

  const now = new Date();
  const isApprovalStep = step.trigger.type === "approval";

  // Apply-first: all step types apply immediately on enter.
  // Approval steps go live right away; the user's approval is the signal to advance.
  await executeStepActions(
    ctx,
    schedule,
    nextStepIndex,
    buildCumulativeActions(schedule, nextStepIndex),
  );

  const nextStepAt = isApprovalStep
    ? null
    : (computeNextStepAt(schedule, nextStepIndex, now) ?? now);

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: isApprovalStep ? "pending-approval" : "running",
    currentStepIndex: nextStepIndex,
    nextStepAt,
  });

  await dispatchRampEvent(ctx, updated, "step.advanced", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      userId: attribution.userId ?? undefined,
      reason: attribution.reason ?? undefined,
      source: attribution.source ?? undefined,
    },
  });

  if (isApprovalStep) {
    await dispatchRampEvent(ctx, updated, "step.approvalRequired", {
      object: {
        rampScheduleId: updated.id,
        rampName: updated.name,
        orgId: ctx.org.id,
        currentStepIndex: updated.currentStepIndex,
        status: updated.status,
      },
    });
  }

  return updated;
}

export async function rollbackToStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  targetStepIndex: number,
  attribution: RampAttribution = { type: "manual" },
): Promise<RampScheduleInterface> {
  const rollbackActions = buildCumulativeActions(schedule, targetStepIndex);
  if (rollbackActions.length === 0) return schedule;

  const now = new Date();
  await executeStepActions(ctx, schedule, targetStepIndex, rollbackActions);

  // Partial rollbacks pause; full rollback to -1 uses "rolled-back" as terminal signal.
  const newStatus = targetStepIndex === -1 ? "rolled-back" : "paused";

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: targetStepIndex,
    nextStepAt: null,
    pausedAt: newStatus === "paused" ? now : null,
  });

  await dispatchRampEvent(ctx, updated, "rolledBack", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      targetStepIndex,
      userId: attribution.userId ?? undefined,
      reason: attribution.reason ?? undefined,
      source: attribution.source ?? undefined,
    },
  });

  return updated;
}

// Jump to jumpTarget in one revision: { ...start, ...s0, ..., ...sN }.
// Identical merge logic to rollback — cumulative state at the target index.
export async function jumpAheadToStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  jumpTarget: number,
): Promise<RampScheduleInterface> {
  const jumpActions = buildCumulativeActions(schedule, jumpTarget);
  const now = new Date();

  if (jumpActions.length > 0) {
    await executeStepActions(ctx, schedule, jumpTarget, jumpActions);
  }

  return ctx.models.rampSchedules.updateById(schedule.id, {
    status: "paused",
    currentStepIndex: jumpTarget,
    nextStepAt: null,
    pausedAt: now,
  });
}

// Merge remaining steps + endCondition into one revision, then mark complete.
// Bypasses timing and approval gates. Used by the REST "complete" action and the
// endCondition deadline handler.
export async function completeRollout(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  attribution: RampAttribution = { type: "manual" },
): Promise<RampScheduleInterface> {
  const endConditionActions = schedule.endCondition?.actions ?? [];

  const mergedPatches = new Map<string, FeatureRulePatch>();
  for (let i = schedule.currentStepIndex + 1; i < schedule.steps.length; i++) {
    for (const action of schedule.steps[i].actions) {
      const prev = mergedPatches.get(action.targetId) ?? {
        ruleId: action.patch.ruleId,
      };
      mergedPatches.set(action.targetId, { ...prev, ...action.patch });
    }
  }
  for (const action of endConditionActions) {
    const prev = mergedPatches.get(action.targetId) ?? {
      ruleId: action.patch.ruleId,
    };
    mergedPatches.set(action.targetId, { ...prev, ...action.patch });
  }

  if (mergedPatches.size > 0) {
    const mergedActions = Array.from(mergedPatches.entries()).map(
      ([targetId, patch]) => ({
        targetType: "feature-rule" as const,
        targetId,
        patch,
      }),
    );
    await executeStepActions(
      ctx,
      schedule,
      schedule.steps.length,
      mergedActions,
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
  });

  await dispatchRampEvent(ctx, updated, "completed", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
      userId: attribution.userId ?? undefined,
      reason: attribution.reason ?? undefined,
      source: attribution.source ?? undefined,
    },
  });

  return updated;
}

export type CriteriaResult = "pass" | "fail" | "inconclusive";

// STUB — not yet wired to a caller. Will connect once DecisionCriteria entity exists.
// See evaluateAutoRollback JSDoc history for wiring plan.
export async function evaluateAutoRollback(
  ctx: ReqContext | ApiReqContext,
  criteriaIds: string[],
  result: CriteriaResult,
): Promise<void> {
  if (result !== "fail") return;

  const activeSchedules = await ctx.models.rampSchedules.getActiveSchedules();
  const affected = activeSchedules.filter(
    (s) =>
      s.autoRollback?.enabled &&
      s.autoRollback.criteriaId &&
      criteriaIds.includes(s.autoRollback.criteriaId),
  );

  for (const schedule of affected) {
    try {
      await rollbackToStep(ctx, schedule, -1, {
        type: "system",
        reason: "Auto-rollback: criteria evaluation failed",
        source: "system",
      });

      await dispatchRampEvent(ctx, schedule, "autoRollback", {
        object: {
          rampScheduleId: schedule.id,
          rampName: schedule.name,
          orgId: ctx.org.id,
          currentStepIndex: schedule.currentStepIndex,
          status: "rolled-back",
          criteriaId: schedule.autoRollback!.criteriaId,
        },
      });
    } catch (e) {
      logger.error(e, `Error auto-rolling back ramp schedule ${schedule.id}`);
    }
  }
}

// Transitions a ramp from "pending" once its activating revision is published.
// "immediately" → auto-start; "manual"/"scheduled" → "ready".
export async function onActivatingRevisionPublished(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  if (schedule.status !== "pending") return;

  const trigger = schedule.startCondition?.trigger ?? {
    type: "immediately" as const,
  };

  if (trigger.type === "immediately") {
    const now = new Date();
    const initialNextStepAt = schedule.steps.length > 0 ? now : null;

    let current = await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "running",
      startedAt: now,
      phaseStartedAt: now,
      nextStepAt: initialNextStepAt,
    });

    const startAttribution = makeAttribution(
      undefined,
      "auto-started on activating revision publish",
      "system",
    );

    await applyStartConditionActions(ctx, current);

    if (current.steps.length > 0) {
      await advanceUntilBlocked(ctx, current, now, startAttribution);
      current = (await ctx.models.rampSchedules.getById(current.id)) ?? current;
    }

    await dispatchRampEvent(ctx, current, "started", {
      object: {
        rampScheduleId: current.id,
        rampName: current.name,
        orgId: ctx.org.id,
        currentStepIndex: current.currentStepIndex,
        status: current.status,
      },
    });
  } else {
    await ctx.models.rampSchedules.updateById(schedule.id, { status: "ready" });
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

export async function dispatchRampEvent<
  T extends ResourceEvents<"rampSchedule">,
>(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface | { id: string },
  event: T,
  data: CreateEventData<"rampSchedule", T>,
): Promise<void> {
  try {
    await createEvent({
      context: ctx,
      object: "rampSchedule",
      objectId: schedule.id,
      event,
      data,
      projects: [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, `Error dispatching ramp schedule event ${event}`);
  }
}

export function initRampScheduleHooks(): void {
  registerRevisionPublishedHook(onRevisionPublished);
}

// Advance through all steps that are currently due. Stops when:
// - schedule leaves "running" (approval gate, completion, error)
// - next step not yet due or no more steps remain
// - safety cap of schedule.steps.length iterations
export async function advanceUntilBlocked(
  ctx: ReqContext | ApiReqContext,
  initial: RampScheduleInterface,
  now: Date,
  attribution: RampAttribution,
): Promise<void> {
  let current = initial;
  const maxSteps = current.steps.length;

  for (let i = 0; i < maxSteps; i++) {
    if (
      current.endCondition?.trigger?.type === "scheduled" &&
      current.endCondition.trigger.at <= now &&
      ["running", "paused", "pending-approval"].includes(current.status)
    ) {
      await completeRollout(
        ctx,
        current,
        makeAttribution(undefined, "endCondition deadline reached", "system"),
      );
      return;
    }

    if (current.status !== "running") return;
    if (!current.nextStepAt || current.nextStepAt > now) return;

    current = await advanceStep(ctx, current, attribution);
  }
}

export type ApproveStepError =
  | { code: "feature_not_found" }
  | { code: "permission_denied"; detail: string }
  | { code: "error"; detail: string };

// Actions were already applied when the step was entered (apply-first in advanceStep).
// This just runs permission checks and advances the schedule.
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

  const hasFutureEndDate =
    !nextStepAt &&
    schedule.endCondition?.trigger?.type === "scheduled" &&
    schedule.endCondition.trigger.at > now;
  const holdForEndDate =
    hasFutureEndDate && schedule.endEarlyWhenStepsComplete === false;
  const isCompleting = !nextStepAt && !holdForEndDate;

  if (isCompleting) {
    const endActions = schedule.endCondition?.actions ?? [];
    if (endActions.length) {
      await executeStepActions(
        ctx,
        schedule,
        schedule.steps.length,
        endActions,
      );
    }
  }

  await ctx.models.rampSchedules.updateById(schedule.id, {
    status: isCompleting ? "completed" : "running",
    nextStepAt,
    ...(wasApprovalGate ? { phaseStartedAt: newPhaseStart } : {}),
  });

  await dispatchRampEvent(ctx, schedule, "step.approved", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: ctx.org.id,
      currentStepIndex: stepIndex,
      status: isCompleting ? "completed" : "running",
    },
  });

  return null;
}
