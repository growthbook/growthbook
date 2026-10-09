import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { banditStageType, screenshot, variation } from "./experiments";
import { namedSchema } from "./openapi-helpers";
import { apiRuleConfigField } from "./features-v2";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import { featurePrerequisite, savedGroupTargeting } from "./shared";

export const MAX_CONTEXTUAL_BANDIT_LEAVES = 12;

export const variationWeightPairValidator = z.object({
  variationId: z.string(),
  weight: z.number(),
});
export type VariationWeightPair = z.infer<typeof variationWeightPairValidator>;

export const leafWeightValidator = z.object({
  leafId: z.number().int(),
  condition: z.record(z.string(), z.unknown()),
  weights: z.array(variationWeightPairValidator),
});
export type LeafWeight = z.infer<typeof leafWeightValidator>;

export const contextualBanditStatus = ["draft", "running", "stopped"] as const;
export type ContextualBanditStatus = (typeof contextualBanditStatus)[number];

// Absent = "active". See contextual-bandit-variation-changes.ts for semantics.
const contextualBanditVariationStatus = [
  "active",
  "pending",
  "deactivated",
] as const;
export type ContextualBanditVariationStatus =
  (typeof contextualBanditVariationStatus)[number];

// Only the stored document carries status; the server owns transitions.
const contextualBanditVariation = variation.extend({
  key: z.string().regex(/\S/, "Variation key cannot be empty."),
  status: z.enum(contextualBanditVariationStatus).optional(),
});
export type ContextualBanditVariation = z.infer<
  typeof contextualBanditVariation
>;

export const contextualBanditValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    tags: z.array(z.string()),
    archived: z.boolean(),

    status: z.enum(contextualBanditStatus),
    dateStarted: z.date().optional(),
    dateStopped: z.date().optional(),

    trackingKey: z.string(),
    hashAttribute: z.string(),

    variations: z.array(contextualBanditVariation),

    datasource: z.string(),
    contextualBanditQueryId: z.string(),

    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    seed: z.string(),
    variationWeights: z.array(variationWeightPairValidator).optional(),
    currentLeafWeights: z.array(leafWeightValidator),
    banditVersion: z.number().int().nonnegative(),

    contextualAttributes: z.array(z.string()),

    decisionMetric: z.string().optional(),
    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),

    // TODO(holdout-v1.5): preserved on the doc but NOT wired through — the orchestrator,
    // SQL runner, stats engine, SDK callback, and results UI all ignore non-zero values.
    holdoutPercent: z.number().min(0).max(0.5),

    banditModelVersion: z.number().int().nonnegative(),

    linkedFeatures: z.array(z.string()).optional(),

    pendingFeatureDrafts: z
      .array(
        z
          .object({
            featureId: z.string(),
            revisionVersion: z.number(),
          })
          .strict(),
      )
      .optional(),
    scheduleValue: z.number().optional(),
    scheduleUnit: z.enum(["days", "hours"]).optional(),
    burnInValue: z.number().optional(),
    burnInUnit: z.enum(["days", "hours"]).optional(),
    conversionWindowValue: z.number().optional().nullable(),
    conversionWindowUnit: z.enum(["hours", "days"]).optional().nullable(),
    stage: z.enum(banditStageType).optional(),
    stageDateStarted: z.date().optional(),
    autoSnapshots: z.boolean().optional(),
    lastSnapshotAttempt: z.date().optional(),
    nextSnapshotAttempt: z.date().optional(),
  })
  .strict();

export type ContextualBanditInterface = z.infer<
  typeof contextualBanditValidator
>;

const apiContextualBanditVariation = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Tombstones are stripped from API responses; "deactivated" never appears here.
  status: z.enum(["active", "pending"]).optional(),
});

export const apiContextualBanditValidator = namedSchema(
  "ContextualBandit",
  apiBaseSchema.safeExtend({
    name: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    ownerEmail: ownerEmailField,
    tags: z.array(z.string()),
    archived: z.boolean(),

    status: z.enum(contextualBanditStatus),
    dateStarted: z.iso.datetime().optional(),
    dateStopped: z.iso.datetime().optional(),

    trackingKey: z.string(),
    hashAttribute: z.string(),
    variations: z.array(apiContextualBanditVariation),

    datasource: z.string(),
    contextualBanditQueryId: z.string(),

    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    seed: z.string(),
    variationWeights: z.array(variationWeightPairValidator).optional(),
    currentLeafWeights: z.array(leafWeightValidator),
    banditVersion: z.number().int().nonnegative(),

    contextualAttributes: z.array(z.string()),
    decisionMetric: z.string().optional(),
    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),
    holdoutPercent: z.number().min(0).max(0.5),
    banditModelVersion: z.number().int().nonnegative(),
    scheduleValue: z.number().optional(),
    scheduleUnit: z.enum(["days", "hours"]).optional(),
    burnInValue: z.number().optional(),
    burnInUnit: z.enum(["days", "hours"]).optional(),
    conversionWindowValue: z.number().optional().nullable(),
    conversionWindowUnit: z.enum(["hours", "days"]).optional().nullable(),
    stage: z.enum(banditStageType).optional(),
    stageDateStarted: z.iso.datetime().optional(),
    autoSnapshots: z.boolean().optional(),
    nextSnapshotAttempt: z.iso.datetime().optional(),
  }),
);

