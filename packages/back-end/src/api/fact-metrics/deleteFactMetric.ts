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
    let id = req.params.id;
    // Add `fact__` prefix if it doesn't exist
    if (!id.startsWith("fact__")) {
      id = `fact__${id}`;
    }

    const factMetric = await getFactMetric(req.context, id);
    if (!factMetric) {
      throw new Error(
        "Unable to delete - Could not find factMetric with that id"
      );
    }
    req.context.permissions.canCreateMetrics(factMetric).throwIfError();

    await deleteFactMetricInDb(req.context, factMetric);

    return {
      deletedId: id,
    };
  }
);
