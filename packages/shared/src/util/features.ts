import Ajv from "ajv";
import { subWeeks } from "date-fns";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import {
  FeatureInterface,
  FeatureRule,
  ForceRule,
  RolloutRule,
} from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { evalCondition } from "@growthbook/growthbook";
import { Environment } from "back-end/types/organization";
import { ProjectInterface } from "back-end/types/project";
import { getValidDate } from "../dates";
import { getMatchingRules, includeExperimentInPayload } from ".";

export function getValidation(feature: FeatureInterface) {
  try {
    const jsonSchema = feature?.jsonSchema?.schema
      ? JSON.parse(feature?.jsonSchema?.schema)
      : null;
    const validationEnabled = jsonSchema ? feature?.jsonSchema?.enabled : false;
    const schemaDateUpdated = feature?.jsonSchema?.date;
    return { jsonSchema, validationEnabled, schemaDateUpdated };
  } catch (e) {
    // log an error?
    return {
      jsonSchema: null,
      validationEnabled: false,
      schemaDateUpdated: null,
    };
  }
}

export function mergeRevision(
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  environments: string[]
) {
  const newFeature = cloneDeep(feature);

  newFeature.defaultValue = revision.defaultValue;

  const envSettings = newFeature.environmentSettings;
  environments.forEach((env) => {
    envSettings[env] = envSettings[env] || {};
    envSettings[env].enabled = envSettings[env].enabled || false;
    envSettings[env].rules =
      revision.rules?.[env] || envSettings[env].rules || [];
  });

  return newFeature;
}