export type ApiContextualBanditInterface = z.infer<
  typeof apiContextualBanditValidator
>;

export const apiListContextualBanditsValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    projectId: z.string().optional(),
    datasourceId: z.string().optional(),
    trackingKey: z.string().optional(),
  }),
  paramsSchema: z.never(),
};

export const apiCreateContextualBanditBody = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  project: z.string().optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),

  trackingKey: z.string(),
  hashAttribute: z.string().optional(),

  decisionMetric: z.string(),

  variations: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),

  datasource: z.string(),
  contextualBanditQueryId: z.string(),

  contextualAttributes: z.array(z.string()),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z
    .number()
    .int()
    .positive()
    .max(MAX_CONTEXTUAL_BANDIT_LEAVES)
    .optional(),

  scheduleValue: z.number().optional(),
  scheduleUnit: z.enum(["days", "hours"]).optional(),
  burnInValue: z.number().optional(),
  burnInUnit: z.enum(["days", "hours"]).optional(),
  conversionWindowValue: z.number().optional(),
  conversionWindowUnit: z.enum(["hours", "days"]).optional(),
});

export type ApiCreateContextualBanditBody = z.infer<
  typeof apiCreateContextualBanditBody
>;

export const apiUpdateContextualBanditBody = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  project: z.string().optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),

  trackingKey: z.string().optional(),
  hashAttribute: z.string().optional(),

  datasource: z.string().optional(),
  contextualBanditQueryId: z.string().optional(),

  contextualAttributes: z.array(z.string()).optional(),
  decisionMetric: z.string().optional(),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z
    .number()
    .int()
    .positive()
    .max(MAX_CONTEXTUAL_BANDIT_LEAVES)
    .optional(),
  scheduleValue: z.number().optional(),
  scheduleUnit: z.enum(["days", "hours"]).optional(),
  burnInValue: z.number().optional(),
  burnInUnit: z.enum(["days", "hours"]).optional(),
  conversionWindowValue: z.number().optional().nullable(),
  conversionWindowUnit: z.enum(["hours", "days"]).optional().nullable(),

  archived: z.boolean().optional(),
  status: z.enum(contextualBanditStatus).optional(),

  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  seed: z.string().optional(),
});

export type ApiUpdateContextualBanditBody = z.infer<
  typeof apiUpdateContextualBanditBody
>;

/** Fields `ContextualBanditModel.processApiUpdateBody` keeps after filtering. */
export const CONTEXTUAL_BANDIT_API_UPDATE_FIELDS = [
  "name",
  "description",
  "project",
  "owner",
  "tags",
  "trackingKey",
  "hashAttribute",
  "datasource",
  "contextualBanditQueryId",
  "contextualAttributes",
  "decisionMetric",
  "minUsersPerLeaf",
  "maxLeaves",
  "scheduleValue",
  "scheduleUnit",
  "burnInValue",
  "burnInUnit",
  "conversionWindowValue",
  "conversionWindowUnit",
  "archived",
  "status",
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "seed",
] as const satisfies readonly (keyof ApiUpdateContextualBanditBody)[];

