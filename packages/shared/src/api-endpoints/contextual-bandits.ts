import { z } from "zod";
import { booleanQueryField } from "../validators/shared";
import { contextualLeafClauseValidator } from "../validators/contextual-bandit-event";
import { queryPointerValidator } from "../validators/queries";
import {
  apiContextualBanditCancelReturn,
  apiContextualBanditCancelValidator,
  apiContextualBanditLifecycleReturn,
  apiContextualBanditRefreshReturn,
  apiContextualBanditRefreshValidator,
  apiContextualBanditStartValidator,
  apiContextualBanditStopValidator,
  apiContextualBanditUpdateVariationsValidator,
  apiContextualBanditValidator,
  apiContextualBanditVariationsReturn,
  apiCreateContextualBanditBody,
  apiListContextualBanditsValidator,
  apiUpdateContextualBanditBody,
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

/**
 * Every REST route under `/api/v1/contextual-bandits`. Each export is one
 * route, named after its operationId. The back-end must mount every export
 * (see contextual-bandits.router.ts), so nothing else belongs in this file.
 */

const tags = ["ContextualBandits"];
const idParams = z.object({ id: z.string() }).strict();

export const listContextualBandits = {
  ...apiListContextualBanditsValidator,
  responseSchema: z.object({
    contextualBandits: z.array(apiContextualBanditValidator),
  }),
  summary: "Get all contextualBandits",
  operationId: "listContextualBandits",
  tags,
  method: "get" as const,
  path: "/contextual-bandits",
};

export const createContextualBandit = {
  paramsSchema: z.never(),
  bodySchema: apiCreateContextualBanditBody,
  querySchema: z.never(),
  responseSchema: z.object({ contextualBandit: apiContextualBanditValidator }),
  summary: "Create a single contextualBandit",
  operationId: "createContextualBandit",
  tags,
  method: "post" as const,
  path: "/contextual-bandits",
};

export const getContextualBandit = {
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ contextualBandit: apiContextualBanditValidator }),
  summary: "Get a single contextualBandit",
  operationId: "getContextualBandit",
  tags,
  method: "get" as const,
  path: "/contextual-bandits/:id",
};

export const updateContextualBandit = {
  paramsSchema: idParams,
  bodySchema: apiUpdateContextualBanditBody,
  querySchema: z.never(),
  responseSchema: z.object({ contextualBandit: apiContextualBanditValidator }),
  summary: "Update a single contextualBandit",
  operationId: "updateContextualBandit",
  tags,
  method: "put" as const,
  path: "/contextual-bandits/:id",
};

export const startContextualBandit = {
  ...apiContextualBanditStartValidator,
  responseSchema: apiContextualBanditLifecycleReturn,
  summary: "Start a Contextual Bandit",
  operationId: "startContextualBandit",
  tags,
  method: "post" as const,
  path: "/contextual-bandits/:id/start",
};

export const stopContextualBandit = {
  ...apiContextualBanditStopValidator,
  responseSchema: apiContextualBanditLifecycleReturn,
  summary: "Stop a Contextual Bandit",
  operationId: "stopContextualBandit",
  tags,
  method: "post" as const,
  path: "/contextual-bandits/:id/stop",
};

export const refreshContextualBandit = {
  ...apiContextualBanditRefreshValidator,
  responseSchema: apiContextualBanditRefreshReturn,
  summary: "Trigger a Contextual Bandit snapshot refresh",
  operationId: "refreshContextualBandit",
  tags,
  method: "post" as const,
  path: "/contextual-bandits/:id/refresh",
};

export const updateContextualBanditVariations = {
  ...apiContextualBanditUpdateVariationsValidator,
  responseSchema: apiContextualBanditVariationsReturn,
  summary: "Add or remove Contextual Bandit variations",
  description: `Adds and/or removes variations on a Contextual Bandit. Send \`addVariations\` and \`removeVariationIds\` independently; both are optional. New arms must carry a \`values\` entry for each linked feature. Running CBs publish the linked-feature updates; draft CBs stage them until start. Under an approval flow, unapproved drafts leave the added arm \`pending\` (zero weight, filtered from the SDK) until every linked feature's draft is live. Removed arms are tombstoned; their ids can never be re-added. Weights are reconciled server-side.`,
  operationId: "updateContextualBanditVariations",
  tags,
  method: "post" as const,
  path: "/contextual-bandits/:id/variations",
};

export const cancelContextualBandit = {
  ...apiContextualBanditCancelValidator,
  responseSchema: apiContextualBanditCancelReturn,
  summary: "Cancel a running Contextual Bandit snapshot refresh",
  operationId: "cancelContextualBandit",
  tags,
  method: "post" as const,
  path: "/contextual-bandits/:id/cancel",
};

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
  tags,
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
  tags,
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
  tags,
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
  tags,
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
  tags,
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
  tags,
  method: "get" as const,
  path: "/contextual-bandits/:id/results",
};

export const getContextualBanditLinkedFeatures = {
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
  tags,
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
  tags,
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
  tags,
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
  tags,
  method: "delete" as const,
  path: "/contextual-bandits/:id/linked-feature/:featureId",
};
