import {
  ContextualBanditVariationStatus,
  VariationWeightPair,
} from "shared/validators";
import { getEqualWeights } from "./experiments";

export const MIN_CONTEXTUAL_BANDIT_VARIATIONS = 2;

export type WeightReconcileMode = "uniform" | "redistribute";
export type VariationIdentity = { id: string };

/**
 * CB variation (arm) lifecycle status.
 * - active (default when absent): served, weighted, analyzed
 * - pending: added but value not yet live on a linked feature; no weight
 * - deactivated: removed; tombstoned so the id is never reused
 */
export type VariationWithStatus = VariationIdentity & {
  status?: ContextualBanditVariationStatus;
};

export function isActiveVariation(v: VariationWithStatus): boolean {
  return !v.status || v.status === "active";
}

export function isPendingVariation(v: VariationWithStatus): boolean {
  return v.status === "pending";
}

export function isDeactivatedVariation(v: VariationWithStatus): boolean {
  return v.status === "deactivated";
}

/** Arms the user can see and edit: active + pending (tombstones hidden). */
export function getVisibleVariations<T extends VariationWithStatus>(
  variations: T[],
): T[] {
  return variations.filter((v) => !isDeactivatedVariation(v));
}

/** Arms that serve traffic and receive weight: active only. */
export function getActiveVariations<T extends VariationWithStatus>(
  variations: T[],
): T[] {
  return variations.filter(isActiveVariation);
}
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
