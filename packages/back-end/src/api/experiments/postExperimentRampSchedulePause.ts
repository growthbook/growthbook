import { postExperimentRampSchedulePauseValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { pauseSchedule } from "back-end/src/services/rampSchedule";

export const postExperimentRampSchedulePause = createApiRequestHandler(
  postExperimentRampSchedulePauseValidator,
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
  if (!schedule) throw new Error("Ramp schedule not found");
  if (schedule.status !== "running") {
    throw new Error(`Ramp schedule is not running (status: ${schedule.status})`);
  }

  const updated = await pauseSchedule(req.context, schedule, "API pause");
  return { rampSchedule: updated };
});
