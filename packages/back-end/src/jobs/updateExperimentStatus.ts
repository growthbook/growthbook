import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getExperimentsWithScheduledStatusUpdate,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { executeExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { notifyScheduledStatusUpdateFailed } from "back-end/src/services/experimentNotifications";

type UpdateSingleExperimentStatusJob = Job<{
  experimentId: string;
  organization: string;
}>;

const QUEUE_EXPERIMENT_STATUS_UPDATES = "queueScheduledExperimentStatusUpdates";

const UPDATE_SINGLE_EXPERIMENT_STATUS = "updateSingleExperimentStatus";

// Caps retries of a scheduled status transition. The QUEUE_* job runs every
// minute, so without a cap a persistently-failing experiment (e.g. a linked
// feature draft with a merge conflict) would re-queue forever. Each failure
// increments `nextScheduledStatusUpdate.failedAttempts`; once the count hits
// this cap the job clears `nextScheduledStatusUpdate` and emits a terminal
// `experiment.warning` event so the user can re-schedule manually.
const SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS = 5;

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

  if (
    experiment.archived ||
    experiment.status === "stopped" ||
    experiment.status === "running"
  ) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} is ${experiment.archived ? "archived" : experiment.status}`,
    );
    // Clear the scheduled update so it doesn't get re-processed
    await updateExperiment({
      context,
      experiment,
      changes: { nextScheduledStatusUpdate: null },
    });
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
  if (scheduled.date > now) {
    logger.info(
      `Skipping status update: Experiment ${experiment.id} scheduled update is in the future (possibly rescheduled).`,
    );
    return;
  }

  try {
    logger.info("Start updating status for experiment " + experiment.id);

    switch (scheduled.type) {
      case "start": {
        if (experiment.status !== "draft") {
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

        const experimentBefore = experiment;
        const { updated } = await executeExperimentStart(context, experiment);
        // The agenda context has no logged-in user, so this is recorded
        // as a `system` audit event.
        await context.auditLog({
          event: "experiment.status",
          entity: {
            object: "experiment",
            id: experimentBefore.id,
          },
          details: auditDetailsUpdate(experimentBefore, updated),
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
    const attempts = (scheduled.failedAttempts ?? 0) + 1;
    const willRetry = attempts < SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS;
    const reason = e instanceof Error ? e.message : String(e);

    logger.error(
      e,
      `Failed to update experiment status ${experiment.id} (attempt ${attempts}/${SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS})`,
    );

    if (!willRetry) {
      logger.warn(
        `Giving up on scheduled status update for experiment ${experiment.id} after ${attempts} failed attempts; clearing nextScheduledStatusUpdate.`,
      );
    }

    // Persist the new attempt count (or clear the schedule once we've hit
    // the cap). Wrapped because if executeExperimentStart already wrote to
    // the experiment we may hit a stale-revision error here, and a failure
    // to record state must not mask the original error in the logs.
    try {
      await updateExperiment({
        context,
        experiment,
        changes: {
          nextScheduledStatusUpdate: willRetry
            ? { ...scheduled, failedAttempts: attempts }
            : null,
        },
      });
    } catch (inner) {
      logger.error(
        inner,
        `Failed to persist nextScheduledStatusUpdate after status update failure for experiment ${experiment.id}`,
      );
    }

    try {
      await notifyScheduledStatusUpdateFailed({
        context,
        experiment,
        scheduledStatusUpdateType: scheduled.type,
        attempts,
        maxAttempts: SCHEDULED_STATUS_UPDATE_MAX_ATTEMPTS,
        willRetry,
        reason,
      });
    } catch (inner) {
      logger.error(
        inner,
        `Failed to dispatch experiment.warning for scheduled status update failure on ${experiment.id}`,
      );
    }
  }
};
