import { z } from "zod";
import { baseSchema } from "./base-model";

export const contextualLeafClauseValidator = z.object({
  attribute: z.string(),
  levels: z.array(z.string()),
  operator: z.enum(["in", "not in"]),
});
export type ContextualLeafClauseInterface = z.infer<
  typeof contextualLeafClauseValidator
>;

/** One tree leaf's targeting condition: the AND of its per-attribute clauses. */
export const contextualLeafMapEntryValidator = z.object({
  leafId: z.number().int(),
  context: z.array(contextualLeafClauseValidator),
});
export type ContextualLeafMapEntryInterface = z.infer<
  typeof contextualLeafMapEntryValidator
>;

export const contextualLeafStatsEntryValidator = z.object({
  leafId: z.number().int(),
  sampleSizePerVariation: z.array(z.number()).nullable().optional(),
  sampleMeans: z.array(z.number()).nullable().optional(),
  sampleVariances: z.array(z.number()).nullable().optional(),
});
export type ContextualLeafStatsEntryInterface = z.infer<
  typeof contextualLeafStatsEntryValidator
>;

/** Metadata for a single greedy tree split (pre-split leaf condition + partition). */
export const contextualTreeSplitValidator = z.object({
  leafClauses: z.array(contextualLeafClauseValidator),
  attribute: z.string(),
  leftLevels: z.array(z.string()),
  rightLevels: z.array(z.string()),
});
export type ContextualTreeSplitInterface = z.infer<
  typeof contextualTreeSplitValidator
>;

/** Total within-tree SSE at each stage of greedy tree growth (root, after 1st split, ...). */
export const contextualSseTrajectoryEntryValidator = z.object({
  numSplits: z.number().int().nonnegative(),
  totalSse: z.number(),
  split: contextualTreeSplitValidator.optional(),
  ssePerVariation: z.array(z.number()).optional(),
});
export type ContextualSseTrajectoryEntryInterface = z.infer<
  typeof contextualSseTrajectoryEntryValidator
>;

/** BIC model-selection statistic for one greedy tree split (observability only). */
export const contextualBicTrajectoryEntryValidator = z.object({
  numSplits: z.number().int().nonnegative(),
  logLikelihoodRatio: z.number(),
  penalty: z.number(),
  deltaBic: z.number(),
});
export type ContextualBicTrajectoryEntryInterface = z.infer<
  typeof contextualBicTrajectoryEntryValidator
>;

/** Mirrors gbstats `ContextualBanditResponse`. */
export const contextualBanditResponseValidator = z.object({
  context: z.record(z.string(), z.unknown()),
  leafId: z.number().int().optional(),
  sampleSizePerVariation: z.array(z.number()).nullable().optional(),
  sampleMeans: z.array(z.number()).nullable().optional(),
  sampleVariances: z.array(z.number()).nullable().optional(),
  updatedWeights: z.array(z.number()).nullable().optional(),
  bestArmProbabilities: z.array(z.number()).nullable().optional(),
  updateMessage: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type ContextualBanditResponseInterface = z.infer<
  typeof contextualBanditResponseValidator
>;

// TODO(holdout-v1.5): the holdout pipeline will add new stats-engine output fields
// (e.g. `holdoutComparison`); update this schema, the matching `ContextualBanditResult`
// type in back-end/src/enterprise/services/contextualBanditStats.ts, and the results UI.

export const contextualBanditEventValidator = baseSchema
  .extend({
    contextualBandit: z.string(),
    snapshotId: z.string(),
    attributes: z.array(z.string()),
    responses: z.array(contextualBanditResponseValidator),
    leaf_map: z.array(contextualLeafMapEntryValidator).optional(),
    leaf_stats: z.array(contextualLeafStatsEntryValidator).optional(),
    sse_trajectory: z.array(contextualSseTrajectoryEntryValidator).optional(),
    bic_trajectory: z.array(contextualBicTrajectoryEntryValidator).optional(),
    weightsWereUpdated: z.boolean(),
    degreesOfFreedom: z.number().int().nonnegative().optional(),
    // The seed that was applied to the CB when this event was persisted.
    // Stored for historical tracking; the CB's current seed changes each epoch.
    seed: z.string().optional(),
  })
  .strict();

export type ContextualBanditEventInterface = z.infer<
  typeof contextualBanditEventValidator
>;
