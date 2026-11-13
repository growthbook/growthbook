import {
  ExperimentInterfaceExcludingHoldouts,
  putExperimentScheduleValidator,
} from "shared/validators";
import { scheduleWriteNeedsRunPermission } from "shared/experiments";
import { scheduleActions } from "shared/util";
import { setExperimentSchedule } from "back-end/src/services/experimentScheduling";
import { assertCanRunExperimentInAffectedEnvironments } from "back-end/src/services/experiments";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  confirmationLink,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";
import { requireExperiment } from "./requireExperiment";

export const putExperimentSchedule = createApiRequestHandler(
  putExperimentScheduleValidator,
)(async (req) => {
  const experiment = await requireExperiment(req.context, req.params.id);
  if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
    req.context.permissions.throwPermissionError();
  }
  // A schedule that will start, stop or ship is a deferred status change and
  // takes the same permission as making it now; notify-only ends do not.
  if (scheduleWriteNeedsRunPermission(experiment, req.body)) {
    await assertCanRunExperimentInAffectedEnvironments(req.context, experiment);
  }

  const scheduled = scheduleActions(req.body);
  // Clearing a schedule cancels a start or stop that was due.
  await requireConfirmation(req.context, {
    actions: scheduled.length ? scheduled : ["experiment.other"],
    project: experiment.project,
    summary: `Schedule ${experiment.name}`,
    links: [confirmationLink("experiment", experiment.id, experiment.name)],
    pin: experiment.statusUpdateSchedule ?? null,
  });

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
