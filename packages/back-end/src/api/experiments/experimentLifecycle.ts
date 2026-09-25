import {
  deleteExperimentPhaseValidator,
  deleteExperimentValidator,
  ExperimentInterfaceExcludingHoldouts,
  postExperimentPhaseValidator,
  postExperimentRestartValidator,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { deleteExperimentWithLinks } from "back-end/src/services/experiments";
import {
  deleteExperimentPhase as deleteExperimentPhaseService,
  restartExperiment,
  startNewExperimentPhase,
} from "back-end/src/services/experimentChanges/phases";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

async function toResponse(
  context: ApiReqContext,
  updated: ExperimentInterface,
) {
  return {
    experiment: await toEnhancedExperimentApiResponse(
      context,
      updated as ExperimentInterfaceExcludingHoldouts,
    ),
  };
}

export const deleteExperiment = createApiRequestHandler(
  deleteExperimentValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment || experiment.type === "holdout") {
    // Holdouts are deleted through their own endpoint, with their links
    throw new NotFoundError("Experiment not found");
  }
  await deleteExperimentWithLinks(req.context, experiment);
  return { deletedId: experiment.id };
});

export const postExperimentRestart = createApiRequestHandler(
  postExperimentRestartValidator,
)(async (req) => {
  const { experiment, updated } = await restartExperiment({
    context: req.context as ReqContext,
    experimentId: req.params.id,
    status: req.body.status ?? "running",
  });
  await req.audit({
    event: "experiment.status",
    entity: { object: "experiment", id: experiment.id },
    details: auditDetailsUpdate(experiment, updated),
  });
  return toResponse(req.context, updated);
});

export const postExperimentPhase = createApiRequestHandler(
  postExperimentPhaseValidator,
)(async (req) => {
  const { releasePlan, reason, ...targeting } = req.body;
  const { experiment, updated } = await startNewExperimentPhase({
    context: req.context as ReqContext,
    experimentId: req.params.id,
    releasePlan: releasePlan ?? "new-phase",
    reason,
    targeting,
  });
  await req.audit({
    event: "experiment.phase",
    entity: { object: "experiment", id: experiment.id },
    details: auditDetailsUpdate(experiment, updated),
  });
  return toResponse(req.context, updated);
});

export const deleteExperimentPhase = createApiRequestHandler(
  deleteExperimentPhaseValidator,
)(async (req) => {
  const { experiment, updated } = await deleteExperimentPhaseService({
    context: req.context,
    experimentId: req.params.id,
    phaseIndex: req.params.phase,
  });
  await req.audit({
    event: "experiment.phase.delete",
    entity: { object: "experiment", id: experiment.id },
    details: auditDetailsUpdate(experiment, updated),
  });
  return toResponse(req.context, updated);
});
