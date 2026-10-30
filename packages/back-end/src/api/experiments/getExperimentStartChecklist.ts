import { getExperimentStartChecklistValidator } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getExperimentStartChecklist as getExperimentStartChecklistStatus } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireEditableExperiment } from "./requireExperiment";

export const getExperimentStartChecklist = createApiRequestHandler(
  getExperimentStartChecklistValidator,
)(async (req) => {
  const experiment = await requireEditableExperiment(
    req.context,
    req.params.id,
    "use the launch checklist",
  );

  const { checklistItems, gates, status } =
    await getExperimentStartChecklistStatus({
      context: req.context as ReqContext,
      experiment,
    });

  return { checklistItems, gates, status };
});
