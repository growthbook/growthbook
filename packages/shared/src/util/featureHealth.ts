import {
  ExperimentInterfaceStringDates,
  ExperimentHealthSettings,
} from "shared/types/experiment";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import {
  RampScheduleInterface,
  isReadyForApproval,
} from "../validators/ramp-schedule";
import { getSafeRolloutResultStatus } from "../enterprise/decision-criteria/decisionCriteria";
import {
  EnvStaleResult,
  isUnconditionalCatcher,
  validateFeatureValue,
} from "./features";
import { getRulesForEnvironment } from ".";

export type FeatureHealthSeverity = "high" | "medium" | "low";

// Ranked most urgent first, mirroring the experiment status precedence:
// active harm, then decisions a person is blocking on, then data problems,
// then misconfiguration and hygiene, then cleanup. Doubles as display order
// and as the `health:` token set.
export const FEATURE_HEALTH_SIGNAL_SEVERITY = {
  "safe-rollout-rollback-now": "high",
  "invalid-value": "high",
  "ramp-needs-approval": "medium",
  "safe-rollout-no-data": "medium",
  "safe-rollout-unhealthy": "medium",
  "missing-experiment": "medium",
  "ramp-paused": "medium",
  "unreachable-rule": "medium",
  "old-temp-rollout": "low",
  "temp-rollout": "low",
} as const satisfies Record<string, FeatureHealthSeverity>;
export type FeatureHealthSignal = keyof typeof FEATURE_HEALTH_SIGNAL_SEVERITY;
export const FEATURE_HEALTH_SIGNALS = Object.keys(
  FEATURE_HEALTH_SIGNAL_SEVERITY,
) as FeatureHealthSignal[];

// One entry per signal per feature, however many rules, ramps, or
// environments triggered it.
export type FeatureHealthEntry = {
  signal: FeatureHealthSignal;
  count: number;
  environments?: string[];
};

const RULE_VALUES = (rule: FeatureRule): string[] => {
  switch (rule.type) {
    case "force":
    case "rollout":
      return [rule.value];
    case "experiment":
      return rule.values.map((v) => v.value);
    case "experiment-ref":
    case "contextual-bandit-ref":
      return rule.variations.map((v) => v.value);
    case "safe-rollout":
      return [rule.controlValue, rule.variationValue];
  }
};

export function computeFeatureHealth({
  feature,
  environments,
  envResults,
  experimentMap,
  rampSchedules,
  safeRollouts,
  healthSettings,
}: {
  feature: FeatureInterface;
  environments: string[];
  envResults: Record<string, EnvStaleResult>;
  experimentMap: Map<string, ExperimentInterfaceStringDates>;
  rampSchedules: RampScheduleInterface[];
  safeRollouts: SafeRolloutInterface[];
  healthSettings: ExperimentHealthSettings;
}): FeatureHealthEntry[] {
  const found = new Map<
    FeatureHealthSignal,
    { count: number; envs: Set<string> }
  >();
  const add = (signal: FeatureHealthSignal, env?: string) => {
    const entry = found.get(signal) ?? { count: 0, envs: new Set<string>() };
    entry.count++;
    if (env) entry.envs.add(env);
    found.set(signal, entry);
  };

  for (const [envId, result] of Object.entries(envResults)) {
    if (result.tempRollout) add(result.tempRollout, envId);
  }

  const enabledEnvs = environments.filter(
    (envId) => feature.environmentSettings?.[envId]?.enabled,
  );
  const unreachableRuleIds = new Map<string, Set<string>>();
  for (const envId of enabledEnvs) {
    let shadowed = false;
    for (const rule of getRulesForEnvironment(feature.rules, envId)) {
      if (!rule.enabled) continue;
      if (shadowed) {
        const envs = unreachableRuleIds.get(rule.id) ?? new Set<string>();
        envs.add(envId);
        unreachableRuleIds.set(rule.id, envs);
      } else if (isUnconditionalCatcher(rule)) {
        shadowed = true;
      }
    }
  }
  for (const envs of unreachableRuleIds.values()) {
    const entry = found.get("unreachable-rule") ?? {
      count: 0,
      envs: new Set<string>(),
    };
    entry.count++;
    envs.forEach((e) => entry.envs.add(e));
    found.set("unreachable-rule", entry);
  }

  for (const rule of feature.rules ?? []) {
    if (rule.type !== "experiment-ref" || !rule.enabled) continue;
    if (!experimentMap.has(rule.experimentId)) add("missing-experiment");
  }

  for (const schedule of rampSchedules) {
    if (schedule.status === "paused") add("ramp-paused");
    else if (isReadyForApproval(schedule)) add("ramp-needs-approval");
  }

  for (const safeRollout of safeRollouts) {
    if (safeRollout.status !== "running") continue;
    const status = getSafeRolloutResultStatus({
      safeRollout,
      healthSettings,
      daysLeft: 0,
    })?.status;
    if (status === "rollback-now") {
      add("safe-rollout-rollback-now", safeRollout.environment);
    } else if (status === "unhealthy") {
      add("safe-rollout-unhealthy", safeRollout.environment);
    } else if (status === "no-data") {
      add("safe-rollout-no-data", safeRollout.environment);
    }
  }

  const values = [
    feature.defaultValue,
    ...(feature.rules ?? []).flatMap(RULE_VALUES),
  ];
  for (const value of values) {
    if (feature.valueType === "boolean") {
      if (value !== "true" && value !== "false") add("invalid-value");
      continue;
    }
    try {
      validateFeatureValue(feature, value);
    } catch {
      add("invalid-value");
    }
  }

  return FEATURE_HEALTH_SIGNALS.filter((signal) => found.has(signal)).map(
    (signal) => {
      const { count, envs } = found.get(signal)!;
      return {
        signal,
        count,
        ...(envs.size ? { environments: [...envs].sort() } : {}),
      };
    },
  );
}
