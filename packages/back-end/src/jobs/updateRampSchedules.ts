import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  advanceUntilBlocked,
  applyStartConditionActions,
  completeRollout,
  computeNextStepAt,
  makeAttribution,
} from "back-end/src/services/rampSchedule";
import { IS_CLOUD } from "back-end/src/util/secrets";

type AdvanceSingleRampScheduleJob = Job<{
  rampScheduleId: string;
  organization: string;
}>;

export const QUEUE_RAMP_SCHEDULE_ADVANCES = "queueRampScheduleAdvances";
const ADVANCE_SINGLE_RAMP_SCHEDULE = "advanceSingleRampSchedule";

/** Default polling interval in minutes — applies to Cloud and self-hosted
 * instances that have not overridden the setting. */
export const DEFAULT_RAMP_POLL_INTERVAL_MINUTES = 10;

/**
 * Cancel any existing outer ramp-schedule polling job and re-register it with
 * the given interval. Safe to call at any point after the job definitions have
 * been registered.  Cloud deployments are always locked to the default.
 */
export async function rescheduleRampScheduleJob(
  agenda: Agenda,
  intervalMinutes: number,
): Promise<void> {
  if (IS_CLOUD) {
    intervalMinutes = DEFAULT_RAMP_POLL_INTERVAL_MINUTES;
  }
  const clamped = Math.min(
    DEFAULT_RAMP_POLL_INTERVAL_MINUTES,
    Math.max(1, Math.round(intervalMinutes)),
  );

  // Cancel all existing recurring outer jobs so we don't end up with duplicates.
  await agenda.cancel({ name: QUEUE_RAMP_SCHEDULE_ADVANCES });

  const job = agenda.create(QUEUE_RAMP_SCHEDULE_ADVANCES, {});
  job.unique({});
  job.repeatEvery(`${clamped} minutes`);
  await job.save();

  logger.info(`Ramp schedule polling interval set to ${clamped} minute(s).`);
}

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

export default async function addRampScheduleJob(
  agenda: Agenda,
  initialIntervalMinutes: number = DEFAULT_RAMP_POLL_INTERVAL_MINUTES,
) {
  // Outer recurring job: poll for schedules due for advancement
  agenda.define(QUEUE_RAMP_SCHEDULE_ADVANCES, async () => {
    const now = new Date();

    // Collect all orgs with active ramp schedules that need processing.
    // Uses db.collection() directly since RampScheduleModel is a BaseModel (not mongoose.model).
    const mongoose = await import("mongoose");
    const scheduleDocs = await mongoose.default.connection.db
      .collection("rampschedules")
      .find(
        {
          $or: [
            // Running schedules with a step timer due
            { status: "running", nextStepAt: { $ne: null, $lte: now } },
            // Ready schedules with a scheduled start time that has passed — Agenda auto-starts these.
            // "immediately" and "manual" ready schedules are NOT started by Agenda:
            //   - "immediately" is started inline when the activating revision is published.
            //   - "manual" requires the user to click Start.
            {
              status: "ready",
              "startCondition.trigger.type": "scheduled",
              "startCondition.trigger.at": { $lte: now },
            },
            // Running/pending-approval schedules with a hard deadline due.
            // Paused schedules are excluded — the deadline is deferred until resumed.
            {
              status: { $in: ["running", "pending-approval"] },
              "endCondition.trigger.at": { $lte: now },
            },
          ],
        },
        { projection: { _id: 1, id: 1, organization: 1 } },
      )
      .toArray();

    for (const doc of scheduleDocs) {
      const d = doc as unknown as {
        id?: string;
        _id: unknown;
        organization: string;
      };
      await queueRampScheduleAdvance(agenda, {
        id: d.id || String(d._id),
        organization: d.organization,
      });
    }
  });

  // Inner job: advance or complete a single ramp schedule
  agenda.define(ADVANCE_SINGLE_RAMP_SCHEDULE, advanceSingleRampSchedule);

  // Register the outer job at the org-configured interval (default 10 minutes).
  // Self-hosted orgs can lower this to 1 minute via org settings; the interval
  // is re-registered at startup (reading the saved org setting) and again
  // whenever the org setting changes via putOrganization.
  await rescheduleRampScheduleJob(agenda, initialIntervalMinutes);
}

/**
 * Advance a running schedule through all steps that are currently due,
 * creating a separate revision for each step.
 *
 * The loop stops when:
 *   - The schedule leaves the "running" state (approval gate, completion, error)
 *   - No more steps remain (nextStepAt === null)
 *   - The next step is not yet due (nextStepAt > now)
 *   - A safety cap of schedule.steps.length iterations is reached
 *
 * Only non-intervention (interval) steps are advanced automatically.
 * Approval-trigger steps naturally break the loop because advanceStep sets
 * status to "pending-approval", which fails the loop's status check.
 */

export const advanceSingleRampSchedule = async (
  job: AdvanceSingleRampScheduleJob,
) => {
  const rampScheduleId = job.attrs.data?.rampScheduleId;
  const organization = job.attrs.data?.organization;
  if (!rampScheduleId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const schedule = await context.models.rampSchedules.getById(rampScheduleId);
  if (!schedule) return;

  const now = new Date();
  const scheduleAttribution = makeAttribution(
    undefined,
    "scheduled step advance",
    "system",
  );

  try {
    // Hard deadline — trumps everything else, but deferred while paused.
    if (
      schedule.endCondition?.trigger?.type === "scheduled" &&
      schedule.endCondition.trigger.at <= now &&
      ["running", "pending-approval"].includes(schedule.status)
    ) {
      await completeRollout(
        context,
        schedule,
        makeAttribution(undefined, "endCondition deadline reached", "system"),
      );
      return;
    }

    // Auto-start "ready" schedules whose startCondition.trigger.type === "scheduled" and at <= now.
    // "immediately" ramps are started inline when the activating revision is published.
    // "manual" ramps require an explicit user action (REST start endpoint).
    let current = schedule;
    if (
      current.status === "ready" &&
      current.startCondition?.trigger.type === "scheduled" &&
      current.startCondition.trigger.at <= now
    ) {
      // Hold-first: compute step 0's fire time before advancing.
      const initialNextStepAt =
        current.steps.length > 0
          ? computeNextStepAt(
              { ...current, phaseStartedAt: now, startedAt: now },
              0,
              now,
            )
          : null;
      current = await context.models.rampSchedules.updateById(current.id, {
        status: "running",
        startedAt: now,
        phaseStartedAt: now,
        nextStepAt: initialNextStepAt,
      });
      await applyStartConditionActions(context, current);
    }

    // Advance through all interval steps that have elapsed since the last poll.
    // Each step produces its own revision; approval steps stop the loop.
    await advanceUntilBlocked(context, current, now, scheduleAttribution);
  } catch (e) {
    logger.error(e, `Error advancing ramp schedule ${rampScheduleId}`);

    try {
      await context.models.rampSchedules.updateById(rampScheduleId, {
        status: "paused",
      });

      const { createEvent } = await import("back-end/src/models/EventModel");
      await createEvent({
        context,
        object: "rampSchedule",
        objectId: rampScheduleId,
        event: "error",
        data: {
          object: {
            rampScheduleId,
            rampName: schedule.name,
            orgId: organization,
            currentStepIndex: schedule.currentStepIndex,
            status: "paused",
            error: (e as Error).message ?? String(e),
          },
        },
        projects: [],
        tags: [],
        environments: [],
        containsSecrets: false,
      });
    } catch (inner) {
      logger.error(inner, "Error updating ramp schedule status after failure");
    }
  }
};
