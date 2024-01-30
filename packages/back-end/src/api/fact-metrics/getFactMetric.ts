import { GetFactMetricResponse } from "../../../types/openapi";
import {
  getFactMetric as findFactMetricById,
  toFactMetricApiInterface,
} from "../../models/FactMetricModel";
import { createApiRequestHandler } from "../../util/handler";
import { getFactMetricValidator } from "../../validators/openapi";

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
