import Agenda, { Job } from "agenda";
import { ExperimentPhase } from "shared/validators";
import { Changeset } from "shared/types/experiment";
import {
  getContextForAgendaJobByOrgId,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { HoldoutModel } from "back-end/src/models/HoldoutModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/holdouts";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getChangesToStartExperiment } from "back-end/src/services/experiments";

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

  if (!holdoutExperiment) {
    throw new Error("Holdout experiment not found: " + holdout.id);
  }
  if (holdoutExperiment.archived) {
    logger.info(
      "Skipping status update: Holdout experiment is archived: " + holdout.id,
    );
    return;
  }
  if (holdoutExperiment.status === "stopped") {
    logger.info(
      "Skipping status update: Holdout experiment is stopped: " + holdout.id,
    );
    return;
  }

  const now = new Date();
  const phases = [...holdoutExperiment.phases] as ExperimentPhase[];

  let newNextScheduledStatusUpdate: {
    type: "start" | "startAnalysisPeriod" | "stop";
    date: Date;
  } | null = null;

  try {
    logger.info("Start Updating Status for holdout " + holdout.id);

    switch (holdout.nextScheduledStatusUpdate?.type) {
      case "start": {
        const changes: Changeset = await getChangesToStartExperiment(
          context,
          holdoutExperiment,
        );

        if (holdout.statusUpdateSchedule?.startAnalysisPeriodAt) {
          newNextScheduledStatusUpdate = {
            type: "startAnalysisPeriod",
            date: holdout.statusUpdateSchedule.startAnalysisPeriodAt,
          };
        }

        await context.models.holdout.update(holdout, {
          nextScheduledStatusUpdate: newNextScheduledStatusUpdate,
        });
        await updateExperiment({
          context,
          experiment: holdoutExperiment,
          changes,
        });
        queueSDKPayloadRefresh({
          context,
          payloadKeys: getAffectedSDKPayloadKeys(
            holdout,
            getEnvironmentIdsFromOrg(context.org),
          ),
        });
        break;
      }
      case "startAnalysisPeriod":
        phases[1] = {
          ...phases[0],
          lookbackStartDate: now,
          dateEnded: undefined,
          name: "Analysis Period",
        };

        if (holdout.statusUpdateSchedule?.stopAt) {
          newNextScheduledStatusUpdate = {
            type: "stop",
            date: holdout.statusUpdateSchedule.stopAt,
          };
        }

        await context.models.holdout.update(holdout, {
          analysisStartDate: now,
          nextScheduledStatusUpdate: newNextScheduledStatusUpdate,
        });
        await updateExperiment({
          context,
          experiment: holdoutExperiment,
          changes: { phases, status: "running" },
        });
        queueSDKPayloadRefresh({
          context,
          payloadKeys: getAffectedSDKPayloadKeys(
            holdout,
            getEnvironmentIdsFromOrg(context.org),
          ),
        });
        break;

      case "stop":
        // put end date on both phases
        if (phases[0]) {
          phases[0].dateEnded = new Date();
        }
        if (phases[1]) {
          phases[1].dateEnded = new Date();
        }
        // Set the next scheduled status update to null to exclude from holdoutsToUpdate query
        await context.models.holdout.update(holdout, {
          nextScheduledStatusUpdate: null,
        });
        // set the status to stopped for the experiment
        await updateExperiment({
          context,
          experiment: holdoutExperiment,
          changes: {
            phases,
            status: "stopped",
          },
        });
        queueSDKPayloadRefresh({
          context,
          payloadKeys: getAffectedSDKPayloadKeys(
            holdout,
            getEnvironmentIdsFromOrg(context.org),
          ),
        });
        break;
    }

    logger.info("Successfully Updated Status for holdout " + holdout.id);
  } catch (e) {
    logger.error(e, "Failed to update holdout " + holdout.id);
  }
};
