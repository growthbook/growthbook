import { postExperimentStartChecklistValidator } from "shared/validators";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  completeExperimentStartChecklistItems,
  getExperimentStartChecklist,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { ReqContext } from "back-end/types/request";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postExperimentStartChecklist = createApiRequestHandler(
  postExperimentStartChecklistValidator,
)(async (req) => {
  const context = req.context as ReqContext;
  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }

  const updated = await completeExperimentStartChecklistItems({
    context,
    experiment,
    keys: req.body.keys,
  });
  const checklist = await getExperimentStartChecklist({
    context,
    experiment: updated,
  });

  await req.audit({
    event: "experiment.launchChecklist.updated",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(
      experiment.manualLaunchChecklist || [],
      updated.manualLaunchChecklist || [],
    ),
  });

  return {
    checklistItems: checklist.checklistItems,
    incompleteRequiredItems: checklist.incompleteRequiredItems,
    requiredItemsRemaining: checklist.requiredItemsRemaining,
    allRequiredComplete: checklist.allRequiredComplete,
    manualLaunchChecklist: updated.manualLaunchChecklist || [],
  };
});
