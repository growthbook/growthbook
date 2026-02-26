import Ajv from "ajv";
import { subWeeks } from "date-fns";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import { evalCondition } from "@growthbook/growthbook";
import {
  FeatureInterface,
  FeatureRule,
  ForceRule,
  RolloutRule,
  SchemaField,
  SimpleSchema,
  ScheduleRule,
} from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  OrganizationSettings,
  RequireReview,
  Environment,
} from "shared/types/organization";
import { ProjectInterface } from "shared/types/project";
import { ApiFeature } from "shared/types/openapi";
import { GroupMap } from "shared/types/saved-group";
import { getValidDate } from "../dates";
import {
  conditionHasSavedGroupErrors,
  expandNestedSavedGroups,
} from "../sdk-versioning";
import {
  getMatchingRules,
  includeExperimentInPayload,
  isDefined,
  recursiveWalk,
} from ".";

export const DRAFT_REVISION_STATUSES = [
  "draft",
  "approved",
  "changes-requested",
  "pending-review",
];

export function getValidation(feature: Pick<FeatureInterface, "jsonSchema">) {
  try {
    if (!feature?.jsonSchema) {
      return {
        jsonSchema: null,
        validationEnabled: false,
        schemaDateUpdated: null,
        simpleSchema: null,
      };
    }

    const schemaString =
      feature.jsonSchema.schemaType === "schema"
        ? feature.jsonSchema.schema
        : simpleToJSONSchema(feature.jsonSchema.simple);

    const jsonSchema = JSON.parse(schemaString);
    const validationEnabled = feature.jsonSchema.enabled;
    const schemaDateUpdated = feature?.jsonSchema.date;
    return {
      jsonSchema,
      validationEnabled,
      schemaDateUpdated,
      simpleSchema:
        feature.jsonSchema.schemaType === "simple"
          ? feature.jsonSchema.simple
          : null,
    };
  } catch (e) {
    // log an error?
    return {
      jsonSchema: null,
      validationEnabled: false,
      schemaDateUpdated: null,
      simpleSchema: null,
    };
  }
}

