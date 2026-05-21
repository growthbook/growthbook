import { z } from "zod";
import { baseSchema } from "./base-model";

/** Per-leaf arm weights stored on a CB phase. */
export const leafWeightValidator = z.object({
  contextId: z.string(),
  weights: z.array(z.number()),
});
export type LeafWeight = z.infer<typeof leafWeightValidator>;

/** One phase of a contextual bandit experiment. */
export const cbPhaseValidator = z.object({
  dateStarted: z.date(),
  dateEnded: z.date().nullable().optional(),
  currentLeafWeights: z.array(leafWeightValidator),
});
export type CbPhase = z.infer<typeof cbPhaseValidator>;

export const contextualBanditValidator = baseSchema
  .extend({
    /** Foreign key → ExperimentInterface.id */
    experiment: z.string(),

    datasourceId: z.string(),
    exposureQueryId: z.string(),

    /** Ordered list of attribute column names used to derive context IDs. */
    contextualAttributes: z.array(z.string()),

    /** Maximum number of distinct contexts to track. */
    maxContexts: z.number().int().positive(),

    /** Decision-tree algorithm/model name (e.g. "linear_tree"). */
    treeModel: z.string(),

    /** Minimum users required in a leaf for that leaf to be split. */
    minUsersPerLeaf: z.number().int().positive(),

    /** Maximum number of tree leaves (contexts) to fit. */
    maxLeaves: z.number().int().positive(),

    /** Must always be 0 — contextual bandits do not support holdouts. */
    holdoutPercent: z.literal(0),

    /** Must always be false — contextual bandits do not support sticky bucketing. */
    stickyBucketing: z.literal(false),

    /** Version of the canonicalization algorithm used to derive context IDs. */
    canonicalFormVersion: z.number().int().nonnegative(),

    phases: z.array(cbPhaseValidator),
  })
  .strict();

export type ContextualBanditInterface = z.infer<
  typeof contextualBanditValidator
>;
