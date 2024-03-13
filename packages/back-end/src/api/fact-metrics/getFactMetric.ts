import { getFactMetricValidator } from "@back-end/src/validators/openapi";
import { GetFactMetricResponse } from "@back-end/types/openapi";
import {
  getFactMetric as findFactMetricById,
  toFactMetricApiInterface,
} from "@back-end/src/models/FactMetricModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getFactMetric = createApiRequestHandler(getFactMetricValidator)(
  async (req): Promise<GetFactMetricResponse> => {
    let id = req.params.id;
    // Add `fact__` prefix if it doesn't exist
    if (!id.startsWith("fact__")) {
      id = `fact__${id}`;
    }

    const factMetric = await findFactMetricById(req.context, id);
    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
