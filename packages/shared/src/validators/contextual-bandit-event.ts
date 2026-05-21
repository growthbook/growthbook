import { z } from "zod";
import { baseSchema } from "./base-model";

/** One leaf of the decision tree: contextId → per-arm weights. */
export const treeLeafValidator = z.object({
  contextId: z.string(),
  weights: z.array(z.number()),
});
export type TreeLeaf = z.infer<typeof treeLeafValidator>;

/** Per-context stats & weight update returned by the stats engine. */
export const contextResultValidator = z.object({
  contextId: z.string(),
  /** Number of users per variation observed in this context. */
  sampleSizePerVariation: z.array(z.number()).nullable().optional(),
  /** Mean outcome per variation. */
  variationMeans: z.array(z.number()).nullable().optional(),
  /** Updated arm weights after the run. */
  updatedWeights: z.array(z.number()).nullable().optional(),
  /** Best-arm probabilities from Thompson sampling. */
  bestArmProbabilities: z.array(z.number()).nullable().optional(),
  updateMessage: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type ContextResult = z.infer<typeof contextResultValidator>;

/** The fitted decision-tree model emitted by the stats engine. */
const cbTreeValidator = z.object({
  model: z.string(),
  splitFeatures: z.array(z.string()),
  leaves: z.array(treeLeafValidator),
});
export type CbTree = z.infer<typeof cbTreeValidator>;

export const contextualBanditEventValidator = baseSchema
  .extend({
    experiment: z.string(),
    phase: z.number(),
    snapshotId: z.string(),
    /** Results for every context leaf that was updated this run. */
    contextResults: z.array(contextResultValidator),
    /** The fitted tree (null when no tree was fitted this run). */
    tree: cbTreeValidator.nullable().optional(),
    /** True when arm weights were actually changed by this event. */
    weightsWereUpdated: z.boolean(),
  })
  .strict();

export type ContextualBanditEventInterface = z.infer<
  typeof contextualBanditEventValidator
>;
