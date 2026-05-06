import {
  RampScheduleInterface,
  SafeRolloutInterface,
  StepHoldConditions,
} from "shared/validators";
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
  | { action: "rollback"; reason: string };

// Evaluates the current step of a running ramp schedule.
// Returns a decision: advance, hold, or rollback.
export async function evaluateCurrentStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
): Promise<EvalDecision> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) return { action: "advance" };

  // Monitored steps are driven by the snapshot pipeline rather than
  // the interval timer. The evaluator triggers snapshots, checks
  // health, and gates advancement on both interval + healthy results.
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

  // Check for rollback signal from the analysis summary.
  const rollbackDecision = checkRollbackSignal(safeRollout);
  if (rollbackDecision) return rollbackDecision;

  // Trigger a new snapshot if the query interval has elapsed.
  await maybeTriggerSnapshot(ctx, schedule, safeRollout, now);

  // Check if the step interval has elapsed.
  const stepEnteredAt = schedule.currentStepEnteredAt;
  const step = schedule.steps[schedule.currentStepIndex];
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

  // Step interval has elapsed. Check for a healthy snapshot that was
  // completed AFTER the step interval expired. This ensures the
  // analysis covers the full step duration.
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

  // We have a post-interval snapshot. Check if it's healthy.
  const summary = safeRollout.analysisSummary;
  if (!summary?.health?.totalUsers) {
    return { action: "hold", reason: "Waiting for analysis results" };
  }

  const resultsStatus = summary.resultsStatus;
  if (!resultsStatus) {
    return { action: "hold", reason: "No results status available yet" };
  }

  // Check additional hold conditions (minSampleSize, requireHealthy, etc.)
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

function checkRollbackSignal(
  safeRollout: SafeRolloutInterface,
): EvalDecision | null {
  const summary = safeRollout.analysisSummary;
  if (!summary?.resultsStatus) return null;

  // Check if any guardrail metric is a statistically significant loser.
  // This mirrors the rollback logic in checkAndRollbackSafeRollout.
  for (const [metricId, status] of Object.entries(summary.resultsStatus)) {
    if (status.variationResults) {
      for (const vr of status.variationResults) {
        if (vr.significant && vr.loser) {
          return {
            action: "rollback",
            reason: `Guardrail metric ${metricId} is a significant loser`,
          };
        }
      }
    }
  }

  return null;
}

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
    // Dynamically import to avoid circular dependency at module load time.
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

    // Advance nextSnapshotAt so the job wakes up again after the next interval.
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

  if (hold.requireHealthy) {
    // For monitored steps, health is checked via the snapshot pipeline above.
    // For unmonitored steps with requireHealthy, this is a no-op until
    // we wire up an independent health check mechanism.
  }

  if (hold.minSampleSize) {
    // TODO: Check sample size from the analysis summary.
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
