import Ajv from "ajv";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";

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
  revision: FeatureRevisionInterface
) {
  const newFeature = cloneDeep(feature);

  newFeature.defaultValue = revision.defaultValue;

  const envSettings = newFeature.environmentSettings;
  Object.entries(revision.rules).forEach(([env, rules]) => {
    envSettings[env] = envSettings[env] || {};
    envSettings[env].enabled = envSettings[env].enabled || false;
    envSettings[env].rules = rules;
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

    Object.entries(revision.rules).forEach(([env, rules]) => {
      if (isEqual(rules, base.rules[env])) {
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
  Object.entries(revision.rules).forEach(([env, rules]) => {
    // If the revision doesn't have changes in this environment, skip
    if (isEqual(rules, base.rules[env]) || isEqual(rules, live.rules[env])) {
      return;
    }

    result.rules = result.rules || {};

    // If there's a conflict
    // TODO: be smarter about this - it's only really a conflict if the same rule is being changed in both
    if (
      env in live.rules &&
      !isEqual(live.rules[env], base.rules[env]) &&
      !isEqual(live.rules[env], rules)
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
