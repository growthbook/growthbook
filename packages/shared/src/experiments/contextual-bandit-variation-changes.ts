import { VariationWeightPair } from "shared/validators";
import { getEqualWeights } from "./experiments";

export const MIN_CONTEXTUAL_BANDIT_VARIATIONS = 2;

/** Weight floor applied after redistribution; mirrors stats-ts MIN_VARIATION_WEIGHT. */
export const MIN_VARIATION_WEIGHT = 0.01;

/**
 * How reconciled weights are produced for a new arm set:
 *   - "uniform"      → even split across all arms (no learned weights to preserve).
 *   - "redistribute" → carry over the existing learned weights and reweight.
 */
export type WeightReconcileMode = "uniform" | "redistribute";
export type VariationIdentity = { id: string };
export type VariationDiff = {
  addedIds: string[];
  removedIds: string[];
  keptIds: string[];
};

export function diffVariations(
  previous: VariationIdentity[],
  next: VariationIdentity[],
): VariationDiff {
  const prevIds = previous.map((v) => v.id);
  const nextIds = next.map((v) => v.id);
  const prevSet = new Set(prevIds);
  const nextSet = new Set(nextIds);
  return {
    addedIds: nextIds.filter((id) => !prevSet.has(id)),
    removedIds: prevIds.filter((id) => !nextSet.has(id)),
    keptIds: nextIds.filter((id) => prevSet.has(id)),
  };
}

export function assertAtLeastTwoVariations(
  variations: VariationIdentity[],
): void {
  if (variations.length < MIN_CONTEXTUAL_BANDIT_VARIATIONS) {
    throw new Error(
      `A contextual bandit must have at least ${MIN_CONTEXTUAL_BANDIT_VARIATIONS} variations.`,
    );
  }
}

/**
 * Of the variations being removed, return those still referenced by a live
 * linked-feature rule (so the caller can block the removal or require the
 * feature to be updated first).
 *
 * Pure set intersection: the backend (P2) is responsible for extracting the set
 * of referenced variation ids from the linked features and passing it in here.
 */
export function getRemovedVariationsInUse(
  removedIds: string[],
  referencedVariationIds: Iterable<string>,
): string[] {
  const referenced = new Set(referencedVariationIds);
  return removedIds.filter((id) => referenced.has(id));
}

/** Even split across the given variation ids, in order, summing to 1. */
function uniformWeightPairs(variationIds: string[]): VariationWeightPair[] {
  const weights = getEqualWeights(variationIds.length || 1);
  return variationIds.map((variationId, i) => ({
    variationId,
    weight: weights[i],
  }));
}

/**
 * Produce a reconciled paired weight set over exactly `newVariationIds` (in that
 * order, so the SDK's positional array stays aligned), summing to 1.
 *
 * @param current           existing paired weights for the previous arm set
 * @param newVariationIds    desired final arm set, in `variations` order
 * @param mode               see {@link WeightReconcileMode}
 */
export function reconcileVariationWeights(
  current: VariationWeightPair[],
  newVariationIds: string[],
  mode: WeightReconcileMode,
): VariationWeightPair[] {
  // Reference `current` so the signature is stable for the redistribute impl.
  void current;

  if (mode === "uniform") {
    return uniformWeightPairs(newVariationIds);
  }

  // =========================================================================
  // TODO(luke) — P6: REDISTRIBUTE-MODE WEIGHT FORMULA — NOT YET DECIDED.
  //
  // How weights are recomputed when the arm set changes while learned weights
  // exist (exploit stage) is an open product/stats decision. Do NOT implement an
  // interim formula here — a wrong split ships incorrect live traffic and
  // mis-buckets exposures.
  //
  // When defined, the implementation must:
  //   - read `current` (previous paired weights, sums ~1) and return a paired set
  //     over exactly `newVariationIds`, in that order;
  //   - handle removals (arms in `current` absent from `newVariationIds`) and
  //     additions (arms in `newVariationIds` absent from `current`); an added
  //     arm's seed weight must be large enough to accrue data (the CB stays in
  //     its current stage on add — no reset);
  //   - clamp each weight to MIN_VARIATION_WEIGHT and renormalize to sum to 1.
  // =========================================================================
  throw new Error(
    "Contextual bandit weight redistribution ('redistribute' mode) is not " +
      "implemented yet (awaiting formula). See TODO(luke) in " +
      "contextual-bandit-variation-changes.ts.",
  );
}
