import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import {
  apiExperimentResultsValidator,
  attributionModel,
  customMetricSlice,
  lookbackOverride,
  metricOverride,
} from "./experiments";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const reportAnalysisSettingsSchema = z
  .object({
    statsEngine: z.enum(["bayesian", "frequentist"]).optional(),
    goalMetrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z.string().optional(),
    metricOverrides: z
      .array(metricOverride)
      .describe("Per-metric window, risk, and regression-adjustment overrides")
      .optional(),
    customMetricSlices: z
      .array(customMetricSlice)
      .describe("Custom metric slice definitions")
      .optional(),
    dimension: z.string().optional(),
    differenceType: z
      .enum(["relative", "absolute", "scaled"])
      .describe(
        "How lifts are expressed in results: `relative` (% change), `absolute` (raw difference), or `scaled` (scaled impact)",
      )
      .optional(),
    dateStarted: z.string().optional(),
    dateEnded: z.string().optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z
      .number()
      .describe("Tuning parameter for sequential testing (frequentist only)")
      .optional(),
    attributionModel: z
      .enum(attributionModel)
      .describe(
        "Metric conversion window attribution model: `firstExposure`, `experimentDuration`, or `lookbackOverride`",
      )
      .optional(),
    lookbackOverride: lookbackOverride
      .describe(
        "Lookback window used when `attributionModel` is `lookbackOverride`",
      )
      .optional(),
    trackingKey: z
      .string()
      .describe("Tracking key used to identify experiment exposures")
      .optional(),
    exposureQueryId: z
      .string()
      .describe("Datasource exposure query ID (Assignment Table)")
      .optional(),
    segment: z.string().describe("Segment ID to filter users by").optional(),
    queryFilter: z
      .string()
      .describe("Raw SQL WHERE clause added to the exposure query")
      .optional(),
    skipPartialData: z
      .boolean()
      .describe(
        "When true, exclude users who have not completed the full conversion window",
      )
      .optional(),
  })
  .strict();

export const reportShareLevelSchema = z
  .enum(["public", "organization", "private"])
  .describe(
    "Visibility of the report. `private` (default) restricts access to the API caller and admins. `organization` makes it visible to all members of the organization in the GrowthBook UI. `public` additionally exposes it via a shareable URL (returned as `shareUrl`); anyone with the URL can view it without authentication.",
  );

export const apiReportValidator = namedSchema(
  "Report",
  z.object({
    id: z.string(),
    dateCreated: z.string(),
    dateUpdated: z.string(),
    title: z.string(),
    description: z.string(),
    type: z
      .enum(["experiment-snapshot", "experiment"])
      .describe(
        "Report type. `experiment-snapshot` is the current shape and is what `POST /reports` always creates. `experiment` is a deprecated legacy shape that is read-only through this API; it cannot be created or refreshed and is preserved only for backward compatibility when reading reports created before the new shape existed.",
      ),
    status: z
      .enum(["published", "private"])
      .describe(
        "UI lifecycle marker. Note: this does NOT control public shareability — see `shareLevel` for visibility controls.",
      )
      .optional(),
    shareLevel: reportShareLevelSchema.optional(),
    shareUrl: z
      .string()
      .describe(
        "Public URL for viewing the report. Only present when `shareLevel` is `public`.",
      )
      .optional(),
    experimentId: z.string().optional(),
    snapshotId: z
      .string()
      .describe("Snapshot ID (experiment-snapshot type only)")
      .optional(),
    snapshotStatus: z
      .enum(["running", "success", "error"])
      .describe("Status of the latest snapshot (poll this after refresh)")
      .optional(),
    snapshotError: z
      .string()
      .describe("Error message if snapshot failed")
      .optional(),
    analysisSettings: reportAnalysisSettingsSchema.optional(),
    experimentMetadata: z
      .object({
        type: z
          .enum(["standard", "multi-armed-bandit", "holdout"])
          .describe("Experiment type")
          .optional(),
        variations: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              key: z.string(),
              weight: z.number().describe("Traffic weight (0–1)"),
            }),
          )
          .describe(
            "Variation metadata with current traffic weights — use to label result columns",
          )
          .optional(),
        phases: z
          .array(
            z.object({
              name: z.string().optional(),
              dateStarted: z.string().optional(),
              dateEnded: z.string().optional(),
              coverage: z
                .number()
                .describe("Traffic coverage (0–1)")
                .optional(),
            }),
          )
          .describe("Experiment phases")
          .optional(),
      })
      .optional(),
    results: apiExperimentResultsValidator.optional(),
  }),
);

export type ApiReport = z.infer<typeof apiReportValidator>;

// ---- Route validators ----

