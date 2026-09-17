import {
  FeatureInterface,
  isTerminalRampScheduleStatus,
  RampScheduleInterface,
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

// Rule removals and revision reverts can leave a running safe rollout that
// nothing references any more.
export function isOrphanedSafeRollout(
  feature: FeatureInterface | null,
  safeRollout: Pick<SafeRolloutInterface, "id" | "rampScheduleId">,
  rampSchedule: Pick<RampScheduleInterface, "status"> | null,
): boolean {
  if (!feature) return true;
  if (getSafeRolloutRuleFromFeature(feature, safeRollout.id)) return false;
  if (!safeRollout.rampScheduleId) return true;
  return !rampSchedule || isTerminalRampScheduleStatus(rampSchedule.status);
}

export function shouldSkipScheduledSafeRolloutSnapshot(
  feature: FeatureInterface,
  safeRollout: Pick<SafeRolloutInterface, "id" | "rampScheduleId">,
): boolean {
  if (safeRollout.rampScheduleId) return false;

  const rule = getSafeRolloutRuleFromFeature(feature, safeRollout.id, true);
  return !rule || !rule.enabled;
}
