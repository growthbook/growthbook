import { z } from "zod";
import { statsEngines } from "shared/constants";
import {
  ciTupleValidator,
  namespaceValue,
  featurePrerequisite,
  savedGroupTargeting,
} from "./shared";
import { windowTypeValidator } from "./fact-table";

export const customMetricSlice = z.object({
  slices: z.array(
    z.object({
      column: z.string(),
      levels: z.array(z.string()),
    }),
  ),
});
export type CustomMetricSlice = z.infer<typeof customMetricSlice>;

export const experimentResultsType = [
  "dnf",
  "won",
  "lost",
  "inconclusive",
] as const;
export type ExperimentResultsType = (typeof experimentResultsType)[number];

export const singleVariationResult = z.object({
  users: z.number().optional(),
  cr: z.number().optional(),
  ci: ciTupleValidator.optional(),
});

export const banditResult = z.object({
  singleVariationResults: z.array(singleVariationResult).optional(),
  currentWeights: z.array(z.number()),
  updatedWeights: z.array(z.number()),
  bestArmProbabilities: z.array(z.number()).optional(),
  seed: z.number().optional(),
  updateMessage: z.string().optional(),
  error: z.string().optional(),
  reweight: z.boolean().optional(),
  weightsWereUpdated: z.boolean().optional(),
  /** @deprecated */
  srm: z.number().optional(),
});

export const banditEvent = z
  .object({
    date: z.date(),
    banditResult: banditResult,
    health: z
      .object({
        srm: z.number().optional(),
      })
      .optional(),
    snapshotId: z.string().optional(), // 0th may not have snapshot
  })
  .strict();

export type BanditResult = z.infer<typeof banditResult>;
export type BanditEvent = z.infer<typeof banditEvent>;

export const experimentPhase = z
  .object({
    dateStarted: z.date(),
    dateEnded: z.date().optional(),
    name: z.string().min(1),
    reason: z.string(),
    coverage: z.number(),
    condition: z.string(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    namespace: namespaceValue.optional(),
    seed: z.string().optional(),
    variationWeights: z.array(z.number()),
    banditEvents: z.array(banditEvent).optional(),
    lookbackStartDate: z.date().optional(),
  })
  .strict();
export type ExperimentPhase = z.infer<typeof experimentPhase>;

export const experimentStatus = ["draft", "running", "stopped"] as const;
export type ExperimentStatus = (typeof experimentStatus)[number];

export const screenshot = z
  .object({
    path: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    description: z.string().optional(),
  })
  .strict();
export type Screenshot = z.infer<typeof screenshot>;

export const variation = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    key: z.string(),
    screenshots: z.array(screenshot),
  })
  .strict();
export type Variation = z.infer<typeof variation>;

export const attributionModel = [
  "firstExposure",
  "experimentDuration",
  "lookbackOverride",
] as const;
export type AttributionModel = (typeof attributionModel)[number];

export const implementationType = [
  "visual",
  "code",
  "configuration",
  "custom",
] as const;
export type ImplementationType = (typeof implementationType)[number];

export const experimentNotification = [
  "auto-update",
  "multiple-exposures",
  "srm",
  "significance",
] as const;
export type ExperimentNotification = (typeof experimentNotification)[number];

export const metricOverride = z
  .object({
    id: z.string(),
    windowType: windowTypeValidator.optional(),
    windowHours: z.number().optional(),
    delayHours: z.number().optional(),
    winRisk: z.number().optional(),
    loseRisk: z.number().optional(),
    properPriorOverride: z.boolean().optional(),
    properPriorEnabled: z.boolean().optional(),
    properPriorMean: z.number().optional(),
    properPriorStdDev: z.number().optional(),
    regressionAdjustmentOverride: z.boolean().optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),
    regressionAdjustmentDays: z.number().optional(),
  })
  .strict();
export type MetricOverride = z.infer<typeof metricOverride>;

export const experimentType = [
  "standard",
  "multi-armed-bandit",
  "holdout",
] as const;
export type ExperimentType = (typeof experimentType)[number];

export const banditStageType = ["explore", "exploit", "paused"] as const;
export type BanditStageType = (typeof banditStageType)[number];

export const decisionFrameworkMetricOverrides = z.object({
  id: z.string(),
  targetMDE: z.number().optional(),
});
export type DecisionFrameworkMetricOverrides = z.infer<
  typeof decisionFrameworkMetricOverrides
>;

export const experimentDecisionFrameworkSettings = z.object({
  decisionCriteriaId: z.string().optional(),
  decisionFrameworkMetricOverrides: z
    .array(decisionFrameworkMetricOverrides)
    .optional(),
});
export type ExperimentDecisionFrameworkSettings = z.infer<
  typeof experimentDecisionFrameworkSettings
>;

export const lookbackOverrideValueUnit = z.enum([
  "minutes",
  "hours",
  "days",
  "weeks",
]);
export type LookbackOverrideValueUnit = z.infer<
  typeof lookbackOverrideValueUnit
>;

export const lookbackOverride = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("date"),
    value: z.coerce.date(),
  }),
  z.object({
    type: z.literal("window"),
    value: z.number().min(0),
    valueUnit: lookbackOverrideValueUnit,
  }),
]);
export type LookbackOverride = z.infer<typeof lookbackOverride>;

