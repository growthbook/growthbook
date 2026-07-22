import Ajv from "ajv";
import { subMonths, subWeeks } from "date-fns";
import dJSON from "dirty-json";
import stringify from "json-stringify-pretty-compact";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import { evalCondition } from "@growthbook/growthbook";
import {
  ExperimentRefRule,
  RevisionMetadata,
  ApiFeature,
} from "shared/validators";
import {
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  ForceRule,
  RolloutRule,
  SchemaField,
  SimpleSchema,
  ScheduleRule,
  JSONSchemaDef,
  FeatureValueType,
} from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  OrganizationSettings,
  RequireReview,
  TargetingReviewRule,
  Environment,
  SDKAttributeSchema,
} from "shared/types/organization";
import { ProjectInterface } from "shared/types/project";
import { GroupMap } from "shared/types/saved-group";
// Direct file import (not the `shared/validators` barrel) to avoid a runtime
// import cycle: the barrel pulls safe-rollout-snapshot → enterprise → util.
import { assertValidExtendsEntries } from "../validators/constant";
import { RampScheduleInterface } from "../validators/ramp-schedule";
import { getValidDate } from "../dates";
import {
  conditionHasSavedGroupErrors,
  expandNestedSavedGroups,
  EXTENDS_KEY,
} from "../sdk-versioning";
import { formatJsonMultilineObjects } from "./format-json";
import { stemRuleId } from "./ruleId";
import {
  getMatchingRules,
  getRulesForEnvironment,
  includeExperimentInPayload,
  naiveFlattenV1Rules,
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

/**
 * View-only JIT migration of a v1 feature snapshot (rules under
 * `environmentSettings[env].rules`) to v2 (top-level `feature.rules`).
 *
 * Used at the front-end model boundary for audit log snapshots, cached
 * responses, fixtures. Idempotent. Does NOT merge content-identical rules
 * across envs — naive stamp with `allEnvironments: false` +
 * `environments: [env]`. For persistence use `normalizeRulesInputToV2`.
 */
export function toV2FeatureSnapshot<T extends Partial<FeatureInterface>>(
  snapshot: T,
): T {
  if (!snapshot) return snapshot;
  // Already v2 — trust the top-level array (empty is meaningful).
  if (Array.isArray(snapshot.rules)) return snapshot;

  const envSettings = snapshot.environmentSettings;
  if (!envSettings || typeof envSettings !== "object") return snapshot;

  // v2 `FeatureEnvironment` has no `rules` field; cast is load-bearing
  // for historical audit snapshots.
  const rulesByEnv: Record<string, FeatureRule[]> = {};
  let sawV1Rules = false;
  for (const [env, setting] of Object.entries(envSettings)) {
    const legacyRules = (setting as unknown as { rules?: FeatureRule[] })
      ?.rules;
    if (Array.isArray(legacyRules)) {
      sawV1Rules = true;
      rulesByEnv[env] = legacyRules;
    }
  }
  if (!sawV1Rules) return snapshot;

  const flat = naiveFlattenV1Rules(rulesByEnv);

  const strippedEnvSettings: Record<string, unknown> = {};
  for (const [env, setting] of Object.entries(envSettings)) {
    if (setting && typeof setting === "object" && "rules" in setting) {
      const { rules: _stripped, ...rest } = setting as unknown as {
        rules?: FeatureRule[];
      } & Record<string, unknown>;
      strippedEnvSettings[env] = rest;
    } else {
      strippedEnvSettings[env] = setting;
    }
  }

  return {
    ...snapshot,
    rules: flat,
    environmentSettings: strippedEnvSettings,
  } as T;
}

export function mergeRevision(
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  environments: string[],
) {
  const newFeature = cloneDeep(feature);

  newFeature.defaultValue = revision.defaultValue;

  // A revision carries the full intended rule set; replace wholesale when
  // present. `undefined` means the revision didn't touch rules.
  if (revision.rules !== undefined) {
    newFeature.rules = naiveFlattenV1Rules(revision.rules);
  }

  const envSettings = newFeature.environmentSettings;
  environments.forEach((env) => {
    envSettings[env] = envSettings[env] || { enabled: false };
    envSettings[env].enabled = envSettings[env].enabled || false;

    if (revision.environmentsEnabled && env in revision.environmentsEnabled) {
      envSettings[env].enabled = revision.environmentsEnabled[env];
    }
  });

  if (revision.prerequisites !== undefined) {
    newFeature.prerequisites = revision.prerequisites;
  }

  if (revision.archived !== undefined) {
    newFeature.archived = revision.archived;
  }

  if ("holdout" in revision) {
    newFeature.holdout = revision.holdout ?? undefined;
  }

  if (revision.metadata) {
    const m = revision.metadata;
    if (m.description !== undefined) newFeature.description = m.description;
    if (m.owner !== undefined) newFeature.owner = m.owner;
    if (m.project !== undefined) newFeature.project = m.project;
    if (m.targetingAllProjects !== undefined)
      newFeature.targetingAllProjects = m.targetingAllProjects;
    if (m.targetingProjects !== undefined)
      newFeature.targetingProjects = m.targetingProjects;
    if (m.tags !== undefined) newFeature.tags = m.tags;
    if (m.neverStale !== undefined) newFeature.neverStale = m.neverStale;
    if (m.customFields !== undefined)
      newFeature.customFields = m.customFields as Record<string, unknown>;
    if (m.jsonSchema !== undefined) newFeature.jsonSchema = m.jsonSchema;
    if (m.baseConfig !== undefined) newFeature.baseConfig = m.baseConfig;
    // Use draft valueType for preview so rule/defaultValue validation is accurate
    if (m.valueType !== undefined) newFeature.valueType = m.valueType;
  }

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
  // Non-json flags hold a raw scalar; coerce instead of JSON-parsing (default keeps json behavior).
  valueType?: FeatureValueType,
) {
  const { jsonSchema, validationEnabled } = getValidation(feature);
  if (!validationEnabled) {
    return { valid: true, enabled: validationEnabled, errors: [] };
  }
  try {
    const ajv = getJSONValidator();
    const validate = ajv.compile(jsonSchema);
    let parsedValue;
    if (valueType === "string") {
      parsedValue = value;
    } else if (valueType === "number") {
      parsedValue = typeof value === "string" ? parseFloat(value) : value;
    } else if (typeof value === "string") {
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
            errors: [e instanceof Error ? e.message : String(e)],
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
    return {
      valid: false,
      enabled: validationEnabled,
      errors: [e instanceof Error ? e.message : String(e)],
    };
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
    const { valid, errors } = validateJSONFeatureValue(
      value,
      feature,
      "number",
    );
    if (!valid) {
      throw new Error(prefix + errors.join(", "));
    }
  } else if (type === "string") {
    const { valid, errors } = validateJSONFeatureValue(
      value,
      feature,
      "string",
    );
    if (!valid) {
      throw new Error(prefix + errors.join(", "));
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
        throw new Error(prefix + (e instanceof Error ? e.message : String(e)));
      }
    }
    // validate with JSON schema if set and enabled
    const { valid, errors } = validateJSONFeatureValue(parsedValue, feature);
    if (!valid) {
      throw new Error(prefix + errors.join(", "));
    }
    // Reject malformed `$extends` entries (the resolver silently drops them).
    // Inline objects are allowed (advanced escape hatch); loose junk isn't.
    // Lenient for features: only enforce on arrays already used as a merge
    // directive (≥1 ref/inline object), so a pre-existing flag that used
    // `$extends` as a plain data key still saves.
    assertValidExtendsEntries(parsedValue, prefix, true);
    // If the JSON was invalid but could be parsed by 'dirty-json', return the fixed JSON
    if (!validJSON) {
      return stringify(parsedValue);
    }
  }

  return value;
}

// Parses a string into a plain JSON object. Returns null when it doesn't parse
// or isn't a plain key/val object (array, null, primitive). The null result is
// how callers detect a feature whose default value can't support sparse rules.
export function parsePlainJSONObject(
  value: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof parsed === "object"
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

// Merges a sparse `json` rule value onto the feature's default object. Only the
// keys present in the rule value override the default; the rest fall back to
// the default at evaluation time.
//
// The merge is TOP-LEVEL ONLY (a shallow spread) — it is not a deep merge. A key
// in the rule value replaces the default's value for that key wholesale, so a
// nested object in the patch overwrites the default's entire object for that key
// rather than merging into it. E.g. default `{"theme":{"a":1,"b":2}}` patched
// with `{"theme":{"a":9}}` resolves to `{"theme":{"a":9}}` ("b" is dropped).
//
// If either side isn't a plain object the rule value is returned parsed as-is, so
// a misconfigured sparse flag degrades to normal (full-value) behavior rather
// than producing surprising output.
export function resolveSparseJSONValue(
  ruleValueStr: string,
  defaultObj: Record<string, unknown> | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const sparse = parsePlainJSONObject(ruleValueStr);
  if (!defaultObj || sparse === null) {
    try {
      return JSON.parse(ruleValueStr);
    } catch {
      return null;
    }
  }
  return { ...defaultObj, ...sparse };
}

// Reads the `$extends` constant-reference list off a parsed JSON object,
// ignoring non-string entries. Returns [] when absent or not an array.
function getExtendsRefs(obj: Record<string, unknown>): string[] {
  const list = obj[EXTENDS_KEY];
  return Array.isArray(list)
    ? list.filter((r): r is string => typeof r === "string")
    : [];
}

// The raw `$extends` array (string references plus any inline-object literals).
function getExtendsEntries(obj: Record<string, unknown>): unknown[] {
  const list = obj[EXTENDS_KEY];
  return Array.isArray(list) ? list : [];
}

// True when `$extends` carries an inline-object literal (the advanced escape
// hatch). Those entries are positional, so the string-ref diff/union below
// can't safely reorder them — we preserve the array verbatim instead.
function hasInlineExtendsObject(obj: Record<string, unknown>): boolean {
  return getExtendsEntries(obj).some(
    (e) => e !== null && typeof e === "object",
  );
}

// Rebuilds a JSON object string with `$extends` first (when non-empty) followed
// by the given own keys, one key per line.
function serializeExtendsObject(
  extendsEntries: unknown[],
  ownKeys: Record<string, unknown>,
): string {
  return formatJsonMultilineObjects(
    extendsEntries.length
      ? { [EXTENDS_KEY]: extendsEntries, ...ownKeys }
      : ownKeys,
  );
}

// Strips top-level keys from a full JSON value that are deep-equal to the
// feature default's value for that key, leaving the minimal sparse patch. Used
// when switching a JSON rule INTO sparse mode so the editor starts from a clean
// diff (often `{}`) instead of the full, default-laden object the rule was
// seeded with. Returns the input unchanged when either side isn't a plain
// object (no meaningful patch can be computed).
//
// `$extends` is a merge directive, not data: the patch keeps only the refs not
// already pulled in by the default's `$extends` (set difference), so the layered
// resolution doesn't double-apply them.
export function stripDefaultsForSparse(
  valueStr: string,
  defaultValueStr: string,
): string {
  const value = parsePlainJSONObject(valueStr);
  const defaultObj = parsePlainJSONObject(defaultValueStr);
  if (!value || !defaultObj) return valueStr;

  const patch: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === EXTENDS_KEY) continue;
    if (!(key in defaultObj) || !isEqual(v, defaultObj[key])) {
      patch[key] = v;
    }
  }

  // Inline-object `$extends` entries are positional and can't be ref-diffed
  // safely, so preserve the value's `$extends` array verbatim (lossless, just
  // not minimal). Only the all-string case gets the minimal set-difference.
  if (hasInlineExtendsObject(value) || hasInlineExtendsObject(defaultObj)) {
    return serializeExtendsObject(getExtendsEntries(value), patch);
  }

  const defaultRefs = new Set(getExtendsRefs(defaultObj));
  const patchRefs = getExtendsRefs(value).filter((r) => !defaultRefs.has(r));
  return serializeExtendsObject(patchRefs, patch);
}

