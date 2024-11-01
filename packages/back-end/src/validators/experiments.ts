import { z } from "zod";
import { windowTypeValidator } from "back-end/src/routers/fact-table/fact-table.validators";
import { statsEngines } from "back-end/src/util/constants";
import {
  namespaceValue,
  featurePrerequisite,
  savedGroupTargeting,
} from "./features";

export const experimentResultsType = [
  "dnf",
  "won",
  "lost",
  "inconclusive",
] as const;
export type ExperimentResultsType = typeof experimentResultsType[number];

export const singleVariationResult = z.object({
  users: z.number().optional(),
  cr: z.number().optional(),
  ci: z.tuple([z.number(), z.number()]).optional(),
});

export const banditResult = z.object({
  singleVariationResults: z.array(singleVariationResult).optional(),
  currentWeights: z.array(z.number()),
  updatedWeights: z.array(z.number()),
  srm: z.number().optional(),
  bestArmProbabilities: z.array(z.number()).optional(),
  seed: z.number().optional(),
  updateMessage: z.string().optional(),
  error: z.string().optional(),
  reweight: z.boolean().optional(),
  weightsWereUpdated: z.boolean().optional(),
});

export const banditEvent = z
  .object({
    date: z.date(),
    banditResult: banditResult,
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
    namespace: namespaceValue,
    seed: z.string().optional(),
    variationWeights: z.array(z.number()),
    banditEvents: z.array(banditEvent).optional(),
  })
  .strict();
export type ExperimentPhase = z.infer<typeof experimentPhase>;

export const experimentStatus = ["draft", "running", "stopped"] as const;
export type ExperimentStatus = typeof experimentStatus[number];

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
] as const;
export type AttributionModel = typeof attributionModel[number];

export const implementationType = [
  "visual",
  "code",
  "configuration",
  "custom",
] as const;
export type ImplementationType = typeof implementationType[number];

export const experimentNotification = [
  "auto-update",
  "multiple-exposures",
  "srm",
  "significance",
] as const;
export type ExperimentNotification = typeof experimentNotification[number];

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

export const experimentType = ["standard", "multi-armed-bandit"] as const;
export type ExperimentType = typeof experimentType[number];

export const banditStageType = ["explore", "exploit", "paused"] as const;
export type banditStageType = typeof banditStageType[number];

export const experimentInterface = z
  .object({
    id: z.string(),
    trackingKey: z.string(),
    organization: z.string(),
    project: z.string().optional(),
    owner: z.string(),
    datasource: z.string(),
    exposureQueryId: z.string(),
    /**
     * @deprecated Always set to 'code'
     */
    implementation: z.enum(implementationType),
    /**
     * @deprecated
     */
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
    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    guardrailMetrics: z.array(z.string()),
    activationMetric: z.string().optional(),
    metricOverrides: z.array(metricOverride).optional(),
    segment: z.string().optional(),
    queryFilter: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    attributionModel: z.enum(attributionModel).optional(),
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
    regressionAdjustmentEnabled: z.boolean().optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    statsEngine: z.enum(statsEngines).optional(),
    manualLaunchChecklist: z
      .array(
        z
          .object({
            key: z.string(),
            status: z.enum(["complete", "incomplete"]),
          })
          .strict()
      )
      .optional(),
    type: z.enum(experimentType).optional(),
    banditStage: z.enum(banditStageType).optional(),
    banditStageDateStarted: z.date().optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["hours", "days"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["hours", "days"]).optional(),
  })
  .strict();
export type ExperimentInterface = z.infer<typeof experimentInterface>;
