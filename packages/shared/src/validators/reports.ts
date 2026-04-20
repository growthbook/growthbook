import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import { apiExperimentResultsValidator } from "./experiments";
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
    dateStarted: z.string().optional(),
    dateEnded: z.string().optional(),
  })
  .strict();

export const apiReportValidator = namedSchema(
  "Report",
  z.object({
    id: z.string(),
    dateCreated: z.string(),
    dateUpdated: z.string(),
    title: z.string(),
    description: z.string(),
    type: z.enum(["experiment-snapshot", "experiment"]),
    status: z.enum(["published", "private"]).optional(),
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
      .describe("Analysis start date (ISO 8601)")
      .optional(),
    dateEnded: z.string().describe("Analysis end date (ISO 8601)").optional(),
    regressionAdjustmentEnabled: z
      .boolean()
      .describe("Enable CUPED regression adjustment")
      .optional(),
    sequentialTestingEnabled: z
      .boolean()
      .describe("Enable sequential testing")
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
