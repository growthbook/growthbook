import { z } from "zod";

import { namedSchema } from "./openapi-helpers";
import {
  cappingSettingsValidator,
  priorSettingsValidator,
  windowSettingsValidator,
} from "./fact-table";
import { memberRoleWithProjects } from "./organization";

// Approval rules are project-scoped: a rule with no `projects` is the
// all-projects rule, and a project override inherits any field it omits.
const requireReviewRuleFields = {
  projects: z.array(z.string()).optional(),
  resetReviewOnChange: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  featureRequireEnvironmentReview: z.boolean().optional(),
  featureRequireMetadataReview: z.boolean().optional(),
  blockSelfApproval: z.boolean().optional(),
  autopublishOnApproval: z.boolean().optional(),
  requiredApproverTeams: z.array(z.string()).optional(),
};

// Reads tolerate a rule stored without the switch; writes must state it, since
// it is the one field that never inherits.
export const apiRequireReviewRule = namedSchema(
  "RequireReviewRule",
  z
    .object({
      requireReviewOn: z.boolean().optional(),
      ...requireReviewRuleFields,
    })
    .strict(),
);

export const apiRequireReviewRuleInput = namedSchema(
  "RequireReviewRuleInput",
  z
    .object({ requireReviewOn: z.boolean(), ...requireReviewRuleFields })
    .strict(),
);

export const apiTargetingReviewRule = namedSchema(
  "TargetingReviewRule",
  z
    .object({
      projects: z
        .array(z.string())
        .describe(
          "Targeting Project IDs this rule applies to. An empty list is the organization-wide default.",
        ),
      mode: z
        .enum(["strict", "loose"])
        .describe(
          "`strict`: a Feature Flag delivered into these Targeting Projects must also satisfy their approval requirements, and a Targeting Project with a rule of its own must be approved by one of its reviewers. `loose`: only the flag's primary project governs approvals.",
        ),
    })
    .strict(),
);

export const apiSavedGroupApprovalRule = namedSchema(
  "SavedGroupApprovalRule",
  z
    .object({
      required: z.boolean(),
      projects: z.array(z.string()).optional(),
      resetReviewOnChange: z.boolean().optional(),
      requireMetadataReview: z.boolean().optional(),
      blockSelfApproval: z.boolean().optional(),
      autopublishOnApproval: z.boolean().optional(),
      requiredApproverTeams: z.array(z.string()).optional(),
    })
    .strict(),
);

export const apiApprovalFlows = z
  .object({ savedGroups: z.array(apiSavedGroupApprovalRule) })
  .strict();

const probability = z.number().gt(0).lt(1);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const timeUnit = z.enum(["hours", "days"]);

const apiMetricDefaults = z
  .object({
    minimumSampleSize: z.number().nonnegative().optional(),
    maxPercentageChange: z.number().nonnegative().optional(),
    minPercentageChange: z.number().nonnegative().optional(),
    targetMDE: z.number().nonnegative().optional(),
    windowSettings: windowSettingsValidator.optional(),
    cappingSettings: cappingSettingsValidator.optional(),
    priorSettings: priorSettingsValidator.optional(),
  })
  .strict();

const apiLearningStatus = z
  .object({
    id: z.string(),
    label: z.string(),
    color: z
      .enum([
        "gray",
        "blue",
        "cyan",
        "indigo",
        "violet",
        "purple",
        "amber",
        "orange",
        "yellow",
        "green",
        "teal",
        "red",
        "pink",
      ])
      .optional(),
  })
  .strict();

