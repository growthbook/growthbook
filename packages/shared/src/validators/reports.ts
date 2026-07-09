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
    dateStarted: z.string().meta({ format: "date-time" }).optional(),
    dateEnded: z.string().meta({ format: "date-time" }).optional(),
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
      .meta({ format: "date-time" })
      .describe("Analysis start date (ISO 8601)")
      .optional(),
    dateEnded: z
      .string()
      .meta({ format: "date-time" })
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

const putReportMetadataBody = z
  .object({
    title: z.string().describe("Report title").optional(),
    description: z.string().describe("Report description").optional(),
    status: z
      .enum(["published", "private"])
      .describe("UI lifecycle marker for the report")
      .optional(),
    shareLevel: reportShareLevelSchema
      .describe(
        "Visibility of the report. Setting to `public` enables a shareable `shareUrl`; setting back to `organization` or `private` revokes public access (the share token is preserved, so re-publishing exposes the same URL).",
      )
      .optional(),
    editLevel: z
      .enum(["organization", "private"])
      .describe(
        "Who can edit the report in the GrowthBook UI. `organization` allows any org member with the `createAnalyses` permission; `private` restricts editing to the report owner.",
      )
      .optional(),
  })
  .strict();

export const putReportMetadataValidator = {
  bodySchema: putReportMetadataBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ report: apiReportValidator }).strict(),
  summary: "Update report metadata (title, description, visibility)",
  operationId: "putReportMetadata",
  tags: ["reports"],
  method: "put" as const,
  path: "/reports/:id/metadata",
};

const putReportSettingsBody = z
  .object({
    statsEngine: z
      .enum(["bayesian", "frequentist"])
      .describe("Stats engine override")
      .optional(),
    goalMetrics: z.array(z.string()).describe("Goal metric IDs").optional(),
    secondaryMetrics: z
      .array(z.string())
      .describe("Secondary metric IDs")
      .optional(),
    guardrailMetrics: z
      .array(z.string())
      .describe("Guardrail metric IDs")
      .optional(),
    activationMetric: z.string().describe("Activation metric ID").optional(),
    metricOverrides: z
      .array(metricOverride)
      .describe("Per-metric window, risk, and regression-adjustment overrides")
      .optional(),
    customMetricSlices: z
      .array(customMetricSlice)
      .describe("Custom metric slice definitions")
      .optional(),
    dimension: z.string().describe("Dimension to cut results by").optional(),
    differenceType: z
      .enum(["relative", "absolute", "scaled"])
      .describe("How lifts are expressed in results")
      .optional(),
    dateStarted: z
      .string()
      .meta({ format: "date-time" })
      .describe("Analysis start date (ISO 8601)")
      .optional(),
    dateEnded: z
      .string()
      .meta({ format: "date-time" })
      .nullable()
      .describe(
        "Analysis end date (ISO 8601). Pass `null` to clear the end date and analyze through today.",
      )
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
    attributionModel: z
      .enum(attributionModel)
      .describe("Metric conversion window attribution model")
      .optional(),
    lookbackOverride: lookbackOverride
      .describe("Lookback window when `attributionModel` is `lookbackOverride`")
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
    variations: z
      .array(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          key: z.string().optional(),
          weight: z
            .number()
            .min(0)
            .max(1)
            .describe("Traffic weight (0–1)")
            .optional(),
        }),
      )
      .describe(
        "Override variation names, keys, or traffic weights used in this report. Weights are merged into the latest phase. Changes take effect on the next refresh.",
      )
      .optional(),
    coverage: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Traffic coverage (0–1) for the latest phase. Used when computing scaled impact.",
      )
      .optional(),
  })
  .strict();

export const putReportSettingsValidator = {
  bodySchema: putReportSettingsBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ report: apiReportValidator }).strict(),
  summary: "Update report analysis settings",
  description:
    "Updates the analysis settings for an existing report. Changes are staged and do not take effect until you call `POST /reports/:id/refresh`.",
  operationId: "putReportSettings",
  tags: ["reports"],
  method: "put" as const,
  path: "/reports/:id/settings",
};