export const apiContextualBanditStartValidator = {
  paramsSchema: z.strictObject({
    id: z.string().describe("The Contextual Bandit id"),
  }),
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiContextualBanditStopValidator = {
  paramsSchema: z.strictObject({
    id: z.string().describe("The Contextual Bandit id"),
  }),
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiContextualBanditUpdateVariationsValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({
    addVariations: z
      .array(
        variation.extend({
          id: z.string().optional(),
          key: z.string().optional(),
          screenshots: z.array(screenshot).optional(),
          values: z
            .record(z.string(), z.string())
            .optional()
            .describe(
              'Value this new arm serves on each currently-linked feature, keyed by feature id. Required for every linked feature. Encode as a string for every `valueType` (`"true"`, `"5"`, `"{\\"a\\":1}"`), matching how `feature.defaultValue` is set.',
            ),
        }),
      )
      .optional()
      .describe(
        "New arms to add. Omit `id` to have the server generate one and `key` to have the server assign the next integer.",
      ),
    removeVariationIds: z
      .array(z.string())
      .optional()
      .describe(
        "Ids of active arms to remove. Removed arms are tombstoned in place and their ids can never be re-added.",
      ),
    updateVariations: z
      .array(
        z.strictObject({
          id: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          key: z
            .string()
            .optional()
            .describe(
              "New key for the arm. Must be unique across the contextual bandit's arms, including removed ones. The key is what SDKs report in exposure events, so renaming an arm on a running bandit orphans exposures already recorded under the old key.",
            ),
        }),
      )
      .optional()
      .describe(
        "Metadata edits to existing active arms. `name`, `description`, and `key` may be changed; values, weights, screenshots, and status are preserved.",
      ),
  }),
  querySchema: z.never(),
};

export const apiContextualBanditLifecycleReturn = z.object({
  contextualBandit: apiContextualBanditValidator,
});

/**
 * Return shape for the add/remove-variations endpoint. `featureDraftPublishFailures`
 * lists linked features whose value for a newly-added arm was staged as a draft
 * but could not be auto-published (e.g. needs approval), so the caller/UI can warn.
 */
export const apiContextualBanditVariationsReturn = z.object({
  contextualBandit: apiContextualBanditValidator,
  featureDraftPublishFailures: z
    .array(
      z.object({
        featureId: z.string(),
        revisionVersion: z.number(),
        reason: z.string(),
      }),
    )
    .optional(),
});

export const apiContextualBanditRefreshValidator = {
  paramsSchema: z.strictObject({
    id: z.string().describe("The Contextual Bandit id"),
  }),
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiContextualBanditRefreshReturn = z.object({
  snapshotId: z.string(),
  cbeId: z.string().optional(),
});

export const apiContextualBanditCancelValidator = {
  paramsSchema: z.strictObject({
    id: z.string().describe("The Contextual Bandit id"),
  }),
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiContextualBanditCancelReturn = z
  .object({
    status: z.number(),
  })
  .describe("Contextual Bandit snapshot refresh canceled");

export const contextualBanditIdAndSnapshotParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    snapshotId: z.string().describe("The snapshot id"),
  })
  .strict();

export const contextualBanditIdAndEventParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    eventId: z.string().describe("The event id"),
  })
  .strict();

export const contextualBanditIdOnlyParam = z
  .object({ id: z.string().describe("The Contextual Bandit id") })
  .strict();

export const contextualBanditIdAndFeatureParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    featureId: z.string().describe("The linked feature id"),
  })
  .strict();

export const contextualBanditSnapshotResponseShape = z.object({
  id: z.string(),
  contextualBandit: z.string(),
  status: z.enum(["pending", "running", "success", "error", "partial"]),
  weightsWereUpdated: z.boolean().optional(),
  contextualBanditEventId: z.string().nullable().optional(),
  error: z.string().optional(),
  dateCreated: z.string(),
});

export const contextualBanditEventResponseShape = z.object({
  id: z.string(),
  contextualBandit: z.string(),
  snapshotId: z.string(),
  weightsWereUpdated: z.boolean(),
  degreesOfFreedom: z.number().int().nonnegative().optional(),
  dateCreated: z.string(),
});

export const contextualBanditLinkedFeatureRuleFields = {
  variations: z
    .array(
      z
        .object({
          variationId: z
            .string()
            .describe("Id of the Contextual Bandit variation."),
          value: z
            .string()
            .describe("Feature value served for this variation."),
          config: apiRuleConfigField,
        })
        .strict(),
    )
    .min(1)
    .describe(
      "One entry per Contextual Bandit variation. Every variation must be covered exactly once.",
    ),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  allEnvironments: z
    .boolean()
    .optional()
    .describe("Apply the rule in every environment. Defaults to true."),
  environments: z
    .array(z.string())
    .optional()
    .describe("Environments to apply the rule in when not all."),
  allProjects: z.boolean().optional(),
  projects: z.array(z.string()).optional(),
  autoPublish: z
    .boolean()
    .optional()
    .describe(
      "Publish the resulting revision immediately instead of leaving it as a draft.",
    ),
};

export const contextualBanditLinkedFeatureDraftVersionField = z.coerce
  .number()
  .int()
  .optional();
