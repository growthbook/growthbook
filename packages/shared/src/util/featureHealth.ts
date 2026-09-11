import {
  ExperimentInterfaceStringDates,
  ExperimentHealthSettings,
} from "shared/types/experiment";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import {
  RampScheduleInterface,
  isReadyForApproval,
  isTerminalRampScheduleStatus,
} from "../validators/ramp-schedule";
import { getSafeRolloutResultStatus } from "../enterprise/decision-criteria/decisionCriteria";
import {
  EnvStaleResult,
  getTempRolloutStaleReason,
  isUnconditionalCatcher,
  IsFeatureStaleResult,
  TempRolloutStaleReason,
  validateFeatureValue,
} from "./features";
import { getRulesForEnvironment, includeExperimentInPayload } from ".";

export type FeatureHealthSeverity = "high" | "medium" | "low";

// Ranked most urgent first (mirrors experiment status precedence): live
// rollouts in trouble, misconfiguration, blocking decisions, cleanup.
export const FEATURE_HEALTH_SIGNAL_SEVERITY = {
  "safe-rollout-rollback-now": "high",
  "safe-rollout-unhealthy": "high",
  "safe-rollout-no-data": "high",
  "invalid-value": "high",
  "ramp-needs-approval": "medium",
  "ramp-paused": "medium",
  "missing-experiment": "medium",
  "unreachable-rule": "medium",
  "old-temp-rollout": "medium",
  "temp-rollout": "low",
} as const satisfies Record<string, FeatureHealthSeverity>;
export type FeatureHealthSignal = keyof typeof FEATURE_HEALTH_SIGNAL_SEVERITY;
export const FEATURE_HEALTH_SIGNALS = Object.keys(
  FEATURE_HEALTH_SIGNAL_SEVERITY,
) as FeatureHealthSignal[];

export type FeatureHealthDetail = {
  label: string;
  // ISO date this started needing attention, for relative display.
  since?: string;
};

// One entry per signal per feature, however many rules or environments triggered it.
export type FeatureHealthEntry = {
  signal: FeatureHealthSignal;
  count: number;
  details?: FeatureHealthDetail[];
};

// One row of the internal /features/health response.
export type FeatureHealthStateEntry = IsFeatureStaleResult & {
  neverStale: boolean;
  computedAt: string;
  health: FeatureHealthEntry[];
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
    default:
      return [];
  }
};

// Absent `enabled` is live, matching the SDK payload.
const isLiveRule = (r: unknown): r is FeatureRule =>
  typeof r === "object" && r !== null && (r as FeatureRule).enabled !== false;

// validateFeatureValue coerces booleans instead of rejecting them.
function isInvalidValue(feature: FeatureInterface, value: string): boolean {
  if (feature.valueType === "boolean") {
    return value !== "true" && value !== "false";
  }
  try {
    validateFeatureValue(feature, value);
    return false;
  } catch {
    return true;
  }
}

