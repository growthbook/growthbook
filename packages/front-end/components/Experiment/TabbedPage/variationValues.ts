import { FeatureValueType } from "shared/types/feature";
import {
  expandSparseToFull,
  sortObjectKeys,
  validateFeatureValue,
} from "shared/util";

// What a variation actually serves, in a form equal values share.
function servedKey(
  value: string,
  valueType: FeatureValueType,
  sparse: boolean,
  sparseBase: string,
): string {
  if (valueType === "number") {
    const n = parseFloat(value);
    return Number.isNaN(n) ? value : String(n);
  }
  if (valueType !== "json") return value;
  const full = sparse ? expandSparseToFull(value, sparseBase) : value;
  try {
    return JSON.stringify(sortObjectKeys(JSON.parse(full)));
  } catch {
    return full.trim();
  }
}

/** Variations that serve the same value as another; missing values are skipped. */
export function getDuplicateVariationIds(
  values: { variationId: string; value: string | undefined }[],
  valueType: FeatureValueType,
  sparse = false,
  sparseBase = "",
): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const { variationId, value } of values) {
    if (value === undefined) continue;
    const key = servedKey(value, valueType, sparse, sparseBase);
    byKey.set(key, [...(byKey.get(key) ?? []), variationId]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}

type LabeledVariation = { id: string; name?: string; index: number };

export const variationLabel = (v: LabeledVariation) =>
  v.name || `Variation ${v.index}`;

/**
 * Every variation's value as it would be stored, and the ones that had to be
 * repaired to get there, so a caller can show the fix before saving it.
 */
export function repairVariationValues(
  feature: Parameters<typeof validateFeatureValue>[0],
  variations: LabeledVariation[],
  valueFor: (variationId: string) => string | undefined,
  label: (v: LabeledVariation) => string = variationLabel,
) {
  const repaired: Record<string, string> = {};
  const checked = variations.map((v) => {
    const value = valueFor(v.id) ?? "";
    const stored = validateFeatureValue(feature, value, label(v));
    if (stored !== value) repaired[v.id] = stored;
    return { variationId: v.id, value: stored };
  });
  return { checked, repaired };
}
