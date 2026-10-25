import { postExperimentStartChecklistManualCompleteValidator } from "shared/validators";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  completeExperimentStartChecklistItems,
  getExperimentStartChecklist,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { ReqContext } from "back-end/types/request";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireExperiment } from "./requireExperiment";

export const postExperimentStartChecklistManualComplete =
  createApiRequestHandler(postExperimentStartChecklistManualCompleteValidator)(
    async (req) => {
      const context = req.context as ReqContext;
      const experiment = await requireExperiment(context, req.params.id);

      const updated = await completeExperimentStartChecklistItems({
        context,
        experiment,
        keys: req.body.keys,
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

      const checklist = await getExperimentStartChecklist({
        context,
        experiment: updated,
      });

      return {
        checklistItems: checklist.checklistItems,
        status: checklist.status,
      };
    },
  );
