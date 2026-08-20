import Agenda, { Job } from "agenda";
import {
  getHoldoutStage,
  HoldoutStage,
  isHoldoutStageTransitionAllowed,
} from "shared/util";
import {
  HoldoutInterface,
  HoldoutNextScheduledStatusUpdate,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { HoldoutModel } from "back-end/src/models/HoldoutModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  normalizeHoldoutScheduleUpdates,
  setHoldoutStage,
} from "back-end/src/services/holdouts";

type UpdateSingleHoldoutJob = Job<{
  holdoutId: string;
  organization: string;
}>;

export function scheduledTypeToStage(
  scheduledType: HoldoutNextScheduledStatusUpdate["type"],
): HoldoutStage {
  switch (scheduledType) {
    case "start":
      return "running";
    case "startAnalysisPeriod":
      return "analysis-period";
    case "stop":
      return "stopped";
    default:
      scheduledType satisfies never;
      throw new Error(
        `Unhandled scheduled holdout update type: ${scheduledType}`,
      );
  }
}

export function isScheduledTransitionApplicable(
  scheduledType: HoldoutNextScheduledStatusUpdate["type"],
  experiment: Pick<ExperimentInterface, "status">,
  holdout: Pick<HoldoutInterface, "analysisStartDate">,
): boolean {
  const currentStage = getHoldoutStage(holdout, experiment);
  const targetStage = scheduledTypeToStage(scheduledType);
  return isHoldoutStageTransitionAllowed(currentStage, targetStage);
}

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

  // Archived or already-stopped holdouts have no remaining transitions. Clear any
  // due pointer so the 1-minute poller stops re-selecting them.
  if (holdoutExperiment.archived || holdoutExperiment.status === "stopped") {
    logger.info(
      `Skipping status update: Holdout ${holdout.id} is ${
        holdoutExperiment.archived ? "archived" : "stopped"
      }`,
    );
    if (holdout.nextScheduledStatusUpdate) {
      await context.models.holdout.update(holdout, {
        nextScheduledStatusUpdate: null,
      });
    }
    return;
  }

  const now = new Date();
  const scheduled = holdout.nextScheduledStatusUpdate;
  if (!scheduled?.date) {
    logger.info(
      `Skipping status update: Holdout ${holdout.id} has no scheduled update`,
    );
    return;
  }
  if (scheduled.date > now) {
    logger.info(
      `Skipping status update: Holdout ${holdout.id} scheduled update is in the future (possibly rescheduled).`,
    );
    return;
  }

  // A manual status change can leave a stale scheduled transition.
  if (
    !isScheduledTransitionApplicable(scheduled.type, holdoutExperiment, holdout)
  ) {
    const { nextScheduledStatusUpdate } = normalizeHoldoutScheduleUpdates({
      holdout,
      experiment: holdoutExperiment,
      scheduleInput: holdout.statusUpdateSchedule ?? null,
    });
    await context.models.holdout.update(holdout, { nextScheduledStatusUpdate });
    logger.info(
      `Skipping status update: Holdout ${holdout.id} is no longer in a state to apply "${scheduled.type}"; reconciled next scheduled update.`,
    );
    return;
  }

  try {
    logger.info("Start Updating Status for holdout " + holdout.id);
    await setHoldoutStage(context, {
      holdout,
      experiment: holdoutExperiment,
      stage: scheduledTypeToStage(scheduled.type),
    });
    logger.info("Successfully Updated Status for holdout " + holdout.id);
  } catch (e) {
    logger.error(e, "Failed to update holdout " + holdout.id);
  }
};
