import {
  RampScheduleInterface,
  SafeRolloutInterface,
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
import {
  MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS,
  advanceStep,
  completeRollout,
  computeAutoAdvanceTarget,
  computeNextProcessAt,
  pauseSchedule,
  rollbackSchedule,
  withRampScheduleAdvanceLockRetry,
} from "back-end/src/services/rampSchedule";
import {
  NotFoundError,
  RampAdvanceLockBusyError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

export type EvalDecision =
  | { action: "advance" }
  | {
      action: "hold";
      reason: string;
      nextProcessAt?: Date | null;
      // True only when the *single* remaining gate is the step's approval hold,
      // i.e. every other condition (interval timer, fresh analysis, traffic,
      // guardrails/health, min sample size, signal metrics) has already cleared.
      // This is what makes approval the final gate: the UI only prompts and the
      // API only accepts an approval once awaitingApproval is set.
      awaitingApproval?: boolean;
    }
  | { action: "rollback"; reason: string }
  | { action: "pause"; reason: string };

export async function evaluateCurrentStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<EvalDecision> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) {
    // No current step. This happens in two cases:
    //  1. 0-step simple schedules at currentStepIndex -1 (no steps to run)
    //  2. Multi-step ramps where currentStepIndex is past the last step
    //     (all steps done, waiting for cutoffDate to fire the disable)
    //
    // In both cases, if there's a future cutoffDate we hold until it arrives.
    // Without this guard, returning "advance" causes advanceStep → completeRollout,
    // which would end the schedule without honoring the configured end date.
    //
    // Multi-step ramps at currentStepIndex -1 with steps still to run are NOT
    // caught here: nextStepIndex 0 < steps.length, so the guard doesn't fire.
    const nextStepIndex = schedule.currentStepIndex + 1;
    if (
      nextStepIndex >= schedule.steps.length &&
      schedule.cutoffDate &&
      schedule.cutoffDate > now
    ) {
      return {
        action: "hold",
        reason: "Waiting for scheduled end date",
        nextProcessAt: schedule.cutoffDate,
      };
    }
    return { action: "advance" };
  }

  if (step.monitored) {
    const decision = await evaluateMonitoredStep(ctx, schedule, now);
    return decision;
  }

  // Non-monitored step. Enforce the interval time hold BEFORE the approval
  // hold so that approval is the *final* gate of a composite step
  // (interval + requiresApproval). `nextStepAt` is the step's timer, set by
  // advanceStep via computeNextStepAt; it is null for steps with no interval
  // (pure approval / instant gates).
  //
  // This ordering is what lets isCurrentStepReadyForApproval distinguish "still
  // counting down" from "ready to approve": while the timer is pending we
  // return this interval hold (not the approval hold), so a premature approval
  // is rejected rather than recorded. It also defends the agenda advance path —
  // though in practice the agenda only ticks once nextProcessAt (the min of
  // nextStepAt and other gates) is due, so nextStepAt <= now by then.
  if (schedule.nextStepAt && schedule.nextStepAt > now) {
    return {
      action: "hold",
      reason: "Waiting for the step interval to elapse",
      nextProcessAt: schedule.nextStepAt,
    };
  }

  if (
    step.holdConditions?.requiresApproval &&
    schedule.stepApproval?.stepIndex !== schedule.currentStepIndex
  ) {
    return {
      action: "hold",
      reason: "Awaiting approval",
      awaitingApproval: true,
    };
  }

  // `minSampleSize` is intentionally not checked here. It requires snapshot
  // data, which is only available on monitored steps (handled above by
  // evaluateMonitoredStep). A non-monitored step with minSampleSize set has
  // no data source to evaluate against, so the gate is a no-op. See the
  // stepHoldConditions schema comment for the full explanation.
  return { action: "advance" };
}

