import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentScheduleStopValidator,
} from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { setExperimentScheduledStop } from "back-end/src/services/experimentScheduling";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

export const postExperimentScheduleStop = createApiRequestHandler(
  postExperimentScheduleStopValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) throw new Error("Could not find the experiment");
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }

  const { experiment: updated, warnings } = await setExperimentScheduledStop({
    context: req.context,
    experiment,
    stopAt: req.body.stopAt,
    stopAfter: req.body.stopAfter,
  });

  await req.audit({
    event: "experiment.update",
    entity: { object: "experiment", id: experiment.id },
    details: auditDetailsUpdate(experiment, updated),
  });

  const apiExperiment = await toEnhancedExperimentApiResponse(
    req.context,
    updated as ExperimentInterfaceExcludingHoldouts,
  );
  return {
    experiment: apiExperiment,
    ...(warnings.length ? { warnings } : {}),
  };
});
