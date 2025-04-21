import { z } from "zod";
import { statsEngines } from "back-end/src/util/constants";
import { eventUser } from "./events";

export const simpleSchemaFieldValidator = z.object({
  key: z.string().max(64),
  type: z.enum(["integer", "float", "string", "boolean"]),
  required: z.boolean(),
  default: z.string().max(256),
  description: z.string().max(256),
  enum: z.array(z.string().max(256)).max(256),
  min: z.number(),
  max: z.number(),
});

export const simpleSchemaValidator = z.object({
  type: z.enum(["object", "object[]", "primitive", "primitive[]"]),
  fields: z.array(simpleSchemaFieldValidator),
});

export const savedGroupTargeting = z
  .object({
    match: z.enum(["all", "none", "any"]),
    ids: z.array(z.string()),
  })
  .strict();

export type SavedGroupTargeting = z.infer<typeof savedGroupTargeting>;

export const featureValueType = [
  "boolean",
  "string",
  "number",
  "json",
] as const;

export type FeatureValueType = typeof featureValueType[number];

const scheduleRule = z
  .object({
    timestamp: z.union([z.string(), z.null()]),
    enabled: z.boolean(),
  })
  .strict();

export type ScheduleRule = z.infer<typeof scheduleRule>;

export const featurePrerequisite = z
  .object({
    id: z.string(),
    condition: z.string(),
  })
  .strict();

export type FeaturePrerequisite = z.infer<typeof featurePrerequisite>;

export const baseRule = z
  .object({
    description: z.string(),
    condition: z.string().optional(),
    id: z.string(),
    enabled: z.boolean().optional(),
    scheduleRules: z.array(scheduleRule).optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
  })
  .strict();

export const forceRule = baseRule
  .extend({
    type: z.literal("force"),
    value: z.string(),
  })
  .strict();

export type ForceRule = z.infer<typeof forceRule>;

export const rolloutRule = baseRule
  .extend({
    type: z.literal("rollout"),
    value: z.string(),
    coverage: z.number(),
    hashAttribute: z.string(),
  })
  .strict();

export type RolloutRule = z.infer<typeof rolloutRule>;

const experimentValue = z
  .object({
    value: z.string(),
    weight: z.number(),
    name: z.string().optional(),
  })
  .strict();

export type ExperimentValue = z.infer<typeof experimentValue>;

export const namespaceValue = z
  .object({
    enabled: z.boolean(),
    name: z.string(),
    range: z.tuple([z.number(), z.number()]),
  })
  .strict();

export type NamespaceValue = z.infer<typeof namespaceValue>;

export const experimentType = ["standard", "multi-armed-bandit"] as const;
export const banditStageType = ["explore", "exploit", "paused"] as const;

const experimentRule = baseRule
  .extend({
    type: z.literal("experiment"), // refers to RuleType, not experiment.type
    experimentType: z.enum(experimentType).optional(),
    hypothesis: z.string().optional(),
    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.number().optional(),
    disableStickyBucketing: z.boolean().optional(),
    bucketVersion: z.number().optional(),
    minBucketVersion: z.number().optional(),
    namespace: namespaceValue.optional(),
    coverage: z.number().optional(),
    datasource: z.string().optional(),
    exposureQueryId: z.string().optional(),
    goalMetrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z.string().optional(),
    segment: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    values: z.array(experimentValue),
    regressionAdjustmentEnabled: z.boolean().optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    statsEngine: z.enum(statsEngines).optional(),
    banditStage: z.enum(banditStageType).optional(),
    banditStageDateStarted: z.date().optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["hours", "days"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["hours", "days"]).optional(),
    templateId: z.string().optional(),
    customFields: z.record(z.any()).optional(),
  })
  .strict();

export type ExperimentRule = z.infer<typeof experimentRule>;

const experimentRefVariation = z
  .object({
    variationId: z.string(),
    value: z.string(),
  })
  .strict();

export type ExperimentRefVariation = z.infer<typeof experimentRefVariation>;

const experimentRefRule = baseRule
  .extend({
    type: z.literal("experiment-ref"),
    experimentId: z.string(),
    variations: z.array(experimentRefVariation),
  })
  .strict();

export type ExperimentRefRule = z.infer<typeof experimentRefRule>;

export const featureRule = z.union([
  forceRule,
  rolloutRule,
  experimentRule,
  experimentRefRule,
]);

export type FeatureRule = z.infer<typeof featureRule>;

export const featureEnvironment = z
  .object({
    enabled: z.boolean(),
    prerequisites: z.array(featurePrerequisite).optional(),
    rules: z.array(featureRule),
  })
  .strict();

export type FeatureEnvironment = z.infer<typeof featureEnvironment>;

export const JSONSchemaDef = z
  .object({
    schemaType: z.enum(["schema", "simple"]),
    schema: z.string(),
    simple: simpleSchemaValidator,
    date: z.date(),
    enabled: z.boolean(),
  })
  .strict();

const revisionLog = z
  .object({
    user: eventUser,
    approvedBy: eventUser.optional(),
    timestamp: z.date(),
    action: z.string(),
    subject: z.string(),
    value: z.string(),
  })
  .strict();

export type RevisionLog = z.infer<typeof revisionLog>;

const featureRevisionInterface = z
  .object({
    featureId: z.string(),
    organization: z.string(),
    baseVersion: z.number(),
    version: z.number(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    datePublished: z.union([z.null(), z.date()]),
    publishedBy: z.union([z.null(), eventUser]),
    createdBy: eventUser,
    comment: z.string(),
    status: z.enum([
      "draft",
      "published",
      "discarded",
      "approved",
      "changes-requested",
      "pending-review",
    ]),
    defaultValue: z.string(),
    rules: z.record(z.string(), z.array(featureRule)),
    log: z.array(revisionLog).optional(),
  })
  .strict();

export type FeatureRevisionInterface = z.infer<typeof featureRevisionInterface>;

export const featureInterface = z
  .object({
    id: z.string(),
    archived: z.boolean().optional(),
    description: z.string().optional(),
    organization: z.string(),
    nextScheduledUpdate: z.union([z.date(), z.null()]).optional(),
    owner: z.string(),
    project: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    valueType: z.enum(featureValueType),
    defaultValue: z.string(),
    version: z.number(),
    hasDrafts: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    environmentSettings: z.record(z.string(), featureEnvironment),
    linkedExperiments: z.array(z.string()).optional(),
    jsonSchema: JSONSchemaDef.optional(),
    customFields: z.record(z.any()).optional(),

    /** @deprecated */
    legacyDraft: z.union([featureRevisionInterface, z.null()]).optional(),
    /** @deprecated */
    legacyDraftMigrated: z.boolean().optional(),
    neverStale: z.boolean().optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
  })
  .strict();

export type FeatureInterface = z.infer<typeof featureInterface>;

const computedFeatureInterface = featureInterface
  .extend({
    projectId: z.string(),
    projectName: z.string(),
    projectIsDeReferenced: z.boolean(),
    savedGroups: z.array(z.string()),
    stale: z.boolean(),
    staleReason: z.string(),
    ownerName: z.string(),
  })
  .strict();

export type ComputedFeatureInterface = z.infer<typeof computedFeatureInterface>;
