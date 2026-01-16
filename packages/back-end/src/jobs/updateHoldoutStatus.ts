import Agenda, { Job } from "agenda";
import { ExperimentPhase } from "shared/validators";
import {
  getContextForAgendaJobByOrgId,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { HoldoutModel } from "../models/HoldoutModel";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import { getAffectedSDKPayloadKeys } from "../util/holdouts";
import { refreshSDKPayloadCache } from "../services/features";

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
  if (holdoutExperiment.status === "stopped") return;

  const now = new Date();
  let phases = [...holdoutExperiment.phases] as ExperimentPhase[];

  let newNextScheduledUpdateType:
    | "start"
    | "startAnalysisPeriod"
    | "stop"
    | null = null;
  let newNextScheduledUpdate: Date | null = null;

  try {
    logger.info("Start Updating Status for holdout " + holdout.id);

    switch (holdout.nextScheduledUpdateType) {
      case "start":
        phases[0] = {
          ...phases[0],
          dateEnded: undefined,
        };
        if (phases[1]) {
          phases = [phases[0]];
        }

        if (holdout.scheduledStatusUpdates?.startAnalysisPeriodAt) {
          newNextScheduledUpdateType = "startAnalysisPeriod";
          newNextScheduledUpdate =
            holdout.scheduledStatusUpdates.startAnalysisPeriodAt;
        } else if (holdout.scheduledStatusUpdates?.stopAt) {
          newNextScheduledUpdateType = "stop";
          newNextScheduledUpdate = holdout.scheduledStatusUpdates.stopAt;
        }

        await context.models.holdout.update(holdout, {
          analysisStartDate: undefined,
          nextScheduledUpdateType: newNextScheduledUpdateType,
          nextScheduledUpdate: newNextScheduledUpdate,
        });
        await updateExperiment({
          context,
          experiment: holdoutExperiment,
          changes: { phases, status: "running" },
        });
        await refreshSDKPayloadCache({
          context,
          payloadKeys: getAffectedSDKPayloadKeys(
            holdout,
            getEnvironmentIdsFromOrg(context.org),
          ),
        });
        break;

      case "startAnalysisPeriod":
        phases[1] = {
          ...phases[0],
          lookbackStartDate: now,
          dateEnded: undefined,
          name: "Analysis Period",
        };

        if (holdout.scheduledStatusUpdates?.stopAt) {
          newNextScheduledUpdateType = "stop";
          newNextScheduledUpdate = holdout.scheduledStatusUpdates.stopAt;
        }

        await context.models.holdout.update(holdout, {
          analysisStartDate: now,
          nextScheduledUpdateType: newNextScheduledUpdateType,
          nextScheduledUpdate: newNextScheduledUpdate,
        });
        await updateExperiment({
          context,
          experiment: holdoutExperiment,
          changes: { phases, status: "running" },
        });
        await refreshSDKPayloadCache({
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
        // Set the next scheduled update to null to exclude from holdoutsToUpdate query
        await context.models.holdout.update(holdout, {
          nextScheduledUpdateType: null,
          nextScheduledUpdate: null,
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
        await refreshSDKPayloadCache({
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