export function computeFeatureHealth({
  feature,
  environments,
  envResults,
  experimentMap,
  rampSchedules,
  safeRollouts,
  healthSettings,
  knownExperimentIds,
}: {
  feature: FeatureInterface;
  environments: string[];
  envResults: Record<string, EnvStaleResult>;
  experimentMap: Map<string, ExperimentInterfaceStringDates>;
  rampSchedules: RampScheduleInterface[];
  safeRollouts: SafeRolloutInterface[];
  healthSettings: ExperimentHealthSettings;
  // Every live experiment id referenced by the feature, regardless of the
  // caller's read permissions, so unreadable experiments are not reported as missing.
  knownExperimentIds?: Set<string>;
}): FeatureHealthEntry[] {
  const rules = (feature.rules ?? []).filter(isLiveRule);
  const known = knownExperimentIds ?? new Set(experimentMap.keys());
  const found = new Map<
    FeatureHealthSignal,
    { count: number; details: FeatureHealthDetail[] }
  >();
  const add = (
    signal: FeatureHealthSignal,
    count = 1,
    details: FeatureHealthDetail[] = [],
  ) => {
    const entry = found.get(signal) ?? { count: 0, details: [] };
    entry.count += count;
    entry.details.push(...details);
    found.set(signal, entry);
  };

  // One temp rollout rule may target several environments: count rules once.
  const tempRolloutRules = new Map<
    TempRolloutStaleReason,
    Map<string, FeatureHealthDetail>
  >();
  for (const [envId, result] of Object.entries(envResults)) {
    const tier = result.tempRollout;
    if (!tier) continue;
    const byRule = tempRolloutRules.get(tier) ?? new Map();
    for (const rule of getRulesForEnvironment(feature.rules, envId)) {
      if (rule.type !== "experiment-ref" || !isLiveRule(rule)) continue;
      const exp = experimentMap.get(rule.experimentId);
      if (
        exp?.status === "stopped" &&
        includeExperimentInPayload(exp) &&
        getTempRolloutStaleReason(exp) === tier
      ) {
        const ended = exp.phases?.[exp.phases.length - 1]?.dateEnded;
        byRule.set(rule.id, {
          label: exp.name || exp.id,
          ...(ended ? { since: new Date(ended).toISOString() } : {}),
        });
      }
    }
    tempRolloutRules.set(tier, byRule);
  }
  for (const [tier, byRule] of tempRolloutRules) {
    add(tier, Math.max(byRule.size, 1), [...byRule.values()]);
  }

  const enabledEnvs = environments.filter(
    (envId) => feature.environmentSettings?.[envId]?.enabled,
  );
  const unreachableRuleIds = new Set<string>();
  for (const envId of enabledEnvs) {
    let shadowed = false;
    for (const rule of getRulesForEnvironment(feature.rules, envId)) {
      if (!isLiveRule(rule)) continue;
      if (shadowed) unreachableRuleIds.add(rule.id);
      else if (isUnconditionalCatcher(rule)) shadowed = true;
    }
  }
  if (unreachableRuleIds.size) add("unreachable-rule", unreachableRuleIds.size);

  for (const rule of rules) {
    if (rule.type !== "experiment-ref") continue;
    if (!known.has(rule.experimentId)) add("missing-experiment");
  }

  for (const schedule of rampSchedules) {
    if (schedule.status === "paused") add("ramp-paused");
    else if (isReadyForApproval(schedule)) add("ramp-needs-approval");
  }

  // Only safe rollouts an enabled rule or a live ramp schedule still points at;
  // orphans are inert.
  const referencedSafeRollouts = new Set(
    rules.flatMap((rule) =>
      rule.type === "safe-rollout" ? [rule.safeRolloutId] : [],
    ),
  );
  const liveRampIds = new Set(
    rampSchedules
      .filter((s) => !isTerminalRampScheduleStatus(s.status))
      .map((s) => s.id),
  );
  for (const safeRollout of safeRollouts) {
    if (safeRollout.status !== "running") continue;
    const referenced =
      referencedSafeRollouts.has(safeRollout.id) ||
      (!!safeRollout.rampScheduleId &&
        liveRampIds.has(safeRollout.rampScheduleId));
    if (!referenced) continue;
    const status = getSafeRolloutResultStatus({
      safeRollout,
      healthSettings,
      daysLeft: 0,
    })?.status;
    if (status === "rollback-now") add("safe-rollout-rollback-now");
    else if (status === "unhealthy") add("safe-rollout-unhealthy");
    else if (status === "no-data") add("safe-rollout-no-data");
  }

  // Counted per rule (plus the default value), not per variation.
  if (isInvalidValue(feature, feature.defaultValue)) add("invalid-value");
  for (const rule of rules) {
    if (RULE_VALUES(rule).some((v) => isInvalidValue(feature, v))) {
      add("invalid-value");
    }
  }

  return FEATURE_HEALTH_SIGNALS.filter((signal) => found.has(signal)).map(
    (signal) => {
      const { count, details } = found.get(signal)!;
      return { signal, count, ...(details.length ? { details } : {}) };
    },
  );
}
