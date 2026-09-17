import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { validateFeatureValue } from "shared/util";
import { BadRequestError } from "./errors";

type FeatureValues = Partial<Pick<FeatureInterface, "defaultValue" | "rules">>;

export class FeatureValueError extends BadRequestError {}

// Match stored values by rule/variation identity, so copying a snapshot or
// editing targeting does not repair (or reject) unrelated legacy values.
export function mapChangedFeatureValues<T extends FeatureValues>(
  values: T,
  transform: (value: string, label: string) => string,
  previous?: FeatureValues,
): T {
  const previousRules = new Map(
    (previous?.rules ?? []).filter(Boolean).map((rule) => [rule.id, rule]),
  );
  const mapValue = (
    value: string,
    oldValue: string | undefined,
    label: string,
  ) =>
    typeof value === "string" && value === oldValue
      ? value
      : transform(value, label);
  const mapRule = (rule: FeatureRule, index: number): FeatureRule => {
    const stored = rule.id ? previousRules.get(rule.id) : undefined;
    previousRules.delete(rule.id);
    const prior = stored?.type === rule.type ? stored : undefined;
    const label = `Rule #${index + 1}`;
    switch (rule.type) {
      case "force":
      case "rollout":
        return {
          ...rule,
          value: mapValue(
            rule.value,
            prior && "value" in prior ? prior.value : undefined,
            label,
          ),
        };
      case "experiment":
        if (!rule.values) return rule;
        return {
          ...rule,
          values: (rule.values ?? []).map((variation, i) => ({
            ...variation,
            value: mapValue(
              variation.value,
              prior?.type === "experiment"
                ? prior.values?.[i]?.value
                : undefined,
              `${label} variation #${i + 1}`,
            ),
          })),
        };
      case "experiment-ref":
      case "contextual-bandit-ref": {
        if (!rule.variations) return rule;
        const priorVariations = new Map(
          (prior && "variations" in prior ? (prior.variations ?? []) : []).map(
            (variation) => [variation.variationId, variation.value],
          ),
        );
        return {
          ...rule,
          variations: (rule.variations ?? []).map((variation, i) => {
            const priorValue = priorVariations.get(variation.variationId);
            priorVariations.delete(variation.variationId);
            return {
              ...variation,
              value: mapValue(
                variation.value,
                priorValue,
                `${label} variation #${i + 1}`,
              ),
            };
          }),
        };
      }
      case "safe-rollout":
        return {
          ...rule,
          controlValue: mapValue(
            rule.controlValue,
            prior?.type === "safe-rollout" ? prior.controlValue : undefined,
            `${label} control value`,
          ),
          variationValue: mapValue(
            rule.variationValue,
            prior?.type === "safe-rollout" ? prior.variationValue : undefined,
            `${label} variation value`,
          ),
        };
      default:
        // Older nodes may encounter a rule type written by a newer node.
        return rule;
    }
  };

  return {
    ...values,
    ...(values.defaultValue !== undefined
      ? {
          defaultValue: mapValue(
            values.defaultValue,
            previous?.defaultValue,
            "Default value",
          ),
        }
      : {}),
    ...(values.rules !== undefined
      ? {
          rules: values.rules
            .filter((rule) => rule !== null && typeof rule === "object")
            .map(mapRule),
        }
      : {}),
  };
}

function normalizeJSONValue(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FeatureValueError(`${label}: A JSON value is required.`);
  }
  try {
    return validateFeatureValue({ valueType: "json" }, value, label);
  } catch (e) {
    throw new FeatureValueError(e instanceof Error ? e.message : String(e));
  }
}

export function normalizeFeatureJSONValues<T extends FeatureValues>(
  feature: Pick<FeatureInterface, "valueType">,
  values: T,
  previous?: FeatureValues,
): T {
  if (feature.valueType !== "json") return values;
  return mapChangedFeatureValues(values, normalizeJSONValue, previous);
}

// Only for reconciling an already-persisted live revision. Keep unrecoverable
// legacy values, and recognize repairs made when an older draft was published.
export function getFeatureValuesForDriftRepair<T extends FeatureValues>(
  feature: Pick<FeatureInterface, "valueType"> & FeatureValues,
  live: T,
): T {
  if (feature.valueType !== "json") return live;
  return mapChangedFeatureValues(
    live,
    (value, label) => {
      try {
        return normalizeJSONValue(value, label);
      } catch (e) {
        if (!(e instanceof FeatureValueError)) throw e;
        return value;
      }
    },
    feature,
  );
}
