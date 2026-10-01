import { z } from "zod";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import { crudEndpoint, customEndpoint } from "../api-model";
import { booleanQueryField } from "../validators/shared";
import { contextualLeafClauseValidator } from "../validators/contextual-bandit-event";
import { queryPointerValidator } from "../validators/queries";
import {
  contextualBanditEventResponseShape,
  contextualBanditIdAndEventParam,
  contextualBanditIdAndFeatureParam,
  contextualBanditIdAndSnapshotParam,
  contextualBanditIdOnlyParam,
  contextualBanditLinkedFeatureDraftVersionField,
  contextualBanditLinkedFeatureRuleFields,
  contextualBanditSnapshotResponseShape,
  leafWeightValidator,
} from "../validators/contextual-bandit";
import {
  cancelContextualBanditEndpoint,
  contextualBanditApiSpec,
  refreshContextualBanditEndpoint,
  startContextualBanditEndpoint,
  stopContextualBanditEndpoint,
  updateVariationsContextualBanditEndpoint,
} from "../validators/contextual-bandit.spec";

/**
 * Every REST route under `/api/v1/contextual-bandits`. Each export is one
 * route, named after its operationId. ContextualBanditModel mounts the ones
 * built from contextualBanditApiSpec and contextual-bandits.router.ts mounts
 * the rest. `pnpm generate-openapi` fails on any export the back-end does not
 * mount, so nothing else belongs in this file.
 */

export const listContextualBandits = crudEndpoint(
  contextualBanditApiSpec,
  "list",
);
export const createContextualBandit = crudEndpoint(
  contextualBanditApiSpec,
  "create",
);
export const getContextualBandit = crudEndpoint(contextualBanditApiSpec, "get");
export const updateContextualBandit = crudEndpoint(
  contextualBanditApiSpec,
  "update",
);
export const startContextualBandit = customEndpoint(
  contextualBanditApiSpec,
  startContextualBanditEndpoint,
);
export const stopContextualBandit = customEndpoint(
  contextualBanditApiSpec,
  stopContextualBanditEndpoint,
);
export const refreshContextualBandit = customEndpoint(
  contextualBanditApiSpec,
  refreshContextualBanditEndpoint,
);
export const updateContextualBanditVariations = customEndpoint(
  contextualBanditApiSpec,
  updateVariationsContextualBanditEndpoint,
);
export const cancelContextualBandit = customEndpoint(
  contextualBanditApiSpec,
  cancelContextualBanditEndpoint,
);

export const getContextualBanditCurrentWeights = {
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

export const listContextualBanditSnapshots = {
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

export const getContextualBanditSnapshot = {
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

export const listContextualBanditEvents = {
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

export const getContextualBanditEvent = {
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

export const getContextualBanditResults = {
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
          bic_trajectory: z.array(z.unknown()).optional(),
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
              split: z
                .object({
                  leafClauses: z.array(contextualLeafClauseValidator),
                  attribute: z.string(),
                  leftLevels: z.array(z.string()),
                  rightLevels: z.array(z.string()),
                })
                .optional(),
            }),
          ),
          overall: z.object({
            variations: z.array(
              z.object({
                variationId: z.string(),
                variationName: z.string().optional(),
                weight: z.number().nullable(),
                mean: z.number().nullable(),
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
          queries: z.array(queryPointerValidator),
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

export const getContextualBanditLinkedFeatures = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdOnlyParam,
  responseSchema: z
    .object({
      linkedFeatures: z.array(z.custom<LinkedFeatureInfo>()),
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

export const addContextualBanditLinkedFeature = {
  bodySchema: z
    .object({
      ...contextualBanditLinkedFeatureRuleFields,
      draftVersion: contextualBanditLinkedFeatureDraftVersionField.describe(
        "Add the rule to this existing draft revision instead of starting a new one.",
      ),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdAndFeatureParam,
  responseSchema: z
    .object({
      featureId: z.string(),
      ruleId: z.string(),
      revisionVersion: z.number(),
      published: z.boolean(),
    })
    .strict(),
  summary: "Link a feature to a Contextual Bandit",
  description:
    "Adds a `contextual-bandit-ref` rule to the bottom of the feature's rule list and links the feature to this contextual bandit. The rule lands in a draft revision that auto-publishes when the contextual bandit starts, unless `autoPublish` is set. Targeting (condition, Saved Groups, prerequisites, coverage) is inherited from the contextual bandit and cannot be set on the rule.",
  operationId: "addContextualBanditLinkedFeature",
  tags: ["ContextualBandits"],
  method: "post" as const,
  path: "/contextual-bandits/:id/linked-feature/:featureId",
};

export const updateContextualBanditLinkedFeature = {
  bodySchema: z
    .object({
      ...contextualBanditLinkedFeatureRuleFields,
      draftVersion: contextualBanditLinkedFeatureDraftVersionField.describe(
        "Update the rule on this existing draft revision instead of starting a new one.",
      ),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: contextualBanditIdAndFeatureParam,
  responseSchema: z
    .object({
      featureId: z.string(),
      ruleIds: z.array(z.string()),
      revisionVersion: z.number(),
      published: z.boolean(),
    })
    .strict(),
  summary: "Replace a Contextual Bandit's rule on a linked feature",
  description:
    "Replaces every `contextual-bandit-ref` rule pointing at this contextual bandit on the feature, keeping each rule's id and position in the rule list. Every field is replaced, so omitted optional fields revert to their defaults. Returns a 400 when the feature has no such rule on the target revision, or when it has several that are not identical to each other. The change lands in a draft revision that auto-publishes when the contextual bandit starts, unless `autoPublish` is set. Targeting (condition, Saved Groups, prerequisites, coverage) is inherited from the contextual bandit and cannot be set on the rule.",
  operationId: "updateContextualBanditLinkedFeature",
  tags: ["ContextualBandits"],
  method: "put" as const,
  path: "/contextual-bandits/:id/linked-feature/:featureId",
};

export const deleteContextualBanditLinkedFeature = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      autoPublish: booleanQueryField.describe(
        "Publish the resulting revision immediately instead of leaving it as a draft.",
      ),
      draftVersion: contextualBanditLinkedFeatureDraftVersionField.describe(
        "Remove the rule from this existing draft revision instead of live. Required when the rule hasn't been published yet — omitting it targets the live revision, which has nothing to remove.",
      ),
    })
    .strict(),
  paramsSchema: contextualBanditIdAndFeatureParam,
  responseSchema: z
    .object({
      featureId: z.string(),
      removedRuleIds: z.array(z.string()),
      revisionVersion: z.number().nullable(),
      published: z.boolean(),
    })
    .strict(),
  summary: "Unlink a feature from a Contextual Bandit",
  description:
    "Removes every `contextual-bandit-ref` rule pointing at this contextual bandit from the feature and drops the feature from the bandit's linked-feature list. The rule removal lands in a draft revision unless `autoPublish` is set. When the feature has no such rule left, only the linkage is cleared.",
  operationId: "deleteContextualBanditLinkedFeature",
  tags: ["ContextualBandits"],
  method: "delete" as const,
  path: "/contextual-bandits/:id/linked-feature/:featureId",
};
