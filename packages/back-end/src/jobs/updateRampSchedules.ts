import Agenda, { Job } from "agenda";
import { isAwaitingStartApproval } from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { withRampScheduleAdvanceLock } from "back-end/src/services/rampSchedule";
import {
  getActivatingVersion,
  runRampScheduleTick,
} from "back-end/src/services/rampScheduleTick";
import { RampAdvanceLockBusyError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { RampScheduleModel } from "back-end/src/models/RampScheduleModel";

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
    // A failed step waits out its backoff; the poll keeps finding it due.
    const backoffUntil = screened.stepFailure?.retryAt;
    if (backoffUntil && backoffUntil > now) {
      job.schedule(backoffUntil);
      return;
    }
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
  let retryAt: Date | null;
  try {
    retryAt = await withRampScheduleAdvanceLock(
      context,
      rampScheduleId,
      (heartbeat) =>
        runRampScheduleTick(context, rampScheduleId, now, heartbeat),
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
  // The poll runs once a minute; rescheduling this job lets the first retries
  // land seconds apart.
  if (retryAt) job.schedule(retryAt);
};
