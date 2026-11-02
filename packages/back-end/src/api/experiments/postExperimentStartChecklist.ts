import { postExperimentStartChecklistManualCompleteValidator } from "shared/validators";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getExperimentStartChecklist,
  planChecklistCompletion,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  confirmationLink,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import { ReqContext } from "back-end/types/request";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireExperiment } from "./requireExperiment";

export const postExperimentStartChecklistManualComplete =
  createApiRequestHandler(postExperimentStartChecklistManualCompleteValidator)(
    async (req) => {
      const context = req.context as ReqContext;
      const experiment = await requireExperiment(context, req.params.id);

      const { keys } = req.body;
      const changes = await planChecklistCompletion({
        context,
        experiment,
        keys,
      });
      // Ticking an item attests to it; a key can ask a person to confirm which.
      await requireConfirmation(context, {
        actions: ["experiment.draft", "experiment.checklist"],
        project: experiment.project,
        summary: `Mark launch checklist items complete on ${experiment.name}: ${keys.join(", ")}`,
        links: [confirmationLink("experiment", experiment.id, experiment.name)],
        pin: [experiment.manualLaunchChecklist ?? []],
      });
      const updated = await updateExperiment({
        context,
        experiment,
        changes,
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
        gates: checklist.gates,
        status: checklist.status,
      };
    },
  );
