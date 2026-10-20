import { z } from "zod";
import {
  apiBaseSchema,
  apiMetricAnalysisIdValidator,
  apiMetricAnalysisReturn,
  apiMetricAnalysisValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

// Custom rather than the default CRUD get, whose response would need
// MetricAnalysis to require its dates (POST /fact-metrics/{id}/analysis omits them)
export const getMetricAnalysisEndpoint = {
  pathFragment: "/:id",
  verb: "get" as const,
  operationId: "getMetricAnalysis",
  validator: apiMetricAnalysisIdValidator,
  zodReturnObject: apiMetricAnalysisReturn,
  summary: "Get a metric analysis and its results",
  description: "Poll until `status` is no longer running.",
};

export const cancelMetricAnalysisEndpoint = {
  pathFragment: "/:id/cancel",
  verb: "post" as const,
  confirmation: ["other.write"] as const,
  operationId: "postMetricAnalysisCancel",
  validator: apiMetricAnalysisIdValidator,
  zodReturnObject: apiMetricAnalysisReturn,
  summary: "Cancel a running metric analysis",
};

export const metricAnalysisApiSpec = {
  modelSingular: "metricAnalysis",
  modelPlural: "metricAnalyses",
  pathBase: "/metric-analyses",
  // Only types the model's toApiInterface; no CRUD route returns it
  apiInterface: apiMetricAnalysisValidator.extend({
    dateCreated: apiBaseSchema.shape.dateCreated,
    dateUpdated: apiBaseSchema.shape.dateUpdated,
  }),
  schemas: {
    createBody: z.object({}),
    updateBody: z.object({}),
  },
  crudActions: [] as const,
  customEndpoints: [getMetricAnalysisEndpoint, cancelMetricAnalysisEndpoint],
  tag: "fact-metrics",
} satisfies OpenApiModelSpec;
export default metricAnalysisApiSpec;
