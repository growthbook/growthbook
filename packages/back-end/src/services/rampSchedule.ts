/**
 * rampSchedule.ts — Core service for the RampSchedule entity.
 *
 * Responsibilities:
 *   - advanceStep / rollbackToStep / completeRollout
 *   - computeNextStepAt (respects cumulative flag)
 *   - evaluateAutoRollback (called by SafeRollout snapshot completion and experiment analysis)
 *   - onRevisionPublished / onRevisionDiscarded (registered as hooks on FeatureRevisionModel)
 *   - initRampScheduleHooks (registers the hooks at startup)
 */

import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import {
  FeatureRulePatch,
  RampAttribution,
  RampScheduleInterface,
  RampStepAction,
  StepHistoryEntry,
} from "shared/validators";
import { ResourceEvents } from "shared/types/events/base-types";
import {
  autoMerge,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
} from "shared/util";
import {
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import {
  createRevision,
  discardRevision,
  getRevision,
  markRevisionAsPublished,
  markRevisionAsPendingParent,
  markRevisionAsReviewRequested,
  registerRevisionDiscardedHook,
  registerRevisionPublishedHook,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";
import { IS_CLOUD } from "back-end/src/util/secrets";

// ---------------------------------------------------------------------------
// Org-level polling interval helper
// ---------------------------------------------------------------------------

/** Minimum allowed interval step duration in minutes for this org. Cloud is always
 * 10 minutes. Self-hosted orgs may lower it to 1 minute via org settings. */
export function getRampSchedulePollIntervalMinutes(
  ctx: ReqContext | ApiReqContext,
): number {
  if (IS_CLOUD) return 10;
  const setting = ctx.org.settings?.rampSchedulePollIntervalMinutes;
  if (typeof setting === "number") {
    return Math.min(10, Math.max(1, Math.round(setting)));
  }
  return 10;
}

// ---------------------------------------------------------------------------
// Attribution helper
// ---------------------------------------------------------------------------

// Builds a RampAttribution from the caller-supplied identifiers.
// type rules: explicit userId → "manual"; source "system" → "system"; otherwise → "schedule".
export function makeAttribution(
  userId?: string,
  reason?: string,
  source?: string,
): RampAttribution {
  const type = userId ? "manual" : source === "system" ? "system" : "schedule";
  // Omit undefined fields so MongoDB doesn't store them as null.
  return {
    type,
    ...(userId !== undefined && { userId }),
    ...(reason !== undefined && { reason }),
    ...(source !== undefined && { source }),
  };
}

// ---------------------------------------------------------------------------
// EntityHandler interface
// ---------------------------------------------------------------------------

interface BuildRevisionResult {
  /** Sparse changes to pass to createRevision */
  changes: Partial<FeatureRevisionInterface>;
  /** Sparse previous values (same shape as the patch) for rollback storage */
  previousValues: { targetId: string; patch: FeatureRulePatch }[];
}

interface EntityHandler {
  /**
   * Build revision changes from the step actions targeting a single entity.
   * Returns both the revision changes and the previousValues snapshot for stepHistory.
   */
  buildRevisionChanges(
    ctx: ReqContext | ApiReqContext,
    entityId: string,
    actions: RampStepAction[],
  ): Promise<BuildRevisionResult>;
}

// ---------------------------------------------------------------------------
// Feature EntityHandler
// ---------------------------------------------------------------------------

/**
 * Apply a sparse FeatureRulePatch to an existing rule, returning the merged rule.
 * Only fields present in the patch are overwritten.
 */
function applyPatchToRule(
  existing: FeatureRule,
  patch: Omit<FeatureRulePatch, "ruleId">,
): FeatureRule {
  const updated = { ...existing };
  if (patch.coverage != null) {
    (updated as { coverage?: number }).coverage = patch.coverage;
  }
  if (patch.condition != null) {
    updated.condition = patch.condition;
  }
  if (patch.savedGroups != null) {
    updated.savedGroups = patch.savedGroups;
  }
  if (patch.prerequisites != null) {
    updated.prerequisites = patch.prerequisites;
  }
  if ("force" in patch && patch.force !== undefined) {
    (updated as { value?: unknown }).value = patch.force;
  }
  return updated;
}

/**
 * Extract the current sparse values for the fields in a patch (for previousValues storage).
 */
function extractPreviousValues(
  existing: FeatureRule | undefined,
  patch: Omit<FeatureRulePatch, "ruleId">,
): Omit<FeatureRulePatch, "ruleId"> {
  if (!existing) return {};
  const prev: Omit<FeatureRulePatch, "ruleId"> = {};
  if (patch.coverage !== undefined) {
    prev.coverage = (existing as { coverage?: number }).coverage ?? 0;
  }
  if (patch.condition !== undefined) {
    prev.condition = existing.condition ?? "";
  }
  if (patch.savedGroups !== undefined) {
    prev.savedGroups = existing.savedGroups ?? [];
  }
  if (patch.prerequisites !== undefined) {
    prev.prerequisites = existing.prerequisites ?? [];
  }
  if ("force" in patch && patch.force !== undefined) {
    prev.force = (existing as { value?: unknown }).value;
  }
  return prev;
}

const featureEntityHandler: EntityHandler = {
  async buildRevisionChanges(ctx, entityId, actions) {
    const feature = await getFeature(ctx, entityId);
    if (!feature) throw new Error(`Feature not found: ${entityId}`);

    // Build per-environment rule maps from current live state
    const rulesSnapshot: Record<string, FeatureRule[]> = {};
    for (const [env, envSettings] of Object.entries(
      feature.environmentSettings ?? {},
    )) {
      rulesSnapshot[env] = [...(envSettings.rules ?? [])];
    }

    const previousValues: { targetId: string; patch: FeatureRulePatch }[] = [];

    for (const action of actions) {
      const { targetId, patch } = action;
      const { ruleId, ...patchFields } = patch;

      // Apply the patch to this rule in every environment it appears in
      let foundInAnyEnv = false;
      for (const env of Object.keys(rulesSnapshot)) {
        const ruleIdx = rulesSnapshot[env].findIndex((r) => r.id === ruleId);
        if (ruleIdx === -1) continue;

        foundInAnyEnv = true;
        const existingRule = rulesSnapshot[env][ruleIdx];

        // Capture previous values (only once per targetId, from first env found)
        if (!previousValues.find((pv) => pv.targetId === targetId)) {
          previousValues.push({
            targetId,
            patch: {
              ruleId,
              ...extractPreviousValues(existingRule, patchFields),
            },
          });
        }

        rulesSnapshot[env][ruleIdx] = applyPatchToRule(
          existingRule,
          patchFields,
        );
      }

      if (!foundInAnyEnv) {
        logger.warn(
          { ruleId, featureId: entityId },
          "Ramp step action: ruleId not found in any environment",
        );
      }
    }

    return {
      changes: { rules: rulesSnapshot },
      previousValues,
    };
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
      `No EntityHandler registered for entityType "${entityType}" (TODO v2)`,
    );
  }
  return handler;
}

// ---------------------------------------------------------------------------
// computeNextStepAt
// ---------------------------------------------------------------------------

/**
 * Compute the time at which step `nextStepIndex` should fire.
 *
 * "Hold-first" semantics: a step's interval is the wait *before* that step
 * fires (not after). The fire time is therefore:
 *
 *   nextStepAt = phaseStartedAt + sum(seconds[0..nextStepIndex])  (inclusive)
 *
 * After an approval gate, phaseStartedAt is adjusted via
 * computePhaseStartAfterApproval so the next interval step fires exactly
 * steps[nextStepIndex].seconds after the approval time.
 */
export function computeNextStepAt(
  schedule: RampScheduleInterface,
  nextStepIndex: number,
  now: Date,
): Date | null {
  const step = schedule.steps[nextStepIndex];
  if (!step) return null;

  const trigger = step.trigger;
  // Approval steps fire as soon as the previous step completes — the "wait"
  // is the human approval itself, not a time-based delay.
  if (trigger.type === "approval") return now;
  if (trigger.type === "scheduled") return trigger.at;

  const phaseStart = schedule.phaseStartedAt ?? schedule.startedAt ?? now;

  // Sum intervals of steps 0..nextStepIndex (inclusive): step N's interval is
  // how long to wait *before* step N applies its effects.
  let total = 0;
  for (let i = 0; i <= nextStepIndex; i++) {
    const t = schedule.steps[i]?.trigger;
    if (t?.type === "interval") total += t.seconds;
  }
  return new Date(phaseStart.getTime() + total * 1000);
}

/**
 * Compute a phaseStartedAt value to use after an approval gate at `stepIndex`
 * fires, such that computeNextStepAt returns `now + steps[nextStepIndex].seconds`
 * for the immediately following interval step.
 *
 * With hold-first semantics and the inclusive sum above:
 *   phaseStart = now - sum(steps[0..nextStepIndex-1].interval, interval-only)
 */
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

// ---------------------------------------------------------------------------
// computeRollbackPatch
// ---------------------------------------------------------------------------

/**
 * Accumulate previousValues from currentStepIndex down to targetStepIndex+1.
 * Earlier steps (lower i) overwrite later steps on overlapping fields — they
 * have higher precedence when rewinding to an older state.
 *
 * Returns a map of { targetId → merged sparse patch }.
 */
export function computeRollbackPatch(
  stepHistory: StepHistoryEntry[],
  currentStepIndex: number,
  targetStepIndex: number,
): Record<string, FeatureRulePatch> {
  const patchByTarget: Record<string, FeatureRulePatch> = {};

  for (let i = currentStepIndex; i > targetStepIndex; i--) {
    const entry = stepHistory.find((h) => h.stepIndex === i);
    if (!entry) continue;

    for (const { targetId, patch } of entry.previousValues) {
      patchByTarget[targetId] = {
        ...(patchByTarget[targetId] ?? {}),
        ...patch,
      };
    }
  }

  return patchByTarget;
}

// ---------------------------------------------------------------------------
// advanceStep — internal helper
// ---------------------------------------------------------------------------

/**
 * Create revisions for one step's actions.
 * Actions are grouped by entity so targets on the same entity share one revision.
 * For approval-gated steps the primary entity's revision becomes the approval gate;
 * secondary-entity revisions are held as pending-parent until it is approved.
 */
async function createStepRevisions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  stepIndex: number,
  actions: RampStepAction[],
): Promise<{
  revisionIds: string[];
  previousValues: { targetId: string; patch: FeatureRulePatch }[];
  pendingApprovalRevisionId?: string;
}> {
  // Group actions by entityId
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

  const revisionIds: string[] = [];
  const allPreviousValues: { targetId: string; patch: FeatureRulePatch }[] = [];
  const primaryKey = `${schedule.entityType}:${schedule.entityId}`;
  const isApprovalStep = schedule.steps[stepIndex]?.trigger.type === "approval";

  const user: EventUser = {
    type: "system",
    subtype: "ramp-schedule",
    id: schedule.id,
  };
  let pendingApprovalRevisionId: string | undefined;

  for (const [key, group] of byEntity) {
    const handler = getEntityHandler(group.entityType);
    const feature = await getFeature(ctx, group.entityId);
    if (!feature) {
      logger.warn(
        { entityId: group.entityId },
        "Ramp step: entity not found, skipping",
      );
      continue;
    }

    const { changes, previousValues } = await handler.buildRevisionChanges(
      ctx,
      group.entityId,
      group.actions,
    );
    allPreviousValues.push(...previousValues);

    const isPrimary = key === primaryKey;

    const revision = await createRevision({
      context: ctx,
      feature: feature as FeatureInterface,
      user,
      environments: ctx.environments,
      changes,
      publish: false,
      comment:
        stepIndex >= schedule.steps.length
          ? `Ramp complete`
          : `Ramp schedule step ${stepIndex + 1}`,
      title:
        stepIndex >= schedule.steps.length
          ? `Ramp complete: ${schedule.name}`
          : `Ramp [${stepIndex + 1} of ${schedule.steps.length}]: ${schedule.name}`,
      org: ctx.org,
    });

    const revisionRef = `${feature.id}:${revision.version}`;

    if (isApprovalStep && isPrimary) {
      // Approval gate — request review and track it as the blocker.
      await markRevisionAsReviewRequested(ctx, revision, user);
      pendingApprovalRevisionId = revisionRef;
    } else if (!isPrimary) {
      // Secondary-entity revision waits for the primary to be approved.
      await markRevisionAsPendingParent(
        ctx.org.id,
        feature.id,
        revision.version,
      );
    } else {
      // Non-approval primary step: org-level approval requirements do NOT apply.
      // The ramp controls its own publication lifecycle — approval gates are only
      // introduced by explicit "approval" trigger steps. Interval steps always
      // auto-publish immediately.
      const allEnvironments = getEnvironmentIdsFromOrg(ctx.org);
      const featureEnvs: Record<string, boolean> = Object.fromEntries(
        Object.entries(
          (feature as FeatureInterface).environmentSettings ?? {},
        ).map(([envId, env]) => [envId, !!env.enabled]),
      );
      const fillEnvs = (r: FeatureRevisionInterface) => ({
        ...fillRevisionFromFeature(r, feature as FeatureInterface),
        environmentsEnabled: {
          ...featureEnvs,
          ...(r.environmentsEnabled ?? {}),
        },
      });
      const liveRevision = await getRevision({
        context: ctx,
        organization: feature.organization,
        featureId: feature.id,
        version: (feature as FeatureInterface).version,
      });
      if (liveRevision) {
        const mergeResult = autoMerge(
          fillEnvs(liveRevision),
          fillEnvs(liveRevision),
          revision,
          allEnvironments,
          {},
        );
        if (mergeResult.success) {
          await publishRevision(
            ctx,
            feature as FeatureInterface,
            revision,
            mergeResult.result,
            `Ramp: ${schedule.name} — step ${stepIndex + 1}`,
          );
        } else {
          logger.warn(
            { scheduleId: schedule.id, stepIndex },
            "Ramp step auto-publish: merge conflict, leaving as draft",
          );
        }
      }
    }

    revisionIds.push(revisionRef);
  }

  return {
    revisionIds,
    previousValues: allPreviousValues,
    pendingApprovalRevisionId,
  };
}

