import {
  RampScheduleInterface,
  MonitoringConfig,
  StepHoldConditions,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";

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

  const holdConditions = step.holdConditions;
  const monitoring = schedule.monitoringConfig;

  // Check rollback rules first (they take priority)
  if (step.monitored && monitoring) {
    const rollbackDecision = await checkRollbackRules(
      ctx,
      schedule,
      monitoring,
    );
    if (rollbackDecision) return rollbackDecision;
  }

  // Check hold conditions
  if (holdConditions) {
    const holdDecision = checkHoldConditions(schedule, holdConditions, now);
    if (holdDecision) return holdDecision;
  }

  return { action: "advance" };
}

function checkHoldConditions(
  schedule: RampScheduleInterface,
  hold: StepHoldConditions,
  now: Date,
): EvalDecision | null {
  const stepEnteredAt = schedule.currentStepEnteredAt;
  if (!stepEnteredAt) return null;

  // Min duration hold
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

  // Require healthy guardrails before advancing
  if (hold.requireHealthy) {
    // TODO: Query safe rollout analysis summary for current guardrail health.
    // For now, this is a placeholder that will integrate with the
    // SafeRolloutInterface's analysisSummary once the monitoring pipeline
    // is wired up.
  }

  // Min sample size
  if (hold.minSampleSize) {
    // TODO: Check sample size from the analysis summary.
    // This requires integration with the safe rollout snapshot system.
  }

  return null;
}

async function checkRollbackRules(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  monitoring: MonitoringConfig,
): Promise<EvalDecision | null> {
  if (!monitoring.rollbackRules?.length) return null;

  // TODO: Fetch latest analysis results from the linked SafeRolloutInterface
  // and compare against each rollback rule's thresholds.
  //
  // The flow:
  // 1. Find the SafeRollout linked to this schedule (via attach-monitoring action)
  // 2. Read its analysisSummary
  // 3. For each rollbackRule, check if the metric's delta exceeds the threshold
  // 4. If any rule fires, return rollback/pause based on rule.action
  //
  // For now, we log and pass through.

  try {
    // Placeholder: actual implementation will query ctx.models.safeRollouts
    // and compare analysis results against monitoring.rollbackRules
    logger.debug(
      { scheduleId: schedule.id },
      "Rollback rule evaluation (stub)",
    );
  } catch (e) {
    logger.error(e, "Error evaluating rollback rules");
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

  if (!step.apiAdvance) {
    return {
      allowed: false,
      reason: "Current step does not allow API-driven advancement",
    };
  }

  return { allowed: true };
}
