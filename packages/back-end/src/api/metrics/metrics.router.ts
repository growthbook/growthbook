import { OpenApiRoute } from "back-end/src/util/handler";
import { getMetric } from "./getMetric";
import { listMetrics } from "./listMetrics";
import { postMetric } from "./postMetric";
import { putMetric } from "./putMetric";
import { deleteMetricHandler as deleteMetric } from "./deleteMetric";

export const metricsRoutes: OpenApiRoute[] = [
  listMetrics,
  postMetric,
  getMetric,
  putMetric,
  deleteMetric,
];
