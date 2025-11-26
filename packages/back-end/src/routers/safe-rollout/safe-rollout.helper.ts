import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";

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
    // Get rules for this environment from top-level rules array
    const envRules = feature.rules.filter(
      (rule) => rule.allEnvironments || rule.environments?.includes(env),
    );
    for (const rule of envRules) {
      if (
        rule.type === "safe-rollout" &&
        rule.safeRolloutId === safeRolloutId
      ) {
        return rule as SafeRolloutRule;
      }
    }
  }
  return null;
}
