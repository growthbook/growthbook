import Agenda, { Job } from "agenda";
import { listAllOrganizationIds } from "back-end/src/models/OrganizationModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  advanceUntilBlocked,
  appendRampEvent,
  applyRampStartActions,
  completeRollout,
  computeNextProcessAt,
  ensureSafeRolloutForMonitoredRamp,
  onActivatingRevisionPublished,
  syncLinkedSafeRolloutForRampState,
} from "back-end/src/services/rampSchedule";
import {
  applyRampEvaluationDecision,
  evaluateCurrentStep,
} from "back-end/src/services/rampScheduleEvaluator";
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
  agenda.define(QUEUE_RAMP_SCHEDULE_ADVANCES, async () => {
    const now = new Date();
    const orgIds = await listAllOrganizationIds();

    for (const organization of orgIds) {
      try {
        const context = await getContextForAgendaJobByOrgId(organization);
        const dueIds =
          await context.models.rampSchedules.agendaFindDueScheduleIds(now);
        for (const id of dueIds) {
          await queueRampScheduleAdvance(agenda, { id, organization });
        }
      } catch {
        // Skip this org so a single bad org can't block the rest of the tick.
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
  const schedule = await context.models.rampSchedules.getById(rampScheduleId);
  if (!schedule) return;

  const now = new Date();

  try {
    let current = schedule;

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
      current.startDate &&
      current.startDate <= now
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

    if (current.status === "running") {
      if (current.cutoffDate && current.cutoffDate <= now) {
        await completeRollout(context, current, {
          disableActiveTargets: true,
        });
        return;
      }

      current = await ensureSafeRolloutForMonitoredRamp(context, current);

      const decision = await evaluateCurrentStep(context, current, now);
      const result = await applyRampEvaluationDecision(
        context,
        current,
        decision,
      );
      if (result.handled) {
        return;
      }
      current = result.schedule;
    }

    await advanceUntilBlocked(context, current, now);
  } catch (e) {
    logger.error(e, `Error advancing ramp schedule ${rampScheduleId}`);
    // Persist the failure as a schedule-level event so the UI/history shows
    // why we paused; agenda's own error path handles the throw if any
    // recovery step itself fails.
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
      await syncLinkedSafeRolloutForRampState(context, updated);
    }
  }
};
