import { getExperimentRampScheduleValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getExperimentRampSchedule = createApiRequestHandler(
  getExperimentRampScheduleValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }
  if (!experiment.rampScheduleId) {
    return { rampSchedule: null };
  }

  const schedule = await req.context.models.rampSchedules.getById(
    experiment.rampScheduleId,
  );
  return { rampSchedule: schedule ?? null };
});
