import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import {
  FeatureRulePatch,
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

// Applies actions for one entity: computes a fresh patch against live state and publishes immediately.
interface EntityHandler {
  applyActions(
    ctx: ReqContext | ApiReqContext,
    entityId: string,
    actions: RampStepAction[],
    opts: { stepLabel: string; user: EventUser },
  ): Promise<void>;
}

// Accumulates patches from startCondition through stepIndex for each targetId.
// Steps are sparse — fields absent from a step are inherited from prior steps.
// startCondition is the fully-qualified baseline; every controlled field should appear there.
// stepIndex=-1 → startCondition only; stepIndex >= steps.length → also include endCondition.
export function computeEffectivePatch(
  schedule: Pick<
    RampScheduleInterface,
    "startCondition" | "steps" | "endCondition"
  >,
  stepIndex: number,
): Map<string, FeatureRulePatch> {
  const byTarget = new Map<string, FeatureRulePatch>();

  const merge = (act: RampStepAction) => {
    if (act.targetType !== "feature-rule") return;
    const { ruleId, ...fields } = act.patch;
    const existing = byTarget.get(act.targetId);
    if (existing) {
      // Only assign keys explicitly present in this action's patch (absent = inherit).
      for (const [k, v] of Object.entries(fields)) {
        (existing as Record<string, unknown>)[k] = v;
      }
    } else {
      byTarget.set(act.targetId, { ruleId, ...fields } as FeatureRulePatch);
    }
  };

  for (const a of schedule.startCondition?.actions ?? []) merge(a);

  const lastStepIdx = Math.min(stepIndex, schedule.steps.length - 1);
  for (let i = 0; i <= lastStepIdx; i++) {
    for (const a of schedule.steps[i]?.actions ?? []) merge(a);
  }

  if (stepIndex >= schedule.steps.length) {
    for (const a of schedule.endCondition?.actions ?? []) merge(a);
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
  if ("force" in patch) {
    (updated as { value?: unknown }).value = patch.force; // null is a valid JSON value
  }
  if ("enabled" in patch) {
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

// nextStepAt = phaseStartedAt + cumulative interval seconds up to stepIndex.
// Approval steps return now (gate is human); phaseStartedAt resets after approval gates.
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

// Computes when the job should next poll this schedule. null = no polling needed.
export function computeNextProcessAt(schedule: {
  status: RampScheduleInterface["status"];
  nextStepAt?: Date | null;
  endCondition?: RampScheduleInterface["endCondition"];
  startCondition?: RampScheduleInterface["startCondition"];
}): Date | null {
  const endAt =
    schedule.endCondition?.trigger?.type === "scheduled"
      ? schedule.endCondition.trigger.at
      : null;

  switch (schedule.status) {
    case "running": {
      const stepAt = schedule.nextStepAt ?? null;
      if (stepAt) return endAt && endAt < stepAt ? endAt : stepAt;
      return endAt;
    }
    case "pending-approval":
      return endAt;
    case "ready":
      return schedule.startCondition?.trigger.type === "scheduled"
        ? schedule.startCondition.trigger.at
        : null;
    default:
      return null;
  }
}

// After approval, rebase phaseStartedAt so the next interval fires at approval + its seconds.
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

// Group actions by entity and publish one revision per entity. Partial failure is not rolled back.
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
      nextProcessAt: null,
    });
  }

  const now = new Date();
  const isApprovalStep = step.trigger.type === "approval";

  // Apply the accumulated effective state for this step (sparse patches accumulate from start).
  // Approval steps go live right away; the user's approval is the signal to advance.
  const effective = computeEffectivePatch(schedule, nextStepIndex);
  const effectiveActions: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({ targetType: "feature-rule", targetId, patch }),
  );
  await executeStepActions(ctx, schedule, nextStepIndex, effectiveActions);

  const nextStepAt = isApprovalStep
    ? null
    : (computeNextStepAt(schedule, nextStepIndex, now) ?? now);

  const newStatus = isApprovalStep
    ? ("pending-approval" as const)
    : ("running" as const);
  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: nextStepIndex,
    nextStepAt,
    nextProcessAt: computeNextProcessAt({
      status: newStatus,
      nextStepAt,
      endCondition: schedule.endCondition,
    }),
  });

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
): Promise<RampScheduleInterface> {
  // Apply the fully accumulated effective state at the target step so the rule matches
  // what it would look like if the ramp had run sequentially to that point.
  const effective = computeEffectivePatch(schedule, targetStepIndex);
  const rollbackActions: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({ targetType: "feature-rule", targetId, patch }),
  );

  const now = new Date();
  if (rollbackActions.length > 0) {
    await executeStepActions(ctx, schedule, targetStepIndex, rollbackActions);
  }

  // Partial rollbacks pause; full rollback to -1 uses "rolled-back" as terminal signal.
  const newStatus = targetStepIndex === -1 ? "rolled-back" : "paused";

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: targetStepIndex,
    nextStepAt: null,
    pausedAt: newStatus === "paused" ? now : null,
    nextProcessAt: null,
  });

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

  return updated;
}

