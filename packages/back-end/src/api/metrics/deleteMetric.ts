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
      // TODO: Add permission check after merging https://github.com/growthbook/growthbook/pull/1265
      checkPermissions: () => undefined, // checkPermissions: req.checkPermissions
    });
    const deletedMetric = await metricDeleter.perform();

    return {
      deletedId: deletedMetric.id,
    };
  }
);