export function validateJSONFeatureValue(
  // eslint-disable-next-line
  value: any,
  feature: FeatureInterface
) {
  const { jsonSchema, validationEnabled } = getValidation(feature);
  if (!validationEnabled) {
    return { valid: true, enabled: validationEnabled, errors: [] };
  }
  try {
    const ajv = new Ajv();
    const validate = ajv.compile(jsonSchema);
    let parsedValue;
    if (typeof value === "string") {
      try {
        parsedValue = JSON.parse(value);
      } catch (e) {
        // If the JSON is invalid, try to parse it with 'dirty-json' instead
        try {
          parsedValue = dJSON.parse(value);
        } catch (e) {
          return {
            valid: false,
            enabled: validationEnabled,
            errors: [e.message],
          };
        }
      }
    } else {
      parsedValue = value;
    }

    return {
      valid: validate(parsedValue),
      enabled: validationEnabled,
      errors:
        validate?.errors?.map((v) => {
          let prefix = "";
          if (v.schemaPath) {
            const matched = v.schemaPath.match(/^#\/([^/]*)\/?(.*)/);
            if (matched && matched.length > 2) {
              if (matched[1] === "required") {
                prefix = "Missing required field: ";
              } else if (matched[1] === "properties" && matched[2]) {
                prefix = "Invalid value for field: " + matched[2] + " ";
              }
            }
          }
          return prefix + v.message;
        }) ?? [],
    };
  } catch (e) {
    return { valid: false, enabled: validationEnabled, errors: [e.message] };
  }
}

export function validateFeatureValue(
  feature: FeatureInterface,
  value: string,
  label?: string
): string {
  const type = feature.valueType;
  const prefix = label ? label + ": " : "";
  if (type === "boolean") {
    if (!["true", "false"].includes(value)) {
      return value ? "true" : "false";
    }
  } else if (type === "number") {
    if (!value.match(/^-?[0-9]+(\.[0-9]+)?$/)) {
      throw new Error(prefix + "Must be a valid number");
    }
  } else if (type === "json") {
    let parsedValue;
    try {
      parsedValue = JSON.parse(value);
    } catch (e) {
      // If the JSON is invalid, try to parse it with 'dirty-json' instead
      try {
        parsedValue = dJSON.parse(value);
      } catch (e) {
        throw new Error(prefix + e.message);
      }
    }
    // validate with JSON schema if set and enabled
    const { valid, errors } = validateJSONFeatureValue(parsedValue, feature);
    if (!valid) {
      throw new Error(prefix + errors.join(", "));
    }
    return stringify(parsedValue);
  }

  return value;
}

export type StaleFeatureReason = "error" | "no-rules" | "rules-one-sided";

// type guards
const isRolloutRule = (rule: FeatureRule): rule is RolloutRule =>
  rule.type === "rollout";
const isForceRule = (rule: FeatureRule): rule is ForceRule =>
  rule.type === "force";

const areRulesOneSided = (
  rules: FeatureRule[] // can assume all rules are enabled
) => {
  const rolloutRules = rules.filter(isRolloutRule);
  const forceRules = rules.filter(isForceRule);

  const rolloutRulesOnesided =
    !rolloutRules.length ||
    rolloutRules.every(
      (r) => r.coverage === 1 && !r.condition && !r.savedGroups?.length
    );

  const forceRulesOnesided =
    !forceRules.length ||
    forceRules.every((r) => !r.condition && !r.savedGroups?.length);

  return rolloutRulesOnesided && forceRulesOnesided;
};

interface IsFeatureStaleInterface {
  feature: FeatureInterface;
  features?: FeatureInterface[];
  experiments?: ExperimentInterfaceStringDates[];
  environments?: string[];
}
export function isFeatureStale({
  feature,
  features,
  experiments = [],
  environments = [],
}: IsFeatureStaleInterface): { stale: boolean; reason?: StaleFeatureReason } {
  const featuresMap = new Map<string, FeatureInterface>();
  if (features) {
    for (const f of features) {
      featuresMap.set(f.id, f);
    }
  }
  const experimentMap = new Map<string, ExperimentInterfaceStringDates>();
  for (const e of experiments) {
    experimentMap.set(e.id, e);
  }

  const visitedFeatures = new Set<string>();

  if (!features) {
    features = [feature];
  }
  if (!environments.length) {
    environments = Object.keys(feature.environmentSettings);
  }

  const visit = (
    feature: FeatureInterface
  ): { stale: boolean; reason?: StaleFeatureReason } => {
    if (visitedFeatures.has(feature.id)) {
      return { stale: false };
    }
    visitedFeatures.add(feature.id);

    try {
      if (feature.neverStale) return { stale: false };

      const linkedExperiments = (feature?.linkedExperiments ?? [])
        .map((id) => experimentMap.get(id))
        .filter(Boolean) as ExperimentInterfaceStringDates[];

      const twoWeeksAgo = subWeeks(new Date(), 2);
      const dateUpdated = getValidDate(feature.dateUpdated);
      const stale = dateUpdated < twoWeeksAgo;

      if (!stale) return { stale };

      // features with draft revisions are not stale
      if (feature.hasDrafts) return { stale: false };

      // features with fresh dependents are not stale
      if (features && features.length > 1) {
        const dependentFeatures = getDependentFeatures(
          feature,
          features,
          environments
        );
        const hasNonStaleDependentFeatures = dependentFeatures.some((id) => {
          const f = featuresMap.get(id);
          if (!f) return true;
          return !visit(f).stale;
        });
        if (dependentFeatures.length && hasNonStaleDependentFeatures) {
          return { stale: false };
        }
      }
      const dependentExperiments = getDependentExperiments(
        feature,
        experiments
      );
      const hasNonStaleDependentExperiments = dependentExperiments.some((e) =>
        includeExperimentInPayload(e)
      );
      if (dependentExperiments.length && hasNonStaleDependentExperiments) {
        return { stale: false };
      }

      const envSettings = Object.values(feature.environmentSettings ?? {});

      const enabledEnvs = envSettings.filter((e) => e.enabled);
      const enabledRules = enabledEnvs
        .map((e) => e.rules)
        .flat()
        .filter((r) => r.enabled);

      if (enabledRules.length === 0) return { stale, reason: "no-rules" };

      // If there's at least one active experiment, it's not stale
      if (linkedExperiments.some((e) => includeExperimentInPayload(e)))
        return { stale: false };

      if (areRulesOneSided(enabledRules))
        return { stale, reason: "rules-one-sided" };

      return { stale: false };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error calculating stale feature", e);
      return { stale: false };
    }
  };

  return visit(feature);
}

export interface MergeConflict {
  name: string;
  key: string;
  resolved: boolean;
  base: string;
  live: string;
  revision: string;
}
export type MergeStrategy = "" | "overwrite" | "discard";
export type MergeResultChanges = {
  defaultValue?: string;
  rules?: Record<string, FeatureRule[]>;
};
export type AutoMergeResult =
  | {
      success: true;
      conflicts: MergeConflict[];
      result: MergeResultChanges;
    }
  | {
      success: false;
      conflicts: MergeConflict[];
    };

export type RulesAndValues = Pick<
  FeatureRevisionInterface,
  "defaultValue" | "rules" | "version"
>;

export function mergeResultHasChanges(mergeResult: AutoMergeResult): boolean {
  if (!mergeResult.success) return true;

  if (Object.keys(mergeResult.result.rules || {}).length > 0) return true;

  if (mergeResult.result.defaultValue !== undefined) return true;

  return false;
}

export function autoMerge(
  live: RulesAndValues,
  base: RulesAndValues,
  revision: RulesAndValues,
  environments: string[],
  strategies: Record<string, MergeStrategy>
): AutoMergeResult {
  const result: {
    defaultValue?: string;
    rules?: Record<string, FeatureRule[]>;
  } = {};

  // If the base and feature have not diverged, no need to merge anything
  if (live.version === base.version) {
    // Only add changes to result if it's different from the base
    if (revision.defaultValue !== base.defaultValue) {
      result.defaultValue = revision.defaultValue;
    }

    environments.forEach((env) => {
      const rules = revision.rules?.[env];
      if (!rules) return;
      if (isEqual(rules, base.rules[env] || [])) {
        return;
      }
      result.rules = result.rules || {};
      result.rules[env] = rules;
    });

    return {
      success: true,
      result,
      conflicts: [],
    };
  }

  const conflicts: MergeConflict[] = [];

  // If the revision's defaultValue has been changed
  if (
    revision.defaultValue !== base.defaultValue &&
    live.defaultValue !== revision.defaultValue
  ) {
    // If there's a conflict with the live version
    if (live.defaultValue !== base.defaultValue) {
      const conflictInfo = {
        name: "Default Value",
        key: "defaultValue",
        base: base.defaultValue,
        live: live.defaultValue,
        revision: revision.defaultValue,
      };
      const strategy = strategies[conflictInfo.key];

      if (strategy === "overwrite") {
        conflicts.push({
          ...conflictInfo,
          resolved: true,
        });
        result.defaultValue = revision.defaultValue;
      } else if (strategy === "discard") {
        conflicts.push({
          ...conflictInfo,
          resolved: true,
        });
      } else {
        conflicts.push({
          ...conflictInfo,
          resolved: false,
        });
      }
    }
    // Otherwise, there's no conflict and it's safe to update
    else {
      result.defaultValue = revision.defaultValue;
    }
  }

  // Check for conflicts in rules
  environments.forEach((env) => {
    const rules = revision.rules?.[env];
    if (!rules) return;

    // If the revision doesn't have changes in this environment, skip
    if (
      isEqual(rules, base.rules[env] || []) ||
      isEqual(rules, live.rules[env] || [])
    ) {
      return;
    }

    result.rules = result.rules || {};

    // If there's a conflict
    // TODO: be smarter about this - it's only really a conflict if the same rule is being changed in both
    if (
      env in live.rules &&
      !isEqual(live.rules[env] || [], base.rules[env] || []) &&
      !isEqual(live.rules[env] || [], rules)
    ) {
      const conflictInfo = {
        name: `Rules - ${env}`,
        key: `rules.${env}`,
        base: JSON.stringify(base.rules[env], null, 2),
        live: JSON.stringify(live.rules[env], null, 2),
        revision: JSON.stringify(rules, null, 2),
      };
      const strategy = strategies[conflictInfo.key];

      if (strategy === "overwrite") {
        conflicts.push({
          ...conflictInfo,
          resolved: true,
        });
        result.rules[env] = rules;
      } else if (strategy === "discard") {
        conflicts.push({
          ...conflictInfo,
          resolved: true,
        });
      } else {
        conflicts.push({
          ...conflictInfo,
          resolved: false,
        });
      }
    }
    // No conflict
    else {
      result.rules[env] = rules;
    }
  });

  if (conflicts.some((c) => !c.resolved)) {
    return {
      success: false,
      conflicts,
    };
  }

  return {
    success: true,
    conflicts,
    result,
  };
}

export type ValidateConditionReturn = {
  success: boolean;
  empty: boolean;
  suggestedValue?: string;
  error?: string;
};
export function validateCondition(condition?: string): ValidateConditionReturn {
  if (!condition || condition === "{}") {
    return { success: true, empty: true };
  }

  try {
    const res = JSON.parse(condition);
    if (!res || typeof res !== "object") {
      return { success: false, empty: false, error: "Must be object" };
    }

    // TODO: validate beyond just making sure it's valid JSON
    return { success: true, empty: false };
  } catch (e) {
    // Try parsing with dJSON and see if it can be fixed automatically
    try {
      const fixed = dJSON.parse(condition);
      return {
        success: false,
        empty: false,
        suggestedValue: JSON.stringify(fixed),
        error: e.message,
      };
    } catch (e2) {
      return { success: false, empty: false, error: e.message };
    }
  }
}
export function validateAndFixCondition(
  condition: string | undefined,
  applySuggestion: (suggestion: string) => void,
  throwOnSuggestion: boolean = true
): ValidateConditionReturn {
  const res = validateCondition(condition);
  if (res.success) return res;
  if (res.suggestedValue) {
    applySuggestion(res.suggestedValue);
    if (!throwOnSuggestion) return res;
    throw new Error(
      "We fixed some syntax errors in your targeting condition JSON. Please verify the changes and save again."
    );
  }
  throw new Error("Invalid targeting condition JSON: " + res.error);
}

export function getDefaultPrerequisiteCondition(
  parentFeature?: FeatureInterface
) {
  const valueType = parentFeature?.valueType || "boolean";
  if (valueType === "boolean") {
    return `{"value": true}`;
  }
  return `{"value": {"$exists": true}}`;
}

export function isFeatureCyclic(
  feature: FeatureInterface,
  featuresMap: Map<string, FeatureInterface>,
  revision?: FeatureRevisionInterface,
  envs?: string[]
): [boolean, string | null] {
  const visited = new Set<string>();
  const stack = new Set<string>();

  const newFeature = cloneDeep(feature);
  if (revision) {
    for (const env of Object.keys(newFeature.environmentSettings || {})) {
      newFeature.environmentSettings[env].rules = revision?.rules?.[env] || [];
    }
  }
  if (!envs) {
    envs = Object.keys(newFeature.environmentSettings || {});
  }

  const visit = (feature: FeatureInterface): [boolean, string | null] => {
    if (stack.has(feature.id)) return [true, feature.id];
    if (visited.has(feature.id)) return [false, null];

    stack.add(feature.id);
    visited.add(feature.id);

    const prerequisiteIds = (feature.prerequisites || []).map((p) => p.id);
    for (const eid in feature.environmentSettings || {}) {
      if (!envs?.includes(eid)) continue;
      const env = feature.environmentSettings?.[eid];
      if (!env?.rules) continue;
      for (const rule of env.rules || []) {
        if (rule?.prerequisites?.length) {
          const rulePrerequisiteIds = rule.prerequisites.map((p) => p.id);
          prerequisiteIds.push(...rulePrerequisiteIds);
        }
      }
    }

    for (const prerequisiteId of prerequisiteIds) {
      const parentFeature = featuresMap.get(prerequisiteId);
      if (parentFeature && visit(parentFeature)[0])
        return [true, prerequisiteId];
    }

    stack.delete(feature.id);
    return [false, null];
  };

  return visit(newFeature);
}

type PrerequisiteState = "deterministic" | "conditional" | "cyclic";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrerequisiteValue = any;
export type PrerequisiteStateResult = {
  state: PrerequisiteState;
  value: PrerequisiteValue;
};
export function evaluatePrerequisiteState(
  feature: FeatureInterface,
  featuresMap: Map<string, FeatureInterface>,
  env: string,
  skipRootConditions: boolean = false,
  skipCyclicCheck: boolean = false
): PrerequisiteStateResult {
  let isTopLevel = true;
  if (!skipCyclicCheck) {
    if (isFeatureCyclic(feature, featuresMap, undefined, [env])[0])
      return { state: "cyclic", value: null };
  }

  const visit = (feature: FeatureInterface): PrerequisiteStateResult => {
    // 1. Current environment toggles take priority
    if (!feature.environmentSettings[env]) {
      return { state: "deterministic", value: null };
    }
    if (!feature.environmentSettings[env].enabled) {
      return { state: "deterministic", value: null };
    }

    // 2. Determine default feature state
    //   - start with "deterministic" / defaultValue
    //   - force "conditional" if there are rules
    let state: PrerequisiteState = "deterministic";
    let value: PrerequisiteValue = feature.defaultValue;
    // cast value to correct format for evaluation
    if (feature.valueType === "boolean") {
      value = feature.defaultValue !== "false";
    } else if (feature.valueType === "number") {
      value = parseFloat(feature.defaultValue);
    } else if (feature.valueType === "json") {
      try {
        value = JSON.parse(feature.defaultValue);
      } catch (e) {
        // ignore
      }
    }

    if (!skipRootConditions || !isTopLevel) {
      if (
        feature.environmentSettings[env].rules?.filter((r) => !!r.enabled)
          ?.length
      ) {
        state = "conditional";
        value = undefined;
      }
    }

    // 3. If the feature has prerequisites, traverse all nodes (may override default state)
    //  - if any are "off", the feature is "off"
    //  - if any are "conditional", the feature is "conditional"
    isTopLevel = false;
    const prerequisites = feature.prerequisites || [];
    for (const prerequisite of prerequisites) {
      const prerequisiteFeature = featuresMap.get(prerequisite.id);
      if (!prerequisiteFeature) {
        // todo: consider returning info about missing feature
        state = "deterministic";
        value = null;
        break;
      }
      const { state: prerequisiteState, value: prerequisiteValue } = visit(
        prerequisiteFeature
      );
      if (prerequisiteState === "deterministic") {
        const evaled = evalDeterministicPrereqValue(
          prerequisiteValue ?? null,
          prerequisite.condition
        );
        if (evaled === "fail") {
          state = "deterministic";
          value = null;
          break;
        }
      } else if (prerequisiteState === "conditional") {
        // if no "off" prereqs, then any "conditional" prereq state overrides feature's default state (#2)
        state = "conditional";
        value = undefined;
      }
    }

    return { state, value };
  };
  return visit(feature);
}

export function evalDeterministicPrereqValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  condition: string
): "pass" | "fail" {
  const parsedCondition = getParsedPrereqCondition(condition);
  if (!parsedCondition) return "fail";
  const evalObj = { value: value };
  const pass = evalCondition(evalObj, parsedCondition);
  return pass ? "pass" : "fail";
}