// ---------------------------------------------------------------------------
// advanceStep
// ---------------------------------------------------------------------------

export async function advanceStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  attribution: RampAttribution = { type: "schedule" },
): Promise<RampScheduleInterface> {
  const nextStepIndex = schedule.currentStepIndex + 1;
  const step = schedule.steps[nextStepIndex];

  if (!step) {
    // No more steps — complete the schedule
    return ctx.models.rampSchedules.updateById(schedule.id, {
      status: "completed",
      nextStepAt: null,
    });
  }

  const now = new Date();

  const { revisionIds, previousValues, pendingApprovalRevisionId } =
    await createStepRevisions(ctx, schedule, nextStepIndex, step.actions);

  const historyEntry: StepHistoryEntry = {
    stepIndex: nextStepIndex,
    enteredAt: now,
    revisionIds,
    previousValues,
    triggeredBy: attribution,
  };

  const trigger = step.trigger;
  const isApprovalStep = trigger.type === "approval";

  // A step is "blocked" if it's an explicit approval-type step OR if the
  // org's review policy gates the ramp's target environments (policy-gated
  // interval steps set pendingApprovalRevisionId in createStepRevisions).
  const isBlocked = isApprovalStep || !!pendingApprovalRevisionId;

  const nextNextStepIndex = nextStepIndex + 1;
  let nextStepAt: Date | null = null;
  if (!isBlocked) {
    if (schedule.steps[nextNextStepIndex]) {
      nextStepAt = computeNextStepAt(schedule, nextNextStepIndex, now);
    } else {
      // Last step applied — set nextStepAt to now so the agenda job (and
      // advanceUntilBlocked) fires one more time and hits the !step completion branch.
      nextStepAt = now;
    }
  }

  const newStatus: RampScheduleInterface["status"] = isBlocked
    ? "pending-approval"
    : "running";

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: nextStepIndex,
    nextStepAt,
    pendingRevisionIds: revisionIds,
    pendingApprovalRevisionId,
    stepHistory: [...schedule.stepHistory, historyEntry],
  });

  await dispatchRampEvent(ctx, updated, "step.advanced", {
    object: {
      rampScheduleId: updated.id,
      rampName: updated.name,
      orgId: ctx.org.id,
      currentStepIndex: updated.currentStepIndex,
      status: updated.status,
    },
  });

  if (pendingApprovalRevisionId) {
    await dispatchRampEvent(ctx, updated, "step.approvalRequired", {
      object: {
        rampScheduleId: updated.id,
        rampName: updated.name,
        orgId: ctx.org.id,
        currentStepIndex: updated.currentStepIndex,
        status: updated.status,
        revisionId: pendingApprovalRevisionId,
      },
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// rollbackToStep
// ---------------------------------------------------------------------------

export async function rollbackToStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  targetStepIndex: number,
  attribution: RampAttribution = { type: "manual" },
): Promise<RampScheduleInterface> {
  const rollbackPatch = computeRollbackPatch(
    schedule.stepHistory,
    schedule.currentStepIndex,
    targetStepIndex,
  );

  if (Object.keys(rollbackPatch).length === 0) {
    return schedule; // Nothing to roll back
  }

  // Build step actions from the rollback patch
  const rollbackActions: RampStepAction[] = Object.entries(rollbackPatch).map(
    ([targetId, patch]) => ({ targetId, patch }),
  );

  const now = new Date();

  // Discard any pending revisions from the current step
  await discardPendingRevisions(ctx, schedule);

  const { revisionIds } = await createStepRevisions(
    ctx,
    schedule,
    targetStepIndex,
    rollbackActions,
  );

  const historyEntry: StepHistoryEntry = {
    stepIndex: targetStepIndex,
    enteredAt: now,
    revisionIds,
    previousValues: [], // Rollback entries don't store previousValues
    triggeredBy: attribution,
  };

  // Partial rollbacks (landing mid-schedule) pause so Agenda doesn't auto-advance.
  // Full rollbacks to the very beginning (-1) use "rolled-back" as a terminal signal.
  const newStatus = targetStepIndex === -1 ? "rolled-back" : "paused";

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: newStatus,
    currentStepIndex: targetStepIndex,
    nextStepAt: null,
    pausedAt: newStatus === "paused" ? now : null,
    pendingRevisionIds: revisionIds,
    stepHistory: [...schedule.stepHistory, historyEntry],
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

// ---------------------------------------------------------------------------
// completeRollout
// ---------------------------------------------------------------------------

// "Complete rollout" action: merges all remaining step patches and any endCondition
// actions into a single revision, then marks the schedule fully complete.
// Bypasses timing and approval gates. Used by the REST "complete" action and the
// endCondition deadline handler (which passes explicit system attribution).
export async function completeRollout(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  attribution: RampAttribution = { type: "manual" },
): Promise<RampScheduleInterface> {
  await discardPendingRevisions(ctx, schedule);

  const now = new Date();
  const endConditionActions = schedule.endCondition?.actions ?? [];

  // Merge all remaining step patches + endCondition actions into one combined action set.
  // Later entries overwrite earlier ones for the same target+field (last-write-wins),
  // so the single revision lands at the fully-completed final state.
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

  let revisionIds: string[] = [];
  let previousValues: { targetId: string; patch: FeatureRulePatch }[] = [];
  if (mergedPatches.size > 0) {
    const mergedActions = Array.from(mergedPatches.entries()).map(
      ([targetId, patch]) => ({ targetId, patch }),
    );
    ({ revisionIds, previousValues } = await createStepRevisions(
      ctx,
      schedule,
      schedule.steps.length, // Virtual "end" index — beyond all defined steps
      mergedActions,
    ));
  }

  const finalStepIndex =
    schedule.steps.length > 0
      ? schedule.steps.length - 1
      : schedule.currentStepIndex;
  const finalStatus: RampScheduleInterface["status"] = "completed";

  // Single history entry at the virtual "end" position covering the full force-completion.
  const historyEntry: StepHistoryEntry = {
    stepIndex: schedule.steps.length,
    enteredAt: now,
    revisionIds,
    previousValues,
    triggeredBy: attribution,
  };

  const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
    status: finalStatus,
    currentStepIndex: finalStepIndex,
    nextStepAt: null,
    pendingRevisionIds: revisionIds,
    pendingApprovalRevisionId: undefined,
    stepHistory: [...schedule.stepHistory, historyEntry],
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

// ---------------------------------------------------------------------------
// evaluateAutoRollback
// ---------------------------------------------------------------------------

export type CriteriaResult = "pass" | "fail" | "inconclusive";

/**
 * STUB — not yet called from anywhere.
 *
 * `autoRollback.criteriaId` was intended to reference a future `DecisionCriteria`
 * entity: a reusable, named health-check config (guardrails, SRM, min days, etc.)
 * that could be attached to ramp steps, end triggers, or auto-rollback — the
 * generalised form of what `SafeRolloutInterface` inlines today.
 *
 * To wire this up once that entity exists:
 *   1. Hook into `SafeRolloutSnapshotModel.afterUpdate` (which already calls
 *      `checkAndRollbackSafeRollout`) and translate a `"rollback-now"` result
 *      into a `CriteriaResult = "fail"` call here, passing the relevant criteria ID.
 *   2. Do the same for experiment snapshot completion.
 *
 * TODO: instrument once `DecisionCriteria` is defined and safe-rollout health
 * results are keyed by a stable criteria ID.
 */
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

// ---------------------------------------------------------------------------
// onRevisionPublished / onRevisionDiscarded
// ---------------------------------------------------------------------------

// Transitions a ramp from "pending" once its activating revision is published.
// - "immediately": auto-start → "running", advance first step.
// - "manual": → "ready" (waits for user to click Start).
// - "scheduled": → "ready" (Agenda auto-starts it when startCondition.trigger.at <= now).
// TODO: startCondition.actions should be applied as an inline revision before the first step advances.
async function onActivatingRevisionPublished(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<void> {
  if (schedule.status !== "pending") return;

  const trigger = schedule.startCondition?.trigger ?? {
    type: "immediately" as const,
  };

  if (trigger.type === "immediately") {
    const now = new Date();
    // Compute step 0's fire time upfront (hold-first: step 0 waits its own interval).
    const initialNextStepAt =
      schedule.steps.length > 0
        ? computeNextStepAt(
            { ...schedule, phaseStartedAt: now, startedAt: now },
            0,
            now,
          )
        : null;

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
    // Advance step 0 if its timer has already elapsed (interval = 0) and any subsequent steps.
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
    // "manual" or "scheduled" — become eligible to start
    await ctx.models.rampSchedules.updateById(schedule.id, { status: "ready" });
  }
}

export async function onRevisionPublished(
  ctx: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
): Promise<void> {
  const revisionRef = `${revision.featureId}:${revision.version}`;

  // Case 1: This revision activates a pending ramp (created atomically with a rule change)
  const activatingRamps =
    await ctx.models.rampSchedules.findByActivatingRevision(
      revision.featureId,
      revision.version,
    );
  for (const schedule of activatingRamps) {
    await onActivatingRevisionPublished(ctx, schedule);
  }

  // Case 2: This is the approval-gate revision for a pending-approval step
  const approvalRamps =
    await ctx.models.rampSchedules.findByPendingApprovalRevision(revisionRef);
  for (const schedule of approvalRamps) {
    await onApprovalRevisionPublished(ctx, schedule, revision);
  }
}

// Called when the approval-gate revision for a step is published.
// Auto-publishes all other pending revisions for that step, then advances the ramp.
async function onApprovalRevisionPublished(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  approvalRevision: FeatureRevisionInterface,
): Promise<void> {
  const approvalRef = `${approvalRevision.featureId}:${approvalRevision.version}`;

  // Publish all other pending-parent revisions for this step
  await publishPendingRevisions(ctx, schedule, approvalRef);

  const stepIndex = schedule.currentStepIndex;
  const completedEntry = schedule.stepHistory.find(
    (h) => h.stepIndex === stepIndex,
  );
  if (!completedEntry) return;

  const now = new Date();
  const wasApprovalGate =
    schedule.steps[stepIndex]?.trigger.type === "approval";
  const updatedHistory = schedule.stepHistory.map((h) =>
    h.stepIndex === stepIndex ? { ...h, completedAt: now } : h,
  );

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

  // When all steps are done: if endEarlyWhenStepsComplete is false AND a future
  // end date trigger exists, stay "running" so Agenda fires the end date later.
  // Otherwise complete immediately (default behavior for ramp-ups).
  const hasFutureEndDate =
    !nextStepAt &&
    schedule.endCondition?.trigger?.type === "scheduled" &&
    schedule.endCondition.trigger.at > now;
  const holdForEndDate =
    hasFutureEndDate && schedule.endEarlyWhenStepsComplete === false;

  await ctx.models.rampSchedules.updateById(schedule.id, {
    status: nextStepAt || holdForEndDate ? "running" : "completed",
    nextStepAt,
    stepHistory: updatedHistory,
    pendingRevisionIds: [],
    pendingApprovalRevisionId: undefined,
    ...(wasApprovalGate ? { phaseStartedAt: newPhaseStart } : {}),
  });

  await dispatchRampEvent(ctx, schedule, "step.approved", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: ctx.org.id,
      currentStepIndex: stepIndex,
      status: "running",
      revisionId: approvalRef,
    },
  });
}

// Publish all pending-parent revisions in the schedule's pendingRevisionIds,
// skipping excludeRef (already being published or discarded by the caller).
async function publishPendingRevisions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  excludeRef: string,
): Promise<void> {
  const pendingIds = schedule.pendingRevisionIds ?? [];
  const user: EventUser = { type: "system" };

  for (const refId of pendingIds) {
    if (refId === excludeRef) continue;

    const [featureId, versionStr] = refId.split(":");
    const version = parseInt(versionStr, 10);
    if (!featureId || isNaN(version)) continue;

    const feature = await getFeature(ctx, featureId);
    if (!feature) continue;

    const revision = await getRevision({
      context: ctx,
      organization: ctx.org.id,
      featureId,
      version,
    });
    if (!revision || revision.status !== "pending-parent") continue;

    await markRevisionAsPublished(ctx, feature, revision, user);
  }
}

export async function onRevisionDiscarded(
  ctx: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
): Promise<void> {
  const revisionRef = `${revision.featureId}:${revision.version}`;

  // Only react when the approval-gate revision is discarded
  const approvalRamps =
    await ctx.models.rampSchedules.findByPendingApprovalRevision(revisionRef);

  for (const schedule of approvalRamps) {
    // Discard all other pending-parent revisions for this step
    await discardPendingRevisions(ctx, schedule, revisionRef);

    // The approval draft was never published, so its step changes were never applied.
    // Roll currentStepIndex back to the last successfully applied step so that
    // resuming will retry this step rather than skipping it.
    const revertedStepIndex = Math.max(-1, schedule.currentStepIndex - 1);

    await ctx.models.rampSchedules.updateById(schedule.id, {
      status: "paused",
      pausedAt: new Date(),
      currentStepIndex: revertedStepIndex,
      pendingRevisionIds: [],
      pendingApprovalRevisionId: undefined,
    });

    await dispatchRampEvent(ctx, schedule, "paused", {
      object: {
        rampScheduleId: schedule.id,
        rampName: schedule.name,
        orgId: ctx.org.id,
        currentStepIndex: revertedStepIndex,
        status: "paused",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Discard all pending revisions in the schedule, skipping excludeRef if provided.
// Used by completeRollout (discard all) and onRevisionDiscarded (discard all except the
// one already being discarded).
async function discardPendingRevisions(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  excludeRef?: string,
): Promise<void> {
  const pendingIds = schedule.pendingRevisionIds ?? [];
  const user: EventUser = { type: "system" };

  for (const refId of pendingIds) {
    if (excludeRef && refId === excludeRef) continue;

    const [featureId, versionStr] = refId.split(":");
    const version = parseInt(versionStr, 10);
    if (!featureId || isNaN(version)) continue;

    const revision = await getRevision({
      context: ctx,
      organization: ctx.org.id,
      featureId,
      version,
    });
    if (!revision) continue;
    if (revision.status === "published" || revision.status === "discarded") {
      continue;
    }

    try {
      await discardRevision(ctx, revision, user);
    } catch (e) {
      logger.error(e, `Error discarding pending ramp revision ${refId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Event dispatching
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hook registration (call at startup)
// ---------------------------------------------------------------------------

/**
 * Register ramp schedule hooks on FeatureRevisionModel.
 * Must be called at application startup (e.g. in init/queue.ts).
 */
export function initRampScheduleHooks(): void {
  registerRevisionPublishedHook(onRevisionPublished);
  registerRevisionDiscardedHook(onRevisionDiscarded);
}

// ---------------------------------------------------------------------------
// advanceUntilBlocked — shared by agenda job and inline start/resume paths
// ---------------------------------------------------------------------------

/**
 * Advance a running schedule through all steps that are currently due,
 * creating a separate revision for each step.  The loop stops when:
 *   - The schedule leaves "running" (approval gate, completion, error)
 *   - No more steps remain (advanceStep sets status to "completed")
 *   - The next step is not yet due (nextStepAt > now)
 *   - A safety cap of schedule.steps.length iterations is reached
 */
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

    // Hold-first semantics: every step (including step 0) must wait its own
    // interval before firing. nextStepAt is set when transitioning to "running".
    if (!current.nextStepAt || current.nextStepAt > now) return;

    current = await advanceStep(ctx, current, attribution);
  }
}

// ---------------------------------------------------------------------------
// Approve and publish a pending-approval ramp step atomically
// ---------------------------------------------------------------------------

export type ApproveStepError =
  | { code: "no_pending_approval" }
  | { code: "revision_not_found" }
  | { code: "feature_not_found" }
  | { code: "permission_denied"; detail: string }
  | { code: "merge_conflict"; detail: string }
  | { code: "error"; detail: string };

/**
 * Atomically approve and publish the ramp's pending approval revision.
 * Returns null on success, or a structured error that the controller can map to
 * an appropriate HTTP response.
 *
 * The caller does not need to pass a serialized merge result — we compute it
 * here and reject if there are unresolvable conflicts, returning a structured
 * error so the UI can prompt the user to open the diff view.
 */
export async function approveAndPublishStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
): Promise<ApproveStepError | null> {
  if (!schedule.pendingApprovalRevisionId) {
    return { code: "no_pending_approval" };
  }

  // pendingApprovalRevisionId is stored as "featureId:version"
  const parts = schedule.pendingApprovalRevisionId.split(":");
  const revVersion = parseInt(parts[parts.length - 1], 10);
  const featureId = parts.slice(0, parts.length - 1).join(":");

  const feature = await getFeature(ctx, featureId);
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

  const revision = await getRevision({
    context: ctx,
    organization: ctx.org.id,
    featureId: feature.id,
    version: revVersion,
  });
  if (!revision) return { code: "revision_not_found" };

  const live = await getRevision({
    context: ctx,
    organization: ctx.org.id,
    featureId: feature.id,
    version: feature.version,
  });
  if (!live) return { code: "error", detail: "Could not load live revision" };

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision({
          context: ctx,
          organization: ctx.org.id,
          featureId: feature.id,
          version: revision.baseVersion,
        });
  if (!base) return { code: "error", detail: "Could not load base revision" };

  const allEnvironments = getEnvironments(ctx.org);
  const environmentIds = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  ).map((e) => e.id);

  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    {},
  );

  if (!mergeResult.success) {
    return {
      code: "merge_conflict",
      detail: mergeResult.conflicts
        .filter((c) => !c.resolved)
        .map((c) => c.name)
        .join(", "),
    };
  }

  // Check publish permissions for the affected environments
  const changedEnvs = Object.keys(mergeResult.result.rules ?? {});
  const envsToCheck =
    mergeResult.result.defaultValue !== undefined
      ? environmentIds
      : changedEnvs;
  if (
    envsToCheck.length > 0 &&
    !ctx.permissions.canPublishFeature(feature, envsToCheck)
  ) {
    return {
      code: "permission_denied",
      detail: "Cannot publish to one or more affected environments",
    };
  }

  // Mark as approved
  const user: EventUser = {
    type: "system",
    subtype: "ramp-schedule",
    id: schedule.id,
  };
  await submitReviewAndComments(ctx, revision, user, "Approved");

  // Publish — this triggers onRevisionPublished which advances the ramp
  await publishRevision(ctx, feature, revision, mergeResult.result);

  return null;
}