// Expands a sparse patch back into the full value by merging it onto the feature
// default (the inverse of stripDefaultsForSparse). Used when switching a JSON
// rule OUT of sparse mode so the editor shows the whole object again. Returns
// the input unchanged when either side isn't a plain object.
//
// `$extends` arrays from the default and the patch are unioned (default's refs
// first) rather than letting the patch's array clobber the default's. Note: the
// flattened form can't perfectly reproduce the layered precedence when a
// patch-extended constant overrides one of the default's own keys (the resolver
// applies patch-`$extends` above default keys; the flattened object applies all
// `$extends` below them) — an accepted edge case for this editor convenience.
export function expandSparseToFull(
  valueStr: string,
  defaultValueStr: string,
): string {
  const patch = parsePlainJSONObject(valueStr);
  const defaultObj = parsePlainJSONObject(defaultValueStr);
  if (!patch || !defaultObj) return valueStr;

  const ownKeys: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(defaultObj)) {
    if (key !== EXTENDS_KEY) ownKeys[key] = v;
  }
  for (const [key, v] of Object.entries(patch)) {
    if (key !== EXTENDS_KEY) ownKeys[key] = v;
  }

  // With inline-object `$extends` entries the patch already carries the full
  // intended `$extends` (stripDefaultsForSparse preserved it verbatim), so use
  // it as-is rather than union-ing string refs.
  if (hasInlineExtendsObject(patch) || hasInlineExtendsObject(defaultObj)) {
    const entries = getExtendsEntries(patch).length
      ? getExtendsEntries(patch)
      : getExtendsEntries(defaultObj);
    return serializeExtendsObject(entries, ownKeys);
  }

  const mergedRefs = [...getExtendsRefs(defaultObj)];
  for (const ref of getExtendsRefs(patch)) {
    if (!mergedRefs.includes(ref)) mergedRefs.push(ref);
  }
  return serializeExtendsObject(mergedRefs, ownKeys);
}

// Validate the values a revert restores against the value type / JSON schema
// that will be live afterward. Returns one warning per value that no longer
// parses/validates; callers surface these as a bypassable soft warning.
export function getRevertValueValidationWarnings(
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  changes: Pick<MergeResultChanges, "defaultValue" | "rules" | "metadata">,
): string[] {
  // When the revert also restores a different valueType, take the schema from
  // the revert's metadata too (the current schema belongs to the old type).
  const revertsValueType = changes.metadata?.valueType !== undefined;
  const target: Pick<FeatureInterface, "valueType" | "jsonSchema"> = {
    valueType: changes.metadata?.valueType ?? feature.valueType,
    jsonSchema: revertsValueType
      ? changes.metadata?.jsonSchema
      : (changes.metadata?.jsonSchema ?? feature.jsonSchema),
  };

  const warnings: string[] = [];
  const check = (value: string, label: string) => {
    try {
      validateFeatureValue(target, value, label);
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
    }
  };

  if (changes.defaultValue !== undefined) {
    check(changes.defaultValue, "Default value");
  }

  (changes.rules ?? []).forEach((rule, i) => {
    const label = `Rule #${i + 1}`;
    switch (rule.type) {
      case "force":
      case "rollout":
        check(rule.value, label);
        break;
      case "experiment":
        rule.values.forEach((v, j) =>
          check(v.value, `${label} variation #${j + 1}`),
        );
        break;
      case "experiment-ref":
        rule.variations.forEach((v, j) =>
          check(v.value, `${label} variation #${j + 1}`),
        );
        break;
    }
  });

  return warnings;
}

// Ensure a feature's enabled validation schema is compatible with its value type.
export function assertSchemaMatchesValueType(
  jsonSchema: Pick<
    JSONSchemaDef,
    "schemaType" | "schema" | "simple" | "enabled"
  >,
  valueType: FeatureValueType,
): void {
  if (!jsonSchema.enabled) return;

  // JSON flags accept any schema
  if (valueType === "json") return;

  if (valueType === "boolean") {
    throw new Error("Boolean features cannot have a validation schema.");
  }

  let parsed: unknown;
  try {
    const schemaString =
      jsonSchema.schemaType === "simple"
        ? simpleToJSONSchema(jsonSchema.simple)
        : jsonSchema.schema;
    parsed = JSON.parse(schemaString);
  } catch (e) {
    throw new Error(
      `Invalid validation schema: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  const schemaObj: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const topType = schemaObj.type;

  // No top-level "type" is only allowed with an "enum" whose entries all match the value type
  if (topType === undefined) {
    const enumValues = schemaObj.enum;
    if (!Array.isArray(enumValues)) {
      throw new Error(
        `A ${valueType} feature's validation schema must have a top-level "type" or "enum".`,
      );
    }
    if (
      !enumValues.every((v) =>
        valueType === "number" ? typeof v === "number" : typeof v === "string",
      )
    ) {
      throw new Error(
        `All "enum" values in a ${valueType} feature's validation schema must be of type "${valueType}".`,
      );
    }
    return;
  }

  if (valueType === "number") {
    if (topType !== "number" && topType !== "integer") {
      throw new Error(
        'A number feature\'s validation schema must have a top-level type of "number" or "integer".',
      );
    }
  } else if (valueType === "string") {
    if (topType !== "string") {
      throw new Error(
        'A string feature\'s validation schema must have a top-level type of "string".',
      );
    }
  }
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
  | "rules-one-sided"
  | "abandoned-draft"
  | "recently-updated"
  | "active-draft"
  | "has-dependents"
  | "toggled-off"
  | "active-experiment"
  | "has-rules";

export type EnvStaleResult = {
  stale: boolean;
  reason?: StaleFeatureReason;
  evaluatesTo?: string; // set when all users receive the same value; same format as feature.defaultValue
};

export type IsFeatureStaleResult = {
  stale: boolean;
  reason?: StaleFeatureReason;
  envResults: Record<string, EnvStaleResult>;
};

// type guards
const isRolloutRule = (rule: FeatureRule): rule is RolloutRule =>
  rule.type === "rollout";
const isForceRule = (rule: FeatureRule): rule is ForceRule =>
  rule.type === "force";
const isExperimentRefRule = (rule: FeatureRule): rule is ExperimentRefRule =>
  rule.type === "experiment-ref";

// A rule that unconditionally matches all users, blocking any rules after it.
const isUnconditionalCatcher = (rule: FeatureRule): boolean => {
  if (!hasNoCondition(rule)) return false;
  if ((rule.savedGroups ?? []).length > 0) return false;
  if ((rule.prerequisites ?? []).length > 0) return false;
  if (isForceRule(rule)) return true;
  if (isRolloutRule(rule)) return rule.coverage >= 1;
  return false;
};

const hasNoCondition = (rule: FeatureRule): boolean =>
  !rule.condition || rule.condition === "{}";

const areRulesOneSided = (
  rules: FeatureRule[], // can assume all rules are enabled
) => {
  const rolloutRules = rules.filter(isRolloutRule);
  const forceRules = rules.filter(isForceRule);

  const rolloutRulesOnesided =
    !rolloutRules.length ||
    rolloutRules.every(
      (r) => r.coverage === 1 && hasNoCondition(r) && !r.savedGroups?.length,
    );

  const forceRulesOnesided =
    !forceRules.length ||
    forceRules.every((r) => hasNoCondition(r) && !r.savedGroups?.length);

  return rolloutRulesOnesided && forceRulesOnesided;
};

interface IsFeatureStaleInterface {
  feature: FeatureInterface;
  features: FeatureInterface[];
  environments: string[];
  experiments?: ExperimentInterfaceStringDates[];
  dependentExperiments?: ExperimentInterfaceStringDates[];
  featuresMap?: Map<string, FeatureInterface>;
  experimentMap?: Map<string, ExperimentInterfaceStringDates>;
  reverseDependencyIndex?: ReverseDependencyIndex;
  experimentDependencyIndex?: ExperimentDependencyIndex;
  mostRecentDraftDate?: Date | null;
}

// Priority order for picking an overall reason when envs disagree.
const REASON_PRIORITY: StaleFeatureReason[] = [
  "abandoned-draft",
  "no-rules",
  "rules-one-sided",
];

function pickOverallReason(
  reasons: (StaleFeatureReason | undefined)[],
): StaleFeatureReason | undefined {
  const defined = reasons.filter((r): r is StaleFeatureReason => r != null);
  if (!defined.length) return undefined;
  if (defined.every((r) => r === defined[0])) return defined[0];
  for (const p of REASON_PRIORITY) {
    if (defined.includes(p)) return p;
  }
  return defined[0];
}

// Per-env staleness breakdown.
function buildEnvResults(
  feature: FeatureInterface,
  environments: string[],
  experimentMap: Map<string, ExperimentInterfaceStringDates>,
  dependentFeatureIds: string[],
  dependentFeatures: Map<string, FeatureInterface>,
  dependentExperiments: ExperimentInterfaceStringDates[],
): Record<string, EnvStaleResult> {
  const envResults: Record<string, EnvStaleResult> = {};

  const hasActiveDependentExperiment = dependentExperiments.some((e) =>
    includeExperimentInPayload(e),
  );

  // Iterate the authoritative org environments list so every applicable env
  // is evaluated even if the feature has no settings entry for it yet.
  const envIds = environments.length
    ? environments
    : Object.keys(feature.environmentSettings ?? {});

  for (const envId of envIds) {
    const envSetting = feature.environmentSettings?.[envId];
    if (!envSetting?.enabled) {
      envResults[envId] = {
        stale: true,
        reason: "toggled-off",
        evaluatesTo: "null",
      };
      continue;
    }

    // Fall back to v1 `environmentSettings[env].rules` for test fixtures
    // that skip `migrateRawFeatureToV2`'s JIT upgrade.
    const v2RulesForEnv = getRulesForEnvironment(feature.rules, envId);
    const legacyRules = Array.isArray(feature.rules)
      ? []
      : ((envSetting as unknown as { rules?: FeatureRule[] }).rules ?? []);
    const rules = (v2RulesForEnv.length ? v2RulesForEnv : legacyRules).filter(
      (r) => r.enabled,
    );

    const hasDependentsInEnv =
      hasActiveDependentExperiment ||
      dependentFeatureIds.some((id) => {
        const f = dependentFeatures.get(id);
        if (!f) return false;
        // Global feature-level prerequisite
        if (f.prerequisites?.some((p) => p.id === feature.id)) return true;
        // Rule-level prerequisite in this specific environment (v2 or legacy)
        const depV2Rules = getRulesForEnvironment(f.rules, envId);
        const depLegacyRules = Array.isArray(f.rules)
          ? []
          : ((
              f.environmentSettings?.[envId] as unknown as {
                rules?: FeatureRule[];
              }
            )?.rules ?? []);
        const depRules = depV2Rules.length ? depV2Rules : depLegacyRules;
        return depRules.some(
          (r) => r.enabled && r.prerequisites?.some((p) => p.id === feature.id),
        );
      });

    if (rules.length === 0) {
      envResults[envId] = hasDependentsInEnv
        ? {
            stale: false,
            reason: "has-dependents",
            evaluatesTo: feature.defaultValue,
          }
        : {
            stale: true,
            reason: "no-rules",
            evaluatesTo: feature.defaultValue,
          };
      continue;
    }

    // Walk rules in order; an unconditional catcher shadows everything after it.
    let hasActiveExperiment = false;
    for (const rule of rules) {
      if (isUnconditionalCatcher(rule)) break;
      if (isExperimentRefRule(rule)) {
        const exp = experimentMap.get(rule.experimentId);
        if (exp && includeExperimentInPayload(exp)) {
          hasActiveExperiment = true;
          break;
        }
      }
    }
    if (hasActiveExperiment) {
      envResults[envId] = { stale: false, reason: "active-experiment" };
      continue;
    }

    if (areRulesOneSided(rules)) {
      const firstValueRule = rules.find(
        (r): r is ForceRule | RolloutRule =>
          r.type === "force" || r.type === "rollout",
      );
      envResults[envId] = hasDependentsInEnv
        ? {
            stale: false,
            reason: "has-dependents",
            evaluatesTo: firstValueRule?.value ?? feature.defaultValue,
          }
        : {
            stale: true,
            reason: "rules-one-sided",
            evaluatesTo: firstValueRule?.value ?? feature.defaultValue,
          };
      continue;
    }

    envResults[envId] = { stale: false, reason: "has-rules" };
  }

  return envResults;
}