// Jump to jumpTarget (forward or backward), applying the accumulated effective state.
export async function jumpAheadToStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  jumpTarget: number,
): Promise<RampScheduleInterface> {
  const effective = computeEffectivePatch(schedule, jumpTarget);
  const jumpActions: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({ targetType: "feature-rule", targetId, patch }),
  );
  const now = new Date();

  if (jumpActions.length > 0) {
    await executeStepActions(ctx, schedule, jumpTarget, jumpActions);
  }

  return ctx.models.rampSchedules.updateById(schedule.id, {
    status: "paused",
    currentStepIndex: jumpTarget,
    nextStepAt: null,
    pausedAt: now,
    nextProcessAt: null,
  });
}

// Fast-forwards to the terminal state, bypassing timing and approval gates.
// Applies the fully-accumulated effective patch (startCondition + all steps + endCondition)
// so any skipped intermediate steps are included. Used by REST "complete" and endCondition deadlines.
export async function completeRollout(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<RampScheduleInterface> {
  const effective = computeEffectivePatch(schedule, schedule.steps.length);
  const actionsToApply: RampStepAction[] = [...effective.entries()].map(
    ([targetId, patch]) => ({ targetType: "feature-rule", targetId, patch }),
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
    nextProcessAt: null,
  });

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
      nextProcessAt: computeNextProcessAt({
        status: "running",
        nextStepAt: initialNextStepAt,
        endCondition: schedule.endCondition,
      }),
    });

    await applyStartConditionActions(ctx, current);

    if (current.steps.length > 0) {
      await advanceUntilBlocked(ctx, current, now);
      current = (await ctx.models.rampSchedules.getById(current.id)) ?? current;
    }

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
      environments = [
        ...new Set(schedule.targets.flatMap((t) => t.environment ?? [])),
      ];
      const feature = await getFeature(ctx, schedule.entityId);
      if (feature) {
        projects = feature.project ? [feature.project] : [];
        tags = feature.tags ?? [];
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

// Advance through all steps that are currently due. Stops when:
// - schedule leaves "running" (approval gate, completion, error)
// - next step not yet due or no more steps remain
// - safety cap of schedule.steps.length iterations
export async function advanceUntilBlocked(
  ctx: ReqContext | ApiReqContext,
  initial: RampScheduleInterface,
  now: Date,
): Promise<void> {
  let current = initial;
  const maxSteps = current.steps.length;

  for (let i = 0; i < maxSteps; i++) {
    if (
      current.endCondition?.trigger?.type === "scheduled" &&
      current.endCondition.trigger.at <= now &&
      ["running", "paused", "pending-approval"].includes(current.status)
    ) {
      await completeRollout(ctx, current);
      return;
    }

    if (current.status !== "running") return;
    if (!current.nextStepAt || current.nextStepAt > now) return;

    current = await advanceStep(ctx, current);
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

  const approveStatus = isCompleting
    ? ("completed" as const)
    : ("running" as const);
  await ctx.models.rampSchedules.updateById(schedule.id, {
    status: approveStatus,
    nextStepAt,
    ...(wasApprovalGate ? { phaseStartedAt: newPhaseStart } : {}),
    nextProcessAt: computeNextProcessAt({
      status: approveStatus,
      nextStepAt,
      endCondition: schedule.endCondition,
    }),
  });

  return null;
}
