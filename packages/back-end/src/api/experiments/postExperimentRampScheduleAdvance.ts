import { postExperimentRampScheduleAdvanceValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { advanceUntilBlocked } from "back-end/src/services/rampSchedule";
import {
  applyRampEvaluationDecision,
  evaluateCurrentStep,
} from "back-end/src/services/rampScheduleEvaluator";

export const postExperimentRampScheduleAdvance = createApiRequestHandler(
  postExperimentRampScheduleAdvanceValidator,
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

  const now = new Date();
  const decision = await evaluateCurrentStep(req.context, schedule, now);
  const result = await applyRampEvaluationDecision(req.context, schedule, decision);
  if (!result.handled) {
    await advanceUntilBlocked(req.context, result.schedule, now);
  }

  const updated = await req.context.models.rampSchedules.getById(schedule.id);
  return { rampSchedule: updated ?? null };
});
