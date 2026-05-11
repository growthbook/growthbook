import {
  RampScheduleInterface,
  SafeRolloutInterface,
  StepHoldConditions,
  ExperimentHealthAction,
} from "shared/validators";
import { expandMetricGroups } from "shared/experiments";
import { getHealthSettings } from "shared/enterprise";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import {
  appendRampEvent,
  computeNextProcessAt,
  computeNextSnapshotAt,
  getRefreshIntervalMs,
} from "back-end/src/services/rampSchedule";

export type EvalDecision =
  | { action: "advance" }
  | { action: "hold"; reason: string }
  | { action: "rollback"; reason: string }
  | { action: "pause"; reason: string };

// Evaluates the current step of a running ramp schedule.
// Returns a decision: advance, hold, rollback, or pause.
export async function evaluateCurrentStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<EvalDecision> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) return { action: "advance" };

  if (step.monitored) {
    const decision = await evaluateMonitoredStep(ctx, schedule, now);
    logger.info(
      { scheduleId: schedule.id, decision },
      "evaluateCurrentStep: monitored step decision",
    );
    return decision;
  }

  if (step.holdConditions) {
    const holdDecision = checkHoldConditions(
      schedule,
      step.holdConditions,
      now,
    );
    if (holdDecision) return holdDecision;
  }

  return { action: "advance" };
}

async function evaluateMonitoredStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<EvalDecision> {
  logger.info(
    {
      scheduleId: schedule.id,
      stepIndex: schedule.currentStepIndex,
      safeRolloutId: schedule.safeRolloutId,
      status: schedule.status,
      nextStepAt: schedule.nextStepAt,
      nextSnapshotAt: schedule.nextSnapshotAt,
      currentStepEnteredAt: schedule.currentStepEnteredAt,
    },
    "evaluateMonitoredStep: entry",
  );

  const safeRollout = schedule.safeRolloutId
    ? await ctx.models.safeRollout.getById(schedule.safeRolloutId)
    : null;

  if (!safeRollout) {
    return {
      action: "hold",
      reason: "No linked SafeRollout — waiting for monitoring to be attached",
    };
  }

  logger.info(
    {
      scheduleId: schedule.id,
      srId: safeRollout.id,
      autoSnapshots: safeRollout.autoSnapshots,
      lastSnapshotAttempt: safeRollout.lastSnapshotAttempt,
      hasSummary: !!safeRollout.analysisSummary,
      totalUsers: safeRollout.analysisSummary?.health?.totalUsers ?? null,
    },
    "evaluateMonitoredStep: safeRollout state",
  );

  const step = schedule.steps[schedule.currentStepIndex];
  const monitoringConfig = schedule.monitoringConfig ?? undefined;
  const srmAction =
    monitoringConfig?.srmAction ?? schedule.experimentHealthAction ?? "hold";
  const noTrafficAction = monitoringConfig?.noTrafficAction ?? "hold";
  const multipleExposureAction =
    monitoringConfig?.multipleExposureAction ?? "hold";

  // Expand metric group IDs so guardrail/signal checks match individual
  // metric IDs in the analysis summary (which stores expanded keys).
  const metricGroups = await ctx.models.metricGroups.getAll();
  const expandedGuardrailIds = expandMetricGroups(
    monitoringConfig?.guardrailMetricIds ?? [],
    metricGroups,
  );
  const expandedSignalIds = expandMetricGroups(
    monitoringConfig?.signalMetricIds ?? [],
    metricGroups,
  );

  // 1. Check schedule-level guardrail signals (rollback for guardrail-tier metrics).
  // Dedupe: if a metric appears in both tiers, treat it as guardrail only.
  const signalOnly = expandedSignalIds.filter(
    (id) => !expandedGuardrailIds.includes(id),
  );
  const scheduleLevelDecision = checkScheduleGuardrailSignals(
    safeRollout,
    expandedGuardrailIds,
  );
  if (scheduleLevelDecision) return scheduleLevelDecision;

  // 2. Check experiment health (SRM, multiple exposures) at schedule level.
  const experimentHealthDecision = checkExperimentHealth(
    ctx,
    safeRollout,
    srmAction,
    multipleExposureAction,
  );
  if (experimentHealthDecision) return experimentHealthDecision;

  // 3. Trigger a new snapshot if the query interval has elapsed.
  const snapshotTriggered = await maybeTriggerSnapshot(
    ctx,
    schedule,
    safeRollout,
    now,
  );

  // 4. Check if the step interval has elapsed.
  const stepEnteredAt = schedule.currentStepEnteredAt;
  if (stepEnteredAt && step?.trigger.type === "interval") {
    const stepElapsedMs = now.getTime() - stepEnteredAt.getTime();
    const stepDurationMs = step.trigger.seconds * 1000;
    if (stepElapsedMs < stepDurationMs) {
      const remainingMin = Math.ceil((stepDurationMs - stepElapsedMs) / 60_000);
      return {
        action: "hold",
        reason: `Monitored step: ~${remainingMin} min remaining in hold interval`,
      };
    }
  }

  // 5. Step interval has elapsed. Check for a healthy snapshot that was
  //    completed AFTER the step interval expired.
  const intervalEndAt =
    stepEnteredAt && step?.trigger.type === "interval"
      ? new Date(stepEnteredAt.getTime() + step.trigger.seconds * 1000)
      : null;

  // Use the DB value if available, but if we just triggered a snapshot in this
  // tick, treat `now` as the attempt time (avoids stale in-memory object).
  const latestSnapshot = snapshotTriggered
    ? now
    : safeRollout.lastSnapshotAttempt;
  const hasPostIntervalSnapshot =
    intervalEndAt && latestSnapshot && latestSnapshot >= intervalEndAt;

  if (!hasPostIntervalSnapshot) {
    return {
      action: "hold",
      reason: "Waiting for a snapshot that covers the full step duration",
    };
  }

  // 6. Verify analysis results are present.
  const summary = safeRollout.analysisSummary;
  if (!summary?.health) {
    return { action: "hold", reason: "Waiting for analysis results" };
  }

  if (!summary.health.totalUsers) {
    if (noTrafficAction === "rollback") {
      return {
        action: "rollback",
        reason: "No traffic detected — rolling back (noTrafficAction=rollback)",
      };
    }
    if (noTrafficAction === "hold") {
      return {
        action: "hold",
        reason: "No traffic detected — holding step (noTrafficAction=hold)",
      };
    }
    // noTrafficAction === "warn" → log and continue (don't block advancement)
    logger.warn(
      { safeRolloutId: safeRollout.id },
      "No traffic detected on monitored step (noTrafficAction=warn)",
    );
  }

  const resultsStatus = summary.resultsStatus;
  if (!resultsStatus) {
    return { action: "hold", reason: "No results status available yet" };
  }

  // 7. Check minSampleSize before acting on metric results.
  const totalUsers = summary.health.totalUsers ?? 0;
  const minSampleSize = step?.holdConditions?.minSampleSize;
  if (minSampleSize && totalUsers < minSampleSize) {
    return {
      action: "hold",
      reason: `Waiting for minimum sample size (${totalUsers}/${minSampleSize})`,
    };
  }

  // 8. Step-level signal metric gating (hold for signal-tier metrics).
  const signalDecision = checkSignalMetricGating(safeRollout, signalOnly);
  if (signalDecision) return signalDecision;

  // 9. Hold conditions (minDurationMs timing).
  if (step?.holdConditions) {
    const holdDecision = checkHoldConditions(
      schedule,
      step.holdConditions,
      now,
    );
    if (holdDecision) return holdDecision;
  }

  return { action: "advance" };
}