export function getDependentFeatures(
  feature: FeatureInterface,
  features: FeatureInterface[],
  environments: string[]
): string[] {
  const dependentFeatures = features.filter((f) => {
    const prerequisites = f.prerequisites || [];
    const rules = getMatchingRules(
      f,
      (r) =>
        !!r.enabled && (r.prerequisites || []).some((p) => p.id === feature.id),
      environments
    );

    return prerequisites.some((p) => p.id === feature.id) || rules.length > 0;
  });
  return dependentFeatures.map((f) => f.id);
}

export function getDependentExperiments(
  feature: FeatureInterface,
  experiments: ExperimentInterfaceStringDates[]
): ExperimentInterfaceStringDates[] {
  return experiments.filter((e) => {
    const phase = e.phases.slice(-1)?.[0] ?? null;
    return phase?.prerequisites?.some((p) => p.id === feature.id);
  });
}

// Simplified version of getParsedCondition() from: back-end/src/util/features.ts
export function getParsedPrereqCondition(condition: string) {
  if (condition && condition !== "{}") {
    try {
      const cond = JSON.parse(condition);
      if (cond) return cond;
    } catch (e) {
      // ignore condition parse errors here
    }
  }
  return undefined;
}

export function filterProjectsByEnvironment(
  projects: string[],
  environment?: Environment,
  applyEnvironmentProjectsToAll: boolean = false
): string[] {
  if (!environment) return projects;
  const environmentHasProjects = (environment?.projects?.length ?? 0) > 0;
  if (
    applyEnvironmentProjectsToAll &&
    environmentHasProjects &&
    !projects.length
  ) {
    return environment.projects || projects;
  }
  return projects.filter((p) => {
    if (!environmentHasProjects) return true;
    return environment?.projects?.includes(p);
  });
}

