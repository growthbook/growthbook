import {
  ExperimentInterfaceExcludingHoldouts,
  putExperimentScheduleValidator,
} from "shared/validators";
import { scheduleWriteNeedsRunPermission } from "shared/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { setExperimentSchedule } from "back-end/src/services/experimentScheduling";
import { assertCanRunExperimentInAffectedEnvironments } from "back-end/src/services/experiments";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

export const putExperimentSchedule = createApiRequestHandler(
  putExperimentScheduleValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) throw new Error("Could not find the experiment");
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  // A scheduled stop or rollout is a deferred status change and takes the same
  // permission as making it now; notify-only and start-only schedules do not.
  if (scheduleWriteNeedsRunPermission(experiment, req.body)) {
    await assertCanRunExperimentInAffectedEnvironments(req.context, experiment);
  }

  // Full-replace: the body is the complete desired schedule + stop-plan state, so
  // omitted fields are passed through as cleared.
  const { experiment: updated, warnings } = await setExperimentSchedule({
    context: req.context,
    experiment,
    startAt: req.body.startAt ?? null,
    stopAt: req.body.stopAt ?? null,
    stopAfter: req.body.stopAfter ?? null,
    scheduledStopPlan: req.body.scheduledStopPlan ?? null,
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