export const listReportsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      experimentId: z
        .string()
        .describe("Filter reports by experiment id")
        .optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      reports: z.array(apiReportValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all reports",
  operationId: "listReports",
  tags: ["reports"],
  method: "get" as const,
  path: "/reports",
};

export const getReportValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      report: apiReportValidator,
    })
    .strict(),
  summary: "Get a single report",
  operationId: "getReport",
  tags: ["reports"],
  method: "get" as const,
  path: "/reports/:id",
};

const postReportBody = z
  .object({
    experimentId: z.string().describe("The experiment to create a report for"),
    title: z
      .string()
      .describe("Report title (defaults to experiment name)")
      .optional(),
    description: z.string().describe("Report description").optional(),
    statsEngine: z
      .enum(["bayesian", "frequentist"])
      .describe("Stats engine override")
      .optional(),
    goalMetrics: z
      .array(z.string())
      .describe("Goal metric IDs (defaults to experiment's goal metrics)")
      .optional(),
    secondaryMetrics: z
      .array(z.string())
      .describe(
        "Secondary metric IDs (defaults to experiment's secondary metrics)",
      )
      .optional(),
    guardrailMetrics: z
      .array(z.string())
      .describe(
        "Guardrail metric IDs (defaults to experiment's guardrail metrics)",
      )
      .optional(),
    activationMetric: z.string().describe("Activation metric ID").optional(),
    dimension: z.string().describe("Dimension to cut results by").optional(),
    dateStarted: z
      .string()
      .datetime({ offset: true })
      .describe("Analysis start date (ISO 8601)")
      .optional(),
    dateEnded: z
      .string()
      .datetime({ offset: true })
      .describe("Analysis end date (ISO 8601)")
      .optional(),
    regressionAdjustmentEnabled: z
      .boolean()
      .describe("Enable CUPED regression adjustment")
      .optional(),
    sequentialTestingEnabled: z
      .boolean()
      .describe("Enable sequential testing")
      .optional(),
    sequentialTestingTuningParameter: z
      .number()
      .describe("Tuning parameter for sequential testing (frequentist only)")
      .optional(),
    differenceType: z
      .enum(["relative", "absolute", "scaled"])
      .describe(
        "How lifts are expressed in results. Defaults to experiment setting.",
      )
      .optional(),
    attributionModel: z
      .enum(attributionModel)
      .describe(
        "Metric conversion window attribution model. Defaults to experiment setting.",
      )
      .optional(),
    lookbackOverride: lookbackOverride
      .describe("Lookback window when `attributionModel` is `lookbackOverride`")
      .optional(),
    metricOverrides: z
      .array(metricOverride)
      .describe("Per-metric window, risk, and regression-adjustment overrides")
      .optional(),
    customMetricSlices: z
      .array(customMetricSlice)
      .describe("Custom metric slice definitions")
      .optional(),
    segment: z
      .string()
      .describe(
        "Segment ID to filter users by. Defaults to experiment setting.",
      )
      .optional(),
    queryFilter: z
      .string()
      .describe(
        "Raw SQL WHERE clause added to the exposure query. Defaults to experiment setting.",
      )
      .optional(),
    skipPartialData: z
      .boolean()
      .describe(
        "When true, exclude users who have not completed the full conversion window.",
      )
      .optional(),
    shareLevel: reportShareLevelSchema
      .describe(
        "Visibility of the created report. Defaults to `private`. Set to `public` to receive a shareable `shareUrl` in the response.",
      )
      .optional(),
  })
  .strict();

const putReportBody = z
  .object({
    title: z.string().describe("Updated report title").optional(),
    description: z.string().describe("Updated report description").optional(),
    shareLevel: reportShareLevelSchema
      .describe(
        "Update the visibility of the report. Setting this to `public` is the only way to enable a `shareUrl`; setting it back to `organization` or `private` revokes public access (the underlying share token is preserved, so re-publishing exposes the same URL).",
      )
      .optional(),
  })
  .strict();

export const postReportValidator = {
  bodySchema: postReportBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      report: apiReportValidator,
    })
    .strict(),
  summary: "Create a new report",
  operationId: "postReport",
  tags: ["reports"],
  method: "post" as const,
  path: "/reports",
};

export const postReportRefreshValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      report: apiReportValidator,
    })
    .strict(),
  summary: "Refresh a report by re-running its analysis",
  operationId: "postReportRefresh",
  tags: ["reports"],
  method: "post" as const,
  path: "/reports/:id/refresh",
};

export const putReportValidator = {
  bodySchema: putReportBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      report: apiReportValidator,
    })
    .strict(),
  summary: "Update a report's title, description, or share level",
  operationId: "putReport",
  tags: ["reports"],
  method: "put" as const,
  path: "/reports/:id",
};
