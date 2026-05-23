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

    // TODO(holdout-v1.5): holdouts are deferred to v1.5. The field is preserved
    // here so future docs can carry a non-zero value without a breaking schema
    // change, but it is *not yet wired through* — the snapshot orchestrator,
    // SQL runner, stats engine, SDK callback, and results UI all still ignore
    // a non-zero `holdoutPercent`. Operationally callers should keep this at 0
    // until the holdout pipeline ships. See contextual-bandit-fix-prompt.md.
    holdoutPercent: z.number().min(0).max(0.5),

    // TODO(holdout-v1.5): sticky bucketing is intentionally unsupported per
    // the original CB design decision. The field is preserved for forward
    // compatibility with the holdout pipeline (which may need stickiness for
    // the holdout bucket) but consumers should treat any non-default value as
    // a no-op until v1.5.
    stickyBucketing: z.boolean(),

    /** Version of the canonicalization algorithm used to derive context IDs. */
    canonicalFormVersion: z.number().int().nonnegative(),

    phases: z.array(cbPhaseValidator),
  })
  .strict();

export type ContextualBanditInterface = z.infer<
  typeof contextualBanditValidator
>;
