import {
  FeatureInterface,
  SafeRolloutInterface,
  SafeRolloutRule,
} from "shared/validators";
import { getRulesForEnvironment } from "shared/util";

export function getSafeRolloutRuleFromFeature(
  feature: FeatureInterface,
  safeRolloutId: string,
  omitDisabledEnvironments: boolean = false,
): SafeRolloutRule | null {
  // v2: rules live on feature.rules (flat). Project per-env so that the
  // `omitDisabledEnvironments` flag still behaves correctly when a rule is
  // shared across envs but only some are enabled.
  for (const env of Object.keys(feature.environmentSettings)) {
    const environment = feature.environmentSettings[env];
    if (omitDisabledEnvironments && !environment.enabled) {
      continue;
    }
    const rules = getRulesForEnvironment(feature.rules ?? [], env);
    for (const rule of rules) {
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

export function shouldSkipScheduledSafeRolloutSnapshot(
  feature: FeatureInterface,
  safeRollout: Pick<SafeRolloutInterface, "id" | "rampScheduleId">,
): boolean {
  if (safeRollout.rampScheduleId) return false;

  const rule = getSafeRolloutRuleFromFeature(feature, safeRollout.id, true);
  return !rule || !rule.enabled;
}
