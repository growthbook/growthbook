import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/Settings.yaml
export const apiSettingsValidator = namedSchema(
  "Settings",
  z
    .object({
      confidenceLevel: z.coerce.number(),
      northStar: z
        .object({
          title: z.string().optional(),
          metricIds: z.array(z.string()).optional(),
        })
        .nullable(),
      metricDefaults: z.object({
        priorSettings: z
          .object({
            override: z.boolean(),
            proper: z.boolean(),
            mean: z.coerce.number(),
            stddev: z.coerce.number(),
          })
          .optional(),
        minimumSampleSize: z.coerce.number().optional(),
        maxPercentageChange: z.coerce.number().optional(),
        minPercentageChange: z.coerce.number().optional(),
        targetMDE: z.coerce.number().optional(),
      }),
      pastExperimentsMinLength: z.coerce.number(),
      metricAnalysisDays: z.coerce.number(),
      updateSchedule: z
        .object({
          type: z.enum(["cron", "never", "stale"]).optional(),
          cron: z.string().nullable().optional(),
          hours: z.coerce.number().nullable().optional(),
        })
        .nullable(),
      multipleExposureMinPercent: z.coerce.number(),
      defaultRole: z.object({
        role: z.string().optional(),
        limitAccessByEnvironment: z.boolean().optional(),
        environments: z.array(z.string()).optional(),
      }),
      statsEngine: z.string(),
      pValueThreshold: z.coerce.number(),
      regressionAdjustmentEnabled: z.boolean(),
      regressionAdjustmentDays: z.coerce.number(),
      sequentialTestingEnabled: z.boolean(),
      sequentialTestingTuningParameter: z.coerce.number(),
      attributionModel: z.enum([
        "firstExposure",
        "experimentDuration",
        "lookbackOverride",
      ]),
      targetMDE: z.coerce.number(),
      delayHours: z.coerce.number(),
      windowType: z.string(),
      windowHours: z.coerce.number(),
      winRisk: z.coerce.number(),
      loseRisk: z.coerce.number(),
      secureAttributeSalt: z.string(),
      killswitchConfirmation: z.boolean(),
      featureKillSwitchBehavior: z.enum(["off", "warn"]).optional(),
      requireReviews: z.array(
        z.object({
          requireReviewOn: z.boolean().optional(),
          resetReviewOnChange: z.boolean().optional(),
          environments: z.array(z.string()).optional(),
          projects: z.array(z.string()).optional(),
          featureRequireEnvironmentReview: z.boolean().optional(),
          featureRequireMetadataReview: z.boolean().optional(),
        }),
      ),
      restApiBypassesReviews: z.boolean().optional(),
      featureKeyExample: z.string(),
      featureRegexValidator: z.string(),
      banditScheduleValue: z.coerce.number(),
      banditScheduleUnit: z.enum(["hours", "days"]),
      banditBurnInValue: z.coerce.number(),
      banditBurnInUnit: z.enum(["hours", "days"]),
      experimentMinLengthDays: z.coerce.number(),
      experimentMaxLengthDays: z.coerce.number().nullable().optional(),
      preferredEnvironment: z.string().nullable().optional(),
      maxMetricSliceLevels: z.coerce.number().optional(),
    })
    .strict(),
);

export const getSettingsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      settings: apiSettingsValidator,
    })
    .strict(),
  summary: "Get organization settings",
  operationId: "getSettings",
  tags: ["settings"],
  method: "get" as const,
  path: "/settings",
};
