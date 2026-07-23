import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { banditStageType, variation } from "./experiments";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { contextualLeafClauseValidator } from "./contextual-bandit-event";

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

    variations: z.array(variation),

    datasource: z.string(),
    contextualBanditQueryId: z.string(),

    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    seed: z.string().optional(),
    variationWeights: z.array(variationWeightPairValidator).optional(),
    currentLeafWeights: z.array(leafWeightValidator),
    banditVersion: z.number().int().nonnegative(),

    contextualAttributes: z.array(z.string()),
    targetingAttributeColumns: z.array(z.string()).optional(),

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
    seed: z.string().optional(),
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

  variations: z.array(variation).optional(),

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
  variationWeights: z.array(variationWeightPairValidator).optional(),
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
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({}).optional(),
  querySchema: z.never(),
};

export const apiContextualBanditStopValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({}).optional(),
  querySchema: z.never(),
};

export const apiContextualBanditUpdateVariationsValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({
    variations: z.array(variation),
    newVariationValues: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional(),
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
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({}).optional(),
  querySchema: z.never(),
};

export const apiContextualBanditRefreshReturn = z.object({
  snapshotId: z.string(),
  cbeId: z.string().optional(),
});

const contextualBanditIdAndSnapshotParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    snapshotId: z.string().describe("The snapshot id"),
  })
  .strict();

const contextualBanditIdAndEventParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    eventId: z.string().describe("The event id"),
  })
  .strict();

const contextualBanditIdOnlyParam = z
  .object({ id: z.string().describe("The Contextual Bandit id") })
  .strict();

const contextualBanditIdAndFeatureParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    featureId: z.string().describe("The linked feature id"),
  })
  .strict();

const contextualBanditSnapshotResponseShape = z.object({
  id: z.string(),
  contextualBandit: z.string(),
  status: z.enum(["pending", "running", "success", "error", "partial"]),
  weightsWereUpdated: z.boolean().optional(),
  contextualBanditEventId: z.string().nullable().optional(),
  error: z.string().optional(),
  dateCreated: z.string(),
});

const contextualBanditEventResponseShape = z.object({
  id: z.string(),
  contextualBandit: z.string(),
  snapshotId: z.string(),
  weightsWereUpdated: z.boolean(),
  degreesOfFreedom: z.number().int().nonnegative().optional(),
  dateCreated: z.string(),
});

export const getContextualBanditCurrentWeightsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdOnlyParam,
  responseSchema: z
    .object({
      currentLeafWeights: z.array(leafWeightValidator).optional(),
      latestEvent: contextualBanditEventResponseShape.nullable(),
    })
    .strict(),
  summary: "Get current Contextual Bandit leaf weights and latest event",
  operationId: "getContextualBanditCurrentWeights",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/current",
};

export const listContextualBanditSnapshotsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict()
    .optional(),
  paramsSchema: contextualBanditIdOnlyParam,
  responseSchema: z
    .object({ snapshots: z.array(contextualBanditSnapshotResponseShape) })
    .strict(),
  summary: "List Contextual Bandit snapshots",
  operationId: "listContextualBanditSnapshots",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/snapshots",
};

export const getContextualBanditSnapshotValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdAndSnapshotParam,
  responseSchema: z
    .object({ snapshot: contextualBanditSnapshotResponseShape })
    .strict(),
  summary: "Get a single Contextual Bandit snapshot",
  operationId: "getContextualBanditSnapshot",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/snapshots/:snapshotId",
};

export const listContextualBanditEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict()
    .optional(),
  paramsSchema: contextualBanditIdOnlyParam,
  responseSchema: z
    .object({ events: z.array(contextualBanditEventResponseShape) })
    .strict(),
  summary: "List Contextual Bandit weight-update events",
  operationId: "listContextualBanditEvents",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/events",
};

export const getContextualBanditEventValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdAndEventParam,
  responseSchema: z
    .object({ event: contextualBanditEventResponseShape })
    .strict(),
  summary: "Get a single Contextual Bandit weight-update event",
  operationId: "getContextualBanditEvent",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/events/:eventId",
};