export function filterProjectsByEnvironmentWithNull(
  projects: string[],
  environment?: Environment,
  applyEnvironmentProjectsToAll: boolean = false
): string[] | null {
  let filteredProjects: string[] | null = filterProjectsByEnvironment(
    projects,
    environment,
    applyEnvironmentProjectsToAll
  );
  // If projects were scrubbed by environment and nothing is left, then we should
  // return null (no projects) instead of [] (all projects)
  if (projects.length && !filteredProjects.length) {
    filteredProjects = null;
  }
  return filteredProjects;
}

export function featureHasEnvironment(
  feature: FeatureInterface,
  environment: Environment
): boolean {
  const featureProjects = feature.project ? [feature.project] : [];
  if (featureProjects.length === 0) return true;
  const filteredProjects = filterProjectsByEnvironment(
    featureProjects,
    environment,
    true
  );
  return filteredProjects.length > 0;
}

export function filterEnvironmentsByExperiment(
  environments: Environment[],
  experiment: ExperimentInterfaceStringDates
): Environment[] {
  return environments.filter((env) =>
    experimentHasEnvironment(experiment, env)
  );
}

export function experimentHasEnvironment(
  experiment: ExperimentInterfaceStringDates,
  environment: Environment
): boolean {
  const experimentProjects = experiment.project ? [experiment.project] : [];
  if (experimentProjects.length === 0) return true;
  const filteredProjects = filterProjectsByEnvironment(
    experimentProjects,
    environment,
    true
  );
  return filteredProjects.length > 0;
}

export function filterEnvironmentsByFeature(
  environments: Environment[],
  feature: FeatureInterface
): Environment[] {
  return environments.filter((env) => featureHasEnvironment(feature, env));
}

export function getDisallowedProjectIds(
  projects: string[],
  environment?: Environment
) {
  if (!environment) return [];
  return projects.filter((p) => {
    if ((environment?.projects?.length ?? 0) === 0) return false;
    if (!environment?.projects?.includes(p)) return true;
    return false;
  });
}

export function getDisallowedProjects(
  allProjects: ProjectInterface[],
  projects: string[],
  environment?: Environment
) {
  return allProjects.filter((p) =>
    getDisallowedProjectIds(projects, environment).includes(p.id)
  );
}
