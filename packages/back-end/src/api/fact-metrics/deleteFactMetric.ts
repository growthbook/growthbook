import { DeleteFactMetricResponse } from "../../../types/openapi";
import {
  deleteFactMetric as deleteFactMetricInDb,
  getFactMetric,
} from "../../models/FactMetricModel";
import { createApiRequestHandler } from "../../util/handler";
import { deleteFactMetricValidator } from "../../validators/openapi";

export const deleteFactMetric = createApiRequestHandler(
  deleteFactMetricValidator
)(
  async (req): Promise<DeleteFactMetricResponse> => {
    const factMetric = await getFactMetric(req.organization.id, req.params.id);
    if (!factMetric) {
      throw new Error(
        "Unable to delete - Could not find factMetric with that id"
      );
    }
    req.checkPermissions("createMetrics", factMetric.projects);

    await deleteFactMetricInDb(factMetric);

    return {
      deletedId: req.params.id,
    };
  }
);