export const getContextualBanditResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdOnlyParam,
  responseSchema: z
    .object({
      contextualBanditSnapshot: z
        .object({
          attributes: z.array(z.string()),
          responses: z.array(z.unknown()),
          leaf_map: z.array(z.unknown()).optional(),
          leaf_stats: z.array(z.unknown()).optional(),
          sse_trajectory: z.array(z.unknown()).optional(),
        })
        .nullable(),
      overallWeights: z
        .array(
          z.object({
            variationId: z.string(),
            weight: z.number().nullable(),
          }),
        )
        .nullable(),
      results: z
        .object({
          attributes: z.array(z.string()),
          sseTrajectory: z.array(
            z.object({
              numSplits: z.number().int().nonnegative(),
              totalSse: z.number(),
            }),
          ),
          overall: z.object({
            variations: z.array(
              z.object({
                variationId: z.string(),
                variationName: z.string().optional(),
                weight: z.number().nullable(),
                users: z.number().nullable(),
              }),
            ),
          }),
          leaves: z.array(
            z.object({
              leafId: z.number().int(),
              updateMessage: z.string().nullable(),
              error: z.string().nullable(),
              clauses: z.array(contextualLeafClauseValidator),
              variations: z.array(
                z.object({
                  variationId: z.string(),
                  variationName: z.string().optional(),
                  weight: z.number().nullable(),
                  bestArmProbability: z.number().nullable(),
                  users: z.number().nullable(),
                  mean: z.number().nullable(),
                  variance: z.number().nullable(),
                }),
              ),
              contexts: z.array(
                z.object({
                  attributes: z.record(z.string(), z.string()),
                  variations: z.array(
                    z.object({
                      variationId: z.string(),
                      variationName: z.string().optional(),
                      users: z.number().nullable(),
                      mean: z.number().nullable(),
                      variance: z.number().nullable(),
                    }),
                  ),
                }),
              ),
            }),
          ),
        })
        .nullable(),
      latest: z
        .object({
          id: z.string(),
          status: z.enum(["running", "success", "error"]),
          error: z.string(),
          queries: z.array(z.unknown()),
          runStarted: z.string().nullable(),
          dateCreated: z.string(),
          multipleExposures: z.number(),
          type: z.string(),
          triggeredBy: z.string(),
          srm: z
            .object({
              statistic: z.number(),
              pValue: z.number(),
              degreesOfFreedom: z.number().int().nonnegative(),
            })
            .nullable(),
        })
        .nullable(),
    })
    .strict(),
  summary: "Get latest Contextual Bandit results",
  description:
    "Returns the latest contextual-bandit stats engine output (per-context responses tagged with their leaf, the per-leaf targeting conditions, and per-leaf aggregated stats), the overall (marginal) variation weights across all contexts, the SRM of the most recent run, and the status of the most recent snapshot run for the contextual bandit. Same payload the GrowthBook UI uses to render the contextual bandit results table.",
  operationId: "getContextualBanditResults",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/results",
};

export const getContextualBanditLinkedFeaturesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdOnlyParam,
  responseSchema: z
    .object({
      linkedFeatures: z.array(z.unknown()),
      environments: z.array(z.string()),
    })
    .strict(),
  summary: "Get features linked to a Contextual Bandit",
  description:
    "Returns the features that reference this contextual bandit via a `contextual-bandit-ref` rule, enriched with each feature's live/draft state, per-environment rule state, and variation values. Same payload the GrowthBook UI uses to render the Linked Features section.",
  operationId: "getContextualBanditLinkedFeatures",
  tags: ["ContextualBandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/linked-features",
};

export const deleteContextualBanditLinkedFeatureValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdAndFeatureParam,
  responseSchema: z.object({}).strict(),
  summary: "Unlink a feature from a Contextual Bandit",
  description:
    "Detaches a feature from this contextual bandit by removing it from the bandit's linked-feature list and cancelling any queued draft auto-publish. The feature's `contextual-bandit-ref` rule itself is left untouched.",
  operationId: "deleteContextualBanditLinkedFeature",
  tags: ["ContextualBandits"],
  method: "delete" as const,
  path: "/contextual-bandits/:id/linked-feature/:featureId",
};
