import { z } from "zod";
import { baseSchema } from "./base-model";

export const contextualLeafMapEntryValidator = z.object({
  context: z.record(z.string(), z.string()),
  leafId: z.number().int(),
});
export type ContextualLeafMapEntryInterface = z.infer<
  typeof contextualLeafMapEntryValidator
>;

/** One leaf-level contextual bandit response (mirrors gbstats `ContextualBanditResponse`). */
export const contextualBanditResponseValidator = z.object({
  /** Targeting condition for this leaf, e.g. `{ country: { $in: ["US"] } }`. */
  context: z.record(z.string(), z.unknown()),
  sampleSizePerVariation: z.array(z.number()).nullable().optional(),
  variationMeans: z.array(z.number()).nullable().optional(),
  updatedWeights: z.array(z.number()).nullable().optional(),
  bestArmProbabilities: z.array(z.number()).nullable().optional(),
  updateMessage: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type ContextualBanditResponseInterface = z.infer<
  typeof contextualBanditResponseValidator
>;

// TODO(holdout-v1.5): the holdout pipeline will introduce new output fields
// from the stats engine (e.g. `holdoutComparison` with sample sizes, effect
// estimate, and an EDF-style decision flag). Those fields must be added BOTH
// here (so `persistContextualBanditEvent` doesn't fail strict validation)
// AND in the matching `ContextualBanditResult` type in
// back-end/src/enterprise/services/contextualBanditStats.ts, AND consumed by the
// results UI. See contextual-bandit-fix-prompt.md.

export const contextualBanditEventValidator = baseSchema
  .extend({
    /**
     * Parent contextual bandit id (`cb_*`). Replaces the pre-PR-8
     * `experiment` field — the event collection is now keyed by CB id,
     * not by the legacy paired experiment id. See
     * `contextual-bandit-snapshot.ts` for the deeper rationale; the
     * migration script in `scripts/migrate-cb-decoupling.ts` rewrites
     * `experiment` → `contextualBandit` on existing docs.
     */
    contextualBandit: z.string(),
    phase: z.number(),
    snapshotId: z.string(),
    /** Contextual attributes used for this run (mirrors gbstats `ContextualBanditResult.attributes`). */
    attributes: z.array(z.string()),
    /** Per-leaf stats and weight updates from the stats engine. */
    responses: z.array(contextualBanditResponseValidator),
    /** Maps each observed context to its regression-tree leaf id (when tree model is used). */
    leaf_map: z.array(contextualLeafMapEntryValidator).optional(),
    /** True when arm weights were actually changed by this event. */
    weightsWereUpdated: z.boolean(),
  })
  .strict();

export type ContextualBanditEventInterface = z.infer<
  typeof contextualBanditEventValidator
>;
