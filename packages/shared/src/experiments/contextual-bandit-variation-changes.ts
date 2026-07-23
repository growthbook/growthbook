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

/**
 * Value for a newly-added variation on a linked feature's contextual-bandit-ref
 * rule. Precedence: caller-supplied → the rule's control (first) variation value
 * → the feature default. Ensures an added arm is never served as `null` in the
 * SDK payload. The caller type-validates the result via `validateFeatureValue`.
 */
export function defaultAddedVariationValue(
  provided: string | undefined,
  controlValue: string | undefined,
  featureDefaultValue: string,
): string {
  return provided ?? controlValue ?? featureDefaultValue;
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
  if (mode === "uniform") {
    return uniformWeightPairs(newVariationIds);
  }

  // Redistribute mode (exploit): preserve the learned weights across an arm-set
  // change, per Luke's algorithms. Applied once per call site — the aggregate
  // (MAB fallback) weights and each leaf's weights.
  //
  //   Algorithm A (dropping M of K0 arms): let S = total weight of the dropped
  //   arms; each surviving arm i becomes w_i / (1 - S) — i.e. the dropped mass is
  //   spread proportionally over the survivors (here: normalize survivors by
  //   their surviving mass, which equals 1 - S when `current` sums to 1).
  //
  //   Algorithm B (adding N arms to the K survivors): mix the survivor vector
  //   (scaled by K/(K+N)) with the N new arms (each weight 1/(K+N)):
  //       w' = (K/(K+N))·[survivors…, 0×N] + (1/(K+N))·[0×K, 1×N]
  //   So each survivor keeps K/(K+N) of its post-drop share and each added arm
  //   gets 1/(K+N). Sums to 1 and is independent of ordering, so we emit directly
  //   in `newVariationIds` order. Combined add+remove = A then B.
  const currentById = new Map(current.map((p) => [p.variationId, p.weight]));

  const survivorIds = newVariationIds.filter((id) => currentById.has(id));
  const K = survivorIds.length;
  const denom = newVariationIds.length; // K + N (every final id is survivor or added)
  if (denom === 0) return [];

  // Algorithm A: normalize survivor weights by their surviving mass (== 1 - S).
  // Robust to `current` not summing to exactly 1, and to a zero-mass survivor
  // set (fall back to an even split among survivors).
  const survivorMass = survivorIds.reduce(
    (sum, id) => sum + (currentById.get(id) ?? 0),
    0,
  );
  const normalizedSurvivor = new Map<string, number>();
  if (K > 0) {
    if (survivorMass > 0) {
      survivorIds.forEach((id) =>
        normalizedSurvivor.set(id, (currentById.get(id) ?? 0) / survivorMass),
      );
    } else {
      const even = getEqualWeights(K);
      survivorIds.forEach((id, i) => normalizedSurvivor.set(id, even[i]));
    }
  }

  // Algorithm B: survivors scaled by K/(K+N); each added arm gets 1/(K+N).
  return newVariationIds.map((id) =>
    normalizedSurvivor.has(id)
      ? {
          variationId: id,
          weight: (K / denom) * (normalizedSurvivor.get(id) ?? 0),
        }
      : { variationId: id, weight: 1 / denom },
  );
}
