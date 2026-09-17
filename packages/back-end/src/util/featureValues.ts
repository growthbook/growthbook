import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { validateFeatureValue } from "shared/util";

export function normalizeFeatureJSONValues<
  T extends { defaultValue?: string; rules?: FeatureRule[] },
>(feature: Pick<FeatureInterface, "valueType">, values: T): T {
  if (feature.valueType !== "json") return values;

  const normalize = (value: string, label: string) =>
    validateFeatureValue({ valueType: "json" }, value, label);
  const normalizeRule = (rule: FeatureRule, index: number): FeatureRule => {
    const label = `Rule #${index + 1}`;
    switch (rule.type) {
      case "force":
      case "rollout":
        return { ...rule, value: normalize(rule.value, label) };
      case "experiment":
        return {
          ...rule,
          values: rule.values.map((variation, i) => ({
            ...variation,
            value: normalize(variation.value, `${label} variation #${i + 1}`),
          })),
        };
      case "experiment-ref":
      case "contextual-bandit-ref":
        return {
          ...rule,
          variations: rule.variations.map((variation, i) => ({
            ...variation,
            value: normalize(variation.value, `${label} variation #${i + 1}`),
          })),
        };
      case "safe-rollout":
        return {
          ...rule,
          controlValue: normalize(rule.controlValue, `${label} control value`),
          variationValue: normalize(
            rule.variationValue,
            `${label} variation value`,
          ),
        };
    }
  };

  // Persist the validator's repairs; checking and discarding its result leaves
  // near-JSON that the SDK payload's strict parser would turn into null.
  return {
    ...values,
    ...(values.defaultValue !== undefined
      ? { defaultValue: normalize(values.defaultValue, "Default value") }
      : {}),
    ...(values.rules !== undefined
      ? { rules: values.rules.map(normalizeRule) }
      : {}),
  };
}
