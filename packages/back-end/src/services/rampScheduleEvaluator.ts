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
  MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS,
  advanceStep,
  computeNextProcessAt,
  pauseSchedule,
  rollbackSchedule,
} from "back-end/src/services/rampSchedule";

export type EvalDecision =
  | { action: "advance" }
  | { action: "hold"; reason: string; nextProcessAt?: Date | null }
  | { action: "rollback"; reason: string }
  | { action: "pause"; reason: string };

export async function evaluateCurrentStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<EvalDecision> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) return { action: "advance" };

  if (step.monitored) {
    const decision = await evaluateMonitoredStep(ctx, schedule, now);
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
  if (!schedule.safeRolloutId) {
    return {
      action: "hold",
      reason: "No linked SafeRollout — waiting for monitoring to be attached",
    };
  }

  const step = schedule.steps[schedule.currentStepIndex];
  const monitoringConfig = schedule.monitoringConfig ?? undefined;
  const srmAction =
    monitoringConfig?.srmAction ?? schedule.experimentHealthAction ?? "hold";
  const noTrafficAction = monitoringConfig?.noTrafficAction ?? "hold";
  const multipleExposureAction =
    monitoringConfig?.multipleExposureAction ?? "hold";

  const stepEnteredAt = schedule.currentStepEnteredAt;
  if (stepEnteredAt && step?.trigger.type === "interval") {
    const stepElapsedMs = now.getTime() - stepEnteredAt.getTime();
    const stepDurationMs = step.trigger.seconds * 1000;
    if (stepElapsedMs < stepDurationMs) {
      const remainingMin = Math.ceil((stepDurationMs - stepElapsedMs) / 60_000);
      return {
        action: "hold",
        reason: `Monitored step: ~${remainingMin} min remaining in hold interval`,
        nextProcessAt: new Date(stepEnteredAt.getTime() + stepDurationMs),
      };
    }
  }

  const intervalEndAt =
    stepEnteredAt && step?.trigger.type === "interval"
      ? new Date(stepEnteredAt.getTime() + step.trigger.seconds * 1000)
      : null;
  const requiredSnapshotAt =
    intervalEndAt ?? stepEnteredAt ?? schedule.startedAt;

  const safeRollout = await ctx.models.safeRollout.getById(
    schedule.safeRolloutId,
  );
  if (!safeRollout) {
    return {
      action: "hold",
      reason: "No linked SafeRollout — waiting for monitoring to be attached",
    };
  }

  const metricGroups = await ctx.models.metricGroups.getAll();
  const expandedGuardrailIds = expandMetricGroups(
    monitoringConfig?.guardrailMetricIds ?? [],
    metricGroups,
  );
  const expandedSignalIds = expandMetricGroups(
    monitoringConfig?.signalMetricIds ?? [],
    metricGroups,
  );

  const signalOnly = expandedSignalIds.filter(
    (id) => !expandedGuardrailIds.includes(id),
  );

  const summarySnapshot = safeRollout.analysisSummary?.snapshotId
    ? await ctx.models.safeRolloutSnapshots.getById(
        safeRollout.analysisSummary.snapshotId,
      )
    : null;
  // Bumped on ramp restart so prior-run snapshots can't gate the new run.
  const analysisFloor =
    safeRollout.analysisStartedAt ?? safeRollout.startedAt ?? null;
  const hasCurrentAnalysis =
    !!requiredSnapshotAt &&
    summarySnapshot?.status === "success" &&
    summarySnapshot.dateCreated >= requiredSnapshotAt &&
    (!analysisFloor || summarySnapshot.dateCreated >= analysisFloor);

  if (!hasCurrentAnalysis) {
    return {
      action: "hold",
      reason: requiredSnapshotAt
        ? "Waiting for analysis results that cover the current monitored step"
        : "Waiting for monitoring step start time",
    };
  }

  const summary = safeRollout.analysisSummary;
  if (!summary?.health) {
    return { action: "hold", reason: "Waiting for analysis results" };
  }

  const scheduleLevelDecision = checkScheduleGuardrailSignals(
    safeRollout,
    expandedGuardrailIds,
  );
  if (scheduleLevelDecision) return scheduleLevelDecision;

  const experimentHealthDecision = checkExperimentHealth(
    ctx,
    safeRollout,
    srmAction,
    multipleExposureAction,
  );
  if (experimentHealthDecision) return experimentHealthDecision;

  if (!summary.health.totalUsers) {
    const monitoringStartDate =
      schedule.monitoringStartDate ??
      schedule.currentStepEnteredAt ??
      schedule.startedAt;
    if (monitoringStartDate) {
      const elapsedMs = now.getTime() - monitoringStartDate.getTime();
      if (elapsedMs < MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS) {
        const remainingMin = Math.ceil(
          (MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS - elapsedMs) / 60_000,
        );
        return {
          action: "hold",
          reason: `No traffic yet — waiting for 24h monitoring grace period (~${remainingMin} min remaining)`,
          nextProcessAt: new Date(
            monitoringStartDate.getTime() +
              MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS,
          ),
        };
      }
    }

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
    logger.warn(
      { safeRolloutId: safeRollout.id },
      "No traffic detected on monitored step (noTrafficAction=warn)",
    );
  }

  const resultsStatus = summary.resultsStatus;
  if (!resultsStatus) {
    return { action: "hold", reason: "No results status available yet" };
  }

  const totalUsers = summary.health.totalUsers ?? 0;
  const minSampleSize = step?.holdConditions?.minSampleSize;
  if (minSampleSize && totalUsers < minSampleSize) {
    return {
      action: "hold",
      reason: `Waiting for minimum sample size (${totalUsers}/${minSampleSize})`,
    };
  }

  const signalDecision = checkSignalMetricGating(safeRollout, signalOnly);
  if (signalDecision) return signalDecision;

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

export async function applyRampEvaluationDecision(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  decision: EvalDecision,
): Promise<{ handled: boolean; schedule: RampScheduleInterface }> {
  if (decision.action === "rollback") {
    logger.info(
      { scheduleId: schedule.id, reason: decision.reason },
      "Evaluator triggered rollback",
    );
    const updated = await rollbackSchedule(ctx, schedule, decision.reason);
    return { handled: true, schedule: updated };
  }
  if (decision.action === "pause") {
    logger.info(
      { scheduleId: schedule.id, reason: decision.reason },
      "Evaluator triggered pause",
    );
    const updated = await pauseSchedule(ctx, schedule, decision.reason);
    return { handled: true, schedule: updated };
  }
  if (decision.action === "hold") {
    const nextProcessAt = computeNextProcessAt({
      status: schedule.status,
      nextStepAt: decision.nextProcessAt ?? null,
      nextSnapshotAt: schedule.nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
    });
    const updated = await ctx.models.rampSchedules.updateById(schedule.id, {
      nextProcessAt,
    });
    logger.info(
      {
        scheduleId: schedule.id,
        reason: decision.reason,
        nextProcessAt: nextProcessAt?.toISOString() ?? null,
      },
      "Evaluator holding step",
    );
    return { handled: true, schedule: updated };
  }

  const updated = await advanceStep(ctx, schedule);
  return { handled: false, schedule: updated };
}

export async function evaluateRampScheduleAfterSafeRolloutSnapshot(
  ctx: ReqContext,
  safeRollout: SafeRolloutInterface,
  now: Date = new Date(),
): Promise<void> {
  if (!safeRollout.rampScheduleId) return;
  const schedule = await ctx.models.rampSchedules.getById(
    safeRollout.rampScheduleId,
  );
  if (!schedule || schedule.status !== "running") return;
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step?.monitored) return;

  const decision = await evaluateCurrentStep(ctx, schedule, now);
  await applyRampEvaluationDecision(ctx, schedule, decision);
}

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
        nextProcessAt: new Date(stepEnteredAt.getTime() + hold.minDurationMs),
      };
    }
  }

  return null;
}
