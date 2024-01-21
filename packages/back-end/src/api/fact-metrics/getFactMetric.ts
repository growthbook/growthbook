import { GetFactMetricResponse } from "../../../types/openapi";
import {
  getFactMetric as findFactMetricById,
  toFactMetricApiInterface,
} from "../../models/FactMetricModel";
import { createApiRequestHandler } from "../../util/handler";
import { getFactMetricValidator } from "../../validators/openapi";

export const getFactMetric = createApiRequestHandler(getFactMetricValidator)(
  async (req): Promise<GetFactMetricResponse> => {
    const factMetric = await findFactMetricById(
      req.organization.id,
      req.params.id
    );
    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