export function mergeRevision(
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  environments: string[],
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

export function getJSONValidator() {
  return new Ajv({
    strictSchema: false,
  });
}

export function validateJSONFeatureValue(
  // eslint-disable-next-line
  value: any,
  feature: Pick<FeatureInterface, "jsonSchema">,
) {
  const { jsonSchema, validationEnabled } = getValidation(feature);
  if (!validationEnabled) {
    return { valid: true, enabled: validationEnabled, errors: [] };
  }
  try {
    const ajv = getJSONValidator();
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
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  value: string,
  label?: string,
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
    let validJSON = true;
    try {
      parsedValue = JSON.parse(value);
    } catch (e) {
      // If the JSON is invalid, try to parse it with 'dirty-json' instead
      validJSON = false;
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
    // If the JSON was invalid but could be parsed by 'dirty-json', return the fixed JSON
    if (!validJSON) {
      return stringify(parsedValue);
    }
  }

  return value;
}

// Helper function to validate ISO timestamp format
function isValidISOTimestamp(timestamp: string): boolean {
  // Validate that it's a proper date and parses correctly
  try {
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.toISOString() === timestamp;
  } catch {
    return false;
  }
}

// Validate scheduleRules business logic
export function validateScheduleRules(scheduleRules: ScheduleRule[]): void {
  // Optional field - no validation needed if empty
  if (!scheduleRules || scheduleRules.length === 0) {
    return;
  }

  // Rule 1: Must have exactly 2 elements (start and end rules)
  if (scheduleRules.length !== 2) {
    throw new Error(
      "scheduleRules must contain exactly 2 elements (start and end rules)",
    );
  }

  const [rule1, rule2] = scheduleRules;

  // Rule 2: One rule must be enabled=true, the other enabled=false
  if (rule1.enabled === rule2.enabled) {
    throw new Error(
      "scheduleRules must have one rule with enabled=true and one with enabled=false",
    );
  }

  // Rule 3: Only one rule can have timestamp=null
  const nullTimestampCount = scheduleRules.filter(
    (rule) => rule.timestamp === null,
  ).length;

  if (nullTimestampCount > 1) {
    throw new Error("Only one scheduleRule can have a null timestamp");
  }

  // Rule 4: Validate timestamp format for non-null timestamps
  for (const rule of scheduleRules) {
    if (rule.timestamp !== null && !isValidISOTimestamp(rule.timestamp)) {
      throw new Error(
        `Invalid timestamp format: "${rule.timestamp}". Must be in ISO format (e.g., "2025-06-23T16:09:37.769Z")`,
      );
    }
  }
}

export type StaleFeatureReason =
  | "error"
  | "never-stale"
  | "no-rules"
  | "rules-one-sided";

// type guards
const isRolloutRule = (rule: FeatureRule): rule is RolloutRule =>
  rule.type === "rollout";
const isForceRule = (rule: FeatureRule): rule is ForceRule =>
  rule.type === "force";

const areRulesOneSided = (
  rules: FeatureRule[], // can assume all rules are enabled
) => {
  const rolloutRules = rules.filter(isRolloutRule);
  const forceRules = rules.filter(isForceRule);

  const rolloutRulesOnesided =
    !rolloutRules.length ||
    rolloutRules.every(
      (r) => r.coverage === 1 && !r.condition && !r.savedGroups?.length,
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
  dependentExperiments?: ExperimentInterfaceStringDates[];
  environments?: string[];
  featuresMap?: Map<string, FeatureInterface>;
  experimentMap?: Map<string, ExperimentInterfaceStringDates>;
}
export function isFeatureStale({
  feature,
  features,
  experiments = [],
  dependentExperiments,
  environments = [],
  featuresMap: prebuiltFeaturesMap,
  experimentMap: prebuiltExperimentMap,
}: IsFeatureStaleInterface): { stale: boolean; reason?: StaleFeatureReason } {
  const featuresMap =
    prebuiltFeaturesMap ??
    new Map<string, FeatureInterface>((features ?? []).map((f) => [f.id, f]));
  const experimentMap =
    prebuiltExperimentMap ??
    new Map<string, ExperimentInterfaceStringDates>(
      experiments.map((e) => [e.id, e]),
    );

  const visitedFeatures = new Set<string>();

  if (!features) {
    features = [feature];
  }
  if (!environments.length) {
    environments = Object.keys(feature.environmentSettings);
  }

  const visit = (
    feature: FeatureInterface,
  ): { stale: boolean; reason?: StaleFeatureReason } => {
    if (visitedFeatures.has(feature.id)) {
      return { stale: false };
    }
    visitedFeatures.add(feature.id);

    try {
      if (feature.neverStale)
        return { stale: false, reason: "never-stale" as const };

      const linkedExperiments = (feature?.linkedExperiments ?? [])
        .map((id) => experimentMap.get(id))
        .filter(isDefined);

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
          environments,
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
      dependentExperiments =
        dependentExperiments ?? getDependentExperiments(feature, experiments);
      const hasNonStaleDependentExperiments = dependentExperiments.some((e) =>
        includeExperimentInPayload(e),
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
export function listChangedEnvironments(
  base: RulesAndValues,
  revision: RulesAndValues,
  allEnviroments: string[],
) {
  const environmentsList: string[] = [];
  allEnviroments?.forEach((env) => {
    const rules = revision.rules[env];
    if (!rules) return;
    if (isEqual(rules, base.rules[env] || [])) {
      return;
    }
    environmentsList.push(env);
  });
  return environmentsList;
}

export function autoMerge(
  live: RulesAndValues,
  base: RulesAndValues,
  revision: RulesAndValues,
  environments: string[],
  strategies: Record<string, MergeStrategy>,
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
export function validateCondition(
  condition?: string,
  groupMap?: GroupMap,
  skipSavedGroupCycleCheck: boolean = false,
): ValidateConditionReturn {
  if (!condition || condition === "{}") {
    return { success: true, empty: true };
  }
  try {
    const res = JSON.parse(condition);
    if (!res || typeof res !== "object") {
      return { success: false, empty: false, error: "Must be object" };
    }

    const scrubbed = cloneDeep(res);
    recursiveWalk(scrubbed, expandNestedSavedGroups(groupMap || new Map()));
    if (conditionHasSavedGroupErrors(scrubbed, skipSavedGroupCycleCheck)) {
      return {
        success: false,
        empty: false,
        error: "Condition includes invalid or cyclic saved group reference",
      };
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
  throwOnSuggestion: boolean = true,
  groupMap?: GroupMap,
): ValidateConditionReturn {
  const res = validateCondition(condition, groupMap);
  if (res.success) return res;
  if (res.suggestedValue) {
    applySuggestion(res.suggestedValue);
    if (!throwOnSuggestion) return res;
    throw new Error(
      "We fixed some syntax errors in your targeting condition JSON. Please verify the changes and save again.",
    );
  }
  throw new Error("Invalid targeting condition JSON: " + res.error);
}

export function getDefaultPrerequisiteCondition(parentFeature?: {
  valueType?: "boolean" | "string" | "number" | "json";
}) {
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
  envs?: string[],
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
  skipCyclicCheck: boolean = false,
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
      const { state: prerequisiteState, value: prerequisiteValue } =
        visit(prerequisiteFeature);
      if (prerequisiteState === "deterministic") {
        const evaled = evalDeterministicPrereqValue(
          prerequisiteValue ?? null,
          prerequisite.condition,
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
  condition: string,
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
  environments: string[],
): string[] {
  const dependentFeatures = features.filter((f) => {
    const prerequisites = f.prerequisites || [];
    const rules = getMatchingRules(
      f,
      (r) =>
        !!r.enabled && (r.prerequisites || []).some((p) => p.id === feature.id),
      environments,
    );
    return prerequisites.some((p) => p.id === feature.id) || rules.length > 0;
  });
  return dependentFeatures.map((f) => f.id);
}

export function getDependentExperiments(
  feature: FeatureInterface,
  experiments: ExperimentInterfaceStringDates[],
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

// approval flows
export type ResetReviewOnChange = {
  feature: FeatureInterface;
  changedEnvironments: string[];
  defaultValueChanged: boolean;
  settings?: OrganizationSettings;
};
export function getReviewSetting(
  requireReviewSettings: RequireReview[],
  feature: FeatureInterface,
): RequireReview | undefined {
  // check projects
  for (const reviewSetting of requireReviewSettings) {
    // match first value found empty means all projects
    if (
      (feature?.project && reviewSetting.projects.includes(feature?.project)) ||
      reviewSetting.projects.length === 0
    ) {
      return reviewSetting;
    }
  }
}

export function checkEnvironmentsMatch(
  environments: string[],
  reviewSetting: RequireReview,
) {
  for (const env of reviewSetting.environments) {
    if (environments.includes(env)) {
      return true;
    }
  }
  return reviewSetting.environments.length === 0;
}
export function featureRequiresReview(
  feature: FeatureInterface,
  changedEnvironments: string[],
  defaultValueChanged: boolean,
  settings?: OrganizationSettings,
) {
  const requiresReviewSettings = settings?.requireReviews;
  //legacy check
  if (
    requiresReviewSettings === undefined ||
    requiresReviewSettings === true ||
    requiresReviewSettings === false
  ) {
    return !!requiresReviewSettings;
  }
  const reviewSetting = getReviewSetting(requiresReviewSettings, feature);

  if (!reviewSetting || !reviewSetting.requireReviewOn) {
    return false;
  }
  if (defaultValueChanged) {
    return true;
  }
  return checkEnvironmentsMatch(changedEnvironments, reviewSetting);
}

export function resetReviewOnChange({
  feature,
  changedEnvironments,
  defaultValueChanged,
  settings,
}: ResetReviewOnChange) {
  const requiresReviewSettings = settings?.requireReviews;
  //legacy check
  if (
    requiresReviewSettings === true ||
    requiresReviewSettings === false ||
    requiresReviewSettings === undefined
  ) {
    return false;
  }
  const reviewSetting = getReviewSetting(requiresReviewSettings, feature);
  if (
    !reviewSetting ||
    !reviewSetting.requireReviewOn ||
    !reviewSetting.resetReviewOnChange
  ) {
    return false;
  }
  if (defaultValueChanged) {
    return true;
  }
  return checkEnvironmentsMatch(changedEnvironments, reviewSetting);
}

export function checkIfRevisionNeedsReview({
  feature,
  baseRevision,
  revision,
  allEnvironments,
  settings,
}: {
  feature: FeatureInterface;
  baseRevision: FeatureRevisionInterface;
  revision: FeatureRevisionInterface;
  allEnvironments: string[];
  settings?: OrganizationSettings;
}) {
  const changedEnvironments = listChangedEnvironments(
    baseRevision,
    revision,
    allEnvironments,
  );
  const defaultValueChanged =
    baseRevision.defaultValue !== revision.defaultValue;

  return featureRequiresReview(
    feature,
    changedEnvironments,
    defaultValueChanged,
    settings,
  );
}

export function filterProjectsByEnvironment(
  projects: string[],
  environment?: Environment,
  applyEnvironmentProjectsToAll: boolean = false,
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
  applyEnvironmentProjectsToAll: boolean = false,
): string[] | null {
  let filteredProjects: string[] | null = filterProjectsByEnvironment(
    projects,
    environment,
    applyEnvironmentProjectsToAll,
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
  environment: Environment,
): boolean {
  const featureProjects = feature.project ? [feature.project] : [];
  if (featureProjects.length === 0) return true;
  const filteredProjects = filterProjectsByEnvironment(
    featureProjects,
    environment,
    true,
  );
  return filteredProjects.length > 0;
}

export function filterEnvironmentsByExperiment(
  environments: Environment[],
  experiment: ExperimentInterfaceStringDates,
): Environment[] {
  return environments.filter((env) =>
    experimentHasEnvironment(experiment, env),
  );
}

export function experimentHasEnvironment(
  experiment: ExperimentInterfaceStringDates,
  environment: Environment,
): boolean {
  const experimentProjects = experiment.project ? [experiment.project] : [];
  if (experimentProjects.length === 0) return true;
  const filteredProjects = filterProjectsByEnvironment(
    experimentProjects,
    environment,
    true,
  );
  return filteredProjects.length > 0;
}

export function filterEnvironmentsByFeature(
  environments: Environment[],
  feature: FeatureInterface,
): Environment[] {
  return environments.filter((env) => featureHasEnvironment(feature, env));
}

export function getDisallowedProjectIds(
  projects: string[],
  environment?: Environment,
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
  environment?: Environment,
) {
  return allProjects.filter((p) =>
    getDisallowedProjectIds(projects, environment).includes(p.id),
  );
}

export function simpleToJSONSchema(simple: SimpleSchema): string {
  const getValue = (
    value: string,
    field: SchemaField,
  ): string | number | boolean => {
    const type = field.type;
    // Validation
    if (field.type !== "boolean") {
      if (field.enum.length > 0 && !field.enum.includes(value)) {
        throw new Error(`Value '${value}' not in enum for field ${field.key}`);
      }
      if (field.type === "string" && !field.enum.length) {
        if (value.length < field.min) {
          throw new Error(
            `Value '${value}' is shorter than min length for field ${field.key}`,
          );
        }
        if (value.length > field.max) {
          throw new Error(
            `Value '${value}' is longer than max length for field ${field.key}`,
          );
        }
      } else if (!field.enum.length) {
        if (parseFloat(value) < field.min) {
          throw new Error(
            `Value '${value}' is less than min value for field ${field.key}`,
          );
        }
        if (parseFloat(value) > field.max) {
          throw new Error(
            `Value '${value}' is greater than max value for field ${field.key}`,
          );
        }
      }

      if (field.type === "integer" && !Number.isInteger(parseFloat(value))) {
        throw new Error(
          `Value '${value}' is not an integer for field ${field.key}`,
        );
      }
    }

    if (type === "string") return value;
    if (type === "float") return parseFloat(value);
    if (type === "integer") return parseInt(value);
    else return value !== "false";
  };

  const fields = simple.fields.map((f) => {
    const schema: Record<string, unknown> = {
      type: ["float", "integer"].includes(f.type) ? "number" : f.type,
    };

    if (f.description) schema.description = f.description;

    if (f.default) schema.default = getValue(f.default, f);

    if (f.type !== "boolean" && f.enum.length) {
      schema.enum = f.enum.map((v) => getValue(v, f));
    }
    if (!schema.enum) {
      if (f.type === "string") {
        schema.minLength = f.min;
        schema.maxLength = f.max;
        if (f.max < f.min || f.min < 0) {
          throw new Error(`Invalid min or max for field ${f.key}`);
        }
      } else if (f.type === "float" || f.type === "integer") {
        schema.minimum = f.min;
        schema.maximum = f.max;

        if (f.type === "integer") {
          schema.multipleOf = 1;
          schema.format = "number";
        }

        if (f.max < f.min) {
          throw new Error(`Invalid min or max for field ${f.key}`);
        }
      }
    }
    return { key: f.key, required: f.required, schema };
  });
  if (fields.length === 0) {
    throw new Error("Schema must have at least 1 field");
  }

  switch (simple.type) {
    case "object":
      if (fields.some((f) => !f.key)) {
        throw new Error("Property keys cannot be left blank");
      }
      return JSON.stringify({
        type: "object",
        required: fields.filter((f) => f.required).map((f) => f.key),
        properties: fields.reduce(
          (acc, f) => {
            acc[f.key] = f.schema;
            return acc;
          },
          {} as Record<string, unknown>,
        ),
        additionalProperties: false,
      });
    case "object[]":
      if (fields.some((f) => !f.key)) {
        throw new Error("Property keys cannot be left blank");
      }
      return JSON.stringify({
        type: "array",
        items: {
          type: "object",
          required: fields.filter((f) => f.required).map((f) => f.key),
          properties: fields.reduce(
            (acc, f) => {
              acc[f.key] = f.schema;
              return acc;
            },
            {} as Record<string, unknown>,
          ),
          additionalProperties: false,
        },
      });
    case "primitive[]":
      return JSON.stringify({
        type: "array",
        items: fields[0].schema,
      });
    case "primitive":
      return JSON.stringify({
        ...fields[0].schema,
      });
    default:
      throw new Error("Invalid simple schema type");
  }
}

export function inferSchemaField(
  value: unknown,
  key: string,
  existing?: SchemaField,
): undefined | SchemaField {
  if (value == null) {
    return existing;
  }

  let type: SchemaField["type"];
  let min = existing?.min || 0;
  let max = existing?.max || 0;
  switch (typeof value) {
    case "string":
      type = "string";
      max = Math.max(max || 64, value.length);
      break;
    case "boolean":
      type = "boolean";
      break;
    case "number":
      type = Number.isInteger(value) ? "integer" : "float";
      if (value < 0) {
        min = Math.min(min || -999, value);
      }
      max = Math.max(max || 999, value);
      break;
    default:
      throw new Error(`Invalid value type: ${typeof value}`);
  }

  if (existing?.type && type !== existing?.type) {
    // Where there's a mix of integers and floats, use float
    if (type === "float" && existing.type === "integer") {
      type = "float";
    } else if (type === "integer" && existing.type === "float") {
      type = "float";
    }
    // Any other mixing of types is an error
    else {
      throw new Error("Conflicting types");
    }
  }

  return {
    key,
    type,
    required: true,
    enum: [],
    min,
    max,
    default: "",
    description: "",
  };
}

export function inferSchemaFields(
  obj: Record<string, unknown>,
  existing?: Map<string, SchemaField>,
): Map<string, SchemaField> {
  const fields = existing || new Map<string, SchemaField>();
  for (const key in obj) {
    const value = obj[key];
    const existingField = fields.get(key);

    // If there are existing fields, but this field is new, mark it as not required
    const newField = !!(existing && !existingField);

    const field = inferSchemaField(value, key, existingField);
    if (field) {
      if (newField) field.required = false;
      fields.set(key, field);
    }
  }

  // If there are fields that are no longer present, mark them as not required
  const currentKeys = Object.keys(obj);
  for (const key of fields.keys()) {
    if (!currentKeys.includes(key)) {
      const field = fields.get(key);
      if (field) {
        field.required = false;
      }
    }
  }

  return fields;
}

export function inferSimpleSchemaFromValue(rawValue: string): SimpleSchema {
  try {
    const value = JSON.parse(rawValue);

    if (value == null) {
      throw new Error("Unable to convert null or undefined value to schema");
    }
    if (typeof value === "object") {
      // Array of primitives or objects
      if (Array.isArray(value)) {
        // Skip all null elements
        const nonNullValues = value.filter((v) => v != null);

        // Don't have much to go on here, but assume it's an array of objects
        if (nonNullValues.length === 0) {
          return { type: "object[]", fields: [] };
        }

        // Array of primitives
        if (typeof nonNullValues[0] !== "object") {
          let fields: undefined | Map<string, SchemaField> = undefined;
          for (const v of nonNullValues) {
            fields = inferSchemaFields({ "": v }, fields);
          }

          const field = fields?.get("");
          return {
            type: "primitive[]",
            fields: field ? [field] : [],
          };
        }

        // Loop through all values and infer the schema
        let fields: undefined | Map<string, SchemaField> = undefined;
        for (const obj of nonNullValues) {
          if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            throw new Error("Array must contain objects");
          }
          fields = inferSchemaFields(obj as Record<string, unknown>, fields);
        }

        return {
          type: "object[]",
          fields: fields ? Array.from(fields.values()) : [],
        };
      }

      // Non-array object
      const fields = inferSchemaFields(value as Record<string, unknown>);
      return {
        type: "object",
        fields: Array.from(fields.values()),
      };
    }

    // Primitive
    const field = inferSchemaField(value, "");
    if (!field) {
      throw new Error("Unable to infer schema from value");
    }
    return { type: "primitive", fields: [field] };
  } catch (e) {
    // Fall back to a generic schema
    return { type: "object", fields: [] };
  }
}

export function getApiFeatureEnabledEnvs(feature: ApiFeature) {
  if (feature.archived) return [];
  const envs = new Set<string>();
  Object.entries(feature.environments).forEach(([env, settings]) => {
    if (settings?.enabled) {
      envs.add(env);
    }
  });
  return Array.from(envs);
}
