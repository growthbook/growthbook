import { postExperimentRampScheduleResumeValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resumeSchedule } from "back-end/src/services/rampSchedule";

export const postExperimentRampScheduleResume = createApiRequestHandler(
  postExperimentRampScheduleResumeValidator,
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
  if (schedule.status !== "paused") {
    throw new Error(`Ramp schedule is not paused (status: ${schedule.status})`);
  }

  const updated = await resumeSchedule(req.context, schedule);
  return { rampSchedule: updated };
});
