import Agenda, { Job } from "agenda";
import { Changeset } from "shared/types/experiment";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getExperimentsWithScheduledStatusUpdate,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getChangesToStartExperiment } from "back-end/src/services/experiments";

type UpdateSingleExperimentStatusJob = Job<{
  experimentId: string;
  organization: string;
}>;

const QUEUE_EXPERIMENT_STATUS_UPDATES = "queueScheduledExperimentStatusUpdates";

const UPDATE_SINGLE_EXPERIMENT_STATUS = "updateSingleExperimentStatus";

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_STATUS_UPDATES, async () => {
    const experiments = await getExperimentsWithScheduledStatusUpdate();

    for (const experiment of experiments) {
      await queueExperimentStatusUpdate(experiment.id, experiment.organization);
    }
  });

  agenda.define(UPDATE_SINGLE_EXPERIMENT_STATUS, updateSingleExperimentStatus);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_EXPERIMENT_STATUS_UPDATES, {});
    job.unique({});
    job.repeatEvery("1 minute");
    await job.save();
  }

  async function queueExperimentStatusUpdate(
    experimentId: string,
    organization: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_EXPERIMENT_STATUS, {
      experimentId,
      organization,
    }) as UpdateSingleExperimentStatusJob;

    job.unique({
      experimentId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleExperimentStatus = async (
  job: UpdateSingleExperimentStatusJob,
) => {
  const experimentId = job.attrs.data?.experimentId;
  const organization = job.attrs.data?.organization;

  if (!experimentId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) return;

  if (experiment.archived) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} is archived`,
    );
    return;
  }
  if (experiment.status === "stopped") {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} is stopped`,
    );
    return;
  }

  const scheduled = experiment.nextScheduledStatusUpdate;
  if (!scheduled?.date) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} has no scheduled update`,
    );
    return;
  }

  const now = new Date();
  if (new Date(scheduled.date) > now) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} scheduled update is in the future (possibly rescheduled).`,
    );
    return;
  }

  try {
    logger.info("Start updating status for experiment " + experiment.id);

    switch (scheduled.type) {
      case "start": {
        if (
          experiment.status !== "scheduled" &&
          experiment.status !== "draft"
        ) {
          logger.info(
            `Skipping start: Experiment ${experiment.id} is not in a schedulable state (status=${experiment.status}).`,
          );
          await updateExperiment({
            context,
            experiment,
            changes: { nextScheduledStatusUpdate: null },
          });
          return;
        }

        const changes: Changeset = await getChangesToStartExperiment(
          context,
          experiment,
        );
        // Clear the scheduled update so it doesn't get re-processed
        changes.nextScheduledStatusUpdate = null;

        await updateExperiment({
          context,
          experiment,
          changes,
        });
        break;
      }
      // TODO(schedule-status-updates): handle "stop" once stopAt is supported
      default:
        logger.info(
          `Skipping status update: Experiment ${experiment.id} has unsupported scheduled type ${scheduled.type}`,
        );
        await updateExperiment({
          context,
          experiment,
          changes: { nextScheduledStatusUpdate: null },
        });
        return;
    }

    logger.info("Successfully updated status for experiment " + experiment.id);
  } catch (e) {
    logger.error(e, "Failed to update experiment status " + experiment.id);
  }
};
