import { z } from "zod";
import { baseSchema } from "./base-model";

export const contextualLeafMapEntryValidator = z.object({
  context: z.record(z.string(), z.string()),
  leafId: z.number().int(),
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

/** Mirrors gbstats `ContextualBanditResponse`. */
export const contextualBanditResponseValidator = z.object({
  context: z.record(z.string(), z.unknown()),
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
    weightsWereUpdated: z.boolean(),
    /**
     * Degrees of freedom of the contextual SRM test for the snapshot run that
     * produced this event, computed in SQL. Absent when the SRM test could not
     * be run (e.g. no group had enough usable cells, or a non-SQL data source).
     */
    degreesOfFreedom: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ContextualBanditEventInterface = z.infer<
  typeof contextualBanditEventValidator
>;
