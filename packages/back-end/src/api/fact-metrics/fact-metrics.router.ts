import { OpenApiRoute } from "back-end/src/util/handler";
import { getFactMetric } from "./getFactMetric";
import { listFactMetrics } from "./listFactMetrics";
import { postFactMetric } from "./postFactMetric";
import { updateFactMetric } from "./updateFactMetric";
import { deleteFactMetric } from "./deleteFactMetric";
import { postFactMetricAnalysis } from "./postFactMetricAnalysis";
import {
  getLatestFactMetricAnalysis,
  getMetricAnalysis,
  postMetricAnalysisCancel,
} from "./metricAnalyses";

export const factMetricsRoutes: OpenApiRoute[] = [
  listFactMetrics,
  postFactMetric,
  getFactMetric,
  updateFactMetric,
  deleteFactMetric,
  postFactMetricAnalysis,
  getLatestFactMetricAnalysis,
  getMetricAnalysis,
  postMetricAnalysisCancel,
];
