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
import { getValidDate } from "../dates";
import { includeExperimentInPayload } from ".";

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

export function isFeatureStale(
  feature: FeatureInterface,
  linkedExperiments: ExperimentInterfaceStringDates[] | undefined = []
): { stale: boolean; reason?: StaleFeatureReason } {
  try {
    if (feature.neverStale) return { stale: false };

    if (feature.linkedExperiments?.length !== linkedExperiments.length) {
      // eslint-disable-next-line no-console
      console.error("isFeatureStale: linkedExperiments length mismatch");
      return { stale: false, reason: "error" };
    }

    const linkedExperimentIds = linkedExperiments.map((e) => e.id);
    if (
      !linkedExperimentIds.every((id) =>
        feature.linkedExperiments?.includes(id)
      )
    ) {
      // eslint-disable-next-line no-console
      console.error("isFeatureStale: linkedExperiments id mismatch");
      return { stale: false, reason: "error" };
    }

    const twoWeeksAgo = subWeeks(new Date(), 2);
    const dateUpdated = getValidDate(feature.dateUpdated);
    const stale = dateUpdated < twoWeeksAgo;

    if (!stale) return { stale };

    // features with draft revisions are not stale
    if (feature.hasDrafts) return { stale: false };

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