export const experimentAnalysisSettings = z
  .object({
    trackingKey: z.string(),
    datasource: z.string(),
    exposureQueryId: z.string(),
    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    guardrailMetrics: z.array(z.string()),
    activationMetric: z.string().optional(),
    metricOverrides: z.array(metricOverride).optional(),
    lookbackOverride: lookbackOverride.optional(),
    decisionFrameworkSettings: experimentDecisionFrameworkSettings,
    segment: z.string().optional(),
    queryFilter: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    attributionModel: z.enum(attributionModel).optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),
    postStratificationEnabled: z.boolean().nullable().optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    statsEngine: z.enum(statsEngines).optional(),
    customMetricSlices: z.array(customMetricSlice).optional(),
  })
  .strict();
export type ExperimentAnalysisSettings = z.infer<
  typeof experimentAnalysisSettings
>;

export const experimentAnalysisSummaryHealth = z.object({
  srm: z.number(),
  multipleExposures: z.number(),
  totalUsers: z.number().nullable(),
  power: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("error"),
        errorMessage: z.string(),
      }),
      z.object({
        type: z.literal("success"),
        isLowPowered: z.boolean(),
        additionalDaysNeeded: z.number(),
      }),
    ])
    .optional(),
});
export type ExperimentAnalysisSummaryHealth = z.infer<
  typeof experimentAnalysisSummaryHealth
>;

export const goalMetricStatus = ["won", "lost", "neutral"] as const;
export type GoalMetricStatus = (typeof goalMetricStatus)[number];

export const guardrailMetricStatus = ["safe", "lost", "neutral"] as const;
export type GuardrailMetricStatus = (typeof guardrailMetricStatus)[number];

export const goalMetricResult = z.object({
  status: z.enum(goalMetricStatus),
  superStatSigStatus: z.enum(goalMetricStatus),
});
export type GoalMetricResult = z.infer<typeof goalMetricResult>;

export const experimentAnalysisSummaryVariationStatus = z.object({
  variationId: z.string(),
  goalMetrics: z.record(z.string(), goalMetricResult).optional(),
  guardrailMetrics: z
    .record(z.string(), z.object({ status: z.enum(guardrailMetricStatus) }))
    .optional(),
});
export type ExperimentAnalysisSummaryVariationStatus = z.infer<
  typeof experimentAnalysisSummaryVariationStatus
>;

export const experimentAnalysisSummaryResultsStatus = z.object({
  variations: z.array(experimentAnalysisSummaryVariationStatus),
  settings: z.object({
    sequentialTesting: z.boolean(),
  }),
});
export type ExperimentAnalysisSummaryResultsStatus = z.infer<
  typeof experimentAnalysisSummaryResultsStatus
>;

export const experimentAnalysisSummary = z
  .object({
    snapshotId: z.string(),
    health: experimentAnalysisSummaryHealth.optional(),
    resultsStatus: experimentAnalysisSummaryResultsStatus.optional(),
    precomputedDimensions: z.array(z.string()).optional(),
  })
  .strict();

export type ExperimentAnalysisSummary = z.infer<
  typeof experimentAnalysisSummary
>;

export const experimentInterface = z
  .object({
    id: z.string(),
    uid: z.string().optional(),
    organization: z.string(),
    project: z.string().optional(),
    owner: z.string(),
    /** @deprecated Always set to 'code' */
    implementation: z.enum(implementationType),
    /** @deprecated */
    userIdType: z.enum(["anonymous", "user"]).optional(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]),
    disableStickyBucketing: z.boolean().optional(),
    pastNotifications: z.array(z.enum(experimentNotification)).optional(),
    bucketVersion: z.number().optional(),
    minBucketVersion: z.number().optional(),
    name: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    tags: z.array(z.string()),
    description: z.string().optional(),
    hypothesis: z.string().optional(),
    /** @deprecated related to HypGen */
    autoAssign: z.boolean(),
    previewURL: z.string(),
    targetURLRegex: z.string(),
    variations: z.array(variation),
    archived: z.boolean(),
    status: z.enum(experimentStatus),
    phases: z.array(experimentPhase),
    results: z.enum(experimentResultsType).optional(),
    winner: z.number().optional(),
    analysis: z.string().optional(),
    releasedVariationId: z.string(),
    excludeFromPayload: z.boolean().optional(),
    lastSnapshotAttempt: z.date().optional(),
    nextSnapshotAttempt: z.date().optional(),
    autoSnapshots: z.boolean(),
    ideaSource: z.string().optional(),
    hasVisualChangesets: z.boolean().optional(),
    hasURLRedirects: z.boolean().optional(),
    linkedFeatures: z.array(z.string()).optional(),
    manualLaunchChecklist: z
      .array(
        z
          .object({
            key: z.string(),
            status: z.enum(["complete", "incomplete"]),
          })
          .strict(),
      )
      .optional(),
    type: z.enum(experimentType).optional(),
    banditStage: z.enum(banditStageType).optional(),
    banditStageDateStarted: z.date().optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["hours", "days"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["hours", "days"]).optional(),
    customFields: z.record(z.string(), z.any()).optional(),
    templateId: z.string().optional(),
    shareLevel: z.enum(["public", "organization"]).optional(),
    analysisSummary: experimentAnalysisSummary.optional(),
    dismissedWarnings: z.array(z.enum(["low-power"])).optional(),
    holdoutId: z.string().optional(),
    defaultDashboardId: z.string().optional(),
    customMetricSlices: z.array(customMetricSlice).optional(),
  })
  .strict()
  .merge(experimentAnalysisSettings);
export type ExperimentInterface = z.infer<typeof experimentInterface>;

// Excludes "holdout" from the type property for the experiments API
export type ExperimentInterfaceExcludingHoldouts = Omit<
  ExperimentInterface,
  "type"
> & {
  type?: Exclude<ExperimentInterface["type"], "holdout">;
};
