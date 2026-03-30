import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  advanceUntilBlocked,
  applyStartConditionActions,
  completeRollout,
  computeNextProcessAt,
  onActivatingRevisionPublished,
} from "back-end/src/services/rampSchedule";
import { getFeature } from "back-end/src/models/FeatureModel";

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
  // Ensure a sparse index on nextProcessAt for efficient polling.
  const mongoose = await import("mongoose");
  await mongoose.default.connection.db
    .collection("rampschedules")
    .createIndex({ nextProcessAt: 1 }, { sparse: true, name: "nextProcessAt_1" });

  agenda.define(QUEUE_RAMP_SCHEDULE_ADVANCES, async () => {
    const now = new Date();
    const mongoose = await import("mongoose");
    const scheduleDocs = await mongoose.default.connection.db
      .collection("rampschedules")
      .find(
        {
          $or: [
            // Primary path: any schedule with a due process time
            { nextProcessAt: { $ne: null, $lte: now } },
            // Crash recovery: pending schedules whose activation hook may have missed
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
  const schedule = await context.models.rampSchedules.getById(rampScheduleId);
  if (!schedule) return;

  const now = new Date();

  try {
    // Hard deadline — trumps everything else.
    if (
      schedule.endCondition?.trigger?.type === "scheduled" &&
      schedule.endCondition.trigger.at <= now &&
      ["running", "pending-approval"].includes(schedule.status)
    ) {
      await completeRollout(context, schedule);
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
        nextProcessAt: computeNextProcessAt({
          status: "running",
          nextStepAt: initialNextStepAt,
          endCondition: current.endCondition,
        }),
      });
      await applyStartConditionActions(context, current);
    }

    await advanceUntilBlocked(context, current, now);
  } catch (e) {
    logger.error(e, `Error advancing ramp schedule ${rampScheduleId}`);
    try {
      await context.models.rampSchedules.updateById(rampScheduleId, {
        status: "paused",
        nextProcessAt: null,
      });
    } catch (inner) {
      logger.error(inner, "Error updating ramp schedule status after failure");
    }
  }
};
