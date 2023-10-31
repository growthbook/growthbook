import Ajv from "ajv";
import { subWeeks } from "date-fns";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterface } from "back-end/types/experiment";

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

type StaleFeatureReason =
  | "error"
  | "draft-state"
  | "no-active-envs"
  | "no-rules"
  | "no-active-exps"
  | "all-exps-onesided";

export function isFeatureStale(
  feature: FeatureInterface,
  linkedExperiments: ExperimentInterface[] | undefined = []
): { stale: boolean; reason?: StaleFeatureReason } {
  if (feature.linkedExperiments?.length && !linkedExperiments.length) {
    // eslint-disable-next-line no-console
    console.error("isFeatureStale: linkedExperiments not provided");
    return { stale: false, reason: "error" };
  }

  const twoWeeksAgo = subWeeks(new Date(), 2);
  // TODO why is dateUpdated a string?
  const stale = new Date(feature.dateUpdated) < twoWeeksAgo;

  if (!stale) return { stale };

  if (feature.draft) return { stale, reason: "draft-state" };

  const envSettings = Object.values(feature.environmentSettings ?? {});

  const noneEnabled = !envSettings.some((e) => e.enabled);
  if (noneEnabled) return { stale, reason: "no-active-envs" };

  const rules = envSettings.map((e) => e.rules).flat();

  if (rules.length === 0) return { stale, reason: "no-rules" };

  // TODO check if there are 'active' rules and return early if os

  const noExpsActive = !linkedExperiments.some((e) => e.status === "running");
  if (noExpsActive) return { stale, reason: "no-active-exps" };

  const allExpsOneSided = linkedExperiments.every((e) => {
    const latestPhase = e.phases.slice(-1)?.[0];
    if (!latestPhase) return false;
    return latestPhase.variationWeights.includes(1);
  });

  if (allExpsOneSided) return { stale, reason: "all-exps-onesided" };

  return { stale: false };
}
