import { VariationWeightPair } from "shared/validators";
import { getEqualWeights } from "./experiments";

export const MIN_CONTEXTUAL_BANDIT_VARIATIONS = 2;

export const MIN_VARIATION_WEIGHT = 0.01;

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

export function getRemovedVariationsInUse(
  removedIds: string[],
  referencedVariationIds: Iterable<string>,
): string[] {
  const referenced = new Set(referencedVariationIds);
  return removedIds.filter((id) => referenced.has(id));
}

export function defaultAddedVariationValue(
  provided: string | undefined,
  controlValue: string | undefined,
  featureDefaultValue: string,
): string {
  return provided ?? controlValue ?? featureDefaultValue;
}

function uniformWeightPairs(variationIds: string[]): VariationWeightPair[] {
  const weights = getEqualWeights(variationIds.length || 1);
  return variationIds.map((variationId, i) => ({
    variationId,
    weight: weights[i],
  }));
}

export function reconcileVariationWeights(
  current: VariationWeightPair[],
  newVariationIds: string[],
  mode: WeightReconcileMode,
): VariationWeightPair[] {
  if (mode === "uniform") {
    return uniformWeightPairs(newVariationIds);
  }

  const currentById = new Map(current.map((p) => [p.variationId, p.weight]));

  const survivorIds = newVariationIds.filter((id) => currentById.has(id));
  const K = survivorIds.length;
  const denom = newVariationIds.length;
  if (denom === 0) return [];

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

  return newVariationIds.map((id) =>
    normalizedSurvivor.has(id)
      ? {
          variationId: id,
          weight: (K / denom) * (normalizedSurvivor.get(id) ?? 0),
        }
      : { variationId: id, weight: 1 / denom },
  );
}