// Omitted on purpose: fields with their own endpoints, controls a key could loosen for itself, secureAttributeSalt, UI state.
const writableSettingsFields = {
  // Statistics
  statsEngine: z.enum(["bayesian", "frequentist"]),
  confidenceLevel: probability.describe(
    "Bayesian chance-to-win threshold, e.g. 0.95",
  ),
  pValueThreshold: probability,
  pValueCorrection: z.enum(["benjamini-hochberg", "holm-bonferroni"]),
  regressionAdjustmentEnabled: z
    .boolean()
    .describe("Enable CUPED variance reduction by default"),
  regressionAdjustmentDays: positiveInt,
  sequentialTestingEnabled: z.boolean(),
  sequentialTestingTuningParameter: z.number().positive(),
  postStratificationEnabled: z.boolean(),
  srmThreshold: probability,
  multipleExposureMinPercent: probability,
  attributionModel: z.enum([
    "firstExposure",
    "experimentDuration",
    "lookbackOverride",
  ]),

  // Experiments
  updateSchedule: z
    .object({
      type: z.enum(["cron", "never", "stale"]),
      cron: z.string().optional(),
      hours: z.number().positive().optional(),
    })
    .strict(),
  pastExperimentsMinLength: nonNegativeInt,
  metricAnalysisDays: positiveInt,
  experimentMinLengthDays: nonNegativeInt,
  experimentMaxLengthDays: positiveInt,
  banditScheduleValue: z.number().positive(),
  banditScheduleUnit: timeUnit,
  banditBurnInValue: z.number().nonnegative(),
  banditBurnInUnit: timeUnit,
  maxMetricSliceLevels: nonNegativeInt,
  topValuesLookbackValue: z.number().int().min(1).max(365),
  topValuesLookbackUnit: z.enum(["days"]),
  northStar: z
    .object({ title: z.string(), metricIds: z.array(z.string()) })
    .strict(),
  runHealthTrafficQuery: z.boolean(),
  requireExperimentTemplates: z.boolean(),
  requireUniqueExperimentTrackingKeys: z.boolean(),
  decisionFrameworkEnabled: z.boolean(),
  defaultDecisionCriteriaId: z.string(),
  disableLegacyMetricCreation: z.boolean(),
  disablePrecomputedDimensions: z.boolean(),
  displayCurrency: z.string().regex(/^[A-Z]{3}$/, "Must be an ISO 4217 code"),
  learningStatuses: z.array(apiLearningStatus),
  metricDefaults: apiMetricDefaults,

  // Data
  defaultDataSource: z.string(),
  testQueryDays: positiveInt,

  // SDK
  useStickyBucketing: z.boolean(),
  stickyBucketingOnByDefault: z.boolean(),
  useFallbackAttributes: z.boolean(),
  visualEditorEnabled: z.boolean(),

  // Feature flags, configs and saved groups
  featureKeyExample: z.string(),
  featureRegexValidator: z
    .string()
    .describe("New feature keys must match this regular expression"),
  preferredEnvironment: z
    .string()
    .describe("Environment the UI opens on. Null remembers the last one used."),
  requireProjectForFeatures: z.boolean(),
  requireProjectForSdkConnections: z.boolean(),
  requireRegisteredAttributes: z
    .object({ isOn: z.boolean(), requireProjectScoping: z.boolean() })
    .strict(),
  defaultFeatureRulesInAllEnvs: z.boolean(),
  sparseJSONRulesByDefault: z.boolean(),
  configsExtensibleByDefault: z.boolean(),
  configExperimentGuardDefault: z.boolean(),
  blockPublishOnSchemaError: z.boolean(),
  savedGroupSizeLimit: positiveInt,
  enforceSavedGroupProjectScope: z.boolean(),
  requireRebaseBeforePublish: z.boolean(),
  maxConcurrentDrafts: nonNegativeInt.describe("0 means no limit"),

  // Code references
  codeReferencesEnabled: z.boolean(),
  codeRefsBranchesToFilter: z.array(z.string()),
  codeRefsPlatformUrl: z
    .string()
    .regex(/^(https?:\/\/|$)/, "Must be empty or an http(s) URL"),

  // AI
  aiEnabled: z.boolean(),
  aiAskDataEnabled: z.boolean(),
  defaultAIModel: z.string(),
  embeddingModel: z.string(),
  sttModel: z.string(),
  visualEditorAIModel: z.string(),
  visualEditorImageModel: z.string(),
  visualEditorAIContext: z.string(),

  // Custom markdown shown on list and detail pages
  featureListMarkdown: z.string(),
  featurePageMarkdown: z.string(),
  experimentListMarkdown: z.string(),
  experimentPageMarkdown: z.string(),
  metricListMarkdown: z.string(),
  metricPageMarkdown: z.string(),

  // Membership
  defaultRole: memberRoleWithProjects.describe(
    "Role given to members who join without an explicit one (e.g. via SSO)",
  ),

  blockFileUploads: z.boolean(),
};

