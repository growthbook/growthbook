import {
  ContextualBanditVariationStatus,
  Screenshot,
  VariationWeightPair,
} from "shared/validators";
import { getEqualWeights } from "./experiments";

export const MIN_CONTEXTUAL_BANDIT_VARIATIONS = 2;

export type WeightReconcileMode = "uniform" | "redistribute";
type VariationIdentity = { id: string };

type VariationWithStatus = VariationIdentity & {
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

export function getVisibleVariations<T extends VariationWithStatus>(
  variations: T[],
): T[] {
  return variations.filter((v) => !isDeactivatedVariation(v));
}

export function getActiveVariations<T extends VariationWithStatus>(
  variations: T[],
): T[] {
  return variations.filter(isActiveVariation);
}
type VariationDiff = {
  addedIds: string[];
  removedIds: string[];
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
  };
}

export type VariationListEntry = VariationIdentity & {
  name: string;
  description?: string;
  key?: string;
  screenshots?: Screenshot[];
};

export type VariationListChange = {
  addVariations: VariationListEntry[];
  removeVariationIds: string[];
  updateVariations: Array<{
    id: string;
    name?: string;
    description?: string;
    key?: string;
  }>;
};

export function variationListToChange(
  current: VariationListEntry[],
  desired: VariationListEntry[],
): VariationListChange {
  assertUniqueVariationIds(desired);
  const currentById = new Map(current.map((v) => [v.id, v]));
  const { removedIds } = diffVariations(current, desired);
  const addVariations: VariationListEntry[] = [];
  const updateVariations: VariationListChange["updateVariations"] = [];

  for (const { id, name, description, key, screenshots } of desired) {
    const prev = currentById.get(id);
    if (!prev) {
      addVariations.push({
        id,
        name,
        ...(description !== undefined && { description }),
        ...(key !== undefined && { key }),
        ...(screenshots !== undefined && { screenshots }),
      });
      continue;
    }
    const patch = {
      ...(name !== prev.name && { name }),
      ...((description ?? "") !== (prev.description ?? "") && {
        description: description ?? "",
      }),
      ...(key !== undefined && key !== prev.key && { key }),
    };
    if (Object.keys(patch).length) updateVariations.push({ id, ...patch });
  }

  return { addVariations, removeVariationIds: removedIds, updateVariations };
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `A contextual bandit cannot have duplicate variation ${label}: ${[
        ...duplicates,
      ].join(", ")}`,
    );
  }
}

export function assertUniqueVariationIds(
  variations: VariationIdentity[],
): void {
  assertUnique(
    variations.map((v) => v.id),
    "ids",
  );
}

export function assertUniqueVariationKeys(variations: { key: string }[]): void {
  assertUnique(
    variations.map((v) => v.key),
    "keys",
  );
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

export function nextContextualBanditVariationKey(
  existingKeys: readonly string[],
): string {
  let max = -1;
  for (const key of existingKeys) {
    const n = parseInt(key, 10);
    if (Number.isFinite(n) && String(n) === key && n > max) max = n;
  }
  return String(max + 1);
}
