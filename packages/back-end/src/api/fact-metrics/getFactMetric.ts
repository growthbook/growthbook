import { GetFactMetricResponse } from "shared/types/openapi";
import { getFactMetricValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getFactMetric = createApiRequestHandler(getFactMetricValidator)(
  async (req): Promise<GetFactMetricResponse> => {
    let id = req.params.id;
    // Add `fact__` prefix if it doesn't exist
    if (!id.startsWith("fact__")) {
      id = `fact__${id}`;
    }

    const factMetric = await req.context.models.factMetrics.getById(id);
    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }

    return {
      factMetric: req.context.models.factMetrics.toApiInterface(factMetric),
    };
  },
);
