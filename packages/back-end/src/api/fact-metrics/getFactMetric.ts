import { getFactMetricValidator } from "@/src/validators/openapi";
import { GetFactMetricResponse } from "@/types/openapi";
import {
  getFactMetric as findFactMetricById,
  toFactMetricApiInterface,
} from "@/src/models/FactMetricModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
