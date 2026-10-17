import { FeatureValueType } from "shared/types/feature";

export const VALUE_TYPE_LABELS: Record<FeatureValueType, string> = {
  boolean: "Boolean",
  string: "String",
  number: "Number",
  json: "JSON",
};

// Boolean is a poor fit for most experiments, so it sits last.
export const EXPERIMENT_VALUE_TYPE_ORDER: FeatureValueType[] = [
  "string",
  "json",
  "number",
  "boolean",
];

/** Types an experiment with this many variations can't take, with why. */
export function blockedExperimentValueTypes(
  numVariations: number,
): Partial<Record<FeatureValueType, string>> {
  return numVariations > 2 ? { boolean: "Needs exactly two variations" } : {};
}
