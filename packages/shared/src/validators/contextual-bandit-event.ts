import { z } from "zod";
import { baseSchema } from "./base-model";

/**
 * Mongo document cap shared across all CBE writes:
 *   Σ (contextResults × variations) ≤ MAX_CBE_CONTEXT_VARIATION_PAIRS
 *
 * Enforced in `customValidation` on the ContextualBanditEventModel rather
 * than at the schema level, since variation count is not knowable until
 * the doc is assembled. The cap protects the 16MB BSON limit and keeps
 * each tick's payload deserializable on the front-end without streaming.
 */
export const MAX_CBE_CONTEXT_VARIATION_PAIRS = 3000;

/**
 * Tree models supported by the stats engine (A5). `regression_tree` is the
 * verification target for MVP; `linear_thompson` is a stub that returns
 * deterministic mock results when the back-end runs with
 * `GROWTHBOOK_CB_MOCK_STATS=1`.
 */
export const contextualBanditTreeModel = [
  "regression_tree",
  "linear_thompson",
] as const;
export type ContextualBanditTreeModel =
  (typeof contextualBanditTreeModel)[number];

/**
 * Aggregated rows for a single (context, variation) cell. Mirrors the
 * gbstats input contract (A5: `n`, `main_sum`, `main_sum_squares`).
 */
export const contextualBanditVariationStats = z
  .object({
    variation: z.string(),
    n: z.number().int().nonnegative(),
    mainSum: z.number(),
    mainSumSquares: z.number(),
    /** Posterior mean (e.g. expected reward) emitted by the stats engine. */
    posteriorMean: z.number().optional(),
    /** Posterior standard deviation; sibling of `posteriorMean`. */
    posteriorStdDev: z.number().optional(),
    /**
     * Updated allocation weight for this variation within this context.
     * Sum across the variations of a single `contextResult` is ≈ 1.
     * Persisted on the sibling `ContextualBandit.phases[N].currentLeafWeights`
     * by the A6 orchestrator after each tick for SDK emission.
     */
    weight: z.number(),
  })
  .strict();
export type ContextualBanditVariationStats = z.infer<
  typeof contextualBanditVariationStats
>;

/**
 * Single leaf of the policy tree. `contextId` is the canonical hash from
 * `deriveContextId` (A1) and is the stable join key across CBE ticks and
 * SDK payload `contexts` entries.
 */
export const contextualBanditContextResult = z
  .object({
    contextId: z.string(),
    /**
     * Canonical condition JSON produced by `canonicalize()` (A1). Owned by
     * the leaf in the CBE — the snapshot orchestrator (A6) maps each leaf
     * back to the canonical condition before writing.
     */
    condition: z.string(),
    /** Optional human-readable label for UI/debugging. */
    label: z.string().optional(),
    variations: z.array(contextualBanditVariationStats),
    /** Total exposures across all variations at this leaf, for the tick. */
    totalUsers: z.number().int().nonnegative(),
    /** Whether the leaf is the catch-all created when contexts exceed maxContexts (A6). */
    isOther: z.boolean().optional(),
  })
  .strict();
export type ContextualBanditContextResult = z.infer<
  typeof contextualBanditContextResult
>;

/**
 * Serialized tree object emitted by the stats engine. Shape is intentionally
 * permissive — the back-end treats it as opaque and forwards it to the
 * front-end. Stats engine owns the per-model schema (A5 Appendix B in source
 * doc); align field names with the Python side before extending.
 */
export const contextualBanditTreeSummary = z
  .object({
    model: z.enum(contextualBanditTreeModel),
    /** Opaque per-model tree representation (nodes, splits, leaves, …). */
    nodes: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Optional per-tree metadata (depth, fit metrics, RNG seed used, …). */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ContextualBanditTreeSummary = z.infer<
  typeof contextualBanditTreeSummary
>;

export const contextualBanditEventValidator = baseSchema.safeExtend({
  /** Experiment this CBE belongs to. */
  experiment: z.string(),
  /** Phase index on the experiment that owned this tick. */
  phase: z.number().int().nonnegative(),
  /** CBS lifecycle wrapper that produced this CBE (A6 orchestrator). */
  contextualBanditSnapshotId: z.string(),
  /** CBAQ whose settings (attributes, top values) were used at run time. */
  contextualBanditQueryId: z.string(),
  /**
   * `CANONICAL_FORM_VERSION` at write time (A1). Consumers can detect a
   * re-canonicalization and treat older `contextId`s as stale.
   */
  canonicalFormVersion: z.string(),
  treeModel: z.enum(contextualBanditTreeModel),
  treeSummary: contextualBanditTreeSummary,
  contextResults: z.array(contextualBanditContextResult),
  /**
   * Seed used for the tick — both for tree fit reproducibility and for
   * deterministic SDK hash bucketing on the sibling
   * `ContextualBandit.phases[N].currentLeafWeights`.
   */
  seed: z.number().int(),
  /**
   * Holdout percent for the tick. Fixed at `0` in A; carried as a field so
   * the field exists once Phase B / v1.5 lifts the guardrail (per source
   * doc Appendix C).
   */
  holdoutPercent: z.number(),
  /**
   * Whether the stats engine applied a Thompson update this tick. False
   * for ticks fired purely to refresh tree structure / posterior moments
   * without re-allocating arms.
   */
  reweight: z.boolean(),
  /**
   * Set when at least one variation weight changed vs the previous tick's
   * `ContextualBandit.phases[N].currentLeafWeights`. Mirrored onto the
   * CBS for fast UI filtering.
   */
  weightsWereUpdated: z.boolean(),
  /**
   * Decision metric the tick optimized for — e.g. `"met_checkout_revenue"`.
   * Frozen from the experiment's goal metric at tick time.
   */
  decisionMetric: z.string(),
  /**
   * Human-readable summary emitted by the stats engine (A5). Surfaced in
   * the snapshot-history UI and audit log.
   */
  updateMessage: z.string(),
  /**
   * Optional partial-error string from the stats engine. Present when the
   * tick produced usable weights but some sub-step (e.g. a single leaf's
   * Thompson sample) degraded. Hard failures abort before CBE write and
   * land on the CBS instead.
   */
  error: z.string().optional(),
  /** Total users exposed across all contexts for this tick. */
  totalUsersThisTick: z.number().int().nonnegative(),
});

export type ContextualBanditEventInterface = z.infer<
  typeof contextualBanditEventValidator
>;

/**
 * Computes the BSON cap input — Σ (contextResults × variations). Exported
 * so the model `customValidation` and the orchestrator (A6) can share a
 * single source of truth before persisting.
 */
export function getContextVariationPairCount(
  doc: Pick<ContextualBanditEventInterface, "contextResults">,
): number {
  return doc.contextResults.reduce(
    (acc, ctx) => acc + ctx.variations.length,
    0,
  );
}
