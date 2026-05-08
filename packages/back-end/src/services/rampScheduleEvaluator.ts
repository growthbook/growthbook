import {
  RampScheduleInterface,
  SafeRolloutInterface,
  StepHoldConditions,
  ExperimentHealthAction,
  RampMonitoringConfig,
} from "shared/validators";
import { getHealthSettings } from "shared/enterprise";
import { getSRMHealthData } from "shared/health";
import { DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION } from "shared/constants";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import {
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
    return evaluateMonitoredStep(ctx, schedule, now);
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
  const safeRollout = schedule.safeRolloutId
    ? await ctx.models.safeRollout.getById(schedule.safeRolloutId)
    : null;

  if (!safeRollout) {
    return {
      action: "hold",
      reason: "No linked SafeRollout — waiting for monitoring to be attached",
    };
  }

  const step = schedule.steps[schedule.currentStepIndex];
  const monitoringConfig = schedule.monitoringConfig ?? undefined;
  const healthAction = schedule.experimentHealthAction ?? "hold";

  // 1. Check schedule-level guardrail signals (rollback for guardrail-tier metrics).
  const scheduleLevelDecision = checkScheduleGuardrailSignals(
    safeRollout,
    monitoringConfig,
  );
  if (scheduleLevelDecision) return scheduleLevelDecision;

  // 2. Check experiment health (SRM) at schedule level.
  const experimentHealthDecision = checkExperimentHealth(
    ctx,
    safeRollout,
    healthAction,
  );
  if (experimentHealthDecision) return experimentHealthDecision;

  // 3. Trigger a new snapshot if the query interval has elapsed.
  await maybeTriggerSnapshot(ctx, schedule, safeRollout, now);

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

  const latestSnapshot = safeRollout.lastSnapshotAttempt;
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
  if (!summary?.health?.totalUsers) {
    return { action: "hold", reason: "Waiting for analysis results" };
  }

  const resultsStatus = summary.resultsStatus;
  if (!resultsStatus) {
    return { action: "hold", reason: "No results status available yet" };
  }

  // 7. Check minSampleSize before acting on metric results.
  const minSampleSize = step?.holdConditions?.minSampleSize;
  if (minSampleSize && summary.health.totalUsers < minSampleSize) {
    return {
      action: "hold",
      reason: `Waiting for minimum sample size (${summary.health.totalUsers}/${minSampleSize})`,
    };
  }

  // 8. Step-level signal metric gating (hold for signal-tier metrics).
  const signalDecision = checkSignalMetricGating(safeRollout, monitoringConfig);
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
  monitoringConfig?: RampMonitoringConfig,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  const guardrailIds = new Set(monitoringConfig?.guardrailMetricIds ?? []);
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
  healthAction: ExperimentHealthAction,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.health) return null;

  if (
    healthAction === "warn" ||
    healthAction === "rollback" ||
    healthAction === "hold"
  ) {
    const healthSettings = getHealthSettings(ctx.org.settings);
    const srmData = getSRMHealthData({
      srm: summary.health.srm,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: summary.health.totalUsers ?? 0,
      numOfVariations: summary.resultsStatus?.variations.length ?? 2,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });

    if (srmData === "unhealthy") {
      if (healthAction === "warn") {
        logger.warn(
          { safeRolloutId: safeRollout.id },
          "Experiment health (SRM) is unhealthy (warn-only)",
        );
        return null;
      }
      if (healthAction === "rollback") {
        return {
          action: "rollback",
          reason: `Experiment health: SRM check failed (p=${summary.health.srm.toFixed(4)})`,
        };
      }
      return {
        action: "hold",
        reason: `Experiment health: SRM check failed — holding step (p=${summary.health.srm.toFixed(4)})`,
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
  monitoringConfig?: RampMonitoringConfig,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  const signalIds = new Set(monitoringConfig?.signalMetricIds ?? []);
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
): Promise<void> {
  const refreshMs = getRefreshIntervalMs(safeRollout, ctx.org);
  const lastAttempt = safeRollout.lastSnapshotAttempt;

  const isDue =
    !lastAttempt || now.getTime() - lastAttempt.getTime() >= refreshMs;

  if (!isDue) return;

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

    const nextSnapshotAt = computeNextSnapshotAt(safeRollout, ctx.org, now);
    await ctx.models.rampSchedules.updateById(schedule.id, {
      nextSnapshotAt,
    });

    logger.info(
      { scheduleId: schedule.id, safeRolloutId: safeRollout.id },
      "Triggered snapshot for monitored ramp step",
    );
  } catch (e) {
    logger.error(e, `Failed to trigger snapshot for schedule ${schedule.id}`);
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
