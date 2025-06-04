import { z } from "zod";
import { createApiRequestHandler } from "../../util/handler";
import { deleteMetricsValidator } from "../../validators/openapi";
import {
  deleteMetricById,
  getMetricsByIds,
  updateMetric,
} from "../../models/MetricModel";
import { DeleteMetricsResponse } from "../../../types/openapi";

export const deleteMetricsHandler = createApiRequestHandler({
  bodySchema: deleteMetricsValidator.bodySchema,
  querySchema: z
    .object({
      delete: z.preprocess((val) => {
        if (typeof val === "string") {
          if (val.toLowerCase() === "true") return true;
          if (val.toLowerCase() === "false") return false;
        }
        return val;
      }, z.boolean()),
    })
    .strict(),
  paramsSchema: deleteMetricsValidator.paramsSchema,
})(
  async (req): Promise<DeleteMetricsResponse> => {
    if (req.body.ids.length === 0) {
      throw new Error(
        `Must provide at least one metric ID to ${
          req.query.delete ? "delete" : "archive"
        }`
      );
    }

    const metrics = await getMetricsByIds(req.context, req.body.ids);

    const metricMap = new Map(metrics.map((m) => [m.id, m]));

    // get IDs that were in request body (metricIdSet) but not found
    const notFoundIds = req.body.ids.filter((id) => !metricMap.has(id));

    if (notFoundIds.length > 0) {
      throw new Error(
        "Could not find metrics with IDs: " + notFoundIds.join(", ")
      );
    }

    for (const metric of metrics) {
      if (req.query.delete) {
        if (!req.context.permissions.canDeleteMetric(metric)) {
          req.context.permissions.throwPermissionError();
        }
      } else {
        if (
          !req.context.permissions.canUpdateMetric(metric, {
            projects: metric.projects,
          })
        ) {
          req.context.permissions.throwPermissionError();
        }
      }
    }

    for (const metric of metrics) {
      if (req.query.delete) {
        await deleteMetricById(req.context, metric);
      } else {
        await updateMetric(req.context, metric, { status: "archived" });
      }
    }

    return {
      modifiedIds: req.body.ids,
      deleted: req.query.delete,
    };
  }
);
