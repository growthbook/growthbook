import { getExperimentStartChecklistValidator } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getExperimentStartChecklist as getExperimentStartChecklistStatus } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireExperiment } from "./requireExperiment";

export const getExperimentStartChecklist = createApiRequestHandler(
  getExperimentStartChecklistValidator,
)(async (req) => {
  const experiment = await requireExperiment(
    req.context as ReqContext,
    req.params.id,
  );

  const { checklistItems, status } = await getExperimentStartChecklistStatus({
    context: req.context as ReqContext,
    experiment,
  });

  return {
    checklistItems,
    status,
  };
});
