import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";

export function getSafeRolloutRuleFromFeature(
  feature: FeatureInterface,
  safeRolloutId: string
): SafeRolloutRule | null {
  for (const env of Object.keys(feature.environmentSettings)) {
    for (const rule of feature.environmentSettings[env].rules) {
      if (
        rule.type === "safe-rollout" &&
        rule.safeRolloutId === safeRolloutId
      ) {
        return rule;
      }
    }
  }
  return null;
}
