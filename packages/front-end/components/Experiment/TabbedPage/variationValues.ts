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

/** What each variation serves, keyed so equal values match; missing values are left out. */
export function servedValues(
  values: { variationId: string; value: string | undefined }[],
  valueType: FeatureValueType,
  sparse = false,
  sparseBase = "",
): Record<string, string> {
  return Object.fromEntries(
    values.flatMap(({ variationId, value }) =>
      value === undefined
        ? []
        : [[variationId, servedKey(value, valueType, sparse, sparseBase)]],
    ),
  );
}

/**
 * Groups of variations that serve the same as each other in every column, so
 * nothing tells them apart. Matching in one column alone is how a factorial
 * test pairs values. A variation some column has no value for is left out.
 */
export function getDuplicateRows(
  variationIds: string[],
  columns: Record<string, string>[],
): string[][] {
  if (!columns.length) return [];
  const byRow = new Map<string, string[]>();
  for (const id of variationIds) {
    if (columns.some((column) => !(id in column))) continue;
    const row = JSON.stringify(columns.map((column) => column[id]));
    byRow.set(row, [...(byRow.get(row) ?? []), id]);
  }
  return [...byRow.values()].filter((ids) => ids.length > 1);
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
