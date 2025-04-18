import {
  FeatureInterface,
  FeatureRule,
  SafeRolloutRule,
} from "back-end/src/validators/features";

export function getSafeRolloutRuleFromFeature(
  feature: FeatureInterface,
  ruleId: string
): SafeRolloutRule | null {
  Object.keys(feature.environmentSettings).forEach((env: string) =>
    feature.environmentSettings[env].rules.forEach((rule: FeatureRule) => {
      if (rule.id === ruleId && rule.type === "safe-rollout") {
        return rule;
      }
    })
  );
  return null;
}
