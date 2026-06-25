import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { banditStageType, metricOverride, variation } from "./experiments";
import { priorSettingsValidator } from "./fact-table";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

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
    /** Empty string ("") = no project. */
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
    queryFilter: z.string().optional(),
    activationMetric: z.string().optional(),
    metricOverrides: z.array(metricOverride).optional(),
    defaultMetricPriorSettings: priorSettingsValidator,
    skipPartialData: z.boolean().optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),

    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    seed: z.string().optional(),
    /** SDK fallback when no context match. */
    variationWeights: z.array(variationWeightPairValidator).optional(),
    /** Per-leaf bandit weights (one entry per tree leaf), keyed by the leaf's routing condition. */
    currentLeafWeights: z.array(leafWeightValidator),
    /**
     * Number of successful snapshots applied to this bandit. Incremented once per
     * successful snapshot (i.e. each time a ContextualBanditEvent is created and the
     * weight patch runs), regardless of whether the new weights actually differ from
     * the previous ones. Use `weightsWereUpdated` on the CBE to know if weights changed.
     */
    banditVersion: z.number().int().nonnegative(),

    /** Aliased as `targetingAttributeColumns` so SQL builders don't have to translate. */
    contextualAttributes: z.array(z.string()),
    targetingAttributeColumns: z.array(z.string()).optional(),

    decisionMetric: z.string().optional(),
    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),

    // TODO(holdout-v1.5): preserved on the doc but NOT wired through — the orchestrator,
    // SQL runner, stats engine, SDK callback, and results UI all ignore non-zero values.
    holdoutPercent: z.number().min(0).max(0.5),

    canonicalFormVersion: z.number().int().nonnegative(),

    /** Feature IDs referencing this CB; maintained by `featureContextualBanditSync.ts`. */
    linkedFeatures: z.array(z.string()).optional(),

    /** Drafts queued for auto-publish on `status -> running`. */
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
    // @teresayung nit, IDK if we need to preface these with `contextualBandit` since they're
    // within the contextualBandit model.
    contextualBanditScheduleValue: z.number().optional(),
    contextualBanditScheduleUnit: z.enum(["days", "hours"]).optional(),
    contextualBanditBurnInValue: z.number().optional(),
    contextualBanditBurnInUnit: z.enum(["days", "hours"]).optional(),
    contextualBanditStage: z.enum(banditStageType).optional(),
    contextualBanditStageDateStarted: z.date().optional(),
    autoSnapshots: z.boolean().optional(),
    lastSnapshotAttempt: z.date().optional(),
    nextSnapshotAttempt: z.date().optional(),
  })
  .strict();

export type ContextualBanditInterface = z.infer<
  typeof contextualBanditValidator
>;

// REST API DTO is a curated subset of `ContextualBanditInterface` so internal-only
// fields (linkedFeatures, pendingFeatureDrafts, snapshot scheduling) don't leak.

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
    queryFilter: z.string().optional(),
    activationMetric: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),

    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
    seed: z.string().optional(),
    variationWeights: z.array(variationWeightPairValidator).optional(),
    currentLeafWeights: z.array(leafWeightValidator),
    banditVersion: z.number().int().nonnegative(),

    contextualAttributes: z.array(z.string()),
    decisionMetric: z.string().optional(),
    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),
    holdoutPercent: z.number().min(0).max(0.5),
    canonicalFormVersion: z.number().int().nonnegative(),
    contextualBanditScheduleValue: z.number().optional(),
    contextualBanditScheduleUnit: z.enum(["days", "hours"]).optional(),
    contextualBanditBurnInValue: z.number().optional(),
    contextualBanditBurnInUnit: z.enum(["days", "hours"]).optional(),
    contextualBanditStage: z.enum(banditStageType).optional(),
    contextualBanditStageDateStarted: z.iso.datetime().optional(),
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
    /** Exact-match preflight for the CB create form to detect trackingKey collisions. */
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

  skipPartialData: z.boolean().optional(),
  activationMetric: z.string().optional(),
  queryFilter: z.string().optional(),
  regressionAdjustmentEnabled: z.boolean().optional(),

  contextualAttributes: z.array(z.string()),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z.number().int().positive().optional(),

  contextualBanditScheduleValue: z.number().optional(),
  contextualBanditScheduleUnit: z.enum(["days", "hours"]).optional(),
  contextualBanditBurnInValue: z.number().optional(),
  contextualBanditBurnInUnit: z.enum(["days", "hours"]).optional(),
});

