import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentStopValidator,
} from "shared/validators";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { stopExperiment } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { ReqContext } from "back-end/types/request";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

export const postExperimentStop = createApiRequestHandler(
  postExperimentStopValidator,
)(async (req) => {
  const { experiment, updated, isEnding } = await stopExperiment({
    context: req.context as ReqContext,
    input: {
      experimentId: req.params.id,
      results: req.body.results,
      winnerVariationId: req.body.winnerVariationId,
      releasedVariationId: req.body.releasedVariationId,
      enableTemporaryRollout: req.body.enableTemporaryRollout,
      reason: req.body.reason,
      analysis: req.body.analysis,
      dateEnded: req.body.dateEnded,
    },
  });

  await req.audit({
    event: isEnding ? "experiment.stop" : "experiment.results",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  const apiExperiment = await toEnhancedExperimentApiResponse(
    req.context,
    updated as ExperimentInterfaceExcludingHoldouts,
  );
  return {
    experiment: apiExperiment,
  };
});
