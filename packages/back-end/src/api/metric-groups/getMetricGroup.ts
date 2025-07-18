import { GetMetricGroupResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getMetricGroupValidator } from "back-end/src/validators/openapi";

export const getMetricGroup = createApiRequestHandler(getMetricGroupValidator)(
  async (req): Promise<GetMetricGroupResponse> => {
    const metricGroup = await req.context.models.metricGroups.getById(
      req.params.id
    );
    if (!metricGroup) {
      throw new Error("Could not find metricGroup with that id");
    }

    return {
      metricGroup: req.context.models.metricGroups.toMetricGroupApiInterface(
        metricGroup
      ),
    };
  }
);