export type ApiCreateContextualBanditBody = z.infer<
  typeof apiCreateContextualBanditBody
>;

export const apiUpdateContextualBanditBody = z.object({
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
  queryFilter: z.string().optional(),
  activationMetric: z.string().optional(),
  metricOverrides: z.array(metricOverride).optional(),
  skipPartialData: z.boolean().optional(),
  regressionAdjustmentEnabled: z.boolean().optional(),

  contextualAttributes: z.array(z.string()).optional(),
  decisionMetric: z.string().optional(),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z.number().int().positive().optional(),
  contextualBanditScheduleValue: z.number().optional(),
  contextualBanditScheduleUnit: z.enum(["days", "hours"]).optional(),
  contextualBanditBurnInValue: z.number().optional(),
  contextualBanditBurnInUnit: z.enum(["days", "hours"]).optional(),

  archived: z.boolean().optional(),
  status: z.enum(contextualBanditStatus).optional(),

  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
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
  "variations",
  "datasource",
  "contextualBanditQueryId",
  "queryFilter",
  "activationMetric",
  "metricOverrides",
  "skipPartialData",
  "regressionAdjustmentEnabled",
  "contextualAttributes",
  "decisionMetric",
  "minUsersPerLeaf",
  "maxLeaves",
  "contextualBanditScheduleValue",
  "contextualBanditScheduleUnit",
  "contextualBanditBurnInValue",
  "contextualBanditBurnInUnit",
  "archived",
  "status",
  "coverage",
  "condition",
  "seed",
  "variationWeights",
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

export const apiContextualBanditLifecycleReturn = z.object({
  contextualBandit: apiContextualBanditValidator,
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
  /**
   * Degrees of freedom of the contextual SRM test for this event's snapshot run.
   * Absent when the SRM test could not be run (e.g. no group had enough usable
   * cells, or a non-SQL data source).
   */
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
  tags: ["contextual-bandits"],
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
  tags: ["contextual-bandits"],
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
  tags: ["contextual-bandits"],
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
  tags: ["contextual-bandits"],
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
  tags: ["contextual-bandits"],
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
          // Loose to avoid pulling the heavier stats validators into this file.
          responses: z.array(z.unknown()),
          leaf_map: z.array(z.unknown()).optional(),
          leaf_stats: z.array(z.unknown()).optional(),
          // Total within-tree SSE at each stage of greedy tree growth (root,
          // after the first split, after the second, ...): [{ numSplits, totalSse }].
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
      // Normalized leaf-first view: one entry per tree leaf (the decision unit)
      // with its weights + pooled stats and the contexts that route to it, plus
      // a bandit-level `overall` weight summary. Easier to consume than the raw
      // `contextualBanditSnapshot` (positional arrays + separate leaf_map).
      results: z
        .object({
          attributes: z.array(z.string()),
          // Total within-tree SSE at each stage of greedy tree growth, ordered
          // root-first (numSplits 0 = before the first split).
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
    "Returns the latest contextual-bandit stats engine output (per-context responses, the context-to-leaf map, and per-leaf aggregated stats), the overall (marginal) variation weights across all contexts, the SRM of the most recent run, and the status of the most recent snapshot run for the contextual bandit. Same payload the GrowthBook UI uses to render the contextual bandit results table.",
  operationId: "getContextualBanditResults",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/results",
};
