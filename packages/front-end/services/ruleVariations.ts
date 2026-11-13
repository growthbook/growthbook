import { FeatureValueType } from "shared/types/feature";
import { getEqualWeights } from "shared/experiments";
import { generateVariationId } from "shared/util";
import { isEqualSplit } from "@/services/utils";

export type RuleVariation = {
  id: string;
  name: string;
  value: string;
  weight: number;
};

// A value for variation `index` that differs from the others where the type
// allows: the default for Control, then flipped, counted up or suffixed.
export function prefillVariationValue(
  valueType: FeatureValueType,
  defaultValue: string,
  index: number,
): string {
  if (index === 0) return defaultValue;
  if (valueType === "boolean") {
    const flipped = defaultValue === "true" ? "false" : "true";
    return index % 2 ? flipped : defaultValue;
  }
  if (valueType === "number") {
    const n = Number(defaultValue);
    return String((isNaN(n) ? 0 : n) + index);
  }
  if (valueType === "string") {
    return defaultValue ? `${defaultValue}-${index}` : `variation-${index}`;
  }
  return defaultValue;
}

// What a variation is called until it's named.
export function defaultRuleVariationName(index: number): string {
  return index ? `Variation ${index}` : "Control";
}

export function newRuleVariation(
  valueType: FeatureValueType,
  defaultValue: string,
  index: number,
): RuleVariation {
  return {
    id: generateVariationId(),
    name: defaultRuleVariationName(index),
    value: prefillVariationValue(valueType, defaultValue, index),
    weight: 0,
  };
}

// The variations without one. Default names follow their position and given
// ones stay; an even split stays even, and an uneven one keeps its proportions.
export function removeRuleVariation(
  variations: RuleVariation[],
  index: number,
): RuleVariation[] {
  const next = variations
    .filter((_, i) => i !== index)
    .map((v, i) =>
      /^(Control|Variation \d+)$/.test(v.name)
        ? { ...v, name: defaultRuleVariationName(i) }
        : v,
    );
  const total = next.reduce((sum, v) => sum + v.weight, 0);
  const weights =
    isEqualSplit(variations.map((v) => v.weight)) || !total
      ? getEqualWeights(next.length)
      : next.map((v) => v.weight / total);
  return next.map((v, i) => ({ ...v, weight: weights[i] ?? 0 }));
}