export type ApiWritableSettingKey = keyof typeof writableSettingsFields;
export const API_WRITABLE_SETTING_KEYS = Object.keys(
  writableSettingsFields,
) as ApiWritableSettingKey[];

// Returned by GET but not writable here.
const readOnlySettingsFields = {
  restApiBypassesReviews: z.boolean(),
  revertsBypassApproval: z.boolean(),
  disablePersonalAccessTokens: z.boolean(),
};
export const API_READ_ONLY_SETTING_KEYS = Object.keys(
  readOnlySettingsFields,
) as (keyof typeof readOnlySettingsFields)[];

// Corresponds to schemas/Settings.yaml
export const apiSettingsValidator = namedSchema(
  "Settings",
  z
    .object({
      ...z
        .object({ ...writableSettingsFields, ...readOnlySettingsFields })
        .partial().shape,
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
        windowSettings: windowSettingsValidator.optional(),
        cappingSettings: cappingSettingsValidator.optional(),
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
      defaultRole: memberRoleWithProjects,
      statsEngine: z.string(),
      pValueThreshold: z.coerce.number(),
      pValueCorrection: z
        .enum(["benjamini-hochberg", "holm-bonferroni"])
        .nullable(),
      postStratificationEnabled: z.boolean(),
      srmThreshold: z.coerce.number(),
      useStickyBucketing: z.boolean(),
      stickyBucketingOnByDefault: z.boolean(),
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
      requireReviews: z.array(apiRequireReviewRule),
      approvalFlows: apiApprovalFlows,
      targetingReviewMode: z.array(apiTargetingReviewRule).optional(),
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
      topValuesLookbackValue: z.coerce.number().optional(),
      topValuesLookbackUnit: z.enum(["days"]).optional(),
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

export const putSettingsValidator = {
  bodySchema: z.strictObject(
    Object.fromEntries(
      Object.entries(writableSettingsFields).map(([key, schema]) => [
        key,
        schema.nullable().optional(),
      ]),
    ) as {
      [K in ApiWritableSettingKey]: z.ZodOptional<
        z.ZodNullable<(typeof writableSettingsFields)[K]>
      >;
    },
  ),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      settings: apiSettingsValidator,
    })
    .strict(),
  summary: "Update organization settings",
  description:
    "Each supplied field replaces its stored value (object fields are replaced whole); omitted fields are unchanged and `null` resets a field to its default. Approval requirements are managed by `PUT /settings/approvals`.",
  operationId: "putSettings",
  tags: ["settings"],
  method: "put" as const,
  path: "/settings",
  exampleRequest: {
    body: {
      statsEngine: "frequentist" as const,
      pValueThreshold: 0.05,
      requireProjectForFeatures: true,
      preferredEnvironment: null,
    },
  },
};

export const putApprovalSettingsValidator = {
  bodySchema: z
    .object({
      requireReviews: z.array(apiRequireReviewRuleInput).optional(),
      approvalFlows: apiApprovalFlows.optional(),
      targetingReviewMode: z.array(apiTargetingReviewRule).optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      requireReviews: z.array(apiRequireReviewRule),
      approvalFlows: apiApprovalFlows,
      targetingReviewMode: z.array(apiTargetingReviewRule),
    })
    .strict(),
  summary:
    "Replace the approval requirements for feature flags, configs and constants, for saved groups, and the Targeting Projects review mode. Each family is replaced wholesale when supplied; omit one to leave it unchanged.",
  operationId: "putApprovalSettings",
  tags: ["settings"],
  method: "put" as const,
  path: "/settings/approvals",
};
