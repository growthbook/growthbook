import { postExperimentRampScheduleRollbackValidator } from "shared/validators";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { applyExperimentRollback } from "back-end/src/services/experimentRampSchedule";

export const postExperimentRampScheduleRollback = createApiRequestHandler(
  postExperimentRampScheduleRollbackValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  if (!experiment.rampScheduleId) {
    throw new Error("No ramp schedule attached to this experiment");
  }

  const schedule = await req.context.models.rampSchedules.getById(
    experiment.rampScheduleId,
  );
  if (!schedule) {
    throw new Error("Ramp schedule not found");
  }
  if (!["running", "paused"].includes(schedule.status)) {
    throw new Error(`Cannot rollback a ramp in status: ${schedule.status}`);
  }

  const updatedSchedule = await req.context.models.rampSchedules.updateById(
    schedule.id,
    {
      status: "rolled-back",
      lastRollbackAt: new Date(),
      lastRollbackReason: req.body.reason ?? "API rollback",
      nextStepAt: null,
      nextSnapshotAt: null,
      nextProcessAt: null,
    },
  );

  const updatedExperiment = await applyExperimentRollback(
    req.context,
    experiment,
    updatedSchedule,
  );

  if (req.body.excludePreviouslyExposedUsers) {
    await updateExperiment({
      context: req.context,
      experiment: updatedExperiment,
      changes: { minBucketVersion: updatedExperiment.bucketVersion },
    });
  }

  return { rampSchedule: updatedSchedule };
});