export function isFeatureStale({
  feature,
  features,
  environments,
  experiments = [],
  dependentExperiments,
  featuresMap: prebuiltFeaturesMap,
  experimentMap: prebuiltExperimentMap,
  reverseDependencyIndex,
  experimentDependencyIndex,
  mostRecentDraftDate,
}: IsFeatureStaleInterface): IsFeatureStaleResult {
  const featuresMap =
    prebuiltFeaturesMap ??
    new Map<string, FeatureInterface>(features.map((f) => [f.id, f]));
  const experimentMap =
    prebuiltExperimentMap ??
    new Map<string, ExperimentInterfaceStringDates>(
      experiments.map((e) => [e.id, e]),
    );

  const visitedFeatures = new Set<string>();

  const visit = (feature: FeatureInterface): IsFeatureStaleResult => {
    if (visitedFeatures.has(feature.id)) {
      return { stale: false, envResults: {} };
    }
    visitedFeatures.add(feature.id);

    try {
      // Compute dependents before buildEnvResults so per-env results can use them.
      const dependentFeatureIds =
        features && features.length > 1
          ? getDependentFeatures(
              feature,
              features,
              environments,
              reverseDependencyIndex,
              featuresMap,
            )
          : [];
      // Only non-stale dependents protect an env from being marked stale.
      const nonStaleDependentFeatureIds = dependentFeatureIds.filter((id) => {
        const f = featuresMap.get(id);
        return !f || !visit(f).stale;
      });
      dependentExperiments =
        dependentExperiments ??
        getDependentExperiments(
          feature,
          experiments,
          experimentDependencyIndex,
        );

      const envResults = buildEnvResults(
        feature,
        environments,
        experimentMap,
        nonStaleDependentFeatureIds,
        featuresMap,
        dependentExperiments,
      );

      if (feature.neverStale)
        return { stale: false, reason: "never-stale", envResults };

      const twoWeeksAgo = subWeeks(new Date(), 2);
      const dateUpdated = getValidDate(feature.dateUpdated);
      const oldEnough = dateUpdated < twoWeeksAgo;

      if (!oldEnough)
        return { stale: false, reason: "recently-updated", envResults };

      // Active drafts block stale. Abandoned drafts (>1 month) don't force
      // stale on their own — they surface as the reason only if envs are also stale.
      let hasAbandonedDraft = false;
      if (mostRecentDraftDate !== undefined && mostRecentDraftDate !== null) {
        if (mostRecentDraftDate >= subMonths(new Date(), 1)) {
          return { stale: false, reason: "active-draft", envResults };
        }
        hasAbandonedDraft = true;
      }

      if (nonStaleDependentFeatureIds.length) {
        return { stale: false, reason: "has-dependents", envResults };
      }
      const hasNonStaleDependentExperiments = dependentExperiments.some((e) =>
        includeExperimentInPayload(e),
      );
      if (dependentExperiments.length && hasNonStaleDependentExperiments) {
        return { stale: false, reason: "has-dependents", envResults };
      }

      const envValues = Object.values(envResults);
      // Exclude toggled-off environments from the stale determination — a
      // disabled env isn't "stale", it's just off. Only enabled envs count.
      const activeEnvValues = envValues.filter(
        (e) => e.reason !== "toggled-off",
      );
      const stale =
        activeEnvValues.length === 0
          ? false
          : activeEnvValues.every((e) => e.stale);
      const reason = stale
        ? hasAbandonedDraft
          ? "abandoned-draft"
          : pickOverallReason(activeEnvValues.map((e) => e.reason))
        : undefined;

      return { stale, reason, envResults };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error calculating stale feature", e);
      return { stale: false, envResults: {} };
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
  rules?: FeatureRule[];
  environmentsEnabled?: Record<string, boolean>;
  prerequisites?: FeaturePrerequisite[];
  archived?: boolean;
  metadata?: RevisionMetadata;
  holdout?: { id: string; value: string } | null;
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

export type RevisionFields = Pick<
  FeatureRevisionInterface,
  | "defaultValue"
  | "rules"
  | "version"
  | "environmentsEnabled"
  | "prerequisites"
  | "archived"
  | "metadata"
  | "holdout"
  | "rampActions"
>;

// Per-field backfill for old/sparse revisions before passing to autoMerge.
// Fields not listed here are left as-is; sparse absence is meaningful for those.
const revisionFieldFillers: Partial<{
  [K in keyof RevisionFields]: (
    feature: FeatureInterface,
    current: RevisionFields[K],
  ) => RevisionFields[K];
}> = {
  // Fill missing envs from the live feature so new envs don't produce false diffs.
  environmentsEnabled: (feature, current) => ({
    ...Object.fromEntries(
      Object.entries(feature.environmentSettings ?? {}).map(([env, val]) => [
        env,
        !!val.enabled,
      ]),
    ),
    ...(current ?? {}),
  }),
  // Backfill valueType + baseConfig for old revisions that predate these fields,
  // so a legacy draft doesn't false-diff against the live baseline.
  metadata: (feature, current) => {
    let next = current;
    if (next?.valueType === undefined)
      next = { ...next, valueType: feature.valueType };
    if (next?.baseConfig === undefined)
      next = { ...next, baseConfig: feature.baseConfig ?? null };
    return next;
  },
  // Backfill envelope fields for legacy revisions that predate them. Without
  // this, revisionHasGlobalChange compares e.g. "false" !== undefined for
  // defaultValue and returns "all", bypassing env-scoped review checks even
  // for drafts that only touch non-gated environments.
  defaultValue: (feature, current) => current ?? feature.defaultValue,
  archived: (feature, current) => current ?? feature.archived ?? false,
  prerequisites: (feature, current) => current ?? feature.prerequisites ?? [],
  // Backfill holdout from feature so that removing a holdout is detected as a change.
  // Without this, comparing draft.holdout (null) vs base.holdout (undefined → null)
  // would show no change when the feature actually has a holdout.
  // Note: we check for undefined explicitly because null is a valid value (means removal).
  holdout: (feature, current) =>
    current !== undefined ? current : (feature.holdout ?? null),
};

// Backfills stale/missing fields on a revision before passing to autoMerge.
export function fillRevisionFromFeature(
  revision: RevisionFields,
  feature: FeatureInterface,
): RevisionFields {
  const result = { ...revision } as RevisionFields;
  for (const k of Object.keys(
    revisionFieldFillers,
  ) as (keyof RevisionFields)[]) {
    (result[k] as unknown) = revisionFieldFillers[k]!(
      feature,
      result[k] as never,
    );
  }
  return result;
}

// Builds a canonical RevisionFields snapshot from the live feature document.
// Use this (not fillRevisionFromFeature) when constructing the live baseline for diffs.
export function liveRevisionFromFeature(
  liveRevision: RevisionFields,
  feature: FeatureInterface,
): RevisionFields {
  return {
    ...liveRevision,
    defaultValue: feature.defaultValue,
    rules: feature.rules ?? [],
    environmentsEnabled: Object.fromEntries(
      Object.entries(feature.environmentSettings ?? {}).map(([env, val]) => [
        env,
        !!val.enabled,
      ]),
    ),
    archived: feature.archived ?? false,
    prerequisites: feature.prerequisites ?? [],
    holdout:
      "holdout" in (feature as object)
        ? ((feature as { holdout?: RevisionFields["holdout"] }).holdout ?? null)
        : (liveRevision.holdout ?? null),
    metadata: {
      description: feature.description ?? "",
      owner: feature.owner ?? "",
      project: feature.project ?? "",
      tags: feature.tags ?? [],
      jsonSchema: feature.jsonSchema,
      valueType: feature.valueType,
      baseConfig: feature.baseConfig ?? null,
      ...(liveRevision.metadata ?? {}),
    },
  };
}

// Overlays a draft's stored fields onto the live baseline.
export function buildEffectiveDraft(
  draftRevision: RevisionFields,
  filledLive: RevisionFields,
): RevisionFields {
  return {
    ...filledLive,
    defaultValue: draftRevision.defaultValue,
    rules: draftRevision.rules,
    ...(draftRevision.environmentsEnabled !== undefined && {
      environmentsEnabled: draftRevision.environmentsEnabled,
    }),
    ...(draftRevision.prerequisites !== undefined && {
      prerequisites: draftRevision.prerequisites,
    }),
    ...(draftRevision.archived !== undefined && {
      archived: draftRevision.archived,
    }),
    ...(draftRevision.metadata !== undefined && {
      metadata: { ...filledLive.metadata, ...draftRevision.metadata },
    }),
    ...("holdout" in draftRevision && {
      holdout: draftRevision.holdout,
    }),
  };
}

// Reconciles a raw (live, base) revision pair against the live feature document
// so every autoMerge caller compares against the same feature-model-anchored
// baseline. Passing raw revision snapshots straight into autoMerge lets drift
// between a snapshot and feature.environmentSettings/rules (e.g. from the legacy
// v1/v2 write bridge) hide or invent changes, and leaves callers out of unison.
export function reconcileMergeBaselines(
  feature: FeatureInterface,
  live: RevisionFields,
  base: RevisionFields,
): { live: RevisionFields; base: RevisionFields } {
  return {
    live: liveRevisionFromFeature(live, feature),
    base: fillRevisionFromFeature(base, feature),
  };
}

// Returns true if the draft differs from live across any tracked field.
export function draftDiffersFromLive(
  draftRevision: RevisionFields,
  liveRevision: RevisionFields,
  feature: FeatureInterface,
  envIds: string[],
): boolean {
  const filledLive = liveRevisionFromFeature(liveRevision, feature);
  const draft = buildEffectiveDraft(draftRevision, filledLive);

  if (draft.defaultValue !== filledLive.defaultValue) return true;
  if (draft.archived !== filledLive.archived) return true;
  // Whole-array diff is the canonical "did rules change" check; per-env
  // projection is only needed for UX/gating (see `getDraftAffectedEnvironments`).
  if (
    JSON.stringify(naiveFlattenV1Rules(draft.rules)) !==
    JSON.stringify(naiveFlattenV1Rules(filledLive.rules))
  )
    return true;
  if (
    envIds.some(
      (env) =>
        (draft.environmentsEnabled?.[env] ?? false) !==
        (filledLive.environmentsEnabled?.[env] ?? false),
    )
  )
    return true;
  if (
    JSON.stringify(draft.prerequisites ?? []) !==
    JSON.stringify(filledLive.prerequisites ?? [])
  )
    return true;
  if (draft.metadata) {
    const keys = new Set([
      ...Object.keys(draft.metadata),
      ...Object.keys(filledLive.metadata ?? {}),
    ]) as Set<keyof RevisionMetadata>;
    for (const k of keys) {
      if (
        !isEqual(
          normalizeMetadataValue(k, draft.metadata[k]),
          normalizeMetadataValue(k, filledLive.metadata?.[k]),
        )
      )
        return true;
    }
  }
  if (!isEqual(draft.holdout ?? null, filledLive.holdout ?? null)) return true;
  // Pending ramp actions (create/detach) are meaningful changes even if no feature content changed
  if ((draftRevision.rampActions ?? []).length > 0) return true;
  return false;
}

export function mergeResultHasChanges(mergeResult: AutoMergeResult): boolean {
  if (!mergeResult.success) return true;
  const r = mergeResult.result;
  if (r.defaultValue !== undefined) return true;
  // `autoMerge` sets `rules` only when they differ from base. Presence
  // (including an explicit `[]` meaning "all rules deleted") is meaningful.
  if (r.rules !== undefined) return true;
  if (Object.keys(r.environmentsEnabled || {}).length > 0) return true;
  if (r.prerequisites !== undefined) return true;
  if (r.archived !== undefined) return true;
  if ("holdout" in r) return true;
  if (r.metadata !== undefined && Object.keys(r.metadata).length > 0)
    return true;
  return false;
}

// A single field that the live feature changed relative to a draft's base
// version — i.e. a change "published since this draft was created". The `key`
// mirrors the conflict keys used by `autoMerge` (e.g. "rules",
// "environmentsEnabled.prod", "metadata.description") and `name` is a
// human-readable label suitable for UI/notifications.
export interface LiveChange {
  key: string;
  name: string;
}

// Compute the set of fields that differ between the current live revision and
// the revision a draft was branched from (its base). This powers the
// "published in live since this draft's base" panel and the divergence
// warning/count surfaced before publish, as well as REST API friction
// payloads. It is purely descriptive — it never resolves or merges anything.
export function getLiveChangesSinceBase(
  live: RevisionFields,
  base: RevisionFields,
  environments: string[],
): LiveChange[] {
  const changes: LiveChange[] = [];

  if (live.defaultValue !== base.defaultValue) {
    changes.push({ key: "defaultValue", name: "Default Value" });
  }

  if (
    !isEqual(naiveFlattenV1Rules(live.rules), naiveFlattenV1Rules(base.rules))
  ) {
    changes.push({ key: "rules", name: "Rules" });
  }

  for (const env of environments) {
    const liveVal = live.environmentsEnabled?.[env];
    const baseVal = base.environmentsEnabled?.[env];
    if (!isEqual(liveVal, baseVal)) {
      changes.push({
        key: `environmentsEnabled.${env}`,
        name: `Env Enabled - ${env}`,
      });
    }
  }

  if (!isEqual(live.prerequisites ?? [], base.prerequisites ?? [])) {
    changes.push({ key: "prerequisites", name: "Prerequisites" });
  }

  if ((live.archived ?? false) !== (base.archived ?? false)) {
    changes.push({ key: "archived", name: "Archived" });
  }

  if (!isEqual(live.holdout ?? null, base.holdout ?? null)) {
    changes.push({ key: "holdout", name: "Holdout" });
  }

  const metadataKeys = new Set<keyof RevisionMetadata>([
    ...((Object.keys(live.metadata ?? {}) as (keyof RevisionMetadata)[]) || []),
    ...((Object.keys(base.metadata ?? {}) as (keyof RevisionMetadata)[]) || []),
  ]);
  for (const k of metadataKeys) {
    if (
      !isEqual(
        normalizeMetadataValue(k, live.metadata?.[k]),
        normalizeMetadataValue(k, base.metadata?.[k]),
      )
    ) {
      changes.push({ key: `metadata.${k}`, name: `Metadata - ${k}` });
    }
  }

  return changes;
}

// Classifies how a draft relates to the current live version:
//   "current"  — built on the live version; nothing changed underneath it
//   "diverged" — live advanced since the draft's base, but changes auto-merge
//   "conflict" — live advanced with changes that conflict and need resolution
export type DivergenceClass = "current" | "diverged" | "conflict";

export interface PublishGovernanceInput {
  // Status of the draft revision being acted on.
  revisionStatus: FeatureRevisionInterface["status"];
  // The version the draft was branched from.
  baseVersion: number;
  // The current live version of the feature.
  liveVersion: number;
  // Whether autoMerge produced a result with no unresolved conflicts.
  mergeSuccess: boolean;
  // The set of fields live changed since the draft's base (descriptive only).
  liveChanges: LiveChange[];
  // The live version captured at the moment the draft was approved. Null for
  // legacy approvals created before this was tracked.
  approvedBaseVersion?: number | null;
  // Org setting: when true, a stale draft must be rebased before publishing.
  requireRebaseBeforePublish?: boolean;
}

export interface PublishGovernanceResult {
  diverged: boolean;
  divergence: DivergenceClass;
  liveChanges: LiveChange[];
  // An approved draft whose approval no longer reflects the current live state
  // because changes were published after approval.
  staleApproval: boolean;
  // Rebasing is advisable (divergence or a stale approval). UI should surface
  // a "Rebase with live" affordance.
  recommendRebase: boolean;
  // Rebasing/conflict-resolution is mandatory before publishing (hard conflict,
  // or org policy requires same-base merges, or a stale approval under policy).
  rebaseRequired: boolean;
  // Whether publishing is allowed in the current state.
  canPublish: boolean;
  // Human-readable reason publishing is blocked (null when allowed).
  blockReason: string | null;
}

// Central governance decision for publishing/reviewing a draft revision. Pure
// and side-effect free so it can be unit tested and shared between the publish
// UI (callouts + CTA gating) and back-end enforcement. It does NOT perform the
// merge itself — callers pass in the merge outcome and the live-vs-base delta.
export function evaluatePublishGovernance({
  revisionStatus,
  baseVersion,
  liveVersion,
  mergeSuccess,
  liveChanges,
  approvedBaseVersion = null,
  requireRebaseBeforePublish = false,
}: PublishGovernanceInput): PublishGovernanceResult {
  const diverged = liveVersion !== baseVersion;
  const divergence: DivergenceClass = !mergeSuccess
    ? "conflict"
    : diverged
      ? "diverged"
      : "current";

  // An approval is stale when live moved past the point it was approved
  // against. When we have a tracked approval point, compare against it
  // precisely; otherwise (legacy approvals) fall back to raw divergence.
  const staleApproval =
    revisionStatus === "approved" &&
    ((approvedBaseVersion ?? null) !== null
      ? liveVersion !== approvedBaseVersion
      : diverged);

  const recommendRebase = divergence !== "current" || staleApproval;

  const rebaseRequired =
    divergence === "conflict" ||
    (requireRebaseBeforePublish &&
      (divergence === "diverged" || staleApproval));

  let canPublish = true;
  let blockReason: string | null = null;
  if (divergence === "conflict") {
    canPublish = false;
    blockReason =
      "Resolve conflicts with the live version before publishing this draft.";
  } else if (rebaseRequired) {
    canPublish = false;
    blockReason = staleApproval
      ? "Changes were published after this draft was approved. Rebase with live and get re-approval before publishing."
      : "This draft is based on an older version. Rebase with live before publishing.";
  }

  return {
    diverged,
    divergence,
    liveChanges,
    staleApproval,
    recommendRebase,
    rebaseRequired,
    canPublish,
    blockReason,
  };
}

// ── Scheduled / deferred publish ────────────────────────────────────────────
// Single source of truth lives in shared/revisions/scheduledPublish; re-exported
// here so feature surfaces importing from shared/util keep working. Imported from
// the specific file (not a barrel) to avoid a runtime import cycle.
export {
  isScheduledPublishPending,
  isScheduledPublishDue,
  isScheduledPublishLockActive,
  isRevisionEditLockedBySchedule,
  findPublishLockingScheduledRevision,
} from "../revisions/scheduledPublish";

// True if publishing the draft would change anything outside the target
// ref rule(s) matched by `isTargetRef`. Compares effective post-publish state
// (live overlaid with draft-set fields) vs live, sidestepping autoMerge's
// phantom diffs from sparse legacy revisions. Skips environmentsEnabled
// (auto-toggled on link) and metadata (no SDK payload impact).
export function draftHasChangesOutsideTargetRef(
  draftRevision: RevisionFields,
  filledLive: RevisionFields,
  isTargetRef: (rule: FeatureRule) => boolean,
): boolean {
  const effective = buildEffectiveDraft(draftRevision, filledLive);

  if (effective.defaultValue !== filledLive.defaultValue) return true;
  if ((effective.archived ?? false) !== (filledLive.archived ?? false))
    return true;
  if (!isEqual(effective.prerequisites ?? [], filledLive.prerequisites ?? []))
    return true;
  if (!isEqual(effective.holdout ?? null, filledLive.holdout ?? null))
    return true;

  const stripTargetRefs = (rules: FeatureRule[] | undefined) =>
    (rules ?? []).filter((rule) => !isTargetRef(rule));
  const liveOther = stripTargetRefs(naiveFlattenV1Rules(filledLive.rules));
  const draftOther = stripTargetRefs(naiveFlattenV1Rules(effective.rules));
  if (!isEqual(liveOther, draftOther)) return true;

  return false;
}

// Normalize a metadata field value for comparison.
export function normalizeMetadataValue(
  k: keyof RevisionMetadata,
  v: RevisionMetadata[keyof RevisionMetadata],
): unknown {
  if (k === "tags" || k === "targetingProjects")
    return (v as string[] | null | undefined) ?? [];
  if (k === "targetingAllProjects") return !!v;
  if (k === "description" || k === "owner" || k === "project")
    return (v as string | null | undefined) ?? "";
  // Normalize unset/undefined to null so a non-config snapshot doesn't diff
  // against an explicit null.
  if (k === "baseConfig") return (v as string | null | undefined) ?? null;
  return v;
}

// Returns true if the revision contains a change that affects all environments
// (prerequisites, archived, holdout, defaultValue, or metadata).
// Used by getDraftAffectedEnvironments and checkIfRevisionNeedsReview.
function revisionHasGlobalChange(
  revision: RevisionFields,
  base: RevisionFields,
): boolean {
  if (
    revision.prerequisites !== undefined &&
    !isEqual(revision.prerequisites, base.prerequisites || [])
  )
    return true;
  if (revision.archived !== undefined && revision.archived !== base.archived)
    return true;
  if (
    "holdout" in revision &&
    !isEqual(revision.holdout ?? null, base.holdout ?? null)
  )
    return true;
  if (revision.defaultValue !== base.defaultValue) return true;
  if (
    revision.metadata &&
    (Object.keys(revision.metadata) as (keyof RevisionMetadata)[]).some(
      (k) =>
        !isEqual(
          normalizeMetadataValue(k, revision.metadata![k]),
          normalizeMetadataValue(k, base.metadata?.[k]),
        ),
    )
  )
    return true;
  return false;
}

// Returns true if the revision has a metadata-only global change (no
// prerequisites, archived, holdout, or defaultValue changes).
function revisionHasMetadataOnlyGlobalChange(
  revision: RevisionFields,
  base: RevisionFields,
): boolean {
  const hasNonMetadata =
    (revision.prerequisites !== undefined &&
      !isEqual(revision.prerequisites, base.prerequisites || [])) ||
    (revision.archived !== undefined && revision.archived !== base.archived) ||
    ("holdout" in revision &&
      !isEqual(revision.holdout ?? null, base.holdout ?? null)) ||
    revision.defaultValue !== base.defaultValue;
  if (hasNonMetadata) return false;
  return (
    !!revision.metadata &&
    (Object.keys(revision.metadata) as (keyof RevisionMetadata)[]).some(
      (k) =>
        !isEqual(
          normalizeMetadataValue(k, revision.metadata![k]),
          normalizeMetadataValue(k, base.metadata?.[k]),
        ),
    )
  );
}

// Granular three-way merge of two diverged rule arrays (matched by id).
// Rules that only one side touched merge automatically. A rule that both
// sides changed differently — including delete-vs-modify — produces its own
// `rules.<ruleId>` conflict, resolvable independently via the strategies map
// (`overwrite` = take the draft's version, `discard` = take live's). When
// both sides reordered the surviving rules differently, a `rules.order`
// conflict is emitted with the competing id sequences. The blanket "rules"
// strategy key is honored as a fallback that applies to every rule-level
// conflict, preserving the older all-or-nothing resolution contract.
//
// Returns the conflicts found (resolved or not) and the merged array — or
// `merged: null` while any rule-level conflict remains unresolved.
function mergeRulesGranular(
  base: FeatureRule[],
  live: FeatureRule[],
  revision: FeatureRule[],
  strategies: Record<string, MergeStrategy>,
): { merged: FeatureRule[] | null; conflicts: MergeConflict[] } {
  // Defensive: callers route through `naiveFlattenV1Rules` which already
  // filters nullish slots, but the merge keys by `r.id` and a stray nullish
  // entry would collapse every other rule into the `undefined` map slot.
  // Skip them here too rather than corrupting the merge silently.
  const filterValid = (rules: FeatureRule[]) =>
    rules.filter(
      (r): r is FeatureRule => r != null && typeof r === "object" && !!r.id,
    );
  base = filterValid(base);
  live = filterValid(live);
  revision = filterValid(revision);

  const baseById = new Map(base.map((r) => [r.id, r]));
  const liveById = new Map(live.map((r) => [r.id, r]));
  const revById = new Map(revision.map((r) => [r.id, r]));

  const conflicts: MergeConflict[] = [];
  // Per-key strategy with the blanket "rules" key as a legacy fallback.
  const strategyFor = (key: string): MergeStrategy =>
    strategies[key] || strategies["rules"] || "";
  const stringifySide = (rule: FeatureRule | undefined): string =>
    rule === undefined ? "" : JSON.stringify(rule, null, 2);

  // Decide a winner per rule id: the rule's merged content, or null when the
  // winning side deleted it. Ids with unresolved conflicts get no entry.
  const winners = new Map<string, FeatureRule | null>();
  const allIds = new Set([
    ...base.map((r) => r.id),
    ...live.map((r) => r.id),
    ...revision.map((r) => r.id),
  ]);

  for (const id of allIds) {
    const baseRule = baseById.get(id);
    const liveRule = liveById.get(id);
    const revRule = revById.get(id);
    const liveChanged = !isEqual(liveRule, baseRule);
    const revChanged = !isEqual(revRule, baseRule);

    if (liveChanged && revChanged && !isEqual(liveRule, revRule)) {
      // Both sides changed the same rule differently (an absent side means
      // that side deleted it) — a genuine per-rule conflict.
      const sourceRule = revRule ?? liveRule ?? baseRule;
      const desc =
        typeof sourceRule?.description === "string"
          ? sourceRule.description.trim()
          : "";
      const conflictInfo: MergeConflict = {
        name: desc ? `Rule – ${desc}` : `Rule – ${id}`,
        key: `rules.${id}`,
        base: stringifySide(baseRule),
        live: stringifySide(liveRule),
        revision: stringifySide(revRule),
        resolved: false,
      };
      const strategy = strategyFor(conflictInfo.key);
      if (strategy === "overwrite") {
        conflictInfo.resolved = true;
        winners.set(id, revRule ?? null);
      } else if (strategy === "discard") {
        conflictInfo.resolved = true;
        winners.set(id, liveRule ?? null);
      }
      conflicts.push(conflictInfo);
      continue;
    }

    // At most one side changed (or both made the identical change): the
    // changed side wins. An absent winner is a deletion — honoring it here is
    // what keeps draft deletions from being silently resurrected and live
    // deletions from reappearing.
    winners.set(id, (revChanged ? revRule : liveRule) ?? null);
  }

  // Ordering: compare each side's relative order of the ids it shares with
  // base. If only the draft reordered, its order wins; if only live did (or
  // neither), live's order wins; if both reordered differently, that is an
  // order conflict the caller must resolve via `rules.order`.
  const relativeOrder = (
    rules: FeatureRule[],
    others: Map<string, FeatureRule>,
  ): string[] => rules.map((r) => r.id).filter((id) => others.has(id));
  const liveReordered = !isEqual(
    relativeOrder(live, baseById),
    relativeOrder(base, liveById),
  );
  const revReordered = !isEqual(
    relativeOrder(revision, baseById),
    relativeOrder(base, revById),
  );

  let useDraftOrder = revReordered && !liveReordered;
  if (liveReordered && revReordered) {
    const liveCommon = relativeOrder(live, revById);
    const revCommon = relativeOrder(revision, liveById);
    if (!isEqual(liveCommon, revCommon)) {
      const conflictInfo: MergeConflict = {
        name: "Rule Order",
        key: "rules.order",
        base: JSON.stringify(
          base.map((r) => r.id),
          null,
          2,
        ),
        live: JSON.stringify(
          live.map((r) => r.id),
          null,
          2,
        ),
        revision: JSON.stringify(
          revision.map((r) => r.id),
          null,
          2,
        ),
        resolved: false,
      };
      const strategy = strategyFor(conflictInfo.key);
      if (strategy === "overwrite") {
        conflictInfo.resolved = true;
        useDraftOrder = true;
      } else if (strategy === "discard") {
        conflictInfo.resolved = true;
      }
      conflicts.push(conflictInfo);
    }
  }

  if (conflicts.some((c) => !c.resolved)) {
    return { merged: null, conflicts };
  }

  // Walk the winning side's ordering pushing each id's winner, then append
  // winners only present on the other side (that side's additions).
  const primary = useDraftOrder ? revision : live;
  const secondary = useDraftOrder ? live : revision;
  const merged: FeatureRule[] = [];
  const placed = new Set<string>();
  for (const rule of [...primary, ...secondary]) {
    if (placed.has(rule.id)) continue;
    placed.add(rule.id);
    const winner = winners.get(rule.id);
    if (winner) merged.push(winner);
  }

  return { merged, conflicts };
}

// Pending ramp actions reference draft rules by id. After a rebase the
// referenced rule may no longer exist (e.g. live deleted a rule the draft
// never touched, so the merge dropped it) — such actions can never execute
// and would otherwise ride along silently until publish-time orphan cleanup.
// Returns the surviving actions plus the orphans so callers can persist the
// prune and record it in the audit log. Actions without a rule reference are
// kept as-is.
export function pruneOrphanedRampActions<T extends { ruleId?: string }>(
  rampActions: T[] | undefined,
  rules: FeatureRule[],
): { kept: T[]; pruned: T[] } {
  const ruleIds = new Set(rules.map((r) => r?.id).filter(Boolean));
  const kept: T[] = [];
  const pruned: T[] = [];
  for (const action of rampActions ?? []) {
    if (!action.ruleId || ruleIds.has(action.ruleId)) {
      kept.push(action);
    } else {
      pruned.push(action);
    }
  }
  return { kept, pruned };
}

export function autoMerge(
  live: RevisionFields,
  base: RevisionFields,
  revision: RevisionFields,
  environments: string[],
  strategies: Record<string, MergeStrategy>,
): AutoMergeResult {
  const result: MergeResultChanges = {};
  const diverged = live.version !== base.version;

  // Normalize all three sides up front. Pre-migration audit logs / draft
  // revisions may still arrive in v1 shape (Record<env, FeatureRule[]>);
  // normalize to a canonical v2 FeatureRule[] before any merge reasoning.
  const liveRules = naiveFlattenV1Rules(live.rules);
  const baseRules = naiveFlattenV1Rules(base.rules);
  const revRules = naiveFlattenV1Rules(revision.rules);
  // `environments` is retained in the signature for call-site compatibility
  // and for the environmentsEnabled / override paths below, but rule merging
  // now operates on the flat v2 array — not a per-env projection.
  void environments;

  // No divergence path: only include revision changes that differ from base
  if (!diverged) {
    if (revision.defaultValue !== base.defaultValue) {
      result.defaultValue = revision.defaultValue;
    }

    if (revision.rules !== undefined && !isEqual(revRules, baseRules)) {
      result.rules = revRules;
    }

    // environmentsEnabled — anchor to the live feature model, not the base
    // snapshot. `base` and `live` share a version here, so they should match;
    // when they drift (e.g. a legacy v1 REST write that updated the feature doc
    // but not the revision), a stale base value that equals the draft would
    // otherwise swallow a real toggle and report "no changes to publish".
    // `live` is feature-model-sourced (liveRevisionFromFeature), matching
    // draftDiffersFromLive so the dashboard and REST publish gates stay in unison.
    if (revision.environmentsEnabled) {
      for (const env of Object.keys(revision.environmentsEnabled)) {
        const revVal = revision.environmentsEnabled[env];
        if (revVal !== live.environmentsEnabled?.[env]) {
          result.environmentsEnabled = result.environmentsEnabled || {};
          result.environmentsEnabled[env] = revVal;
        }
      }
    }

    // prerequisites
    if (
      revision.prerequisites !== undefined &&
      !isEqual(revision.prerequisites, base.prerequisites || [])
    ) {
      result.prerequisites = revision.prerequisites;
    }

    // archived
    if (
      revision.archived !== undefined &&
      revision.archived !== base.archived
    ) {
      result.archived = revision.archived;
    }

    // holdout
    if (
      "holdout" in revision &&
      !isEqual(revision.holdout, base.holdout ?? null)
    ) {
      result.holdout = revision.holdout;
    }

    // metadata — per-field comparison
    if (revision.metadata) {
      const metadataResult: RevisionMetadata = {};
      let hasMetadataChanges = false;
      for (const k of Object.keys(
        revision.metadata,
      ) as (keyof RevisionMetadata)[]) {
        const revNorm = normalizeMetadataValue(k, revision.metadata[k]);
        const baseNorm = normalizeMetadataValue(k, base.metadata?.[k]);
        if (!isEqual(revNorm, baseNorm)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (metadataResult as any)[k] = revision.metadata[k];
          hasMetadataChanges = true;
        }
      }
      if (hasMetadataChanges) result.metadata = metadataResult;
    }

    return { success: true, result, conflicts: [] };
  }

  // Diverged path: three-way merge with conflict detection
  const conflicts: MergeConflict[] = [];

  // defaultValue
  if (
    revision.defaultValue !== base.defaultValue &&
    revision.defaultValue !== live.defaultValue
  ) {
    if (live.defaultValue !== base.defaultValue) {
      const conflictInfo: MergeConflict = {
        name: "Default Value",
        key: "defaultValue",
        base: base.defaultValue,
        live: live.defaultValue,
        revision: revision.defaultValue,
        resolved: false,
      };
      const strategy = strategies["defaultValue"];
      if (strategy === "overwrite") {
        conflictInfo.resolved = true;
        result.defaultValue = revision.defaultValue;
      } else if (strategy === "discard") {
        conflictInfo.resolved = true;
      }
      conflicts.push(conflictInfo);
    } else {
      result.defaultValue = revision.defaultValue;
    }
  }

  // rules (flat v2 array — granular per-rule merge)
  if (revision.rules !== undefined && !isEqual(revRules, baseRules)) {
    if (!isEqual(revRules, liveRules)) {
      if (!isEqual(liveRules, baseRules)) {
        // Both sides diverged from base. Merge rule-by-rule: untouched/
        // one-sided changes merge automatically, while rules both sides
        // changed differently surface as individual `rules.<ruleId>`
        // conflicts (plus `rules.order` for competing reorders), each
        // resolvable independently.
        const ruleMerge = mergeRulesGranular(
          baseRules,
          liveRules,
          revRules,
          strategies,
        );
        conflicts.push(...ruleMerge.conflicts);
        if (
          ruleMerge.merged !== null &&
          !isEqual(ruleMerge.merged, liveRules)
        ) {
          result.rules = ruleMerge.merged;
        }
      } else {
        // Only revision changed; adopt its rules wholesale.
        result.rules = revRules;
      }
    }
  }

  // environmentsEnabled (per-env boolean)
  if (revision.environmentsEnabled) {
    for (const env of Object.keys(revision.environmentsEnabled)) {
      const revVal = revision.environmentsEnabled[env];
      const baseVal = base.environmentsEnabled?.[env];
      const liveVal = live.environmentsEnabled?.[env];
      if (revVal === baseVal || revVal === liveVal) continue;

      if (liveVal !== baseVal && !isEqual(liveVal, revVal)) {
        const conflictInfo: MergeConflict = {
          name: `Env Enabled - ${env}`,
          key: `environmentsEnabled.${env}`,
          base: JSON.stringify(baseVal),
          live: JSON.stringify(liveVal),
          revision: JSON.stringify(revVal),
          resolved: false,
        };
        const strategy = strategies[conflictInfo.key];
        if (strategy === "overwrite") {
          conflictInfo.resolved = true;
          result.environmentsEnabled = result.environmentsEnabled || {};
          result.environmentsEnabled[env] = revVal;
        } else if (strategy === "discard") {
          conflictInfo.resolved = true;
        }
        conflicts.push(conflictInfo);
      } else {
        result.environmentsEnabled = result.environmentsEnabled || {};
        result.environmentsEnabled[env] = revVal;
      }
    }
  }

  // prerequisites (flat array)
  if (revision.prerequisites !== undefined) {
    const revVal = revision.prerequisites;
    const baseVal = base.prerequisites || [];
    const liveVal = live.prerequisites || [];
    if (!isEqual(revVal, baseVal) && !isEqual(revVal, liveVal)) {
      if (!isEqual(liveVal, baseVal) && !isEqual(liveVal, revVal)) {
        const conflictInfo: MergeConflict = {
          name: "Prerequisites",
          key: "prerequisites",
          base: JSON.stringify(baseVal, null, 2),
          live: JSON.stringify(liveVal, null, 2),
          revision: JSON.stringify(revVal, null, 2),
          resolved: false,
        };
        const strategy = strategies["prerequisites"];
        if (strategy === "overwrite") {
          conflictInfo.resolved = true;
          result.prerequisites = revVal;
        } else if (strategy === "discard") {
          conflictInfo.resolved = true;
        }
        conflicts.push(conflictInfo);
      } else {
        result.prerequisites = revVal;
      }
    }
  }

  // archived (simple boolean, same conflict pattern as environmentsEnabled)
  if (revision.archived !== undefined) {
    const revVal = revision.archived;
    const baseVal = base.archived;
    const liveVal = live.archived;
    if (revVal !== baseVal && revVal !== liveVal) {
      if (liveVal !== baseVal && liveVal !== revVal) {
        const conflictInfo: MergeConflict = {
          name: "Archived",
          key: "archived",
          base: JSON.stringify(baseVal),
          live: JSON.stringify(liveVal),
          revision: JSON.stringify(revVal),
          resolved: false,
        };
        const strategy = strategies["archived"];
        if (strategy === "overwrite") {
          conflictInfo.resolved = true;
          result.archived = revVal;
        } else if (strategy === "discard") {
          conflictInfo.resolved = true;
        }
        conflicts.push(conflictInfo);
      } else {
        result.archived = revVal;
      }
    }
  }

  // holdout (nullable object, same conflict pattern as archived)
  if ("holdout" in revision) {
    const revVal = revision.holdout;
    const baseVal = base.holdout ?? null;
    const liveVal = live.holdout ?? null;
    if (!isEqual(revVal, baseVal) && !isEqual(revVal, liveVal)) {
      if (!isEqual(liveVal, baseVal) && !isEqual(liveVal, revVal)) {
        const conflictInfo: MergeConflict = {
          name: "Holdout",
          key: "holdout",
          base: JSON.stringify(baseVal),
          live: JSON.stringify(liveVal),
          revision: JSON.stringify(revVal),
          resolved: false,
        };
        const strategy = strategies["holdout"];
        if (strategy === "overwrite") {
          conflictInfo.resolved = true;
          result.holdout = revVal;
        } else if (strategy === "discard") {
          conflictInfo.resolved = true;
        }
        conflicts.push(conflictInfo);
      } else {
        result.holdout = revVal;
      }
    }
  }

  // metadata (per-field)
  if (revision.metadata) {
    const metadataResult: RevisionMetadata = {};
    let hasMetadataChanges = false;
    for (const k of Object.keys(
      revision.metadata,
    ) as (keyof RevisionMetadata)[]) {
      const revVal = revision.metadata[k];
      const baseVal = base.metadata?.[k];
      const liveVal = live.metadata?.[k];
      const revNorm = normalizeMetadataValue(k, revVal);
      const baseNorm = normalizeMetadataValue(k, baseVal);
      const liveNorm = normalizeMetadataValue(k, liveVal);
      if (isEqual(revNorm, baseNorm) || isEqual(revNorm, liveNorm)) continue;

      if (!isEqual(liveNorm, baseNorm) && !isEqual(liveNorm, revNorm)) {
        const conflictInfo: MergeConflict = {
          name: `Metadata - ${k}`,
          key: `metadata.${k}`,
          base: JSON.stringify(baseVal),
          live: JSON.stringify(liveVal),
          revision: JSON.stringify(revVal),
          resolved: false,
        };
        const strategy = strategies[conflictInfo.key];
        if (strategy === "overwrite") {
          conflictInfo.resolved = true;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (metadataResult as any)[k] = revVal;
          hasMetadataChanges = true;
        } else if (strategy === "discard") {
          conflictInfo.resolved = true;
        }
        conflicts.push(conflictInfo);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (metadataResult as any)[k] = revVal;
        hasMetadataChanges = true;
      }
    }
    if (hasMetadataChanges) result.metadata = metadataResult;
  }

  if (conflicts.some((c) => !c.resolved)) {
    return { success: false, conflicts };
  }

  return { success: true, conflicts, result };
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
    const errMsg = e instanceof Error ? e.message : String(e);
    // Try parsing with dJSON and see if it can be fixed automatically
    try {
      const fixed = dJSON.parse(condition);
      return {
        success: false,
        empty: false,
        suggestedValue: JSON.stringify(fixed),
        error: errMsg,
      };
    } catch {
      return { success: false, empty: false, error: errMsg };
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

// MongoDB-style logical operators whose values wrap nested sub-conditions
// rather than attribute keys. $and/$or/$nor take arrays; $not takes a single
// object (or inline operators).
const LOGICAL_CONDITION_OPS = new Set(["$and", "$or", "$nor", "$not"]);

// Walks a parsed targeting condition and returns the set of attribute field
// names referenced at the root (e.g. "userId" in { userId: { $eq: "x" } }).
// - Skips any $-prefixed operator keys (values are either nested conditions
//   or literal comparators, never attribute names).
// - Recurses into $and/$or/$nor/$not so nested targeting still surfaces its
//   attribute keys.
// - Dot-notation keys (e.g. "user.id") are reported as the full key; callers
//   that check against attributeSchema should compare against the root segment.
export function extractConditionAttributeKeys(condition: unknown): string[] {
  const found = new Set<string>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (LOGICAL_CONDITION_OPS.has(key)) {
        walk(value);
        continue;
      }
      if (key.startsWith("$")) {
        // Non-logical operators ($eq, $in, $elemMatch, $inGroup, ...) — their
        // values are comparison operands / nested conditions, not attribute keys.
        continue;
      }
      found.add(key);
    }
  };

  walk(condition);
  return Array.from(found);
}

// Canonical shape for the opt-in attribute registration check. The org
// setting is stored as either a legacy boolean (older orgs) or this object
// (new orgs / orgs that have toggled the new project-scoping switch). All
// readers should funnel through `getRequireRegisteredAttributesSettings`
// rather than poking at the raw setting so they handle both shapes.
export type RequireRegisteredAttributesSettings = {
  // Master switch — when false, all checks are skipped.
  isOn: boolean;
  // When true, attributes that exist but aren't scoped to the current
  // project are also rejected. When false, project-scope mismatches are
  // ignored and only truly-unknown attribute keys fail.
  requireProjectScoping: boolean;
};

// Normalizes the raw org setting into `{ isOn, requireProjectScoping }`.
// Legacy boolean `true` maps to `{ isOn: true, requireProjectScoping: true }`
// to preserve the strict behavior orgs were already getting before the
// project-scoping toggle existed. `false` / undefined / null map to off.
export function getRequireRegisteredAttributesSettings(
  raw: boolean | RequireRegisteredAttributesSettings | undefined | null,
): RequireRegisteredAttributesSettings {
  if (!raw) return { isOn: false, requireProjectScoping: false };
  if (typeof raw === "boolean") {
    return { isOn: true, requireProjectScoping: true };
  }
  return {
    isOn: !!raw.isOn,
    // Default to `true` when the object is missing the field — keeps strict
    // behavior the default for newly-created objects too.
    requireProjectScoping: raw.requireProjectScoping !== false,
  };
}

// Splits `keys` into two buckets so callers can write a precise error:
//   - `unknown`: not declared in the schema at all (or archived) — typical typo.
//   - `outOfProject`: declared and active, but scoped to a different project
//     than the rule/experiment lives in. Catches the "attribute exists but
//     this project isn't on its scope list" case, which the user otherwise
//     reads as "Unknown attribute" and tries to re-create.
// Dot-notation keys are checked against their root segment, matching how
// attribute schema is declared.
export function categorizeUnregisteredAttributes(
  keys: string[],
  attributeSchema: SDKAttributeSchema | undefined,
  project?: string | string[],
): { unknown: string[]; outOfProject: string[] } {
  const projects = Array.isArray(project) ? project : project ? [project] : [];
  // root segment -> projects[] declared on the (active) attribute. Missing
  // entries mean the attribute isn't declared (or is archived).
  const declared = new Map<string, string[] | undefined>();
  for (const attr of attributeSchema ?? []) {
    if (attr.archived) continue;
    declared.set(attr.property, attr.projects);
  }

  const unknown: string[] = [];
  const outOfProject: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const root = key.split(".")[0];
    if (!declared.has(root)) {
      unknown.push(key);
      continue;
    }
    const attrProjects = declared.get(root);
    // No project context, or the attribute is org-wide: registered.
    if (!projects.length || !attrProjects?.length) continue;
    if (!projects.some((p) => attrProjects.includes(p))) {
      outOfProject.push(key);
    }
  }
  return { unknown, outOfProject };
}

// Returns the subset of `keys` that are NOT declared as active attributes in
// `attributeSchema`, including those scoped to other projects. Equivalent to
// `unknown ∪ outOfProject` from `categorizeUnregisteredAttributes`. Kept for
// backward compatibility; new callers that need a richer error should use
// `categorizeUnregisteredAttributes` directly.
export function findUnregisteredAttributes(
  keys: string[],
  attributeSchema: SDKAttributeSchema | undefined,
  project?: string | string[],
): string[] {
  const { unknown, outOfProject } = categorizeUnregisteredAttributes(
    keys,
    attributeSchema,
    project,
  );
  return [...unknown, ...outOfProject];
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
  if (revision && revision.rules !== undefined) {
    // v2: overlay the revision's top-level rules onto the feature. Per-env
    // filtering happens downstream via `getRulesForEnvironment`.
    newFeature.rules = naiveFlattenV1Rules(revision.rules);
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
    for (const eid of Object.keys(feature.environmentSettings || {})) {
      if (!envs?.includes(eid)) continue;
      // v2: project the flat top-level rules array to this env and inspect
      // each rule's `prerequisites[]`. Legacy test fixtures still carry v1
      // `environmentSettings[eid].rules` — fall back when v2 array is absent.
      const v2RulesForEnv = getRulesForEnvironment(feature.rules, eid);
      const legacyRulesForEnv = Array.isArray(feature.rules)
        ? []
        : ((
            feature.environmentSettings?.[eid] as unknown as {
              rules?: FeatureRule[];
            }
          )?.rules ?? []);
      const rulesForEnv = v2RulesForEnv.length
        ? v2RulesForEnv
        : legacyRulesForEnv;
      for (const rule of rulesForEnv) {
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
      // v2: project the flat top-level rules array to this env. Legacy test
      // fixtures still carry v1 `environmentSettings[env].rules`; fall back
      // to that shape when the v2 array is absent. Production readers JIT
      // upgrade at the model boundary so this fallback is test-only.
      const v2RulesForEnv = getRulesForEnvironment(feature.rules, env);
      const legacyRulesForEnv = Array.isArray(feature.rules)
        ? []
        : ((
            feature.environmentSettings[env] as unknown as {
              rules?: FeatureRule[];
            }
          ).rules ?? []);
      const rulesForEnv = v2RulesForEnv.length
        ? v2RulesForEnv
        : legacyRulesForEnv;
      if (rulesForEnv.some((r) => !!r.enabled)) {
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

/** Maps each feature ID to the set of features that depend on it as a prerequisite. */
export type ReverseDependencyIndex = Map<string, Set<string>>;

export function buildReverseDependencyIndex(
  features: FeatureInterface[],
): ReverseDependencyIndex {
  const index: ReverseDependencyIndex = new Map();

  for (const f of features) {
    for (const p of f.prerequisites || []) {
      let set = index.get(p.id);
      if (!set) {
        set = new Set();
        index.set(p.id, set);
      }
      set.add(f.id);
    }
    for (const rule of f.rules ?? []) {
      if (!rule?.enabled || !rule.prerequisites?.length) continue;
      for (const p of rule.prerequisites) {
        let set = index.get(p.id);
        if (!set) {
          set = new Set();
          index.set(p.id, set);
        }
        set.add(f.id);
      }
    }
  }

  return index;
}

export function getDependentFeatures(
  feature: FeatureInterface,
  features: FeatureInterface[],
  environments: string[],
  reverseDependencyIndex?: ReverseDependencyIndex,
  featuresMap?: Map<string, FeatureInterface>,
): string[] {
  const isDependent = (f: FeatureInterface) => {
    if ((f.prerequisites || []).some((p) => p.id === feature.id)) return true;
    return (
      getMatchingRules(
        f,
        (r) =>
          !!r.enabled &&
          (r.prerequisites || []).some((p) => p.id === feature.id),
        environments,
      ).length > 0
    );
  };

  if (reverseDependencyIndex) {
    const candidates = reverseDependencyIndex.get(feature.id);
    if (!candidates || candidates.size === 0) return [];
    const lookup = featuresMap ?? new Map(features.map((f) => [f.id, f]));
    return [...candidates].filter((id) => {
      const f = lookup.get(id);
      return f && isDependent(f);
    });
  }

  return features.filter(isDependent).map((f) => f.id);
}

export type ExperimentDependencyIndex = Map<
  string,
  ExperimentInterfaceStringDates[]
>;

export function buildExperimentDependencyIndex(
  experiments: ExperimentInterfaceStringDates[],
): ExperimentDependencyIndex {
  const index: ExperimentDependencyIndex = new Map();
  for (const e of experiments) {
    const phase = e.phases.slice(-1)?.[0] ?? null;
    const seen = new Set<string>();
    for (const p of phase?.prerequisites ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      let arr = index.get(p.id);
      if (!arr) {
        arr = [];
        index.set(p.id, arr);
      }
      arr.push(e);
    }
  }
  return index;
}

export function getDependentExperiments(
  feature: FeatureInterface,
  experiments: ExperimentInterfaceStringDates[],
  experimentDependencyIndex?: ExperimentDependencyIndex,
): ExperimentInterfaceStringDates[] {
  if (experimentDependencyIndex) {
    // Copy so callers can't mutate the array stored in the index; also keeps
    // this path's aliasing contract identical to the `.filter()` scan below.
    return experimentDependencyIndex.get(feature.id)?.slice() ?? [];
  }
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
// Resolve strict/loose review governance for a single targeting project.
// Most-specific-wins: a rule naming the project beats an all-projects rule.
// No matching rule (or no rules configured) defaults to strict.
export function getTargetingReviewMode(
  rules: TargetingReviewRule[] | undefined,
  projectId: string,
): "strict" | "loose" {
  if (!rules?.length) return "strict";
  const specific = rules.find((r) => r.projects.includes(projectId));
  if (specific) return specific.mode;
  const all = rules.find((r) => r.projects.length === 0);
  return all ? all.mode : "strict";
}

// Projects whose `requireReviews` rules govern a change to a targeting-scoped
// entity: the primary (always) plus any targeting project in strict mode. Pass
// the union of current + staged targeting projects so de-scoping is governed too.
export function getGoverningReviewProjects(
  primary: string | undefined,
  targetingProjects: string[],
  targetingReviewMode: TargetingReviewRule[] | undefined,
): string[] {
  const strict = targetingProjects.filter(
    (p) => getTargetingReviewMode(targetingReviewMode, p) === "strict",
  );
  return Array.from(new Set([primary ?? "", ...strict]));
}

export function getReviewSetting(
  requireReviewSettings: RequireReview[],
  // Any project-scoped entity (features, and constants which mirror the feature
  // `project` field) — matched by its single project.
  entity: { project?: string },
): RequireReview | undefined {
  // check projects
  for (const reviewSetting of requireReviewSettings) {
    // match first value found empty means all projects
    if (
      (entity?.project && reviewSetting.projects.includes(entity?.project)) ||
      reviewSetting.projects.length === 0
    ) {
      return reviewSetting;
    }
  }
}

// `entity` is any project-scoped entity (a feature, or a constant which mirrors
// the feature `project` field) — matched by its single project via
// `getReviewSetting`. Constants reuse this via `constantAutopublishOnApproval`.
export function getFeatureAutopublishOnApproval(
  requireReviews: boolean | RequireReview[] | undefined,
  entity: { project?: string },
): boolean {
  if (!Array.isArray(requireReviews)) return false;
  return !!getReviewSetting(requireReviews, entity)?.autopublishOnApproval;
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
  // OR the primary's review requirement with each strict targeting project's.
  return getGoverningReviewProjects(
    feature.project,
    feature.targetingProjects ?? [],
    settings?.targetingReviewMode,
  ).some((project) => {
    const reviewSetting = getReviewSetting(requiresReviewSettings, { project });
    if (!reviewSetting?.requireReviewOn) return false;
    if (defaultValueChanged) return true;
    return checkEnvironmentsMatch(changedEnvironments, reviewSetting);
  });
}

// Constants are a drop-in for feature config and borrow the exact same
// `requireReviews` org settings. The generic `value` affects every environment,
// so a value change is the least-permissive case (always requires review, like
// a feature's defaultValue); per-environment overrides only require review when
// the changed environment is in the matched rule's scope. A pure-metadata edit
// follows the rule's `featureRequireMetadataReview` toggle.
export function constantRequiresReview(
  constant: { project?: string },
  {
    valueChanged,
    changedEnvironments,
    metadataOnly,
  }: {
    valueChanged: boolean;
    changedEnvironments: string[];
    metadataOnly: boolean;
  },
  settings?: OrganizationSettings,
): boolean {
  const requiresReviewSettings = settings?.requireReviews;
  if (
    requiresReviewSettings === undefined ||
    requiresReviewSettings === true ||
    requiresReviewSettings === false
  ) {
    return !!requiresReviewSettings;
  }
  const reviewSetting = getReviewSetting(requiresReviewSettings, constant);
  if (!reviewSetting || !reviewSetting.requireReviewOn) {
    return false;
  }
  // value affects all environments → always requires review
  if (valueChanged) {
    return true;
  }
  // an in-scope environment override changed
  if (
    changedEnvironments.length > 0 &&
    checkEnvironmentsMatch(changedEnvironments, reviewSetting)
  ) {
    return true;
  }
  // only metadata changed → governed by the metadata-review toggle
  if (metadataOnly) {
    return reviewSetting.featureRequireMetadataReview ?? true;
  }
  return false;
}

// Constant analogue of `resetReviewOnChange` + `getFeatureAutopublishOnApproval`
// — constants borrow the feature `requireReviews` model rather than the
// saved-group `approvalFlows` config, so they need their own accessors keyed off
// the matched review rule's project scope.

// Whether an approved constant revision should reset to pending-review when its
// proposed changes are subsequently modified. A `value` change affects every
// environment (always in scope); a per-environment override only counts when the
// changed environment is within the matched rule's scope.
export function constantResetReviewOnChange(
  constant: { project?: string },
  {
    valueChanged,
    changedEnvironments,
  }: { valueChanged: boolean; changedEnvironments: string[] },
  settings?: OrganizationSettings,
): boolean {
  const requiresReviewSettings = settings?.requireReviews;
  if (
    requiresReviewSettings === undefined ||
    typeof requiresReviewSettings === "boolean"
  ) {
    return false;
  }
  const reviewSetting = getReviewSetting(requiresReviewSettings, constant);
  if (
    !reviewSetting ||
    !reviewSetting.requireReviewOn ||
    !reviewSetting.resetReviewOnChange
  ) {
    return false;
  }
  if (valueChanged) {
    return true;
  }
  return (
    changedEnvironments.length > 0 &&
    checkEnvironmentsMatch(changedEnvironments, reviewSetting)
  );
}

// Configs borrow the same `requireReviews` model as features/constants, with one
// wrinkle: an env/project override "flavor" applies only to its scoped
// environments, so a flavor's value change should require review only when one of
// those environments is in the matched rule's scope — not unconditionally the way
// a base config's value change (which applies to every environment, like a
// feature's defaultValue) does. `flavorEnvironments` is the flavor's environment
// scope (`scopedConfig.environments`) or null for a base config; an empty array is
// a catch-all flavor and is treated as all-environments. These re-express a
// flavor's value change as an environment change and defer to the constant
// helpers (the single source of truth for the rule matching).
function toEnvScopedChange(
  change: {
    valueChanged: boolean;
    changedEnvironments: string[];
    metadataOnly: boolean;
  },
  flavorEnvironments: string[] | null,
): {
  valueChanged: boolean;
  changedEnvironments: string[];
  metadataOnly: boolean;
} {
  if (
    flavorEnvironments !== null &&
    change.valueChanged &&
    flavorEnvironments.length > 0
  ) {
    return {
      valueChanged: false,
      changedEnvironments: flavorEnvironments,
      metadataOnly: change.metadataOnly,
    };
  }
  return change;
}

export function configRequiresReview(
  config: { project?: string },
  change: {
    valueChanged: boolean;
    changedEnvironments: string[];
    metadataOnly: boolean;
  },
  flavorEnvironments: string[] | null,
  settings?: OrganizationSettings,
): boolean {
  return constantRequiresReview(
    config,
    toEnvScopedChange(change, flavorEnvironments),
    settings,
  );
}

export function configResetReviewOnChange(
  config: { project?: string },
  change: { valueChanged: boolean; changedEnvironments: string[] },
  flavorEnvironments: string[] | null,
  settings?: OrganizationSettings,
): boolean {
  const scoped = toEnvScopedChange(
    { ...change, metadataOnly: false },
    flavorEnvironments,
  );
  return constantResetReviewOnChange(
    config,
    {
      valueChanged: scoped.valueChanged,
      changedEnvironments: scoped.changedEnvironments,
    },
    settings,
  );
}

// Whether auto-publish-on-approval may be armed for a constant, per the matched
// review rule. Constants share the feature `requireReviews` model, so this is a
// thin wrapper over `getFeatureAutopublishOnApproval` (single source of truth).
export function constantAutopublishOnApproval(
  constant: { project?: string },
  settings?: OrganizationSettings,
): boolean {
  return getFeatureAutopublishOnApproval(settings?.requireReviews, constant);
}

// Whether self-approval is blocked for a constant per its matched `requireReviews`
// rule. Prefer the shared `isUserBlockedFromApproving`, which routes constants
// here automatically; this is its constant-specific implementation.
export function constantBlockSelfApproval(
  constant: { project?: string },
  settings?: OrganizationSettings,
): boolean {
  const requireReviews = settings?.requireReviews;
  if (!Array.isArray(requireReviews)) return false;
  return !!getReviewSetting(requireReviews, constant)?.blockSelfApproval;
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

// Returns which environments a revision affects relative to its base revision.
// Per-env changes (rules, environmentsEnabled) return specific env IDs.
// Global changes (prerequisites, archived, holdout, defaultValue, metadata) return "all".
// Used for both UI display and approval-gate determination.
// Strip UI-only metadata fields from a rule before diffing for review/affected-env
// purposes. These fields never affect SDK behaviour so they must not trigger a
// review requirement or show as "changed" environments.
function normalizeRuleForDiff(
  rule: FeatureRule,
): Omit<FeatureRule, "scheduleType"> {
  const { scheduleType: _scheduleType, ...rest } = rule as FeatureRule & {
    scheduleType?: unknown;
  };
  return rest as Omit<FeatureRule, "scheduleType">;
}

/**
 * Returns the union of all environments explicitly targeted by a ramp
 * schedule's patch actions (startActions, steps, endActions).  Returns "all"
 * if any patch sets `allEnvironments: true`.
 */
export function getEnvsFromRampSchedule(
  schedule: Pick<
    RampScheduleInterface,
    "startActions" | "steps" | "endActions"
  >,
): string[] | "all" {
  const envs = new Set<string>();
  const allPatches = [
    ...(schedule.startActions ?? []).map((a) => a.patch),
    ...schedule.steps.flatMap((s) => s.actions.map((a) => a.patch)),
    ...(schedule.endActions ?? []).map((a) => a.patch),
  ];
  for (const patch of allPatches) {
    if (patch.allEnvironments) return "all";
    for (const env of patch.environments ?? []) {
      envs.add(env);
    }
  }
  return [...envs];
}

export function getDraftAffectedEnvironments(
  revision: RevisionFields,
  baseRevision: RevisionFields,
  allEnvironments: string[],
  liveRampScheduleEnvs?: Map<string, string[] | "all">,
): string[] | "all" {
  if (revisionHasGlobalChange(revision, baseRevision)) return "all";

  // Per-environment changes. v2 `rules` is a flat array, so derive the per-env
  // projection via `getRulesForEnvironment`. This preserves the env-granular
  // "affected envs" semantic used by the review-gating UI: a rule with
  // `allEnvironments: true` counts as touching every allowed env; a v2 rule
  // with `environments: ["prod"]` counts only as touching prod.
  const revRulesAll = naiveFlattenV1Rules(revision.rules);
  const baseRulesAll = naiveFlattenV1Rules(baseRevision.rules);
  const envs = new Set<string>();
  for (const env of allEnvironments) {
    const revRules = getRulesForEnvironment(revRulesAll, env).map(
      normalizeRuleForDiff,
    );
    const baseRules = getRulesForEnvironment(baseRulesAll, env).map(
      normalizeRuleForDiff,
    );
    if (!isEqual(revRules, baseRules)) {
      envs.add(env);
    }
    // Base revisions that predate an environment have no key for it at all;
    // treat missing as false so a freshly-snapshotted `false` on the draft side
    // doesn't register as a kill-switch change.
    const effectiveBaseEnvVal =
      baseRevision.environmentsEnabled?.[env] ?? false;
    if (
      revision.environmentsEnabled?.[env] !== undefined &&
      revision.environmentsEnabled[env] !== effectiveBaseEnvVal
    ) {
      envs.add(env);
    }
  }
  // rampActions target a specific rule by ruleId; the environments that rule
  // is active in are affected by the ramp. Step patches can also widen the
  // scope if they explicitly set `environments` or `allEnvironments`.
  if ((revision.rampActions ?? []).length > 0) {
    for (const action of revision.rampActions!) {
      // Look up the rule in the draft rules first, then the base rules (e.g.
      // for a detach where the rule may already have been removed from draft).
      const rule =
        revRulesAll.find(
          (r) => stemRuleId(r.id ?? "") === stemRuleId(action.ruleId),
        ) ??
        baseRulesAll.find(
          (r) => stemRuleId(r.id ?? "") === stemRuleId(action.ruleId),
        );
      if (rule?.allEnvironments) return "all";
      for (const env of rule?.environments ?? []) {
        if (allEnvironments.includes(env)) envs.add(env);
      }
      if (action.mode !== "detach") {
        // For update actions, also include environments from the CURRENT live
        // schedule so that removing an env from the new steps is still detected.
        if (action.mode === "update" && liveRampScheduleEnvs) {
          const liveEnvs = liveRampScheduleEnvs.get(action.rampScheduleId);
          if (liveEnvs === "all") return "all";
          for (const env of liveEnvs ?? []) {
            if (allEnvironments.includes(env)) envs.add(env);
          }
        }
        const allPatches = [
          ...(action.startActions ?? []).map((a) => a.patch),
          ...action.steps.flatMap((s) => s.actions.map((a) => a.patch)),
          ...(action.endActions ?? []).map((a) => a.patch),
        ];
        for (const patch of allPatches) {
          if (patch.allEnvironments) return "all";
          for (const env of patch.environments ?? []) {
            if (allEnvironments.includes(env)) envs.add(env);
          }
        }
      }
    }
  }

  // Collapse to "all" when every environment is affected
  if (allEnvironments.length > 0 && envs.size === allEnvironments.length) {
    return "all";
  }
  return [...envs];
}

/** Draft experiments whose rules would go live when this revision is published. */
export function getNewDraftExperimentsToPublish({
  environments,
  feature,
  revision,
  experimentsMap,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  environments: Environment[];
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
}): ExperimentInterfaceStringDates[] {
  const environmentIds = environments.map((e) => e.id);

  const liveExperimentIds = new Set(
    getMatchingRules(
      feature,
      (rule) => rule.type === "experiment-ref",
      environmentIds,
    ).map((result) => (result.rule as ExperimentRefRule).experimentId),
  );

  function isExp(
    exp: ExperimentInterfaceStringDates | undefined,
  ): exp is ExperimentInterfaceStringDates {
    return !!exp;
  }

  const draftExperiments = getMatchingRules(
    feature,
    (rule) => {
      if (rule.enabled === false) return false;
      if (rule.type !== "experiment-ref") return false;

      const exp = experimentsMap.get(rule.experimentId);
      if (!exp) return false;

      if (liveExperimentIds.has(rule.experimentId)) return false;
      if (exp.status !== "draft") return false;
      if (exp.archived) return false;
      if (exp.hasVisualChangesets) return false;

      return true;
    },
    environmentIds,
    revision,
  )
    .map((result) =>
      experimentsMap.get((result.rule as ExperimentRefRule).experimentId),
    )
    .filter(isExp);

  return [...new Set(draftExperiments)];
}

export function checkIfRevisionNeedsReview({
  feature,
  baseRevision,
  revision,
  allEnvironments,
  settings,
  requireApprovalsLicensed = true,
  liveRampScheduleEnvs,
}: {
  feature: FeatureInterface;
  baseRevision: FeatureRevisionInterface;
  revision: FeatureRevisionInterface;
  allEnvironments: string[];
  settings?: OrganizationSettings;
  requireApprovalsLicensed?: boolean;
  liveRampScheduleEnvs?: Map<string, string[] | "all">;
}) {
  if (!requireApprovalsLicensed) return false;
  const requireReviews = settings?.requireReviews;
  // Boolean format: true = all changes require review, false/undefined = none do.
  if (!Array.isArray(requireReviews)) return !!requireReviews;

  // Governing review settings = the primary project (always) plus any secondary
  // targeting project in strict mode, across the union of current and staged
  // targeting (so both adding and removing a project is governed). Each project's
  // matched requireReviews rule is evaluated independently and OR'd together.
  const stagedTargeting =
    revision.metadata?.targetingProjects ?? feature.targetingProjects ?? [];
  const targetingUnion = Array.from(
    new Set([...(feature.targetingProjects ?? []), ...stagedTargeting]),
  );
  const reviewSettings = getGoverningReviewProjects(
    feature.project,
    targetingUnion,
    settings?.targetingReviewMode,
  )
    .map((project) => getReviewSetting(requireReviews, { project }))
    .filter((rs): rs is RequireReview => !!rs?.requireReviewOn);
  if (!reviewSettings.length) return false;

  const affected = getDraftAffectedEnvironments(
    revision,
    baseRevision,
    allEnvironments,
    liveRampScheduleEnvs,
  );

  // Change classification is independent of which review rule is evaluated, so
  // compute it once and reuse across every governing setting.
  const metadataOnlyGlobal =
    affected === "all"
      ? revisionHasMetadataOnlyGlobalChange(revision, baseRevision)
      : false;
  let envsWithRuleChanges: string[] = [];
  let envKillSwitchChanges: string[] = [];
  if (affected !== "all") {
    // Env-specific changes split into rules/values vs kill switches.
    // Rules/values always require approval; kill switches only when
    // `featureRequireEnvironmentReview` is true (default when unset).
    // Project rules per-env to account for `allEnvironments`/`environments` scopes.
    const revRulesAll = naiveFlattenV1Rules(revision.rules);
    const baseRulesAll = naiveFlattenV1Rules(baseRevision.rules);
    envsWithRuleChanges = affected.filter((env) => {
      const revRules = getRulesForEnvironment(revRulesAll, env).map(
        normalizeRuleForDiff,
      );
      const baseRules = getRulesForEnvironment(baseRulesAll, env).map(
        normalizeRuleForDiff,
      );
      return !isEqual(revRules, baseRules);
    });
    envKillSwitchChanges = affected.filter(
      (env) =>
        revision.environmentsEnabled?.[env] !== undefined &&
        revision.environmentsEnabled[env] !==
          (baseRevision.environmentsEnabled?.[env] ?? false),
    );
  }

  const needsReviewForSetting = (reviewSetting: RequireReview): boolean => {
    if (affected === "all") {
      // Metadata-only changes respect the featureRequireMetadataReview gate; all
      // other global changes (prerequisites, archived, holdout, defaultValue)
      // always require review.
      if (!metadataOnlyGlobal) return true;
      return reviewSetting.featureRequireMetadataReview !== false;
    }
    if (affected.length === 0) return false;

    const gatedEnvs = reviewSetting.environments;

    // Rules/values always gate
    if (envsWithRuleChanges.length > 0) {
      if (gatedEnvs.length === 0) return true;
      if (envsWithRuleChanges.some((env) => gatedEnvs.includes(env)))
        return true;
    }

    // Kill switch changes only gate when featureRequireEnvironmentReview is enabled
    if (
      envKillSwitchChanges.length > 0 &&
      reviewSetting.featureRequireEnvironmentReview !== false
    ) {
      if (gatedEnvs.length === 0) return true;
      if (envKillSwitchChanges.some((env) => gatedEnvs.includes(env)))
        return true;
    }

    // Ramp actions (create/update/detach) change how the feature is rolled out
    // across environments. They are treated like rule changes and always require
    // approval when any of the targeted environments are gated.
    if ((revision.rampActions ?? []).length > 0) {
      const rampEnvs = affected.filter(
        (env) =>
          !envsWithRuleChanges.includes(env) &&
          !envKillSwitchChanges.includes(env),
      );
      if (rampEnvs.length > 0) {
        if (gatedEnvs.length === 0) return true;
        if (rampEnvs.some((env) => gatedEnvs.includes(env))) return true;
      }
    }

    return false;
  };

  return reviewSettings.some(needsReviewForSetting);
}

// Any entity that pairs a single governance `project` with a secondary
// targeting scope (features, constants, configs).
export type TargetingScopedEntity = {
  project?: string;
  targetingAllProjects?: boolean;
  targetingProjects?: string[];
};

// The set of project ids an entity targets — the governance project plus
// its secondary targeting projects, deduped. Returns null when targeted in ALL
// projects (targetingAllProjects), matching the empty-array "all" convention.
export function getTargetingProjectIds(
  entity: TargetingScopedEntity,
): string[] | null {
  if (entity.targetingAllProjects) return null;
  return Array.from(
    new Set([entity.project ?? "", ...(entity.targetingProjects ?? [])]),
  );
}

export function entityTargetsProject(
  entity: TargetingScopedEntity,
  projectId: string,
): boolean {
  if (entity.targetingAllProjects) return true;
  if ((entity.project ?? "") === projectId) return true;
  return (entity.targetingProjects ?? []).includes(projectId);
}

// Write-time normalization: drop blanks, dupes, and the governance project from
// the targeting list, and clear the list entirely when targeted in all projects.
export function normalizeTargetingProjects(entity: TargetingScopedEntity): {
  targetingAllProjects: boolean;
  targetingProjects: string[];
} {
  if (entity.targetingAllProjects) {
    return { targetingAllProjects: true, targetingProjects: [] };
  }
  const primary = entity.project ?? "";
  const targetingProjects = Array.from(
    new Set((entity.targetingProjects ?? []).filter((p) => p && p !== primary)),
  );
  return { targetingAllProjects: false, targetingProjects };
}

// Normalize any targeting fields present in a partial feature update, in place.
// Resolves against the update's project when it's changing, else the current
// entity's, so the primary is correctly stripped from the targeting list.
export function normalizeTargetingInUpdates(
  updates: TargetingScopedEntity,
  current: TargetingScopedEntity,
): void {
  const hasAll = "targetingAllProjects" in updates;
  const hasList = "targetingProjects" in updates;
  if (!hasAll && !hasList) return;
  const norm = normalizeTargetingProjects({
    project: "project" in updates ? updates.project : current.project,
    targetingAllProjects: hasAll
      ? updates.targetingAllProjects
      : current.targetingAllProjects,
    targetingProjects: hasList
      ? updates.targetingProjects
      : current.targetingProjects,
  });
  if (hasAll) updates.targetingAllProjects = norm.targetingAllProjects;
  if (hasList) updates.targetingProjects = norm.targetingProjects;
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
  // Targeting a feature into additional projects widens its allowed
  // environments to the union of every project it's delivered to (all
  // environments when delivered to all projects).
  if (feature.targetingAllProjects) return true;
  const featureProjects = [
    feature.project,
    ...(feature.targetingProjects ?? []),
  ].filter((p): p is string => !!p);
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

// Codify a single SimpleSchema field into its JSON Schema subschema (type +
// description + default + enum + min/max constraints + nullability). This is the
// per-field half of `simpleToJSONSchema`, exported so editors can faithfully
// seed a raw JSON Schema from simple-mode preferences. `nullable` is baked into
// the subschema here (widening the type to include `"null"`); `required` is a
// composition concern the parent object handles.
export function simpleSchemaFieldToJSONSchema(
  field: SchemaField,
): Record<string, unknown> {
  // A raw per-field schema (config-only) supersedes the simple type. Emit it
  // directly so object/array/nullable/advanced fields compile faithfully (the
  // simple-type path below can't represent them). Layer on the simple-mode
  // description/default only when the raw schema omits them.
  if (field.jsonSchema !== undefined) {
    try {
      const raw = JSON.parse(field.jsonSchema);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const merged = { ...(raw as Record<string, unknown>) };
        if (field.description && merged.description === undefined) {
          merged.description = field.description;
        }
        if (field.default && merged.default === undefined) {
          merged.default = field.default;
        }
        // A bare nullable preset (e.g. {"type":["object","null"]}) is reduced by
        // normalizeField to a raw schema + the `nullable` flag, so re-apply the
        // flag here — otherwise the compiled schema drops `null` and rejects a
        // legitimate null value (and every export re-emits it non-nullable).
        if (
          field.nullable &&
          typeof merged.type === "string" &&
          merged.type !== "null"
        ) {
          merged.type = [merged.type, "null"];
        }
        return merged;
      }
    } catch {
      // Malformed raw schema — fall back to the simple-type compilation.
    }
  }

  const getValue = (value: string): string | number | boolean => {
    const type = field.type;
    // Validation
    if (field.type !== "boolean") {
      if (field.enum.length > 0 && !field.enum.includes(value)) {
        throw new Error(`Value '${value}' not in enum for field ${field.key}`);
      }
      if (field.type === "string" && !field.enum.length) {
        if (field.min !== undefined && value.length < field.min) {
          throw new Error(
            `Value '${value}' is shorter than min length for field ${field.key}`,
          );
        }
        if (field.max !== undefined && value.length > field.max) {
          throw new Error(
            `Value '${value}' is longer than max length for field ${field.key}`,
          );
        }
      } else if (!field.enum.length) {
        if (field.min !== undefined && parseFloat(value) < field.min) {
          throw new Error(
            `Value '${value}' is less than min value for field ${field.key}`,
          );
        }
        if (field.max !== undefined && parseFloat(value) > field.max) {
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

  const baseType = ["float", "integer"].includes(field.type)
    ? "number"
    : field.type;
  const schema: Record<string, unknown> = {
    // A nullable field widens the type to a `T | null` union.
    type: field.nullable ? [baseType, "null"] : baseType,
  };

  if (field.description) schema.description = field.description;

  if (field.default) schema.default = getValue(field.default);

  if (field.type !== "boolean" && field.enum.length) {
    // A nullable enum must also admit null — the type union allows it, so the
    // enum has to list it too or null would fail validation.
    schema.enum = [
      ...field.enum.map((v) => getValue(v)),
      ...(field.nullable ? [null] : []),
    ];
  }
  // Integer markers apply with or without an enum — dropping them on an enum
  // field would re-import `{type:"number", enum:[1,2]}` as a float.
  if (field.type === "integer") {
    schema.multipleOf = 1;
    schema.format = "number";
  }
  if (!schema.enum) {
    // Bounds are optional — emit only when set.
    const { min, max } = field;
    if (field.type === "string") {
      if (min !== undefined) schema.minLength = min;
      if (max !== undefined) schema.maxLength = max;
      if (
        (min !== undefined && min < 0) ||
        (min !== undefined && max !== undefined && max < min)
      ) {
        throw new Error(`Invalid min or max for field ${field.key}`);
      }
    } else if (field.type === "float" || field.type === "integer") {
      if (min !== undefined) schema.minimum = min;
      if (max !== undefined) schema.maximum = max;

      if (min !== undefined && max !== undefined && max < min) {
        throw new Error(`Invalid min or max for field ${field.key}`);
      }
    }
  }
  return schema;
}

export function simpleToJSONSchema(simple: SimpleSchema): string {
  const fields = simple.fields.map((f) => ({
    key: f.key,
    required: f.required,
    schema: simpleSchemaFieldToJSONSchema(f),
  }));
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
        additionalProperties: simple.additionalProperties ?? false,
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
          additionalProperties: simple.additionalProperties ?? false,
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

export function getApiFeatureAllEnvs(feature: ApiFeature) {
  return Object.keys(feature.environments);
}
