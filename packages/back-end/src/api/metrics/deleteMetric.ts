import { DeleteMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { deleteMetricValidator } from "../../validators/openapi";
import { MetricDeleter } from "../../services/metrics";

export const deleteMetric = createApiRequestHandler(deleteMetricValidator)(
  async (req): Promise<DeleteMetricResponse> => {
    const metricDeleter = new MetricDeleter({
      id: req.params.id,
      organization: req.organization,
      eventAudit: req.eventAudit,
    });
    const deletedId = await metricDeleter.perform();

    return {
      deletedId,
    };
  }
);
