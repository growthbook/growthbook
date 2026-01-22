import { FeatureInterface, SafeRolloutRule } from "shared/validators";

export function getSafeRolloutRuleFromFeature(
  feature: FeatureInterface,
  safeRolloutId: string,
  omitDisabledEnvironments: boolean = false,
): SafeRolloutRule | null {
  for (const env of Object.keys(feature.environmentSettings)) {
    const environment = feature.environmentSettings[env];
    if (omitDisabledEnvironments && !environment.enabled) {
      continue;
    }
    for (const rule of environment.rules) {
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
