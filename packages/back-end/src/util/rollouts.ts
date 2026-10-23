import type { FeatureInterface } from "shared/types/feature";
import type {
  ExperimentInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  evalDeterministicPrereqValue,
  evaluatePrerequisiteState,
  getRulesForEnvironment,
  isRampScheduleServing,
  stemRuleId,
} from "shared/util";
import { getCurrentEnabledState } from "./scheduleRules";

export type ActiveRolloutType =
  | "rollout"
  | "safe-rollout"
  | "experiment-ref"
  | "ramp-schedule";

export interface ActiveRollout {
  featureId: string;
  environment: string;
  ruleId: string;
  type: ActiveRolloutType;
  description: string;
  coverage?: number;
  experimentId?: string;
  safeRolloutId?: string;
  rampScheduleId?: string;
}

export interface RolloutLookups {
  // Keyed by experiment id. Experiment-ref rules whose experiment is missing
  // are not serving.
  experiments: Map<string, Pick<ExperimentInterface, "status">>;
  // Keyed by stemmed rule id. A serving schedule makes its rule a ramp
  // regardless of the rule's own type.
  rampSchedules: Map<string, Pick<RampScheduleInterface, "id" | "status">>;
  // Every feature that could be a prerequisite, for static prerequisite
  // gating. When absent, prerequisites are ignored (an upper bound).
  featuresMap?: Map<string, FeatureInterface>;
  now?: Date;
}

/**
 * The randomized, still-ramping splits a feature serves in one environment:
 * a percentage rollout strictly between 0 and 1, a running safe rollout, a
 * running linked experiment, or a rule driven by a serving ramp schedule.
 *
 * Deliberately excludes conditional force rules: two values served by
 * attribute targeting are configuration, not a rollout, and have no control
 * cohort to compare against or revert to. The result is a static upper bound
 * on what users could see — attribute-dependent prerequisites are not
 * evaluated.
 */
export function getActiveRollouts(
  feature: FeatureInterface,
  environment: string,
  lookups: RolloutLookups,
): ActiveRollout[] {
  if (feature.archived) return [];
  if (!feature.environmentSettings?.[environment]?.enabled) return [];
  if (isBlockedByPrerequisites(feature, environment, lookups.featuresMap)) {
    return [];
  }
  const now = lookups.now ?? new Date();

  const result: ActiveRollout[] = [];
  for (const rule of getRulesForEnvironment(feature.rules, environment)) {
    if (rule.enabled === false) continue;
    if (!getCurrentEnabledState(rule.scheduleRules ?? [], now)) continue;

    const base = {
      featureId: feature.id,
      environment,
      ruleId: rule.id,
      description: rule.description ?? "",
    };

    const schedule = lookups.rampSchedules.get(stemRuleId(rule.id));
    if (schedule && isRampScheduleServing(schedule)) {
      result.push({
        ...base,
        type: "ramp-schedule",
        rampScheduleId: schedule.id,
        ...(rule.type === "rollout" ? { coverage: rule.coverage } : {}),
      });
      continue;
    }

    switch (rule.type) {
      case "rollout":
        if (rule.coverage <= 0 || rule.coverage >= 1) break;
        if (rule.value === feature.defaultValue) break;
        result.push({ ...base, type: "rollout", coverage: rule.coverage });
        break;
      case "safe-rollout":
        if (rule.status !== "running") break;
        if (rule.controlValue === rule.variationValue) break;
        result.push({
          ...base,
          type: "safe-rollout",
          safeRolloutId: rule.safeRolloutId,
        });
        break;
      case "experiment-ref": {
        if (lookups.experiments.get(rule.experimentId)?.status !== "running") {
          break;
        }
        const values = new Set(rule.variations.map((v) => v.value));
        if (values.size < 2) break;
        result.push({
          ...base,
          type: "experiment-ref",
          experimentId: rule.experimentId,
        });
        break;
      }
      case "force":
      case "experiment":
      case "contextual-bandit-ref":
        break;
    }
  }
  return result;
}

// A prerequisite whose parent is statically known (no rules, or disabled)
// and fails its condition blocks the feature for everyone.
function isBlockedByPrerequisites(
  feature: FeatureInterface,
  environment: string,
  featuresMap: Map<string, FeatureInterface> | undefined,
): boolean {
  if (!featuresMap || !feature.prerequisites?.length) return false;
  for (const prereq of feature.prerequisites) {
    const parent = featuresMap.get(prereq.id);
    if (!parent) return true;
    const state = evaluatePrerequisiteState(parent, featuresMap, environment);
    if (state.state === "cyclic") return true;
    if (
      state.state === "deterministic" &&
      evalDeterministicPrereqValue(state.value ?? null, prereq.condition) ===
        "fail"
    ) {
      return true;
    }
  }
  return false;
}
