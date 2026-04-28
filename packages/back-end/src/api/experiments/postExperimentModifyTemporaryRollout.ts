import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentModifyTemporaryRolloutValidator,
} from "shared/validators";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { modifyTemporaryRollout } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { ReqContext } from "back-end/types/request";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

export const postExperimentModifyTemporaryRollout = createApiRequestHandler(
  postExperimentModifyTemporaryRolloutValidator,
)(async (req) => {
  const { experiment, updated } = await modifyTemporaryRollout({
    context: req.context as ReqContext,
    input: {
      experimentId: req.params.id,
      enableTemporaryRollout: req.body.enableTemporaryRollout,
      releasedVariationId: req.body.releasedVariationId,
    },
  });

  await req.audit({
    event: "experiment.update",
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
