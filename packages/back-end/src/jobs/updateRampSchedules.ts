import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  advanceUntilBlocked,
  applyStartConditionActions,
  completeRollout,
  makeAttribution,
  onActivatingRevisionPublished,
} from "back-end/src/services/rampSchedule";
import { getFeature } from "back-end/src/models/FeatureModel";
import { IS_CLOUD } from "back-end/src/util/secrets";

type AdvanceSingleRampScheduleJob = Job<{
  rampScheduleId: string;
  organization: string;
}>;

export const QUEUE_RAMP_SCHEDULE_ADVANCES = "queueRampScheduleAdvances";
const ADVANCE_SINGLE_RAMP_SCHEDULE = "advanceSingleRampSchedule";

// Default polling interval. Cloud and unset self-hosted orgs use this.
export const DEFAULT_RAMP_POLL_INTERVAL_MINUTES = 10;

// Cancel and re-register the outer polling job at a new interval.
// Cloud is always locked to the default.
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
  agenda.define(QUEUE_RAMP_SCHEDULE_ADVANCES, async () => {
    const now = new Date();
    // Uses db.collection() directly — RampScheduleModel is a BaseModel, not a mongoose.model.
    const mongoose = await import("mongoose");
    const scheduleDocs = await mongoose.default.connection.db
      .collection("rampschedules")
      .find(
        {
          $or: [
            // Running schedules with a step timer due
            { status: "running", nextStepAt: { $ne: null, $lte: now } },
            // Scheduled-start "ready" schedules — "immediately"/"manual" are NOT started here
            {
              status: "ready",
              "startCondition.trigger.type": "scheduled",
              "startCondition.trigger.at": { $lte: now },
            },
            // Hard end-date deadline (paused schedules excluded — deferred until resumed)
            {
              status: { $in: ["running", "pending-approval"] },
              "endCondition.trigger.at": { $lte: now },
            },
            // Crash recovery: pending with an already-published activating revision
            {
              status: "pending",
              "targets.activatingRevisionVersion": { $exists: true, $ne: null },
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

  agenda.define(ADVANCE_SINGLE_RAMP_SCHEDULE, advanceSingleRampSchedule);
  await rescheduleRampScheduleJob(agenda, initialIntervalMinutes);
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
    // Hard deadline — trumps everything else.
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

    let current = schedule;

    // Crash recovery: replay activation if revision was published before we processed it.
    if (current.status === "pending") {
      const activatingVersion = current.targets[0]?.activatingRevisionVersion;
      if (activatingVersion != null) {
        const feature = current.entityId
          ? await getFeature(context, current.entityId)
          : undefined;
        if ((feature?.version ?? -1) >= activatingVersion) {
          await onActivatingRevisionPublished(context, current);
          current =
            (await context.models.rampSchedules.getById(current.id)) ?? current;
        }
      }
      if (current.status === "pending") return;
    }

    if (
      current.status === "ready" &&
      current.startCondition?.trigger.type === "scheduled" &&
      current.startCondition.trigger.at <= now
    ) {
      const initialNextStepAt = current.steps.length > 0 ? now : null;
      current = await context.models.rampSchedules.updateById(current.id, {
        status: "running",
        startedAt: now,
        phaseStartedAt: now,
        nextStepAt: initialNextStepAt,
      });
      await applyStartConditionActions(context, current);
    }

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
