import Agenda, { Job } from "agenda";
import { RampScheduleInterface } from "shared/validators";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  advanceStep,
  completeRollout,
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

    // Collect all orgs with active ramp schedules that need processing
    // We do a direct DB query here to avoid loading context for every org
    const mongoose = await import("mongoose");
    const scheduleDocs = await mongoose.default
      .model<RampScheduleInterface>("RampSchedule")
      .find({
        $or: [
          // Running schedules with a step timer due
          { status: "running", nextStepAt: { $ne: null, $lte: now } },
          // Ready schedules with a scheduled start time that has passed — Agenda auto-starts these.
          // "immediately" and "manual" ready schedules are NOT started by Agenda:
          //   - "immediately" is started inline when the founding revision is published.
          //   - "manual" requires the user to click Start.
          {
            status: "ready",
            "startTrigger.type": "scheduled",
            "startTrigger.at": { $lte: now },
          },
          // Running/paused/pending-approval schedules with a hard deadline due
          {
            status: { $in: ["running", "paused", "pending-approval"] },
            "endSchedule.trigger.at": { $lte: now },
          },
        ],
      })
      .select("_id organization")
      .lean();

    for (const doc of scheduleDocs) {
      await queueRampScheduleAdvance(agenda, {
        id: (doc as unknown as { id: string }).id || String(doc._id),
        organization: (doc as { organization: string }).organization,
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
async function advanceUntilBlocked(
  context: Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>,
  initial: import("shared/validators").RampScheduleInterface,
  now: Date,
  attribution: import("shared/validators").RampAttribution,
): Promise<void> {
  let current = initial;
  // Cap iterations at the total number of steps to guard against runaway loops
  const maxSteps = current.steps.length;

  for (let i = 0; i < maxSteps; i++) {
    // Re-check endSchedule before each step — it's a hard deadline
    if (
      current.endSchedule &&
      current.endSchedule.trigger.type === "scheduled" &&
      current.endSchedule.trigger.at <= now &&
      ["running", "paused", "pending-approval"].includes(current.status)
    ) {
      await completeRollout(
        context,
        current,
        makeAttribution(undefined, "endSchedule deadline reached", "system"),
      );
      return;
    }

    if (current.status !== "running") return;
    if (!current.nextStepAt || current.nextStepAt > now) return;

    current = await advanceStep(context, current, attribution);

    // If the step we just applied was an approval gate, status is now
    // "pending-approval" and the loop will exit on the next iteration's
    // status check. If all steps are exhausted, advanceStep sets status
    // to "completed" with nextStepAt === null.
  }
}

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
    // Hard deadline — trumps everything else
    if (
      schedule.endSchedule &&
      schedule.endSchedule.trigger.type === "scheduled" &&
      schedule.endSchedule.trigger.at <= now &&
      ["running", "paused", "pending-approval"].includes(schedule.status)
    ) {
      await completeRollout(
        context,
        schedule,
        makeAttribution(undefined, "endSchedule deadline reached", "system"),
      );
      return;
    }

    // Auto-start "ready" schedules whose startTrigger.type === "scheduled" and at <= now.
    // "immediately" ramps are started inline when the founding revision is published.
    // "manual" ramps require an explicit user action (REST start endpoint).
    let current = schedule;
    if (
      current.status === "ready" &&
      current.startTrigger?.type === "scheduled" &&
      current.startTrigger.at <= now
    ) {
      current = await context.models.rampSchedules.updateById(current.id, {
        status: "running",
        startedAt: now,
        phaseStartedAt: now,
      });
      current = await advanceStep(
        context,
        current,
        makeAttribution(
          undefined,
          "auto-started by scheduled startTrigger",
          "system",
        ),
      );
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
