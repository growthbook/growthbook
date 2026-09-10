import { ValidateFunction } from "ajv";
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
  getJSONValidator,
  getTempRolloutStaleReason,
  getValidation,
  isUnconditionalCatcher,
  parseLooseJSON,
  TempRolloutStaleReason,
} from "./features";
import { getRulesForEnvironment, includeExperimentInPayload } from ".";

export type FeatureHealthSeverity = "high" | "medium" | "low";

// Ranked most urgent first (mirrors experiment status precedence): active harm,
// blocking decisions, data problems, misconfiguration, cleanup.
export const FEATURE_HEALTH_SIGNAL_SEVERITY = {
  "safe-rollout-rollback-now": "high",
  "invalid-value": "high",
  "ramp-needs-approval": "medium",
  "safe-rollout-no-data": "medium",
  "safe-rollout-unhealthy": "medium",
  "missing-experiment": "medium",
  "ramp-paused": "medium",
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
  environments?: string[];
  details?: FeatureHealthDetail[];
};

// Ajv compiles are expensive and this runs across every feature on a fetch-all.
const ajv = getJSONValidator();
const compiledSchemas = new Map<string, ValidateFunction>();
const MAX_CACHED_SCHEMAS = 1000;

function getCompiledSchema(feature: FeatureInterface): ValidateFunction | null {
  const { jsonSchema, validationEnabled } = getValidation(feature);
  if (!validationEnabled || !jsonSchema) return null;
  const key = JSON.stringify(jsonSchema);
  let validate = compiledSchemas.get(key);
  if (!validate) {
    if (compiledSchemas.size >= MAX_CACHED_SCHEMAS) compiledSchemas.clear();
    try {
      validate = ajv.compile(jsonSchema);
    } catch {
      return null;
    }
    compiledSchemas.set(key, validate);
  }
  return validate;
}

// Mirrors validateFeatureValue's rules without recompiling the schema per value.
function invalidValueChecker(
  feature: FeatureInterface,
): (v: string) => boolean {
  const { valueType } = feature;
  if (valueType === "boolean") return (v) => v !== "true" && v !== "false";
  const validate = getCompiledSchema(feature);
  const parseJson = (v: string): { ok: boolean; value?: unknown } => {
    try {
      return { ok: true, value: JSON.parse(v) };
    } catch {
      try {
        return { ok: true, value: parseLooseJSON(v) };
      } catch {
        return { ok: false };
      }
    }
  };
  return (v) => {
    if (valueType === "number") {
      if (!/^-?[0-9]+(\.[0-9]+)?$/.test(v)) return true;
      return !!validate && !validate(parseFloat(v));
    }
    if (valueType === "string") return !!validate && !validate(v);
    const parsed = parseJson(v);
    if (!parsed.ok) return true;
    return !!validate && !validate(parsed.value);
  };
}

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
  type Found = {
    count: number;
    envs: Set<string>;
    details: FeatureHealthDetail[];
  };
  const found = new Map<FeatureHealthSignal, Found>();
  const add = (
    signal: FeatureHealthSignal,
    env?: string,
    detail?: FeatureHealthDetail,
  ) => {
    const entry = found.get(signal) ?? {
      count: 0,
      envs: new Set<string>(),
      details: [],
    };
    entry.count++;
    if (env) entry.envs.add(env);
    if (detail) entry.details.push(detail);
    found.set(signal, entry);
  };

  // One temp rollout rule may target several environments: count rules, list envs.
  const tempRolloutRules = new Map<
    TempRolloutStaleReason,
    { rules: Map<string, FeatureHealthDetail>; envs: Set<string> }
  >();
  for (const [envId, result] of Object.entries(envResults)) {
    const tier = result.tempRollout;
    if (!tier) continue;
    const entry = tempRolloutRules.get(tier) ?? {
      rules: new Map<string, FeatureHealthDetail>(),
      envs: new Set<string>(),
    };
    entry.envs.add(envId);
    for (const rule of getRulesForEnvironment(feature.rules, envId)) {
      if (rule.type !== "experiment-ref" || !rule.enabled) continue;
      const exp = experimentMap.get(rule.experimentId);
      if (
        exp?.status === "stopped" &&
        includeExperimentInPayload(exp) &&
        getTempRolloutStaleReason(exp) === tier
      ) {
        const ended = exp.phases?.[exp.phases.length - 1]?.dateEnded;
        entry.rules.set(rule.id, {
          label: exp.name || exp.id,
          ...(ended ? { since: new Date(ended).toISOString() } : {}),
        });
      }
    }
    tempRolloutRules.set(tier, entry);
  }
  for (const [tier, { rules, envs }] of tempRolloutRules) {
    found.set(tier, {
      count: Math.max(rules.size, 1),
      envs,
      details: [...rules.values()],
    });
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
      details: [],
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
    const detail = { label: schedule.name };
    if (schedule.status === "paused") add("ramp-paused", undefined, detail);
    else if (isReadyForApproval(schedule)) {
      add("ramp-needs-approval", undefined, detail);
    }
  }

  // Only safe rollouts an enabled rule or a live ramp schedule still points at;
  // orphans are inert.
  const referencedSafeRollouts = new Set(
    (feature.rules ?? []).flatMap((rule) =>
      rule.type === "safe-rollout" && rule.enabled ? [rule.safeRolloutId] : [],
    ),
  );
  const liveRampIds = new Set(
    rampSchedules
      .filter((s) => !["completed", "rolled-back"].includes(s.status))
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
    if (status === "rollback-now") {
      add("safe-rollout-rollback-now", safeRollout.environment);
    } else if (status === "unhealthy") {
      add("safe-rollout-unhealthy", safeRollout.environment);
    } else if (status === "no-data") {
      add("safe-rollout-no-data", safeRollout.environment);
    }
  }

  // Counted per rule (plus the default value), not per variation.
  const isInvalid = invalidValueChecker(feature);
  if (isInvalid(feature.defaultValue)) add("invalid-value");
  for (const rule of feature.rules ?? []) {
    if (RULE_VALUES(rule).some(isInvalid)) add("invalid-value");
  }

  return FEATURE_HEALTH_SIGNALS.filter((signal) => found.has(signal)).map(
    (signal) => {
      const { count, envs, details } = found.get(signal)!;
      return {
        signal,
        count,
        ...(envs.size ? { environments: [...envs].sort() } : {}),
        ...(details.length ? { details } : {}),
      };
    },
  );
}
