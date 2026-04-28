import { z } from "zod";
import { statsEngines } from "shared/constants";
import {
  namespaceValue,
  featurePrerequisite,
  savedGroupTargeting,
  paginationQueryFields,
  apiPaginationFieldsValidator,
} from "./shared";
import { windowTypeValidator } from "./fact-table";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

import { namedSchema } from "./openapi-helpers";

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
  ci: z
    .tuple([
      z.number().or(z.literal(-Infinity)),
      z.number().or(z.literal(Infinity)),
    ])
    .optional(),
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

// TODO(phase-update): allow "passThrough" e.g. forcibly skip a range
// and send users to the next feature rule
export const variationStatus = ["active"] as const;
export type VariationStatus = (typeof variationStatus)[number];

export const phaseVariation = z
  .object({
    id: z.string(),
    status: z.enum(variationStatus),
  })
  .strict();
export type PhaseVariation = z.infer<typeof phaseVariation>;

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
    variations: z.array(phaseVariation),
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
  covariateImbalance: z
    .object({
      isImbalanced: z.boolean(),
    })
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
    owner: ownerField,
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
    banditConversionWindowValue: z.number().optional().nullable(),
    banditConversionWindowUnit: z.enum(["hours", "days"]).optional().nullable(),
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

// ---------------------------------------------------------------------------
// API validators (migrated from openapi.ts)
// These correspond to the external REST API schemas for experiments & snapshots.
// ---------------------------------------------------------------------------

// Corresponds to schemas/ExperimentMetric.yaml
const apiExperimentMetricOverrides = z.object({
  delayHours: z.coerce.number().optional(),
  windowHours: z.coerce.number().optional(),
  window: z.enum(["conversion", "lookback", ""]).optional(),
  winRiskThreshold: z.coerce.number().optional().meta({ deprecated: true }),
  loseRiskThreshold: z.coerce.number().optional().meta({ deprecated: true }),
  properPriorOverride: z.boolean().optional(),
  properPriorEnabled: z.boolean().optional(),
  properPriorMean: z.coerce.number().optional(),
  properPriorStdDev: z.coerce.number().optional(),
  regressionAdjustmentOverride: z.boolean().optional(),
  regressionAdjustmentEnabled: z.boolean().optional(),
  regressionAdjustmentDays: z.coerce.number().optional(),
});

// Corresponds to schemas/ExperimentMetric.yaml
export const apiExperimentMetricValidator = namedSchema(
  "ExperimentMetric",
  z
    .object({
      metricId: z.string(),
      overrides: apiExperimentMetricOverrides,
    })
    .strict(),
);

export type ApiExperimentMetric = z.infer<typeof apiExperimentMetricValidator>;

// Corresponds to schemas/ExperimentMetricOverrideEntry.yaml
export const apiExperimentMetricOverrideEntryValidator = namedSchema(
  "ExperimentMetricOverrideEntry",
  z
    .object({
      id: z.string().describe("ID of the metric to override settings for."),
      windowType: z.enum(["conversion", "lookback", ""]).optional(),
      windowHours: z.coerce.number().optional(),
      delayHours: z.coerce.number().optional(),
      properPriorOverride: z
        .boolean()
        .describe(
          "Must be true for the override to take effect. If true, the other proper prior settings in this object will be used if present.",
        )
        .optional(),
      properPriorEnabled: z.boolean().optional(),
      properPriorMean: z.coerce.number().optional(),
      properPriorStdDev: z.coerce.number().optional(),
      regressionAdjustmentOverride: z
        .boolean()
        .describe(
          "Must be true for the override to take effect. If true, the other regression adjustment settings in this object will be used if present.",
        )
        .optional(),
      regressionAdjustmentEnabled: z.boolean().optional(),
      regressionAdjustmentDays: z.coerce.number().optional(),
    })
    .strict()
    .describe(
      "Per-metric analysis overrides stored on the experiment (matches internal metricOverrides).",
    ),
);

