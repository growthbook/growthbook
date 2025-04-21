import {
  FeatureInterface,
  FeatureRule,
  SafeRolloutRule,
} from "back-end/src/validators/features";

export function getSafeRolloutRuleFromFeature(
  feature: FeatureInterface,
  safeRolloutId: string
): SafeRolloutRule | null {
  Object.keys(feature.environmentSettings).forEach((env: string) =>
    feature.environmentSettings[env].rules.forEach((rule: FeatureRule) => {
      if (
        rule.type === "safe-rollout" &&
        rule.safeRolloutId === safeRolloutId
      ) {
        return rule;
      }
    })
  );
  return null;
}