async function evaluateMonitoredStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<EvalDecision> {
  if (!schedule.safeRolloutId) {
    // No SafeRollout linked yet. If there are no metrics configured there is
    // nothing to evaluate — advance immediately so the step doesn't strand.
    // Otherwise hold until ensureSafeRolloutForMonitoredRamp attaches one.
    const mc = schedule.monitoringConfig;
    const hasMetrics =
      (mc?.guardrailMetricIds?.length ?? 0) > 0 ||
      (mc?.signalMetricIds?.length ?? 0) > 0;
    if (!hasMetrics) {
      return { action: "advance" };
    }
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
  const stepIntervalSeconds = step?.interval ?? null;
  if (stepEnteredAt && stepIntervalSeconds !== null) {
    const stepElapsedMs = now.getTime() - stepEnteredAt.getTime();
    const stepDurationMs = stepIntervalSeconds * 1000;
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
    stepEnteredAt && stepIntervalSeconds !== null
      ? new Date(stepEnteredAt.getTime() + stepIntervalSeconds * 1000)
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

  // No-traffic gate runs before guardrail/health/results checks: with zero
  // users those downstream analyses are unreliable, so we resolve the
  // no-traffic state explicitly first (grace period -> terminal action).
  if (!summary.health.totalUsers) {
    const monitoringStartDate =
      schedule.monitoringStartDate ??
      schedule.currentStepEnteredAt ??
      schedule.startedAt;
    if (monitoringStartDate) {
      const configuredHours =
        schedule.monitoringConfig?.noTrafficGracePeriodHours ?? null;
      const gracePeriodMs =
        configuredHours !== null
          ? configuredHours * 60 * 60 * 1000
          : MONITORING_NO_TRAFFIC_GRACE_PERIOD_MS;
      const elapsedMs = now.getTime() - monitoringStartDate.getTime();
      if (elapsedMs < gracePeriodMs) {
        const remainingMin = Math.ceil((gracePeriodMs - elapsedMs) / 60_000);
        const gracePeriodHours = gracePeriodMs / (60 * 60 * 1000);
        return {
          action: "hold",
          reason: `No traffic yet — waiting for ${gracePeriodHours}h monitoring grace period (~${remainingMin} min remaining)`,
          nextProcessAt: new Date(
            monitoringStartDate.getTime() + gracePeriodMs,
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
    // "warn": surfaced via UI monitoring badges only; don't gate progression.
    return { action: "advance" };
  }

  // Guardrail and experiment-health checks intentionally run before the
  // per-step minSampleSize gate. This is by design:
  //
  //  • Guardrails are schedule-level safety nets (e.g. "never harm revenue"),
  //    not step-level advancement criteria. Waiting for a minimum sample size
  //    before acting on a confirmed loser would leave a harmful variant running
  //    longer than necessary. A rollback on a small sample is conservative and
  //    reversible; failing to roll back on a small sample is not.
  //
  //  • SRM/multiple-exposure health signals are also automatic global actions:
  //    they indicate a fundamentally broken experiment setup that more data
  //    cannot fix. Delaying on a sample-size gate would only accumulate more
  //    bad data.
  //
  //  • minSampleSize is a step-level hold condition — it gates advancement to
  //    the *next* step, not the decision to protect users *in the current step*.
  //    Signal metrics (which can only hold, not roll back) are correctly placed
  //    after minSampleSize because they are advancement quality checks.
  //
  // TL;DR: automatic global actions (rollbacks) win over stepwise hold
  // conditions. Holds are advisory; rollbacks are protective.
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

  const resultsStatus = summary.resultsStatus;
  if (!resultsStatus) {
    return { action: "hold", reason: "No results status available yet" };
  }

  // minSampleSize is a step-level advancement gate: it prevents the evaluator
  // from treating an underpowered snapshot as a green light to advance.
  // Signal metric gating is also placed after this check for the same reason —
  // both are quality-of-evidence holds that only apply once enough data exists.
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

  if (
    step?.holdConditions?.requiresApproval &&
    schedule.stepApproval?.stepIndex !== schedule.currentStepIndex
  ) {
    return {
      action: "hold",
      reason: "Awaiting approval",
      awaitingApproval: true,
    };
  }

  return { action: "advance" };
}

/**
 * Determines whether the current step is ready for a manual approval.
 *
 * Approval is the *final* gate: a step may only be approved once every other
 * hold condition has cleared. Concretely this means the interval timer has
 * elapsed and — for monitored steps — fresh analysis covering the step is
 * available and no automatic rollback/hold signal is active. We derive this
 * from `evaluateCurrentStep`, which checks approval last and only returns
 * `awaitingApproval` when it is the sole remaining gate.
 *
 * Returns `{ ready: true }` when an approval should be prompted/accepted, or
 * `{ ready: false, reason }` describing the gate that still needs to clear.
 */
export async function isCurrentStepReadyForApproval(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<{ ready: boolean; reason?: string }> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step?.holdConditions?.requiresApproval) {
    return { ready: false, reason: "Step does not require approval" };
  }
  if (schedule.stepApproval?.stepIndex === schedule.currentStepIndex) {
    return { ready: false, reason: "Step has already been approved" };
  }

  const decision = await evaluateCurrentStep(ctx, schedule, now);
  if (decision.action === "hold" && decision.awaitingApproval) {
    return { ready: true };
  }

  // Any other decision means a non-approval gate is still active (interval
  // timer, missing/stale analysis, no traffic, min sample size, signal hold)
  // or the step is failing (rollback). Surface that as the rejection reason.
  const reason =
    "reason" in decision
      ? decision.reason
      : "Step is not ready for approval yet";
  return { ready: false, reason };
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
    if (srmAction === "rollback") {
      return {
        action: "rollback",
        reason: `Experiment health: SRM check failed (p=${summary.health.srm.toFixed(4)})`,
      };
    }
    if (srmAction === "hold") {
      return {
        action: "hold",
        reason: `Experiment health: SRM check failed — holding step (p=${summary.health.srm.toFixed(4)})`,
      };
    }
    // "warn": surfaced via the UI monitoring badges; not a backend gate.
  }

  const meData = getMultipleExposureHealthData({
    multipleExposuresCount: summary.health.multipleExposures ?? 0,
    totalUsersCount: totalUsers,
    minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
    minPercentThreshold: healthSettings.multipleExposureMinPercent,
  });

  if (meData.status === "unhealthy") {
    if (meAction === "rollback") {
      return {
        action: "rollback",
        reason: `Experiment health: multiple exposures detected (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
      };
    }
    if (meAction === "hold") {
      return {
        action: "hold",
        reason: `Experiment health: multiple exposures detected — holding step (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
      };
    }
    // "warn": surfaced via the UI monitoring badges; not a backend gate.
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
  // The clock the decision was evaluated against — reused for the fold so the
  // advance is internally consistent with the caller's cutoff/dueness checks.
  now: Date = new Date(),
): Promise<RampScheduleInterface> {
  if (decision.action === "rollback") {
    return rollbackSchedule(ctx, schedule, decision.reason);
  }
  if (decision.action === "pause") {
    return pauseSchedule(ctx, schedule, decision.reason);
  }
  if (decision.action === "hold") {
    const nextProcessAt = computeNextProcessAt({
      status: schedule.status,
      nextStepAt: decision.nextProcessAt ?? null,
      nextSnapshotAt: schedule.nextSnapshotAt,
      cutoffDate: schedule.cutoffDate,
    });
    return ctx.models.rampSchedules.updateById(schedule.id, {
      nextProcessAt,
    });
  }

  // Fold the verified advance and any due backlog into a single jump publish.
  // The +1 forces past-end schedules into advanceStep's completion branch; the
  // unconditional first hop doubles as the unstick mechanism for broken
  // nextStepAt states.
  const target = Math.max(
    computeAutoAdvanceTarget(schedule, now, { currentStepCleared: true }),
    schedule.currentStepIndex + 1,
  );
  return advanceStep(ctx, schedule, target);
}

export async function evaluateRampScheduleAfterSafeRolloutSnapshot(
  ctx: ReqContext,
  safeRollout: SafeRolloutInterface,
  now: Date = new Date(),
): Promise<void> {
  if (!safeRollout.rampScheduleId) return;
  const rampScheduleId = safeRollout.rampScheduleId;

  // Pre-lock screen: don't pay lock writes for no-op snapshot completions.
  // Re-screened inside the lock.
  const screened = await ctx.models.rampSchedules.getById(rampScheduleId);
  if (!screened || screened.status !== "running") return;
  if (!screened.steps[screened.currentStepIndex]?.monitored) return;

  try {
    // Retry rather than skip: the busy holder may have read pre-snapshot data,
    // and dropping the evaluation would discard rollback decisions.
    await withRampScheduleAdvanceLockRetry(ctx, rampScheduleId, async () => {
      const schedule = await ctx.models.rampSchedules.getById(rampScheduleId);
      if (!schedule || schedule.status !== "running") return;

      // Mirror the tick's cutoff branch: a lapsed cutoff must complete-with-
      // disable, never raise coverage further.
      if (schedule.cutoffDate && schedule.cutoffDate <= now) {
        await completeRollout(ctx, schedule, { disableActiveTargets: true });
        return;
      }

      const step = schedule.steps[schedule.currentStepIndex];
      if (!step?.monitored) return;

      const decision = await evaluateCurrentStep(ctx, schedule, now);
      await applyRampEvaluationDecision(ctx, schedule, decision, now);
    });
  } catch (e) {
    if (e instanceof NotFoundError) return;
    if (!(e instanceof RampAdvanceLockBusyError)) throw e;
    logger.info(
      { rampScheduleId },
      "Skipping post-snapshot ramp evaluation — advance lock still held after retries",
    );
  }
}