// ---------------------------------------------------------------------------
// Schedule-level guardrail checks (rollback for guardrail-tier metrics)
// ---------------------------------------------------------------------------

function checkScheduleGuardrailSignals(
  safeRollout: SafeRolloutInterface,
  expandedGuardrailIds: string[],
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  const guardrailIds = new Set(expandedGuardrailIds);
  if (guardrailIds.size === 0) return null;

  for (const variation of summary.resultsStatus.variations) {
    if (!variation.guardrailMetrics) continue;
    for (const [metricId, gm] of Object.entries(variation.guardrailMetrics)) {
      if (gm.status !== "lost") continue;

      if (guardrailIds.has(metricId)) {
        return {
          action: "rollback",
          reason: `Guardrail metric ${metricId} is a significant loser (variation ${variation.variationId})`,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Experiment health (SRM / multiple exposures) at schedule level
// ---------------------------------------------------------------------------

function checkExperimentHealth(
  ctx: ReqContext | ApiReqContext,
  safeRollout: SafeRolloutInterface,
  srmAction: ExperimentHealthAction,
  meAction: ExperimentHealthAction,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.health) return null;

  const healthSettings = getHealthSettings(ctx.org.settings);
  const totalUsers = summary.health.totalUsers ?? 0;

  // SRM check
  const srmData = getSRMHealthData({
    srm: summary.health.srm,
    srmThreshold: healthSettings.srmThreshold,
    totalUsersCount: totalUsers,
    numOfVariations: summary.resultsStatus?.variations.length ?? 2,
    minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  });

  if (srmData === "unhealthy") {
    if (srmAction === "warn") {
      logger.warn(
        { safeRolloutId: safeRollout.id },
        "Experiment health (SRM) is unhealthy (warn-only)",
      );
    } else if (srmAction === "rollback") {
      return {
        action: "rollback",
        reason: `Experiment health: SRM check failed (p=${summary.health.srm.toFixed(4)})`,
      };
    } else {
      return {
        action: "hold",
        reason: `Experiment health: SRM check failed — holding step (p=${summary.health.srm.toFixed(4)})`,
      };
    }
  }

  // Multiple exposures check
  const meData = getMultipleExposureHealthData({
    multipleExposuresCount: summary.health.multipleExposures ?? 0,
    totalUsersCount: totalUsers,
    minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
    minPercentThreshold: healthSettings.multipleExposureMinPercent,
  });

  if (meData.status === "unhealthy") {
    if (meAction === "warn") {
      logger.warn(
        { safeRolloutId: safeRollout.id },
        "Experiment health (multiple exposures) is unhealthy (warn-only)",
      );
    } else if (meAction === "rollback") {
      return {
        action: "rollback",
        reason: `Experiment health: multiple exposures detected (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
      };
    } else {
      return {
        action: "hold",
        reason: `Experiment health: multiple exposures detected — holding step (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step-level signal metric gating (hold for signal-tier metrics)
// ---------------------------------------------------------------------------

function checkSignalMetricGating(
  safeRollout: SafeRolloutInterface,
  expandedSignalIds: string[],
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  const signalIds = new Set(expandedSignalIds);
  if (signalIds.size === 0) return null;

  for (const variation of summary.resultsStatus.variations) {
    if (!variation.guardrailMetrics) continue;
    for (const [metricId, gm] of Object.entries(variation.guardrailMetrics)) {
      if (gm.status !== "lost") continue;

      if (signalIds.has(metricId)) {
        return {
          action: "hold",
          reason: `Signal metric ${metricId} is unhealthy — holding step`,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Snapshot triggering
// ---------------------------------------------------------------------------

async function maybeTriggerSnapshot(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  safeRollout: SafeRolloutInterface,
  now: Date,
): Promise<boolean> {
  if (!safeRollout.autoSnapshots) return false;
  if (schedule.monitoringConfig?.autoUpdate === false) return false;

  const refreshMs = getRefreshIntervalMs(
    safeRollout,
    ctx.org,
    schedule.monitoringConfig?.updateScheduleMinutes,
  );
  const lastAttempt = safeRollout.lastSnapshotAttempt;

  const isDue =
    !lastAttempt || now.getTime() - lastAttempt.getTime() >= refreshMs;

  if (!isDue) return false;

  try {
    const { createSafeRolloutSnapshot } = await import(
      "back-end/src/services/safeRolloutSnapshots"
    );
    const { getFeature } = await import("back-end/src/models/FeatureModel");

    const feature = schedule.entityId
      ? await getFeature(ctx, schedule.entityId)
      : null;

    await createSafeRolloutSnapshot({
      context: ctx as ReqContext,
      safeRollout,
      customFields: feature?.customFields,
      triggeredBy: "schedule",
    });

    // _createSafeRolloutSnapshot already sets lastSnapshotAttempt on the SR;
    // no need to write it again here.

    const nextSnapshotAt = computeNextSnapshotAt(
      safeRollout,
      ctx.org,
      now,
      schedule.monitoringConfig?.updateScheduleMinutes,
    );

    // For monitored interval steps, ensure we wake up when the step
    // interval elapses — not just when the next snapshot is due.
    const step = schedule.steps[schedule.currentStepIndex];
    let monitoredStepDueAt: Date | null = null;
    if (step?.monitored && step.trigger.type === "interval" && schedule.currentStepEnteredAt) {
      monitoredStepDueAt = new Date(
        schedule.currentStepEnteredAt.getTime() + step.trigger.seconds * 1000,
      );
    }

    await ctx.models.rampSchedules.updateById(schedule.id, {
      nextSnapshotAt,
      nextProcessAt: computeNextProcessAt({
        status: schedule.status,
        nextStepAt: monitoredStepDueAt ?? schedule.nextStepAt,
        nextSnapshotAt,
        cutoffDate: schedule.cutoffDate,
      }),
      eventHistory: appendRampEvent(schedule, "snapshot-triggered", {
        stepIndex: schedule.currentStepIndex,
        status: schedule.status,
      }),
    });

    logger.info(
      { scheduleId: schedule.id, safeRolloutId: safeRollout.id },
      "Triggered snapshot for monitored ramp step",
    );
    return true;
  } catch (e) {
    logger.error(e, `Failed to trigger snapshot for schedule ${schedule.id}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hold conditions (timing + minSampleSize)
// ---------------------------------------------------------------------------

function checkHoldConditions(
  schedule: RampScheduleInterface,
  hold: StepHoldConditions,
  now: Date,
): EvalDecision | null {
  const stepEnteredAt = schedule.currentStepEnteredAt;
  if (!stepEnteredAt) return null;

  if (hold.minDurationMs) {
    const elapsed = now.getTime() - stepEnteredAt.getTime();
    if (elapsed < hold.minDurationMs) {
      const remainingMin = Math.ceil((hold.minDurationMs - elapsed) / 60_000);
      return {
        action: "hold",
        reason: `Holding for min duration: ~${remainingMin} minutes remaining`,
      };
    }
  }

  return null;
}

// Check if an API-driven advance is allowed for the current step
export function canApiAdvanceStep(schedule: RampScheduleInterface): {
  allowed: boolean;
  reason?: string;
} {
  if (!["running", "pending-approval"].includes(schedule.status)) {
    return { allowed: false, reason: "Schedule is not running" };
  }

  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) return { allowed: false, reason: "No current step" };

  return { allowed: true };
}
