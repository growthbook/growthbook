import Agenda, { Job } from "agenda";
import { isAwaitingStartApproval } from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  appendRampEvent,
  applyRampStartActions,
  completeRollout,
  computeNextProcessAt,
  ensureSafeRolloutForMonitoredRamp,
  onActivatingRevisionPublished,
  syncLinkedSafeRolloutForRampState,
  withRampScheduleAdvanceLock,
} from "back-end/src/services/rampSchedule";
import {
  applyRampEvaluationDecision,
  evaluateCurrentStep,
} from "back-end/src/services/rampScheduleEvaluator";
import { RampAdvanceLockBusyError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { RampScheduleModel } from "back-end/src/models/RampScheduleModel";

/**
 * Transient errors should be silently retried on the next scheduler tick.
 * Structural / programming errors still pause the schedule so they surface
 * in the UI.
 */
function isTransientRampError(e: unknown): boolean {
  if (e instanceof RampAdvanceLockBusyError) return true;
  // Mongo network / topology errors surface as generic Errors whose name or
  // message contains well-known driver strings.
  if (e instanceof Error) {
    const name = e.name ?? "";
    const msg = e.message ?? "";
    if (
      name.includes("MongoNetwork") ||
      name.includes("MongoTopology") ||
      name.includes("MongoServerSelection") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("connection timed out")
    ) {
      return true;
    }
  }
  return false;
}

type AdvanceSingleRampScheduleJob = Job<{
  rampScheduleId: string;
  organization: string;
}>;

export const QUEUE_RAMP_SCHEDULE_ADVANCES = "queueRampScheduleAdvances";
const ADVANCE_SINGLE_RAMP_SCHEDULE = "advanceSingleRampSchedule";

const RAMP_POLL_INTERVAL_MINUTES = 1;

async function queueRampScheduleAdvance(
  agenda: Agenda,
  schedule: { id: string; organization: string },
) {
  const job = agenda.create(ADVANCE_SINGLE_RAMP_SCHEDULE, {
    rampScheduleId: schedule.id,
    organization: schedule.organization,
  }) as AdvanceSingleRampScheduleJob;
  job.unique({
    rampScheduleId: schedule.id,
    organization: schedule.organization,
  });
  job.schedule(new Date());
  await job.save();
}

export default async function addRampScheduleJob(agenda: Agenda) {
  agenda.define(QUEUE_RAMP_SCHEDULE_ADVANCES, async () => {
    const now = new Date();
    const due = await RampScheduleModel.dangerouslyFindAllDueSchedules(now);
    for (const { id, organization } of due) {
      try {
        await queueRampScheduleAdvance(agenda, { id, organization });
      } catch (e) {
        logger.error(
          e,
          `Error queuing ramp schedule ${id} for org ${organization}`,
        );
      }
    }
  });

  agenda.define(ADVANCE_SINGLE_RAMP_SCHEDULE, advanceSingleRampSchedule);
  const job = agenda.create(QUEUE_RAMP_SCHEDULE_ADVANCES, {});
  job.unique({});
  job.repeatEvery(`${RAMP_POLL_INTERVAL_MINUTES} minutes`);
  await job.save();
}

function getActivatingVersion(schedule: {
  targets: { activatingRevisionVersion?: number | null }[];
}): number | null {
  const v = schedule.targets.find(
    (t) =>
      t.activatingRevisionVersion !== undefined &&
      t.activatingRevisionVersion !== null,
  )?.activatingRevisionVersion;
  return v ?? null;
}

export const advanceSingleRampSchedule = async (
  job: AdvanceSingleRampScheduleJob,
) => {
  const rampScheduleId = job.attrs.data?.rampScheduleId;
  const organization = job.attrs.data?.organization;
  if (!rampScheduleId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const now = new Date();

  // Pre-lock screen: the pending poll is time-unbounded (a schedule can await
  // its draft publish for weeks) and shouldn't pay two lock writes per minute.
  // Screening errors skip the tick rather than failing the agenda job — the
  // in-lock body re-reads everything and owns the error-pause semantics.
  try {
    const screened = await context.models.rampSchedules.getById(rampScheduleId);
    if (!screened) return;
    // A ready schedule held for start approval never advances from a poll (it
    // waits for the approve action). Skip it here so a held schedule that still
    // carries a past startDate isn't lock-cycled every tick. A *pending*
    // approval-gated schedule is different: it still needs its activating-
    // revision transition (which is what establishes the hold), so let it fall
    // through to the pending-recovery block below — otherwise a publish hook
    // that deferred to the scheduler leaves it stuck pending forever.
    if (screened.status !== "pending" && isAwaitingStartApproval(screened)) {
      return;
    }
    if (screened.status === "pending") {
      const activatingVersion = getActivatingVersion(screened);
      if (activatingVersion === null) return;
      const feature = screened.entityId
        ? await getFeature(context, screened.entityId)
        : undefined;
      if ((feature?.version ?? -1) < activatingVersion) return;
    }
  } catch (e) {
    logger.warn(
      { rampScheduleId, error: e instanceof Error ? e.message : String(e) },
      "Error screening ramp schedule — skipping tick; will retry next poll",
    );
    return;
  }

  // If another advance holds the lock, skip this tick — the schedule's
  // nextProcessAt keeps it queued for a retry.
  try {
    await withRampScheduleAdvanceLock(
      context,
      rampScheduleId,
      async (heartbeat) => {
        await runRampScheduleTick(context, rampScheduleId, now, heartbeat);
      },
    );
  } catch (e) {
    if (e instanceof RampAdvanceLockBusyError) {
      logger.info(
        { rampScheduleId },
        "Skipping ramp schedule tick — advance already in progress",
      );
      return;
    }
    throw e;
  }
};

async function runRampScheduleTick(
  context: Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>,
  rampScheduleId: string,
  now: Date,
  heartbeat: () => Promise<void>,
) {
  try {
    const schedule = await context.models.rampSchedules.getById(rampScheduleId);
    if (!schedule) return;

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
    }

    if (
      current.cutoffDate &&
      current.cutoffDate <= now &&
      ["running", "paused"].includes(current.status)
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
  } catch (e) {
    // Transient errors (network blips, lock contention) — log and let the
    // next scheduler tick retry.
    if (isTransientRampError(e)) {
      logger.info(
        { rampScheduleId },
        `Transient error advancing ramp schedule — will retry next tick: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    logger.error(e, `Error advancing ramp schedule ${rampScheduleId}`);
    // Structural / unrecoverable error — pause and surface in UI event history.
    const errorSchedule =
      await context.models.rampSchedules.getById(rampScheduleId);
    const updated = await context.models.rampSchedules.updateById(
      rampScheduleId,
      {
        status: "paused",
        nextSnapshotAt: null,
        nextProcessAt: null,
        ...(errorSchedule
          ? {
              eventHistory: appendRampEvent(errorSchedule, "error-paused", {
                stepIndex: errorSchedule.currentStepIndex,
                status: "paused",
                previousStatus: errorSchedule.status,
                reason: e instanceof Error ? e.message : String(e),
              }),
            }
          : {}),
      },
    );
    if (errorSchedule) {
      try {
        await syncLinkedSafeRolloutForRampState(context, updated);
      } catch (syncErr) {
        logger.warn(
          { rampScheduleId, error: (syncErr as Error).message },
          "Failed to sync SafeRollout after error-pausing schedule; SafeRollout may be temporarily diverged",
        );
      }
    }
  }
}
