import { FeatureValueType } from "shared/types/feature";
import { expandSparseToFull } from "shared/util";

// Objects compare regardless of key order; arrays keep theirs.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

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
    return JSON.stringify(canonical(JSON.parse(full)));
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
