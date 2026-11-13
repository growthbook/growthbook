import { getRampRetry, isAwaitingStartApproval } from "shared/validators";
import type { RampScheduleInterface } from "shared/validators";
import { isRampScheduleServing } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  appendRampEvent,
  applyRampStartActions,
  completeRollout,
  computeNextProcessAt,
  dispatchRampEvent,
  ensureRampStartActions,
  ensureSafeRolloutForMonitoredRamp,
  onActivatingRevisionPublished,
  recordRampStepFailure,
} from "back-end/src/services/rampSchedule";
import {
  applyRampEvaluationDecision,
  evaluateCurrentStep,
} from "back-end/src/services/rampScheduleEvaluator";
import {
  ConflictError,
  RampAdvanceLockBusyError,
} from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";

export function getActivatingVersion(schedule: {
  targets: { activatingRevisionVersion?: number | null }[];
}): number | null {
  const v = schedule.targets.find(
    (t) =>
      t.activatingRevisionVersion !== undefined &&
      t.activatingRevisionVersion !== null,
  )?.activatingRevisionVersion;
  return v ?? null;
}

// One scheduler pass, run under the schedule's advance lock. A failure backs
// off or pauses the schedule; returns when the next attempt is due, or null.
export async function runRampScheduleTick(
  context: ReqContext | ApiReqContext,
  rampScheduleId: string,
  now: Date,
  heartbeat: () => Promise<void>,
): Promise<Date | null> {
  const schedule = await context.models.rampSchedules.getById(rampScheduleId);
  if (!schedule) return null;
  try {
    await attemptRampScheduleTick(context, schedule, now, heartbeat);
    return null;
  } catch (e) {
    // A lost lease means another holder owns the schedule now.
    if (e instanceof RampAdvanceLockBusyError) {
      logger.info(
        { rampScheduleId },
        "Ramp schedule tick lost its advance lock — leaving it to the holder",
      );
      return null;
    }
    const failed = await context.models.rampSchedules.getById(rampScheduleId);
    return (failed && getRampRetry(failed)?.retryAt) ?? null;
  }
}

// Runs the scheduler's next move now for a schedule backing off after a failed
// step. Another failure counts as an attempt and reaches the caller.
export async function retryRampScheduleNow(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  heartbeat: () => Promise<void>,
): Promise<RampScheduleInterface> {
  if (!getRampRetry(schedule)) {
    throw new ConflictError(
      "Cannot retry: the failed step cleared while the request was in flight",
    );
  }
  // Authorized as the caller; runs as the scheduler would, so a read the
  // caller lacks can't refuse the step.
  const system = getContextForAgendaJobByOrgObject(context.org);
  await attemptRampScheduleTick(system, schedule, new Date(), heartbeat);
  return (await system.models.rampSchedules.getById(schedule.id)) ?? schedule;
}

// A failure is recorded, backing off or pausing the schedule, and rethrown; a
// clean pass clears the last failure.
async function attemptRampScheduleTick(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
  heartbeat: () => Promise<void>,
): Promise<void> {
  try {
    await tickRampSchedule(context, schedule, now, heartbeat);
  } catch (e) {
    if (!(e instanceof RampAdvanceLockBusyError)) {
      await recordRampStepFailure(context, schedule.id, e);
    }
    throw e;
  }
  if (schedule.stepFailure) {
    const recovered = await context.models.rampSchedules.updateById(
      schedule.id,
      { stepFailure: null },
    );
    await dispatchRampEvent(
      context,
      recovered,
      "rampSchedule.actions.stepRecovered",
      {
        object: {
          rampScheduleId: recovered.id,
          rampName: recovered.name,
          orgId: context.org.id,
          currentStepIndex: recovered.currentStepIndex,
          status: recovered.status,
          attempts: schedule.stepFailure.attempts,
        },
      },
    );
  }
}

async function tickRampSchedule(
  context: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  now: Date,
  heartbeat: () => Promise<void>,
) {
  let current = schedule;

  if (current.status === "pending") {
    const activatingVersion = getActivatingVersion(current);
    if (activatingVersion !== null) {
      const feature = current.entityId
        ? await getFeature(context, current.entityId)
        : undefined;
      if ((feature?.version ?? -1) >= activatingVersion) {
        // Activation runs start actions + a catch-up publish — refresh the
        // lease before this potentially slow multi-publish phase.
        await heartbeat();
        await onActivatingRevisionPublished(context, current);
        current =
          (await context.models.rampSchedules.getById(current.id)) ?? current;
      }
    }
    if (current.status === "pending") return;
  }

  current = await ensureRampStartActions(context, current);

  if (
    current.status === "ready" &&
    current.startDate &&
    current.startDate <= now &&
    // An approval-gated schedule holds even past its startDate until approved.
    !isAwaitingStartApproval(current)
  ) {
    const initialNextStepAt = current.steps.length > 0 ? now : null;
    current = await context.models.rampSchedules.updateById(current.id, {
      status: "running",
      startedAt: now,
      phaseStartedAt: now,
      monitoringStartDate: null,
      nextStepAt: initialNextStepAt,
      nextProcessAt: computeNextProcessAt({
        status: "running",
        nextStepAt: initialNextStepAt,
        cutoffDate: current.cutoffDate,
      }),
      eventHistory: appendRampEvent(current, "started", {
        stepIndex: -1,
        status: "running",
        previousStatus: current.status,
        reason: "Scheduled start",
      }),
    });
    await applyRampStartActions(context, current);
    // For ready->running, SR creation/sync happens in the "running" block
    // below in the same tick, so we don't need to wait another scheduler
    // tick to pick it up. Pending->running may already have done this inline
    // via onActivatingRevisionPublished.
  } else if (
    current.status === "running" &&
    current.steps.length === 0 &&
    current.stepFailure &&
    !(current.cutoffDate && current.cutoffDate <= now)
  ) {
    // A schedule without steps enables its rule with its start actions, after
    // it is already running; a failed start is retried here, unless its window
    // has already closed.
    await applyRampStartActions(context, current);
  }

  if (
    current.cutoffDate &&
    current.cutoffDate <= now &&
    isRampScheduleServing(current)
  ) {
    await completeRollout(context, current, {
      disableActiveTargets: true,
    });
    return;
  }

  if (current.status !== "running") return;

  current = await ensureSafeRolloutForMonitoredRamp(context, current);

  const decision = await evaluateCurrentStep(context, current, now);
  // Refresh the lease between the slow evaluation and slow publish phases.
  await heartbeat();
  await applyRampEvaluationDecision(context, current, decision, now);
}
