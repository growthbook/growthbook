import { removeMetricFromExperiments } from "back-end/src/models/ExperimentModel";
import { DeleteMetricGroupResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteMetricGroupValidator } from "back-end/src/validators/openapi";

export const deleteMetricGroup = createApiRequestHandler(
  deleteMetricGroupValidator
)(
  async (req): Promise<DeleteMetricGroupResponse> => {
    const context = req.context;
    if (!context.permissions.canDeleteMetricGroup()) {
      context.permissions.throwPermissionError();
    }
    const metricGroup = await context.models.metricGroups.getById(
      req.params.id
    );
    if (!metricGroup) {
      throw new Error("Could not find the metric group");
    }
    // should we delete all references to this metric group in the experiments?
    await removeMetricFromExperiments(context, metricGroup.id);
    await context.models.metricGroups.delete(metricGroup);

    return {
      deletedId: req.params.id,
    };
  }
);
