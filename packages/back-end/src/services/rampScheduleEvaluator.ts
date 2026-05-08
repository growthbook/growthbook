import {
  RampScheduleInterface,
  SafeRolloutInterface,
  StepHoldConditions,
  ScheduleGuardrailSettings,
  StepGuardrailSettings,
  GuardrailTopLevelAction,
  GuardrailStepAction,
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
  const scheduleSettings = schedule.guardrailSettings ?? undefined;
  const stepSettings = step?.guardrailSettings;

  // 1. Check schedule-level guardrail signals (rollback/pause/warn per metric).
  const scheduleLevelDecision = checkScheduleGuardrailSignals(
    safeRollout,
    scheduleSettings,
  );
  if (scheduleLevelDecision) return scheduleLevelDecision;

  // 2. Check experiment health (SRM) at schedule level.
  const experimentHealthDecision = checkExperimentHealth(
    ctx,
    safeRollout,
    scheduleSettings,
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

  // 7. Step-level guardrail gating (hold/warn/ignore per metric).
  const stepGuardrailDecision = checkStepGuardrailGating(
    safeRollout,
    stepSettings,
  );
  if (stepGuardrailDecision) return stepGuardrailDecision;

  // 8. Step-level experiment health gating.
  const stepHealthDecision = checkStepExperimentHealth(
    ctx,
    safeRollout,
    stepSettings,
  );
  if (stepHealthDecision) return stepHealthDecision;

  // 9. Legacy hold conditions (minDurationMs timing).
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
// Schedule-level guardrail checks (rollback / pause / warn)
// ---------------------------------------------------------------------------

function checkScheduleGuardrailSignals(
  safeRollout: SafeRolloutInterface,
  settings?: ScheduleGuardrailSettings,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  let pauseReason: string | null = null;

  for (const variation of summary.resultsStatus.variations) {
    if (!variation.guardrailMetrics) continue;
    for (const [metricId, gm] of Object.entries(variation.guardrailMetrics)) {
      if (gm.status !== "lost") continue;

      const action = resolveTopLevelAction(metricId, settings);
      switch (action) {
        case "rollback":
          return {
            action: "rollback",
            reason: `Guardrail metric ${metricId} is a significant loser (variation ${variation.variationId})`,
          };
        case "pause":
          pauseReason =
            pauseReason ??
            `Guardrail metric ${metricId} is unhealthy — pausing schedule`;
          break;
        case "warn":
          logger.warn(
            { metricId, variationId: variation.variationId },
            "Guardrail metric is a significant loser (warn-only)",
          );
          break;
      }
    }
  }

  if (pauseReason) {
    return { action: "pause", reason: pauseReason };
  }

  return null;
}

function resolveTopLevelAction(
  metricId: string,
  settings?: ScheduleGuardrailSettings,
): GuardrailTopLevelAction {
  if (!settings) return "rollback"; // legacy default
  return settings.metrics?.[metricId]?.onUnhealthy ?? "warn";
}

// ---------------------------------------------------------------------------
// Experiment health (SRM / multiple exposures) at schedule level
// ---------------------------------------------------------------------------

function checkExperimentHealth(
  ctx: ReqContext | ApiReqContext,
  safeRollout: SafeRolloutInterface,
  settings?: ScheduleGuardrailSettings,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.health) return null;

  const action = settings?.experimentHealthAction ?? "pause";
  if (action === "warn" || action === "rollback" || action === "pause") {
    const healthSettings = getHealthSettings(ctx.org.settings);
    const srmData = getSRMHealthData({
      srm: summary.health.srm,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: summary.health.totalUsers ?? 0,
      numOfVariations: summary.resultsStatus?.variations.length ?? 2,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });

    if (srmData === "unhealthy") {
      if (action === "warn") {
        logger.warn(
          { safeRolloutId: safeRollout.id },
          "Experiment health (SRM) is unhealthy (warn-only)",
        );
        return null;
      }
      return {
        action,
        reason: `Experiment health: SRM check failed (p=${summary.health.srm.toFixed(4)})`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step-level guardrail gating (hold / warn / ignore)
// ---------------------------------------------------------------------------

function checkStepGuardrailGating(
  safeRollout: SafeRolloutInterface,
  stepSettings?: StepGuardrailSettings,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  for (const variation of summary.resultsStatus.variations) {
    if (!variation.guardrailMetrics) continue;
    for (const [metricId, gm] of Object.entries(variation.guardrailMetrics)) {
      if (gm.status === "safe") continue;
      if (gm.status !== "lost") continue;

      const action = resolveStepAction(metricId, stepSettings);
      switch (action) {
        case "hold":
          return {
            action: "hold",
            reason: `Step hold: guardrail metric ${metricId} is unhealthy`,
          };
        case "warn":
          logger.warn(
            { metricId, variationId: variation.variationId },
            "Step-level: guardrail metric unhealthy (warn-only, advancing)",
          );
          break;
        case "ignore":
          break;
      }
    }
  }

  return null;
}

function resolveStepAction(
  metricId: string,
  stepSettings?: StepGuardrailSettings,
): GuardrailStepAction {
  if (!stepSettings) return "hold"; // legacy default
  return stepSettings.metrics?.[metricId]?.onUnhealthy ?? "ignore";
}

// ---------------------------------------------------------------------------
// Step-level experiment health gating
// ---------------------------------------------------------------------------

function checkStepExperimentHealth(
  ctx: ReqContext | ApiReqContext,
  safeRollout: SafeRolloutInterface,
  stepSettings?: StepGuardrailSettings,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.health) return null;

  const action = stepSettings?.experimentHealthAction ?? "hold";
  if (action === "ignore") return null;

  const healthSettings = getHealthSettings(ctx.org.settings);
  const srmData = getSRMHealthData({
    srm: summary.health.srm,
    srmThreshold: healthSettings.srmThreshold,
    totalUsersCount: summary.health.totalUsers ?? 0,
    numOfVariations: summary.resultsStatus?.variations.length ?? 2,
    minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  });

  if (srmData === "unhealthy") {
    if (action === "warn") {
      logger.warn(
        { safeRolloutId: safeRollout.id },
        "Step-level: experiment health (SRM) unhealthy (warn-only, advancing)",
      );
      return null;
    }
    return {
      action: "hold",
      reason: `Step hold: experiment health check failed (SRM p=${summary.health.srm.toFixed(4)})`,
    };
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
// Legacy hold conditions (timing only — health checks moved to guardrailSettings)
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
