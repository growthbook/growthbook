import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { HoldoutModel } from "../models/HoldoutModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";

type UpdateSingleHoldoutJob = Job<{
  holdoutId: string;
  organization: string;
}>;

const QUEUE_HOLDOUT_UPDATES = "queueScheduledHoldoutUpdates";

const UPDATE_SINGLE_HOLDOUT = "updateSingleHoldout";

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_HOLDOUT_UPDATES, async () => {
    const holdoutIds = await HoldoutModel.getAllHoldoutsToUpdate();

    for (const holdoutId of holdoutIds) {
      await queueHoldoutUpdate(holdoutId.id, holdoutId.organization);
    }
  });

  agenda.define(UPDATE_SINGLE_HOLDOUT, updateSingleHoldout);

  await startUpdateJob();

  async function startUpdateJob() {
    const updateHoldoutsJob = agenda.create(QUEUE_HOLDOUT_UPDATES, {});
    updateHoldoutsJob.unique({});
    updateHoldoutsJob.repeatEvery("1 minute");
    await updateHoldoutsJob.save();
  }

  async function queueHoldoutUpdate(holdoutId: string, organization: string) {
    const job = agenda.create(UPDATE_SINGLE_HOLDOUT, {
      holdoutId,
      organization,
    }) as UpdateSingleHoldoutJob;

    job.unique({
      holdoutId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleHoldout = async (job: UpdateSingleHoldoutJob) => {
  const holdoutId = job.attrs.data?.holdoutId;
  const organization = job.attrs.data?.organization;

  if (!holdoutId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const holdout = await context.models.holdout.getById(holdoutId);

  if (!holdout) return;

  const holdoutExperiment = await getExperimentById(
    context,
    holdout.experimentId,
  );

  if (!holdoutExperiment) return;
  if (holdoutExperiment.archived) return;
  if (holdoutExperiment.status !== "running") return;

  const now = new Date();

  try {
    if (holdout.scheduledStopDate && holdout.scheduledStopDate <= now) {
      await updateExperiment({
        context,
        experiment: holdoutExperiment,
        changes: {
          status: "stopped",
        },
      });
      return;
    }

    if (
      holdout.scheduledAnalysisPeriodStartDate &&
      holdout.scheduledAnalysisPeriodStartDate <= now
    ) {
      await context.models.holdout.update(holdout, {
        analysisStartDate: now,
      });
      return;
    }
  } catch (e) {
    logger.error(e, "Failed updating holdout " + holdout.id);
  }
};
