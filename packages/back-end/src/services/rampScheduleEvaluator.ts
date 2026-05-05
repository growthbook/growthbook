import { RampScheduleInterface, StepHoldConditions } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

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

  // TODO: Check rollback rules once monitoring is wired through
  // attach-monitoring actions and linked SafeRollout analysis.

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