// Corresponds to schemas/ExperimentDecisionFrameworkSettings.yaml
export const apiExperimentDecisionFrameworkSettingsValidator = namedSchema(
  "ExperimentDecisionFrameworkSettings",
  z
    .object({
      decisionCriteriaId: z.string().optional(),
      decisionFrameworkMetricOverrides: z
        .array(
          z.object({
            id: z
              .string()
              .describe("ID of the metric to override settings for."),
            targetMDE: z.coerce
              .number()
              .gt(0)
              .describe(
                "The target relative MDE to use for the metric, expressed as proportions (e.g. use 0.1 for 10%). Must be greater than 0.",
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .strict()
    .describe(
      "Controls the decision framework and metric overrides for the experiment. Replaces the entire stored object on update (does not patch individual fields).",
    ),
);

// Corresponds to schemas/LookbackOverride.yaml (API version)
export const apiLookbackOverride = namedSchema(
  "LookbackOverride",
  z
    .object({
      type: z.enum(["date", "window"]),
      value: z
        .union([
          z.coerce
            .number()
            .describe(
              'For "window" type - non-negative numeric value (e.g. 7 for 7 days). For "date" type a date string.',
            ),
          z
            .string()
            .meta({ format: "date-time" })
            .describe(
              'For "window" type - non-negative numeric value (e.g. 7 for 7 days). For "date" type a date string.',
            ),
        ])
        .describe(
          'For "window" type - non-negative numeric value (e.g. 7 for 7 days). For "date" type a date string.',
        ),
      valueUnit: z
        .enum(["minutes", "hours", "days", "weeks"])
        .describe('Used when type is "window". Defaults to "days".')
        .optional(),
    })
    .describe(
      'Controls the lookback override for the experiment. For type "window", value must be a non-negative number and valueUnit is required.',
    ),
);

// Non-coerced version for request bodies
const apiLookbackOverrideInput = z
  .object({
    type: z.enum(["date", "window"]),
    value: z
      .union([
        z
          .number()
          .describe(
            'For "window" type - non-negative numeric value (e.g. 7 for 7 days). For "date" type a date string.',
          ),
        z
          .string()
          .meta({ format: "date-time" })
          .describe(
            'For "window" type - non-negative numeric value (e.g. 7 for 7 days). For "date" type a date string.',
          ),
      ])
      .describe(
        'For "window" type - non-negative numeric value (e.g. 7 for 7 days). For "date" type a date string.',
      ),
    valueUnit: z
      .enum(["minutes", "hours", "days", "weeks"])
      .describe('Used when type is "window". Defaults to "days".')
      .optional(),
  })
  .describe(
    'Controls the lookback override for the experiment. For type "window", value must be a non-negative number and valueUnit is required.',
  );

// Corresponds to schemas/ExperimentAnalysisSettings.yaml (API version)
export const apiExperimentAnalysisSettingsValidator = namedSchema(
  "ExperimentAnalysisSettings",
  z
    .object({
      datasourceId: z.string(),
      assignmentQueryId: z.string(),
      experimentId: z.string(),
      segmentId: z.string(),
      queryFilter: z.string(),
      inProgressConversions: z.enum(["include", "exclude"]),
      attributionModel: z
        .enum(["firstExposure", "experimentDuration", "lookbackOverride"])
        .describe(
          'Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. Setting it to `"lookbackOverride"` requires a `lookbackOverride` object to be provided.',
        ),
      lookbackOverride: apiLookbackOverride.optional(),
      statsEngine: z.enum(["bayesian", "frequentist"]),
      regressionAdjustmentEnabled: z.boolean().optional(),
      sequentialTestingEnabled: z.boolean().optional(),
      sequentialTestingTuningParameter: z.coerce.number().optional(),
      postStratificationEnabled: z
        .union([
          z.boolean().describe("When null, the organization default is used."),
          z.null().describe("When null, the organization default is used."),
        ])
        .describe("When null, the organization default is used.")
        .optional(),
      decisionFrameworkSettings: apiExperimentDecisionFrameworkSettingsValidator
        .describe(
          "Controls the decision framework and metric overrides for the experiment. Replaces the entire stored object on update (does not patch individual fields).",
        )
        .optional(),
      metricOverrides: z
        .array(apiExperimentMetricOverrideEntryValidator)
        .describe(
          "Per-metric analysis overrides; also reflected in goals/secondaryMetrics/guardrails overrides when applicable. On create/update, this replaces the entire stored array (it does not patch individual entries).",
        )
        .optional(),
      goals: z.array(apiExperimentMetricValidator),
      secondaryMetrics: z.array(apiExperimentMetricValidator),
      guardrails: z.array(apiExperimentMetricValidator),
      activationMetric: apiExperimentMetricValidator.optional(),
    })
    .strict(),
);

// Variation sub-schema for API responses
const apiExperimentVariation = z.object({
  variationId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  screenshots: z.array(z.string()),
});

// Phase sub-schema for API responses
const apiExperimentPhase = z.object({
  name: z.string(),
  dateStarted: z.string(),
  dateEnded: z.string(),
  reasonForStopping: z.string(),
  seed: z.string(),
  coverage: z.coerce.number(),
  trafficSplit: z.array(
    z.object({
      variationId: z.string(),
      weight: z.coerce.number(),
    }),
  ),
  namespace: z
    .object({
      namespaceId: z.string(),
      enabled: z.boolean().optional(),
      /** @deprecated use `ranges`; populated with the first range for backward compatibility */
      range: z.array(z.number()).min(2).max(2).optional(),
      ranges: z.array(z.tuple([z.number(), z.number()])).optional(),
    })
    .optional(),
  targetingCondition: z.string(),
  prerequisites: z
    .array(
      z.object({
        id: z.string(),
        condition: z.string(),
      }),
    )
    .optional(),
  savedGroupTargeting: z
    .array(
      z.object({
        matchType: z.enum(["all", "any", "none"]),
        savedGroups: z.array(z.string()),
      }),
    )
    .optional(),
});

// Result summary sub-schema
const apiResultSummary = z.object({
  status: z.string(),
  winner: z.string(),
  conclusions: z.string(),
  releasedVariationId: z.string(),
  excludeFromPayload: z.boolean(),
});

// Custom metric slices sub-schema
const apiCustomMetricSlices = z
  .array(
    z.object({
      slices: z.array(
        z.object({
          column: z.string(),
          levels: z.array(z.string()),
        }),
      ),
    }),
  )
  .describe(
    "Custom slices that apply to ALL applicable metrics in the experiment",
  );

// Corresponds to schemas/Experiment.yaml
const apiExperimentShape = z.object({
  id: z.string(),
  trackingKey: z.string(),
  dateCreated: z.string().meta({ format: "date-time" }),
  dateUpdated: z.string().meta({ format: "date-time" }),
  name: z.string(),
  type: z.enum(["standard", "multi-armed-bandit"]),
  project: z.string(),
  hypothesis: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  owner: ownerField,
  ownerEmail: ownerEmailField,
  archived: z.boolean(),
  status: z.string(),
  autoRefresh: z.boolean(),
  hashAttribute: z.string(),
  fallbackAttribute: z.string().optional(),
  hashVersion: z.union([z.literal(1), z.literal(2)]),
  disableStickyBucketing: z.boolean().optional(),
  bucketVersion: z.coerce.number().optional(),
  minBucketVersion: z.coerce.number().optional(),
  variations: z.array(apiExperimentVariation),
  phases: z.array(apiExperimentPhase),
  settings: apiExperimentAnalysisSettingsValidator,
  resultSummary: apiResultSummary.optional(),
  shareLevel: z.enum(["public", "organization"]).optional(),
  publicUrl: z.string().optional(),
  banditScheduleValue: z.coerce.number().optional(),
  banditScheduleUnit: z.enum(["days", "hours"]).optional(),
  banditBurnInValue: z.coerce.number().optional(),
  banditBurnInUnit: z.enum(["days", "hours"]).optional(),
  banditConversionWindowValue: z.coerce.number().optional(),
  banditConversionWindowUnit: z.enum(["days", "hours"]).optional(),
  linkedFeatures: z.array(z.string()).optional(),
  hasVisualChangesets: z.boolean().optional(),
  hasURLRedirects: z.boolean().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  customMetricSlices: apiCustomMetricSlices.optional(),
  defaultDashboardId: z
    .string()
    .describe("ID of the default dashboard for this experiment.")
    .optional(),
  templateId: z.string().optional(),
});
export const apiExperimentValidator = namedSchema(
  "Experiment",
  apiExperimentShape.strict(),
);

export type ApiExperiment = z.infer<typeof apiExperimentValidator>;

// Corresponds to schemas/ExperimentWithEnhancedStatus.yaml (allOf Experiment + enhancedStatus)
// Uses the non-strict shape so z.intersection can add enhancedStatus.
export const apiExperimentWithEnhancedStatus = namedSchema(
  "ExperimentWithEnhancedStatus",
  z.intersection(
    apiExperimentShape,
    z.object({
      enhancedStatus: z
        .object({
          status: z.enum(["Running", "Stopped", "Draft", "Archived"]),
          detailedStatus: z.string().optional(),
        })
        .optional(),
    }),
  ),
);

// Corresponds to schemas/ExperimentSnapshot.yaml
const apiExperimentSnapshotShape = z.object({
  id: z.string(),
  experiment: z.string(),
  status: z.string(),
});
export const apiExperimentSnapshotValidator = namedSchema(
  "ExperimentSnapshot",
  apiExperimentSnapshotShape.strict(),
);

// Corresponds to schemas/ExperimentResults.yaml
export const apiExperimentResultsValidator = namedSchema(
  "ExperimentResults",
  z
    .object({
      id: z.string(),
      dateUpdated: z.string(),
      experimentId: z.string(),
      phase: z.string(),
      dateStart: z.string(),
      dateEnd: z.string(),
      dimension: z.object({
        type: z.string(),
        id: z.string().optional(),
      }),
      settings: apiExperimentAnalysisSettingsValidator,
      queryIds: z.array(z.string()),
      results: z.array(
        z.object({
          dimension: z.string(),
          totalUsers: z.coerce.number(),
          checks: z.object({
            srm: z.coerce.number(),
          }),
          metrics: z.array(
            z.object({
              metricId: z.string(),
              variations: z.array(
                z.object({
                  variationId: z.string(),
                  users: z.coerce.number().optional(),
                  analyses: z.array(
                    z.object({
                      engine: z.enum(["bayesian", "frequentist"]),
                      numerator: z.coerce.number(),
                      denominator: z.coerce.number(),
                      mean: z.coerce.number(),
                      stddev: z.coerce.number(),
                      percentChange: z.coerce.number(),
                      ciLow: z.coerce.number(),
                      ciHigh: z.coerce.number(),
                      pValue: z.coerce.number().optional(),
                      risk: z.coerce.number().optional(),
                      chanceToBeatControl: z.coerce.number().optional(),
                    }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    })
    .strict(),
);

export type ApiExperimentResults = z.infer<
  typeof apiExperimentResultsValidator
>;

// ---------------------------------------------------------------------------
// Shared sub-schemas for request payloads
// ---------------------------------------------------------------------------

// Decision framework settings for input (non-coerced numbers)
const apiDecisionFrameworkSettingsInput = z
  .object({
    decisionCriteriaId: z.string().optional(),
    decisionFrameworkMetricOverrides: z
      .array(
        z.object({
          id: z.string().describe("ID of the metric to override settings for."),
          targetMDE: z
            .number()
            .gt(0)
            .describe(
              "The target relative MDE to use for the metric, expressed as proportions (e.g. use 0.1 for 10%). Must be greater than 0.",
            )
            .optional(),
        }),
      )
      .optional(),
  })
  .describe(
    "Controls the decision framework and metric overrides for the experiment. Replaces the entire stored object on update (does not patch individual fields).",
  );

// Metric override entry for input (non-coerced numbers)
const apiMetricOverrideEntryInput = z
  .object({
    id: z.string().describe("ID of the metric to override settings for."),
    windowType: z.enum(["conversion", "lookback", ""]).optional(),
    windowHours: z.number().optional(),
    delayHours: z.number().optional(),
    properPriorOverride: z
      .boolean()
      .describe(
        "Must be true for the override to take effect. If true, the other proper prior settings in this object will be used if present.",
      )
      .optional(),
    properPriorEnabled: z.boolean().optional(),
    properPriorMean: z.number().optional(),
    properPriorStdDev: z.number().optional(),
    regressionAdjustmentOverride: z
      .boolean()
      .describe(
        "Must be true for the override to take effect. If true, the other regression adjustment settings in this object will be used if present.",
      )
      .optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),
    regressionAdjustmentDays: z.number().optional(),
  })
  .describe(
    "Per-metric analysis overrides stored on the experiment (matches internal metricOverrides).",
  );

// Variation for input payloads
const apiVariationInput = z.object({
  id: z.string().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  screenshots: z
    .array(
      z.object({
        path: z.string(),
        width: z.number().optional(),
        height: z.number().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

// Phase for input payloads
const apiPhaseInput = z.object({
  name: z.string(),
  dateStarted: z.string().meta({ format: "date-time" }),
  dateEnded: z.string().meta({ format: "date-time" }).optional(),
  reasonForStopping: z.string().optional(),
  seed: z.string().optional(),
  coverage: z.number().optional(),
  trafficSplit: z
    .array(
      z.object({
        variationId: z.string(),
        weight: z.number(),
      }),
    )
    .optional(),
  namespace: z
    .object({
      namespaceId: z.string(),
      enabled: z.boolean().optional(),
      /** @deprecated use `ranges`; populated with the first range for backward compatibility */
      range: z.array(z.number()).min(2).max(2).optional(),
      ranges: z.array(z.tuple([z.number(), z.number()])).optional(),
    })
    .optional(),
  targetingCondition: z.string().optional(),
  prerequisites: z
    .array(
      z.object({
        id: z.string().describe("Feature ID"),
        condition: z.string(),
      }),
    )
    .optional(),
  reason: z.string().optional(),
  condition: z.string().optional(),
  savedGroupTargeting: z
    .array(
      z.object({
        matchType: z.enum(["all", "any", "none"]),
        savedGroups: z.array(z.string()),
      }),
    )
    .optional(),
  variationWeights: z.array(z.number()).optional(),
});

// PostExperimentPayload.yaml
const postExperimentBody = z
  .object({
    datasourceId: z
      .string()
      .describe(
        "ID for the [DataSource](#tag/DataSource_model). Can only be set if a templateId is not provided.",
      )
      .optional(),
    assignmentQueryId: z
      .string()
      .describe(
        "The ID property of one of the assignment query objects associated with the datasource. Can only be set if a templateId is not provided.",
      )
      .optional(),
    trackingKey: z.string(),
    bypassDuplicateKeyCheck: z
      .boolean()
      .describe(
        "If true, allow creating an experiment even if another experiment with the same tracking key already exists",
      )
      .optional(),
    name: z.string().describe("Name of the experiment"),
    type: z.enum(["standard", "multi-armed-bandit"]).optional(),
    project: z
      .string()
      .describe("Project ID which the experiment belongs to")
      .optional(),
    templateId: z
      .string()
      .describe(
        "ID of the [ExperimentTemplate](#tag/ExperimentTemplate_model) this experiment was created from. Template fields are applied by default and overridden by explicitly provided payload fields.",
      )
      .optional(),
    hypothesis: z.string().describe("Hypothesis of the experiment").optional(),
    description: z
      .string()
      .describe("Description of the experiment")
      .optional(),
    tags: z.array(z.string()).optional(),
    metrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z
      .string()
      .describe("Users must convert on this metric before being included")
      .optional(),
    segmentId: z
      .string()
      .describe("Only users in this segment will be included")
      .optional(),
    queryFilter: z
      .string()
      .describe("WHERE clause to add to the default experiment query")
      .optional(),
    owner: ownerInputField.optional(),
    archived: z.boolean().optional(),
    status: z.enum(["draft", "running", "stopped"]).optional(),
    autoRefresh: z.boolean().optional(),
    hashAttribute: z.string().optional(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    disableStickyBucketing: z.boolean().optional(),
    bucketVersion: z.number().optional(),
    minBucketVersion: z.number().optional(),
    releasedVariationId: z.string().optional(),
    excludeFromPayload: z.boolean().optional(),
    inProgressConversions: z.enum(["loose", "strict"]).optional(),
    attributionModel: z
      .enum(["firstExposure", "experimentDuration", "lookbackOverride"])
      .describe(
        'Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. Setting it to `"lookbackOverride"` requires a `lookbackOverride` object to be provided.',
      )
      .optional(),
    lookbackOverride: apiLookbackOverrideInput.optional(),
    statsEngine: z.enum(["bayesian", "frequentist"]).optional(),
    variations: z.array(apiVariationInput).min(2),
    phases: z.array(apiPhaseInput).optional(),
    regressionAdjustmentEnabled: z
      .boolean()
      .describe(
        "Controls whether regression adjustment (CUPED) is enabled for experiment analyses",
      )
      .optional(),
    sequentialTestingEnabled: z
      .boolean()
      .describe("Only applicable to frequentist analyses")
      .optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    shareLevel: z.enum(["public", "organization"]).optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["days", "hours"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["days", "hours"]).optional(),
    banditConversionWindowValue: z.number().optional(),
    banditConversionWindowUnit: z.enum(["days", "hours"]).optional(),
    postStratificationEnabled: z
      .union([
        z.boolean().describe("When null, the organization default is used."),
        z.null().describe("When null, the organization default is used."),
      ])
      .describe("When null, the organization default is used.")
      .optional(),
    decisionFrameworkSettings: apiDecisionFrameworkSettingsInput.optional(),
    metricOverrides: z
      .array(apiMetricOverrideEntryInput)
      .describe(
        "Per-metric analysis overrides for this experiment. Replaces the entire stored array (does not patch individual entries).",
      )
      .optional(),
    defaultDashboardId: z
      .string()
      .describe("ID of the default dashboard for this experiment.")
      .optional(),
    customFields: z.record(z.string(), z.string()).optional(),
    customMetricSlices: apiCustomMetricSlices.optional(),
  })
  .strict();

// UpdateExperimentPayload.yaml
const updateExperimentBody = z
  .object({
    datasourceId: z
      .string()
      .describe(
        "Can only be set if existing experiment does not have a datasource",
      )
      .optional(),
    assignmentQueryId: z.string().optional(),
    trackingKey: z.string().optional(),
    bypassDuplicateKeyCheck: z
      .boolean()
      .describe(
        "If true, allow updating the tracking key even if another experiment with the same tracking key already exists",
      )
      .optional(),
    name: z.string().describe("Name of the experiment").optional(),
    type: z.enum(["standard", "multi-armed-bandit"]).optional(),
    project: z
      .string()
      .describe("Project ID which the experiment belongs to")
      .optional(),
    hypothesis: z.string().describe("Hypothesis of the experiment").optional(),
    description: z
      .string()
      .describe("Description of the experiment")
      .optional(),
    tags: z.array(z.string()).optional(),
    metrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z
      .string()
      .describe("Users must convert on this metric before being included")
      .optional(),
    segmentId: z
      .string()
      .describe("Only users in this segment will be included")
      .optional(),
    queryFilter: z
      .string()
      .describe("WHERE clause to add to the default experiment query")
      .optional(),
    owner: ownerInputField.optional(),
    archived: z.boolean().optional(),
    status: z.enum(["draft", "running", "stopped"]).optional(),
    autoRefresh: z.boolean().optional(),
    hashAttribute: z.string().optional(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    disableStickyBucketing: z.boolean().optional(),
    bucketVersion: z.number().optional(),
    minBucketVersion: z.number().optional(),
    results: z
      .enum(["dnf", "won", "lost", "inconclusive"])
      .describe(
        "The result status of the experiment. Maps to resultSummary.status in the GET response.",
      )
      .optional(),
    winner: z
      .number()
      .describe(
        "The index of the winning variation (0-indexed). Maps to resultSummary.winner (variation ID) in the GET response.",
      )
      .optional(),
    analysis: z
      .string()
      .describe(
        "Analysis summary or conclusions for the experiment. Maps to resultSummary.conclusions in the GET response.",
      )
      .optional(),
    releasedVariationId: z
      .string()
      .describe(
        "The ID of the released variation. Maps to resultSummary.releasedVariationId in the GET response.",
      )
      .optional(),
    excludeFromPayload: z
      .boolean()
      .describe(
        "If true, the experiment is excluded from the SDK payload. Maps to resultSummary.excludeFromPayload in the GET response.",
      )
      .optional(),
    inProgressConversions: z.enum(["loose", "strict"]).optional(),
    attributionModel: z
      .enum(["firstExposure", "experimentDuration", "lookbackOverride"])
      .describe(
        'Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. Setting it to `"lookbackOverride"` requires a `lookbackOverride` object to be provided.',
      )
      .optional(),
    lookbackOverride: apiLookbackOverrideInput.optional(),
    statsEngine: z.enum(["bayesian", "frequentist"]).optional(),
    variations: z.array(apiVariationInput).min(2).optional(),
    phases: z
      .array(
        z.object({
          name: z.string(),
          dateStarted: z.string().meta({ format: "date-time" }),
          dateEnded: z.string().meta({ format: "date-time" }).optional(),
          reasonForStopping: z.string().optional(),
          seed: z.string().optional(),
          coverage: z.number().optional(),
          trafficSplit: z
            .array(
              z.object({
                variationId: z.string(),
                weight: z.number(),
              }),
            )
            .describe("Deprecated and unused. Use variationWeights instead.")
            .optional()
            .meta({ deprecated: true }),
          namespace: z
            .object({
              namespaceId: z.string(),
              range: z.array(z.number()).min(2).max(2),
              enabled: z.boolean().optional(),
            })
            .optional(),
          targetingCondition: z.string().optional(),
          prerequisites: z
            .array(
              z.object({
                id: z.string().describe("Feature ID"),
                condition: z.string(),
              }),
            )
            .optional(),
          reason: z.string().optional(),
          condition: z.string().optional(),
          savedGroupTargeting: z
            .array(
              z.object({
                matchType: z.enum(["all", "any", "none"]),
                savedGroups: z.array(z.string()),
              }),
            )
            .optional(),
          variationWeights: z.array(z.number()).optional(),
        }),
      )
      .optional(),
    regressionAdjustmentEnabled: z
      .boolean()
      .describe(
        "Controls whether regression adjustment (CUPED) is enabled for experiment analyses",
      )
      .optional(),
    sequentialTestingEnabled: z
      .boolean()
      .describe("Only applicable to frequentist analyses")
      .optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    shareLevel: z.enum(["public", "organization"]).optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["days", "hours"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["days", "hours"]).optional(),
    banditConversionWindowValue: z.number().optional(),
    banditConversionWindowUnit: z.enum(["days", "hours"]).optional(),
    postStratificationEnabled: z
      .union([
        z.boolean().describe("When null, the organization default is used."),
        z.null().describe("When null, the organization default is used."),
      ])
      .describe("When null, the organization default is used.")
      .optional(),
    decisionFrameworkSettings: apiDecisionFrameworkSettingsInput.optional(),
    metricOverrides: z
      .array(apiMetricOverrideEntryInput)
      .describe(
        "Per-metric analysis overrides for this experiment. Replaces the entire stored array (does not patch individual entries).",
      )
      .optional(),
    defaultDashboardId: z
      .string()
      .describe("ID of the default dashboard for this experiment.")
      .optional(),
    customFields: z.record(z.string(), z.string()).optional(),
    customMetricSlices: apiCustomMetricSlices.optional(),
  })
  .strict();

// Common params
const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const idAndVariationParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
    variationId: z
      .string()
      .describe(
        "The variation ID (e.g. var_abc123) from the experiment's variations",
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Route validators
// ---------------------------------------------------------------------------

export const listExperimentsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
      datasourceId: z.string().describe("Filter by Data Source").optional(),
      trackingKey: z
        .string()
        .describe("Filter by experiment tracking key")
        .optional(),
      experimentId: z
        .string()
        .describe(
          "Filter the returned list by the experiment tracking key (not the internal experiment ID). Note, this was deprecated to help reduce confusion, consider using `trackingKey` instead, which is functionally identical. You cannot use both params at the same time.",
        )
        .optional()
        .meta({ deprecated: true }),

      status: z.enum(experimentStatus).optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      experiments: z.array(apiExperimentValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all experiments",
  operationId: "listExperiments",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments",
};

export const postExperimentValidator = {
  bodySchema: postExperimentBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      experiment: apiExperimentValidator,
    })
    .strict(),
  summary: "Create a single experiment",
  operationId: "postExperiment",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments",
};

export const getExperimentNamesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      projectId: z.string().describe("Filter by project id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      experiments: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
    })
    .strict(),
  summary: "Get a list of experiments with names and ids",
  operationId: "getExperimentNames",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiment-names",
};

export const getExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      experiment: apiExperimentWithEnhancedStatus,
    })
    .strict(),
  summary: "Get a single experiment",
  operationId: "getExperiment",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateExperimentValidator = {
  bodySchema: updateExperimentBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      experiment: apiExperimentValidator,
    })
    .strict(),
  summary: "Update a single experiment",
  operationId: "updateExperiment",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments/:id",
};

export const postExperimentSnapshotValidator = {
  bodySchema: z
    .object({
      triggeredBy: z
        .enum(["manual", "schedule"])
        .describe(
          'Set to "schedule" if you want this request to trigger notifications and other events as it if were a scheduled update. Defaults to manual.',
        )
        .optional(),
    })
    .strict()
    .optional(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z.string().describe("The experiment id of the experiment to update"),
    })
    .strict(),
  responseSchema: z
    .object({
      snapshot: apiExperimentSnapshotShape,
    })
    .strict(),
  summary: "Create Experiment Snapshot",
  operationId: "postExperimentSnapshot",
  tags: ["experiments", "snapshots"],
  method: "post" as const,
  path: "/experiments/:id/snapshot",
  exampleRequest: { body: { triggeredBy: "schedule" } } as const,
};

export const postVariationImageUploadValidator = {
  bodySchema: z
    .object({
      screenshot: z
        .string()
        .base64()
        .describe("Base64-encoded screenshot data"),
      contentType: z
        .enum(["image/png", "image/jpeg", "image/gif"])
        .describe("MIME type of the screenshot"),
      description: z
        .string()
        .describe("Optional description for the screenshot")
        .optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idAndVariationParams,
  responseSchema: z
    .object({
      screenshot: z.object({
        path: z.string().describe("URL or path to the uploaded screenshot"),
        description: z.string().describe("Description of the screenshot"),
      }),
    })
    .strict(),
  summary: "Upload a variation screenshot",
  operationId: "postVariationImageUpload",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments/:id/variation/:variationId/screenshot/upload",
  exampleRequest: {
    body: {
      screenshot: "<base64-encoded-screenshot>",
      contentType: "image/png" as const,
    },
  },
};

export const deleteVariationScreenshotValidator = {
  bodySchema: z
    .object({
      path: z
        .string()
        .describe("The screenshot path/URL to delete (from upload response)"),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idAndVariationParams,
  responseSchema: z.record(z.string(), z.any()),
  summary: "Delete a variation screenshot",
  operationId: "deleteVariationScreenshot",
  tags: ["experiments"],
  method: "delete" as const,
  path: "/experiments/:id/variation/:variationId/screenshot",
  exampleRequest: {
    params: { id: "abc123", variationId: "abc123" },
    body: { path: "/upload/org_xxx/2025-03/img_uuid.png" },
  },
};

export const getExperimentResultsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      phase: z.string().optional(),
      dimension: z.string().optional(),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      result: apiExperimentResultsValidator,
    })
    .strict(),
  summary: "Get results for an experiment",
  operationId: "getExperimentResults",
  tags: ["experiments"],
  method: "get" as const,
  path: "/experiments/:id/results",
};

export const getExperimentSnapshotValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z
        .string()
        .describe(
          "The id of the requested resource (a snapshot ID, not experiment ID)",
        ),
    })
    .strict(),
  responseSchema: z
    .object({
      snapshot: apiExperimentSnapshotShape,
    })
    .strict(),
  summary: "Get an experiment snapshot status",
  operationId: "getExperimentSnapshot",
  tags: ["snapshots"],
  method: "get" as const,
  path: "/snapshots/:id",
};
