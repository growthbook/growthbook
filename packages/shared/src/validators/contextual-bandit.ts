import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import {
  metricOverride,
  nextScheduledStatusUpdateValidator,
  statusUpdateScheduleValidator,
  variation,
} from "./experiments";
import { priorSettingsValidator } from "./fact-table";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

export const variationWeightPairValidator = z.object({
  variationId: z.string(),
  weight: z.number(),
});
export type VariationWeightPair = z.infer<typeof variationWeightPairValidator>;

export const leafWeightValidator = z.object({
  contextId: z.string(),
  weights: z.array(variationWeightPairValidator),
});
export type LeafWeight = z.infer<typeof leafWeightValidator>;

export const contextualBanditStatus = ["draft", "running", "stopped"] as const;
export type ContextualBanditStatus = (typeof contextualBanditStatus)[number];

export const contextualBanditValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().optional(),
    hypothesis: z.string().optional(),
    /** Empty string ("") = no project. */
    project: z.string().optional(),
    owner: ownerField,
    tags: z.array(z.string()),
    archived: z.boolean(),
    customFields: z.record(z.string(), z.any()).optional(),

    status: z.enum(contextualBanditStatus),
    dateStarted: z.date().optional(),
    dateStopped: z.date().optional(),

    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]),
    /**
     * Inverted-from-original `stickyBucketing` so `false` (the default supplied
     * via `defaultValues` to satisfy the eslint ban on `.default()`) matches
     * the rest of the platform's hash-rule conventions.
     */
    disableStickyBucketing: z.boolean(),

    variations: z.array(variation),

    // @teresayung remove datasourceId here and in a few other places
    /** @deprecated Prefer `datasource`; both fields hold the same value. */
    datasourceId: z.string(),
    datasource: z.string(),
    contextualBanditQueryId: z.string(),
    segment: z.string().optional(),
    queryFilter: z.string().optional(),
    goalMetrics: z.array(z.string()),
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
    /** Per-context bandit weights. */
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

    autoSnapshots: z.boolean().optional(),
    lastSnapshotAttempt: z.date().optional(),
    nextSnapshotAttempt: z.date().optional(),

    statusUpdateSchedule: statusUpdateScheduleValidator.optional().nullable(),
    nextScheduledStatusUpdate: nextScheduledStatusUpdateValidator
      .optional()
      .nullable(),
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
    hypothesis: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    ownerEmail: ownerEmailField,
    tags: z.array(z.string()),
    archived: z.boolean(),
    customFields: z.record(z.string(), z.any()).optional(),

    status: z.enum(contextualBanditStatus),
    dateStarted: z.iso.datetime().optional(),
    dateStopped: z.iso.datetime().optional(),

    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]),
    disableStickyBucketing: z.boolean(),
    variations: z.array(apiContextualBanditVariation),

    datasource: z.string(),
    contextualBanditQueryId: z.string(),
    segment: z.string().optional(),
    queryFilter: z.string().optional(),
    goalMetrics: z.array(z.string()),
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

  // @teresayung remove below fields, hash version is always 2 (do the same for the update payload as well)
  hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  disableStickyBucketing: z.boolean().optional(),
  fallbackAttribute: z.string().optional(),
  hypothesis: z.string().optional(),
  segment: z.string().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  goalMetrics: z.array(z.string()),

  variations: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),

  datasource: z.string(),
  contextualBanditQueryId: z.string(),

  // @lukesonnet can we remove the 3 below?
  skipPartialData: z.boolean().optional(),
  activationMetric: z.string().optional(),
  queryFilter: z.string().optional(),
  // @lukesonnet are we doing cuped
  regressionAdjustmentEnabled: z.boolean().optional(),

  contextualAttributes: z.array(z.string()),
  decisionMetric: z.string().optional(),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z.number().int().positive().optional(),
});

export type ApiCreateContextualBanditBody = z.infer<
  typeof apiCreateContextualBanditBody
>;

export const apiUpdateContextualBanditBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  project: z.string().optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.any()).optional(),

  trackingKey: z.string().optional(),
  hashAttribute: z.string().optional(),
  fallbackAttribute: z.string().optional(),
  hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  disableStickyBucketing: z.boolean().optional(),

  variations: z.array(variation).optional(),

  datasource: z.string().optional(),
  contextualBanditQueryId: z.string().optional(),
  segment: z.string().optional(),
  queryFilter: z.string().optional(),
  goalMetrics: z.array(z.string()).optional(),
  activationMetric: z.string().optional(),
  metricOverrides: z.array(metricOverride).optional(),
  skipPartialData: z.boolean().optional(),
  regressionAdjustmentEnabled: z.boolean().optional(),

  contextualAttributes: z.array(z.string()).optional(),
  decisionMetric: z.string().optional(),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z.number().int().positive().optional(),

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
  "hypothesis",
  "project",
  "owner",
  "tags",
  "customFields",
  "trackingKey",
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
  "disableStickyBucketing",
  "variations",
  "datasource",
  "contextualBanditQueryId",
  "segment",
  "queryFilter",
  "goalMetrics",
  "activationMetric",
  "metricOverrides",
  "skipPartialData",
  "regressionAdjustmentEnabled",
  "contextualAttributes",
  "decisionMetric",
  "minUsersPerLeaf",
  "maxLeaves",
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

// CB-native read endpoints: not wired through the spec-pattern apiConfig because
// the TS inference cascade across too many spec-style customHandlers is unworkable;
// registered as standalone routes in `contextual-bandits.router.ts` instead.

const cbIdAndSnapshotParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    snapshotId: z.string().describe("The snapshot id"),
  })
  .strict();

const cbIdAndEventParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    eventId: z.string().describe("The event id"),
  })
  .strict();

const cbIdOnlyParam = z
  .object({ id: z.string().describe("The Contextual Bandit id") })
  .strict();

const cbSnapshotResponseShape = z.object({
  id: z.string(),
  contextualBandit: z.string(),
  status: z.enum(["pending", "running", "success", "error", "partial"]),
  weightsWereUpdated: z.boolean().optional(),
  contextualBanditEventId: z.string().nullable().optional(),
  error: z.string().optional(),
  dateCreated: z.string(),
});

const cbEventResponseShape = z.object({
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

export const getCbCurrentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z
    .object({
      currentLeafWeights: z.array(leafWeightValidator).optional(),
      latestEvent: cbEventResponseShape.nullable(),
    })
    .strict(),
  summary: "Get current Contextual Bandit leaf weights and latest event",
  operationId: "getCbCurrent",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/current",
};

export const listCbSnapshotsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict()
    .optional(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z
    .object({ snapshots: z.array(cbSnapshotResponseShape) })
    .strict(),
  summary: "List Contextual Bandit snapshots",
  operationId: "listCbSnapshots",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/snapshots",
};

export const getCbSnapshotValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdAndSnapshotParam,
  responseSchema: z.object({ snapshot: cbSnapshotResponseShape }).strict(),
  summary: "Get a single Contextual Bandit snapshot",
  operationId: "getCbSnapshot",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/snapshots/:snapshotId",
};

export const listCbEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict()
    .optional(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z.object({ events: z.array(cbEventResponseShape) }).strict(),
  summary: "List Contextual Bandit weight-update events",
  operationId: "listCbEvents",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/events",
};

export const getCbEventValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdAndEventParam,
  responseSchema: z.object({ event: cbEventResponseShape }).strict(),
  summary: "Get a single Contextual Bandit weight-update event",
  operationId: "getCbEvent",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/events/:eventId",
};

export const getCbResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z
    .object({
      contextualBanditSnapshot: z
        .object({
          attributes: z.array(z.string()),
          // Loose to avoid pulling the heavier stats validators into this file.
          responses: z.array(z.unknown()),
          leaf_map: z.array(z.unknown()).optional(),
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
        })
        .nullable(),
    })
    .strict(),
  summary: "Get latest Contextual Bandit results",
  description:
    "Returns the latest contextual-bandit stats engine output and the status of the most recent snapshot run for the CB. Same payload the GrowthBook UI uses to render the CB results table.",
  operationId: "getCbResults",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/results",
};
