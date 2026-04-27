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
} from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  OrganizationSettings,
  RequireReview,
  Environment,
} from "shared/types/organization";
import { ProjectInterface } from "shared/types/project";
import { GroupMap } from "shared/types/saved-group";
import { getValidDate } from "../dates";
import {
  conditionHasSavedGroupErrors,
  expandNestedSavedGroups,
} from "../sdk-versioning";
import { getMatchingRules, includeExperimentInPayload, recursiveWalk } from ".";

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
    if (m.tags !== undefined) newFeature.tags = m.tags;
    if (m.neverStale !== undefined) newFeature.neverStale = m.neverStale;
    if (m.customFields !== undefined)
      newFeature.customFields = m.customFields as Record<string, unknown>;
    if (m.jsonSchema !== undefined) newFeature.jsonSchema = m.jsonSchema;
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
  features?: FeatureInterface[];
  experiments?: ExperimentInterfaceStringDates[];
  dependentExperiments?: ExperimentInterfaceStringDates[];
  environments?: string[];
  featuresMap?: Map<string, FeatureInterface>;
  experimentMap?: Map<string, ExperimentInterfaceStringDates>;
  // Most recent dateUpdated among active drafts; null = no active drafts.
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

    const rules = (envSetting.rules ?? []).filter((r) => r.enabled);

    const hasDependentsInEnv =
      hasActiveDependentExperiment ||
      dependentFeatureIds.some((id) => {
        const f = dependentFeatures.get(id);
        if (!f) return false;
        // Global feature-level prerequisite
        if (f.prerequisites?.some((p) => p.id === feature.id)) return true;
        // Rule-level prerequisite in this specific environment
        return (f.environmentSettings?.[envId]?.rules ?? []).some(
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
  experiments = [],
  dependentExperiments,
  environments = [],
  featuresMap: prebuiltFeaturesMap,
  experimentMap: prebuiltExperimentMap,
  mostRecentDraftDate,
}: IsFeatureStaleInterface): IsFeatureStaleResult {
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

  const visit = (feature: FeatureInterface): IsFeatureStaleResult => {
    if (visitedFeatures.has(feature.id)) {
      return { stale: false, envResults: {} };
    }
    visitedFeatures.add(feature.id);

    try {
      // Compute dependents before buildEnvResults so per-env results can use them.
      const dependentFeatureIds =
        features && features.length > 1
          ? getDependentFeatures(feature, features, environments)
          : [];
      // Only non-stale dependents protect an env from being marked stale.
      const nonStaleDependentFeatureIds = dependentFeatureIds.filter((id) => {
        const f = featuresMap.get(id);
        return !f || !visit(f).stale;
      });
      dependentExperiments =
        dependentExperiments ?? getDependentExperiments(feature, experiments);

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
  rules?: Record<string, FeatureRule[]>;
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
  // Backfill valueType for old revisions that predate this field.
  metadata: (feature, current) =>
    current?.valueType != null
      ? current
      : { ...current, valueType: feature.valueType },
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
    rules: Object.fromEntries(
      Object.entries(feature.environmentSettings ?? {}).map(([env, val]) => [
        env,
        val.rules ?? [],
      ]),
    ),
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
  if (
    envIds.some(
      (env) =>
        JSON.stringify(draft.rules[env] ?? []) !==
        JSON.stringify(filledLive.rules[env] ?? []),
    )
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
  if (Object.keys(r.rules || {}).length > 0) return true;
  if (Object.keys(r.environmentsEnabled || {}).length > 0) return true;
  if (r.prerequisites !== undefined) return true;
  if (r.archived !== undefined) return true;
  if ("holdout" in r) return true;
  if (r.metadata !== undefined && Object.keys(r.metadata).length > 0)
    return true;
  return false;
}
// Normalize a metadata field value for comparison.
export function normalizeMetadataValue(
  k: keyof RevisionMetadata,
  v: RevisionMetadata[keyof RevisionMetadata],
): unknown {
  if (k === "tags") return (v as string[] | null | undefined) ?? [];
  if (k === "description" || k === "owner" || k === "project")
    return (v as string | null | undefined) ?? "";
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

// Try to merge two diverged rule arrays at the individual rule level (matched by id).
// Returns the merged array when each modified rule was only touched by one side,
// or null when the same rule was modified by both sides (a genuine conflict).
function tryRuleLevelMerge(
  base: FeatureRule[],
  live: FeatureRule[],
  revision: FeatureRule[],
): FeatureRule[] | null {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const liveById = new Map(live.map((r) => [r.id, r]));
  const revById = new Map(revision.map((r) => [r.id, r]));

  const allIds = new Set([
    ...base.map((r) => r.id),
    ...live.map((r) => r.id),
    ...revision.map((r) => r.id),
  ]);

  for (const id of allIds) {
    const liveChanged = !isEqual(liveById.get(id), baseById.get(id));
    const revChanged = !isEqual(revById.get(id), baseById.get(id));
    if (
      liveChanged &&
      revChanged &&
      !isEqual(liveById.get(id), revById.get(id))
    ) {
      return null;
    }
  }

  // No per-rule conflicts. Walk live ordering, applying revision-side changes.
  const merged: FeatureRule[] = [];
  const handledIds = new Set<string>();

  for (const liveRule of live) {
    handledIds.add(liveRule.id);
    const revRule = revById.get(liveRule.id);
    const revChanged =
      revRule !== undefined && !isEqual(revRule, baseById.get(liveRule.id));
    merged.push(revChanged ? revRule! : liveRule);
  }

  // Append rules added or modified by the revision that are not present in live.
  // Skip rules that were in base, unchanged in revision, but deleted from live —
  // those deletions happened server-side and should be respected.
  for (const revRule of revision) {
    if (!handledIds.has(revRule.id)) {
      const isNew = !baseById.has(revRule.id);
      const revChanged = !isEqual(revRule, baseById.get(revRule.id));
      if (isNew || revChanged) {
        merged.push(revRule);
      }
    }
  }

  return merged;
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

  // No divergence path: only include revision changes that differ from base
  if (!diverged) {
    if (revision.defaultValue !== base.defaultValue) {
      result.defaultValue = revision.defaultValue;
    }

    environments.forEach((env) => {
      const rules = revision.rules?.[env];
      if (!rules) return;
      if (isEqual(rules, base.rules[env] || [])) return;
      result.rules = result.rules || {};
      result.rules[env] = rules;
    });

    // environmentsEnabled
    if (revision.environmentsEnabled) {
      for (const env of Object.keys(revision.environmentsEnabled)) {
        const revVal = revision.environmentsEnabled[env];
        if (revVal !== base.environmentsEnabled?.[env]) {
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

  // rules (per-env)
  environments.forEach((env) => {
    const rules = revision.rules?.[env];
    if (!rules) return;
    if (
      isEqual(rules, base.rules[env] || []) ||
      isEqual(rules, live.rules[env] || [])
    ) {
      return;
    }

    result.rules = result.rules || {};

    if (
      env in live.rules &&
      !isEqual(live.rules[env] || [], base.rules[env] || []) &&
      !isEqual(live.rules[env] || [], rules)
    ) {
      // Both sides changed — try per-rule merge before raising a conflict.
      const autoMerged = tryRuleLevelMerge(
        base.rules[env] || [],
        live.rules[env] || [],
        rules,
      );
      if (autoMerged !== null) {
        result.rules[env] = autoMerged;
      } else {
        const conflictInfo: MergeConflict = {
          name: `Rules - ${env}`,
          key: `rules.${env}`,
          base: JSON.stringify(base.rules[env], null, 2),
          live: JSON.stringify(live.rules[env], null, 2),
          revision: JSON.stringify(rules, null, 2),
          resolved: false,
        };
        const strategy = strategies[conflictInfo.key];
        if (strategy === "overwrite") {
          conflictInfo.resolved = true;
          result.rules[env] = rules;
        } else if (strategy === "discard") {
          conflictInfo.resolved = true;
        }
        conflicts.push(conflictInfo);
      }
    } else {
      result.rules[env] = rules;
    }
  });

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

export function getDraftAffectedEnvironments(
  revision: RevisionFields,
  baseRevision: RevisionFields,
  allEnvironments: string[],
): string[] | "all" {
  if (revisionHasGlobalChange(revision, baseRevision)) return "all";

  // Per-environment changes
  const envs = new Set<string>();
  for (const env of allEnvironments) {
    const revRules = (revision.rules[env] || []).map(normalizeRuleForDiff);
    const baseRules = (baseRevision.rules[env] || []).map(normalizeRuleForDiff);
    if (!isEqual(revRules, baseRules)) {
      envs.add(env);
    }
    const effectiveBaseEnvVal = baseRevision.environmentsEnabled?.[env];
    if (
      revision.environmentsEnabled?.[env] !== undefined &&
      revision.environmentsEnabled[env] !== effectiveBaseEnvVal
    ) {
      envs.add(env);
    }
  }
  // Collapse to "all" when every environment is affected
  if (allEnvironments.length > 0 && envs.size === allEnvironments.length) {
    return "all";
  }
  return [...envs];
}

export function checkIfRevisionNeedsReview({
  feature,
  baseRevision,
  revision,
  allEnvironments,
  settings,
  requireApprovalsLicensed = true,
}: {
  feature: FeatureInterface;
  baseRevision: FeatureRevisionInterface;
  revision: FeatureRevisionInterface;
  allEnvironments: string[];
  settings?: OrganizationSettings;
  requireApprovalsLicensed?: boolean;
}) {
  if (!requireApprovalsLicensed) return false;
  const requireReviews = settings?.requireReviews;
  // Boolean format: true = all changes require review, false/undefined = none do.
  if (!Array.isArray(requireReviews)) return !!requireReviews;

  const reviewSetting = getReviewSetting(requireReviews, feature);
  if (!reviewSetting?.requireReviewOn) return false;

  const affected = getDraftAffectedEnvironments(
    revision,
    baseRevision,
    allEnvironments,
  );

  if (affected === "all") {
    // Metadata-only changes respect the featureRequireMetadataReview gate;
    // all other global changes (prerequisites, archived, holdout, defaultValue) always require review.
    if (!revisionHasMetadataOnlyGlobalChange(revision, baseRevision))
      return true;
    return reviewSetting.featureRequireMetadataReview !== false;
  }
  if (affected.length === 0) return false;

  // Environment-specific changes: split into rules/values vs kill switches.
  // Rules/values always require approval. Kill switches only require approval
  // when featureRequireEnvironmentReview is true (default: true when unset).
  const envsWithRuleChanges = affected.filter((env) => {
    const revRules = (revision.rules?.[env] || []).map(normalizeRuleForDiff);
    const baseRules = (baseRevision.rules?.[env] || []).map(
      normalizeRuleForDiff,
    );
    return !isEqual(revRules, baseRules);
  });
  const envKillSwitchChanges = affected.filter(
    (env) =>
      revision.environmentsEnabled?.[env] !== undefined &&
      revision.environmentsEnabled[env] !==
        baseRevision.environmentsEnabled?.[env],
  );

  const gatedEnvs = reviewSetting.environments;

  // Rules/values always gate
  if (envsWithRuleChanges.length > 0) {
    if (gatedEnvs.length === 0) return true;
    if (envsWithRuleChanges.some((env) => gatedEnvs.includes(env))) return true;
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

  return false;
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

export function getApiFeatureAllEnvs(feature: ApiFeature) {
  return Object.keys(feature.environments);
}
