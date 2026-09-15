import { getExperimentStartChecklistValidator } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getExperimentStartChecklist as getExperimentStartChecklistStatus } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentById } from "back-end/src/models/ExperimentModel";

export const getExperimentStartChecklist = createApiRequestHandler(
  getExperimentStartChecklistValidator,
)(async (req) => {
  const experiment = await getExperimentById(
    req.context as ReqContext,
    req.params.id,
  );
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }

  const { checklistItems, status } = await getExperimentStartChecklistStatus({
    context: req.context as ReqContext,
    experiment,
  });

  return {
    checklistItems,
    status,
  };
});
