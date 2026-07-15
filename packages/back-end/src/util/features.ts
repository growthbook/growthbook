import isEqual from "lodash/isEqual";
import {
  ConditionInterface,
  ParentConditionInterface,
} from "@growthbook/growthbook";
import {
  getRulesForEnvironment,
  includeExperimentInPayload,
  isDefined,
  isMultiRangeNamespaceFormat,
  namespacesToMap,
  recursiveWalk,
  ruleFootprint,
  stemRuleId,
  getNamespaceRanges,
  getNamespaceHashAttribute,
  NamespaceValue,
  buildReverseDependencyIndex,
  ReverseDependencyIndex,
  buildExperimentDependencyIndex,
  ExperimentDependencyIndex,
  parsePlainJSONObject,
  getFeatureBaseConfigKey,
  ensureConfigBacking,
  stripConfigExtends,
  deepMergePatch,
} from "shared/util";
import { getLatestPhaseVariations } from "shared/experiments";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import { cloneDeep, isNil, pick } from "lodash";
import md5 from "md5";
import {
  ExperimentMetadata,
  FeatureDefinition,
  FeatureDefinitionRule,
  FeatureMetadata,
} from "shared/types/sdk";
import { ProjectInterface } from "shared/types/project";
import {
  HoldoutInterface,
  ContextualBanditInterface,
  VariationWeightPair,
} from "shared/validators";
import {
  expandNestedSavedGroups,
  getJSONValue,
  getPayloadAllowedKeys,
  replaceSavedGroups,
  resolveConstantRefs,
  ConstantValueMap,
  SDKCapability,
} from "shared/sdk-versioning";
import { OrganizationInterface, Environment } from "shared/types/organization";
import {
  FeatureInterface,
  FeatureRule,
  SavedGroupTargeting,
} from "shared/types/feature";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { RampMonitoredRuleInfo } from "back-end/src/models/RampScheduleModel";
import { logger } from "back-end/src/util/logger";
import { getApplicableEnvIds } from "./flattenRules";
import { getCurrentEnabledState } from "./scheduleRules";

function pairedWeightsToPositional(
  paired: VariationWeightPair[],
  variations: { id: string }[],
): number[] {
  return variations.map(
    (v) => paired.find((w) => w.variationId === v.id)?.weight ?? 0,
  );
}

export interface FeatureLookups {
  featuresMap: Map<string, FeatureInterface>;
  reverseDependencyIndex: ReverseDependencyIndex;
  experiments: ExperimentInterfaceStringDates[];
  experimentMap: Map<string, ExperimentInterfaceStringDates>;
  experimentDependencyIndex: ExperimentDependencyIndex;
}

/** Builds the shared lookup structures used by stale detection and dependents. */
export function buildFeatureLookups(
  allFeatures: FeatureInterface[],
  allExperiments?: ExperimentInterface[],
): FeatureLookups {
  const featuresMap = new Map(allFeatures.map((f) => [f.id, f]));
  const reverseDependencyIndex = buildReverseDependencyIndex(allFeatures);
  const experiments =
    (allExperiments as unknown as ExperimentInterfaceStringDates[]) ?? [];
  const experimentMap = new Map(experiments.map((e) => [e.id, e]));
  const experimentDependencyIndex = buildExperimentDependencyIndex(experiments);
  return {
    featuresMap,
    reverseDependencyIndex,
    experiments,
    experimentMap,
    experimentDependencyIndex,
  };
}

export type MetadataOptions = {
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;
};

export function buildPayloadMetadata<
  T extends FeatureMetadata | ExperimentMetadata,
>(
  entity: {
    project?: string;
    customFields?: Record<string, unknown>;
    tags?: string[];
  },
  opts: MetadataOptions,
  projectsMap: Map<string, ProjectInterface> | undefined,
): T | undefined {
  const metadata: T = {} as T;

  if (opts.includeProjectIdInMetadata && entity.project && projectsMap) {
    const project = projectsMap.get(entity.project);
    if (project) {
      metadata.projects = [project.publicId || project.id];
    }
  }

  if (
    opts.includeCustomFieldsInMetadata &&
    opts.allowedCustomFieldsInMetadata?.length &&
    entity.customFields
  ) {
    const filtered: Record<string, unknown> = {};
    for (const fieldId of opts.allowedCustomFieldsInMetadata) {
      if (entity.customFields[fieldId] !== undefined) {
        filtered[fieldId] = entity.customFields[fieldId];
      }
    }
    if (Object.keys(filtered).length > 0) {
      metadata.customFields = filtered;
    }
  }

  if (opts.includeTagsInMetadata && entity.tags?.length) {
    metadata.tags = entity.tags;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function getSavedGroupCondition(
  groupId: string,
  groupMap: GroupMap,
  include: boolean,
): null | ConditionInterface {
  const group = groupMap.get(groupId);
  if (!group) return null;
  if (group.type === "condition" && group.condition) {
    try {
      const cond = JSON.parse(group.condition);
      return include ? cond : { $not: cond };
    } catch (e) {
      return null;
    }
  }

  if (!group.attributeKey) return null;

  return {
    [group.attributeKey]: { [include ? "$inGroup" : "$notInGroup"]: groupId },
  };
}

export function getParsedCondition(
  groupMap: GroupMap,
  condition?: string,
  savedGroups?: SavedGroupTargeting[],
) {
  const conditions: ConditionInterface[] = [];
  if (condition && condition !== "{}") {
    try {
      const cond = JSON.parse(condition);
      if (cond) conditions.push(cond);
    } catch (e) {
      // ignore condition parse errors here
    }
  }

  if (savedGroups) {
    savedGroups.forEach(({ ids, match }) => {
      const groupIds = ids.filter((id) => {
        const group = groupMap.get(id);
        if (!group) return false;
        if (group.type === "condition") {
          // Condition groups must be non-empty
          if (!group.condition || group.condition === "{}") return false;
        } else {
          // Legacy list groups must be non-empty
          if (!group.useEmptyListGroup && !group.values?.length) return false;
          // List groups must have defined values
          if (typeof group.values === "undefined") return false;
        }
        return true;
      });
      if (!groupIds.length) return;

      // Add each group as a separate top-level AND
      if (match === "all") {
        groupIds.forEach((groupId) => {
          const cond = getSavedGroupCondition(groupId, groupMap, true);
          if (cond) conditions.push(cond);
        });
      }
      // Add one top-level AND with nested OR conditions
      else if (match === "any") {
        const ors: ConditionInterface[] = [];
        groupIds.forEach((groupId) => {
          const cond = getSavedGroupCondition(groupId, groupMap, true);
          if (cond) ors.push(cond);
        });

        // Multiple OR conditions, add them as a nested OR
        if (ors.length > 1) {
          conditions.push({ $or: ors });
        }
        // Single OR condition, not really doing anything, just add it to top-level
        else if (ors.length === 1) {
          conditions.push(ors[0]);
        }
      }
      // Add each group as a separate top-level AND with a NOT condition
      else if (match === "none") {
        groupIds.forEach((groupId) => {
          const cond = getSavedGroupCondition(groupId, groupMap, false);
          if (cond) conditions.push(cond);
        });
      }
    });
  }

  // No conditions
  if (!conditions.length) return undefined;

  // Expand nested saved groups in conditions
  conditions.forEach((cond) => {
    recursiveWalk(cond, expandNestedSavedGroups(groupMap));
  });

  // Exactly one condition, return it
  if (conditions.length === 1) {
    return conditions[0];
  }
  // Multiple conditions, AND them together
  return {
    $and: conditions,
  };
}

export function isRuleEnabled(
  rule: FeatureRule,
  date?: Date | number,
): boolean {
  // Manually disabled
  if (!rule.enabled) return false;

  // Disabled because of an automatic schedule
  // when used in filter/some array loops, the second parameter will be the index, which is not a date.
  const enabledDate = date instanceof Date ? date : new Date();
  if (!getCurrentEnabledState(rule.scheduleRules || [], enabledDate)) {
    return false;
  }

  // Disable if percent rollout is 0
  // Fixes a bug in SDKs where ~1 out of 10,000 users would get a feature even if it was set to 0% rollout
  // If we ever add sticky bucketing to rollouts, we will need to remove this
  if (rule.type === "rollout" && rule.coverage === 0) {
    return false;
  }

  return true;
}

export function getEnabledEnvironments(
  features: FeatureInterface | FeatureInterface[],
  allowedEnvs: string[],
  ruleFilter?: (rule: FeatureRule) => boolean | unknown,
): Set<string> {
  if (!Array.isArray(features)) features = [features];

  const environments = new Set<string>();
  features.forEach((feature) => {
    const settings = feature.environmentSettings || {};

    Object.keys(settings)
      .filter((e) => allowedEnvs.includes(e))
      .filter((e) => settings[e].enabled)
      .filter((e) => {
        if (!ruleFilter) return true;
        // Fallback to v1 `settings[e].rules` for test fixtures that skip the
        // JIT upgrade in `migrateRawFeatureToV2`.
        let envRules: FeatureRule[] = getRulesForEnvironment(feature.rules, e);
        if (envRules.length === 0 && !Array.isArray(feature.rules)) {
          envRules =
            (settings[e] as unknown as { rules?: FeatureRule[] }).rules ?? [];
        }
        return envRules.filter(ruleFilter).some((r) => isRuleEnabled(r));
      })
      .forEach((e) => environments.add(e));
  });

  return environments;
}

export function getSDKPayloadKeys(
  environments: Set<string>,
  projects: Set<string>,
) {
  const keys: SDKPayloadKey[] = [];

  environments.forEach((e) => {
    projects.forEach((p) => {
      keys.push({
        environment: e,
        project: p,
      });
    });
  });

  return keys;
}

export function getSDKPayloadKeysByDiff(
  originalFeature: FeatureInterface,
  updatedFeature: FeatureInterface,
  allowedEnvs: string[],
): SDKPayloadKey[] {
  const environments = new Set<string>();

  // If the feature is archived both before and after the change, no payloads need to update
  if (originalFeature.archived && updatedFeature.archived) {
    return [];
  }

  // Some of the feature keys that change affect all enabled environments
  const allEnvKeys: (keyof FeatureInterface)[] = [
    "archived",
    "defaultValue",
    "project",
    "valueType",
    "nextScheduledUpdate",
    "holdout",
    // Top-level prerequisites apply to every enabled env's payload.
    "prerequisites",
  ];

  if (
    allEnvKeys.some(
      (k) => !isEqual(originalFeature[k] ?? null, updatedFeature[k] ?? null),
    )
  ) {
    getEnabledEnvironments(
      [originalFeature, updatedFeature],
      allowedEnvs,
    ).forEach((e) => environments.add(e));
  }

  // Diff rules by id; each changed rule invalidates only the envs in its
  // footprint (union of old and new). Skip envs disabled both before and
  // after — no payload exists to refresh.
  const envIsRelevant = (e: string): boolean => {
    const oldEnabled = !!originalFeature.environmentSettings?.[e]?.enabled;
    const newEnabled = !!updatedFeature.environmentSettings?.[e]?.enabled;
    return oldEnabled || newEnabled;
  };
  const addRuleEnvs = (rule: FeatureRule | undefined) => {
    if (!rule) return;
    ruleFootprint(rule, allowedEnvs).forEach((e) => {
      if (envIsRelevant(e)) environments.add(e);
    });
  };
  const oldRulesById = new Map(
    (originalFeature.rules ?? []).map((r) => [r.id, r] as const),
  );
  const newRulesById = new Map(
    (updatedFeature.rules ?? []).map((r) => [r.id, r] as const),
  );
  oldRulesById.forEach((oldRule, id) => {
    const newRule = newRulesById.get(id);
    if (!newRule || !isEqual(oldRule, newRule)) {
      addRuleEnvs(oldRule);
      addRuleEnvs(newRule);
    }
  });
  newRulesById.forEach((newRule, id) => {
    if (!oldRulesById.has(id)) addRuleEnvs(newRule);
  });
  // Reordered rules (same ids) still affect evaluation.
  const oldIdOrder = (originalFeature.rules ?? []).map((r) => r.id).join("\0");
  const newIdOrder = (updatedFeature.rules ?? []).map((r) => r.id).join("\0");
  if (oldIdOrder !== newIdOrder) {
    (originalFeature.rules ?? []).forEach(addRuleEnvs);
    (updatedFeature.rules ?? []).forEach(addRuleEnvs);
  }

  const allEnvs = new Set(allowedEnvs);

  // Add in environments if their specific settings changed
  allEnvs.forEach((e) => {
    const oldSettings = originalFeature.environmentSettings[e];
    const newSettings = updatedFeature.environmentSettings[e];

    // If the environment is disabled both before and after the change, ignore changes
    if (!oldSettings?.enabled && !newSettings?.enabled) {
      return;
    }

    // Otherwise, if the environment settings are not equal
    if (!isEqual(oldSettings, newSettings)) {
      environments.add(e);
    }
  });

  const projects = new Set([
    "",
    originalFeature.project || "",
    updatedFeature.project || "",
  ]);

  return getSDKPayloadKeys(environments, projects);
}

export function getAffectedSDKPayloadKeys(
  features: FeatureInterface[],
  allowedEnvs: string[],
  ruleFilter?: (rule: FeatureRule) => boolean | unknown,
): SDKPayloadKey[] {
  const keys: SDKPayloadKey[] = [];

  features.forEach((feature) => {
    const environments = getEnabledEnvironments(
      feature,
      allowedEnvs,
      ruleFilter,
    );
    const projects = new Set(["", feature.project || ""]);
    keys.push(...getSDKPayloadKeys(environments, projects));
  });

  // Unique the list
  const usedKeys = new Set<string>();

  return keys.filter((key) => {
    const s = JSON.stringify(key);
    if (usedKeys.has(s)) return false;
    usedKeys.add(s);
    return true;
  });
}

export { getJSONValue };

export function roundVariationWeight(num: number): number {
  return Math.round(num * 10000) / 10000;
}

export function getHoldoutFeatureDefId(holdoutId: string) {
  return `$holdout:${holdoutId}`;
}

/**
 * Helper function to apply namespace to a rule
 * Handles both multiRange format (with hashAttribute and multiple ranges) and legacy format
 */
export function applyNamespaceToPayload(
  rule: FeatureDefinitionRule,
  namespace: NamespaceValue,
  namespacesMap?: Map<
    string,
    { hashAttribute?: string; seed?: string; format?: "legacy" | "multiRange" }
  >,
): void {
  const nsDefinition = namespacesMap?.get(namespace.name);

  // When the namespace is defined on the org, trust its format; otherwise fall
  // back to the structural check on the phase/rule's namespace shape.
  const multiRange = nsDefinition
    ? nsDefinition.format === "multiRange"
    : isMultiRangeNamespaceFormat(namespace);

  // Some legacy docs stored strings like "0.5" in range tuples — coerce defensively.
  const ranges = getNamespaceRanges(namespace).map(
    ([start, end]) =>
      [Number(start) || 0, Number(end) || 0] as [number, number],
  );

  if (multiRange) {
    // Namespace bucketing is independent of the rule's own variation bucketing.
    // Populate only the Filter object: the SDK reads filter.attribute /
    // filter.hashVersion via getHashAttribute independently of rule.hashAttribute
    // (see packages/sdk-js/src/core.ts `isFilteredOut`). Mutating rule.hashAttribute
    // here would silently re-bucket every user of a running experiment.
    const filterAttribute = getNamespaceHashAttribute(
      namespace,
      nsDefinition?.hashAttribute || rule.hashAttribute || "id",
    );
    const filterHashVersion =
      ("hashVersion" in namespace && namespace.hashVersion) || 2;
    const seed = nsDefinition?.seed || namespace.name;

    rule.filters = [
      ...(rule.filters || []),
      {
        attribute: filterAttribute,
        seed,
        hashVersion: filterHashVersion,
        ranges,
      },
    ];
    return;
  }

  // Legacy format: use tuple on the rule itself for backward compatibility.
  const [start, end] = ranges[0] ?? [0, 0];
  rule.namespace = [namespace.name, start, end];
}

export function getFeatureDefinition({
  feature,
  environment,
  groupMap,
  experimentMap,
  revision,
  date,
  safeRolloutMap,
  holdoutsMap,
  capabilities,
  savedGroupReferencesEnabled,
  organization,
  savedGroupsMap,
  includeRuleIds,
  includeExperimentNames,
  includeDraftExperimentRefs,
  namespaces,
  metadataOptions,
  projectsMap,
  cbMap,
  rampMonitoredRuleMap,
  constantMap,
  onConstantCycle,
}: {
  feature: FeatureInterface;
  environment: string;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  revision?: FeatureRevisionInterface;
  date?: Date;
  safeRolloutMap: Map<string, SafeRolloutInterface>;
  holdoutsMap?: Map<
    string,
    { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
  >;
  capabilities?: SDKCapability[];
  savedGroupReferencesEnabled?: boolean;
  organization?: OrganizationInterface;
  savedGroupsMap?: Record<string, SavedGroupInterface>;
  includeRuleIds?: boolean;
  includeExperimentNames?: boolean;
  includeDraftExperimentRefs?: boolean;
  namespaces?: Map<
    string,
    { hashAttribute?: string; seed?: string; format?: "legacy" | "multiRange" }
  >;
  metadataOptions?: MetadataOptions;
  projectsMap?: Map<string, ProjectInterface>;
  cbMap?: Map<string, ContextualBanditInterface>;
  rampMonitoredRuleMap?: Map<string, RampMonitoredRuleInfo>;
  // Per-environment constant values. When provided, EVERY emitted value is
  // resolved here (exactly once): sparse rule values resolve BEFORE the sparse
  // merge (so the rule's own fields are applied last and win over the resolved
  // constant); all other values resolve as they're emitted.
  constantMap?: ConstantValueMap;
  // Invoked with any constant key left unresolved due to a reference cycle.
  onConstantCycle?: (key: string) => void;
}): FeatureDefinition | null {
  const settings = feature.environmentSettings?.[environment];

  // Don't include features which are disabled for this environment
  if (!settings || !settings.enabled || feature.archived) {
    return null;
  }

  const defaultValue = revision
    ? (revision.defaultValue ?? feature.defaultValue)
    : feature.defaultValue;

  // For `json` features, parse the default value once so rules flagged `sparse`
  // can merge their partial object onto it. Null when the default isn't a plain
  // key/val object (array, null, primitive) — sparse is then a no-op and rules
  // emit their value as-is. When a constant map is supplied, resolve the
  // default's `$extends` references first so they form the sparse merge base
  // (the resolved default + its keys), which the patch then overrides.
  const resolveRefs = (val: unknown): unknown =>
    constantMap
      ? resolveConstantRefs(
          val,
          constantMap,
          undefined,
          onConstantCycle,
          feature.project || "",
          environment,
        )
      : val;

  // Config-backing is authoritative via `baseConfig`. For a config-backed
  // feature, every rule/variation value implicitly serves the base config: if a
  // value doesn't reference its own (family) config, we prepend the feature's so
  // resolution flattens the base underneath it. For a NON-config feature, a
  // value must not carry `@config:` at all — strip any stray ref so it can never
  // resolve a config (`@const:` refs are kept).
  const defaultConfigKey = getFeatureBaseConfigKey({
    valueType: feature.valueType,
    baseConfig: feature.baseConfig,
  });

  const jsonDefaultObj = (() => {
    if (feature.valueType !== "json") return null;
    // Inject the base config so the resolved default — the sparse merge base for
    // rules — includes the config layer even when the stored default is a pure
    // patch (no-op when the default already references its own config). Non-config
    // features strip any stray `@config:`.
    const backed = defaultConfigKey
      ? ensureConfigBacking(defaultValue, defaultConfigKey)
      : (stripConfigExtends(defaultValue) ?? defaultValue);
    const base = parsePlainJSONObject(backed);
    if (!base || !constantMap) return base;
    const resolved = resolveRefs(base);
    return resolved !== null &&
      typeof resolved === "object" &&
      !Array.isArray(resolved)
      ? (resolved as Record<string, unknown>)
      : base;
  })();

  const valueForSDK = (valueStr: string, sparse?: boolean): unknown => {
    // Non-object values (array/scalar/string) have replace semantics — ship
    // them as-is rather than prepending a config base they'd never merge with.
    const normalized = defaultConfigKey
      ? valueStr.trim() === "" || parsePlainJSONObject(valueStr) !== null
        ? ensureConfigBacking(valueStr, defaultConfigKey)
        : valueStr
      : // Non-config feature: drop any stray `@config:` so it can't resolve a
        // config (keeps `@const:` refs).
        (stripConfigExtends(valueStr) ?? valueStr);
    if (sparse && jsonDefaultObj) {
      const patch = parsePlainJSONObject(normalized);
      if (patch !== null) {
        // Resolve the patch's constants BEFORE merging so the rule's fields are
        // spread last and win over the (already-resolved) default — i.e. sparse
        // fields are "further down". A config-backed rule keeps its own
        // `$extends` here so it resolves against the config it references (which
        // may be a descendant it was re-pointed to) — this matches the value the
        // config-backing editor previews. Non-object resolutions (e.g. a
        // whole-value JSON constant that resolves to an array) replace outright.
        const resolvedPatch = resolveRefs(patch);
        if (
          resolvedPatch !== null &&
          typeof resolvedPatch === "object" &&
          !Array.isArray(resolvedPatch)
        ) {
          // Config-backed features get a deep (targeted) sparse patch so a rule
          // restates only the leaves it changes; plain JSON features keep the
          // top-level spread. `$extends`-composed chunks stay atomic.
          return defaultConfigKey
            ? deepMergePatch(jsonDefaultObj, resolvedPatch)
            : {
                ...jsonDefaultObj,
                ...(resolvedPatch as Record<string, unknown>),
              };
        }
        return resolvedPatch;
      }
    }
    return resolveRefs(getJSONValue(feature.valueType, normalized));
  };

  // Rule source: revision's unified array (draft/published) > feature's (live).
  // Legacy `settings.rules` is test-only — production reads flow through
  // `migrateRawFeatureToV2`.
  //
  // Project-scoping intersect: `allEnvironments: true` means "all APPLICABLE
  // envs" (per `flattenV1ToV2Rules`). Use `ruleFootprint` to honor that —
  // matching `bucketRulesByEnv` so the SDK definition and the per-env API
  // bucket agree. Without `organization` we can't resolve applicability and
  // fall back to the literal env-list filter.
  const v2Rules = revision?.rules ?? feature.rules;
  const applicableEnvs = organization?.settings?.environments
    ? getApplicableEnvIds(organization.settings.environments, feature.project)
    : null;
  let rules: FeatureRule[];
  if (!Array.isArray(v2Rules)) {
    rules = (settings as unknown as { rules?: FeatureRule[] }).rules ?? [];
  } else if (!applicableEnvs) {
    rules = getRulesForEnvironment(v2Rules, environment);
  } else if (!applicableEnvs.includes(environment)) {
    rules = [];
  } else {
    rules = v2Rules.filter((r) =>
      ruleFootprint(r, applicableEnvs).includes(environment),
    );
  }

  const namespacesMap =
    namespaces ?? namespacesToMap(organization?.settings?.namespaces);

  // undefined = all capabilities; compute build-time constraints when capabilities is set
  const hasPrerequisites =
    capabilities === undefined || capabilities.includes("prerequisites");
  const shouldExpandSavedGroups =
    capabilities !== undefined &&
    !!savedGroupsMap &&
    (savedGroupReferencesEnabled === false ||
      !capabilities.includes("savedGroupReferences"));
  // looseUnmarshalling => no capability-based strip. Connection settings still gate rule id, names, etc.
  const allowedKeys =
    capabilities !== undefined && !capabilities.includes("looseUnmarshalling")
      ? getPayloadAllowedKeys(capabilities)
      : null;

  // Exclude feature when connection lacks prerequisites and feature has any gates (top-level or rule-level).
  if (capabilities !== undefined && !hasPrerequisites) {
    const hasTopLevelPrereqs = !!feature.prerequisites?.length;
    const hasRuleLevelGates = rules?.some((r) => {
      if (r.type === "experiment-ref") {
        const exp = experimentMap.get(r.experimentId);
        const phase = exp?.phases?.slice(-1)?.[0];
        return !!phase?.prerequisites?.length;
      }
      return !!(r as { prerequisites?: unknown[] }).prerequisites?.length;
    });
    if (hasTopLevelPrereqs || hasRuleLevelGates) {
      return null;
    }
  }

  // If the feature has a holdout and it's enabled for the environment, add holdout as a
  // pseudo force rule with a prerequisite condition. The environment being enabled is
  // already checked in the getAllPayloadHoldouts function.
  const holdoutRule: FeatureDefinitionRule[] =
    hasPrerequisites &&
    feature.holdout &&
    holdoutsMap &&
    holdoutsMap.get(feature.holdout.id)?.holdout.environmentSettings?.[
      environment
    ]?.enabled
      ? [
          {
            ...(includeRuleIds
              ? { id: `holdout_${md5(feature.id + feature.holdout.id)}` }
              : {}),
            parentConditions: [
              {
                id: getHoldoutFeatureDefId(feature.holdout.id),
                condition: { value: "holdoutcontrol" },
              },
            ],
            force: valueForSDK(feature.holdout.value),
          },
        ]
      : [];

  // convert prerequisites to force rules (only when connection has prerequisites capability)
  const prerequisiteRules = hasPrerequisites
    ? (feature.prerequisites ?? [])
        ?.map((p) => {
          const condition = getParsedCondition(groupMap, p.condition);
          if (!condition) return null;
          return {
            parentConditions: [
              {
                id: p.id,
                condition,
                gate: true,
              },
            ],
          };
        })
        .filter(isDefined)
    : [];

  const isRule = (
    rule: FeatureDefinitionRule | null,
  ): rule is FeatureDefinitionRule => !!rule;

  const defRules = [
    ...holdoutRule,
    ...prerequisiteRules,
    ...(rules
      ?.filter((r) => {
        return isRuleEnabled(r, date);
      })
      ?.map((r) => {
        const rule: FeatureDefinitionRule = {
          // SDK payload emits the STEM id so split rules
          // (`fr_abc__production` + `fr_abc__staging`) report as `fr_abc`
          // in telemetry. REST emits the qualified id; see `normalizeRuleForApi`.
          ...(includeRuleIds && r.id != null ? { id: stemRuleId(r.id) } : {}),
        } as FeatureDefinitionRule;

        // Experiment reference rules inherit everything from the experiment
        if (r.type === "experiment-ref") {
          const exp = experimentMap.get(r.experimentId);
          if (!exp) return null;

          if (!includeExperimentInPayload(exp)) return null;

          if (exp.status === "draft" && !includeDraftExperimentRefs)
            return null;

          // Get current experiment phase and use it to set rule properties
          const phase = exp.phases[exp.phases.length - 1];
          if (!phase) return null;
          if (!hasPrerequisites && phase?.prerequisites?.length) return null;

          const condition = getParsedCondition(
            groupMap,
            phase.condition,
            phase.savedGroups,
          );
          if (condition) {
            rule.condition = condition;
          }

          if (phase?.prerequisites?.length) {
            rule.parentConditions = phase.prerequisites
              .map((prerequisite) => {
                try {
                  return {
                    id: prerequisite.id,
                    condition: JSON.parse(prerequisite.condition),
                  };
                } catch (e) {
                  // do nothing
                }
                return null;
              })
              .filter(Boolean) as ParentConditionInterface[];
          }

          rule.coverage = phase.coverage;

          if (exp.hashAttribute) {
            rule.hashAttribute = exp.hashAttribute;
          }
          if (exp.fallbackAttribute) {
            rule.fallbackAttribute = exp.fallbackAttribute;
          }
          if (exp.disableStickyBucketing) {
            rule.disableStickyBucketing = exp.disableStickyBucketing;
          }
          if (exp.bucketVersion) {
            rule.bucketVersion = exp.bucketVersion;
          }
          if (exp.minBucketVersion) {
            rule.minBucketVersion = exp.minBucketVersion;
          }
          if (
            phase.namespace &&
            phase.namespace.enabled &&
            phase.namespace.name
          ) {
            applyNamespaceToPayload(rule, phase.namespace, namespacesMap);
          }

          if (phase.seed) {
            rule.seed = phase.seed;
          }
          rule.hashVersion = exp.hashVersion;

          // Stopped experiment. Origin/main's Mongoose `[]` seed silently
          // dropped malformed legacy rules lacking `variations`; we no longer
          // seed defaults, so guard against missing arrays here and below.
          if (exp.status === "stopped") {
            const variation = r.variations?.find(
              (v) => v.variationId === exp.releasedVariationId,
            );
            if (!variation) return null;

            // A config-backed feature composes every arm as a sparse patch on
            // the base (the invariant above), so force sparse there regardless
            // of the stored flag — a rule retro-fitted onto config-backing may
            // still carry sparse=false. Matches the CB-ref / inline-experiment
            // arms below. Non-config features keep their independent sparse.
            const armSparse = r.sparse || !!defaultConfigKey;

            // If a variation has been rolled out to 100%
            rule.force = valueForSDK(variation.value, armSparse);
          }
          // Running experiment
          else {
            const armSparse = r.sparse || !!defaultConfigKey;
            rule.variations = getLatestPhaseVariations(exp).map((v) => {
              const variation = r.variations?.find(
                (ruleVariation) => v.id === ruleVariation.variationId,
              );
              return variation ? valueForSDK(variation.value, armSparse) : null;
            });
            rule.weights = phase.variationWeights;

            rule.key = exp.trackingKey;
            const phaseVariations = getLatestPhaseVariations(exp);
            rule.meta = includeExperimentNames
              ? phaseVariations.map((v) => ({ key: v.key, name: v.name }))
              : phaseVariations.map((v) => ({ key: v.key }));
            rule.phase = exp.phases.length - 1 + "";
            if (includeExperimentNames) rule.name = exp.name;
          }
          if (shouldExpandSavedGroups && savedGroupsMap && organization) {
            if (rule.condition)
              recursiveWalk(
                rule.condition,
                replaceSavedGroups(savedGroupsMap, organization!),
              );
            if (rule.parentConditions)
              recursiveWalk(
                rule.parentConditions,
                replaceSavedGroups(savedGroupsMap, organization!),
              );
          }
          if (metadataOptions) {
            const expMetadata = buildPayloadMetadata<ExperimentMetadata>(
              {
                project: exp.project,
                customFields: exp.customFields,
                tags: exp.tags,
              },
              metadataOptions,
              projectsMap,
            );
            if (expMetadata) rule.metadata = expMetadata;
          }

          if (allowedKeys) {
            const picked = pick(
              rule,
              allowedKeys.featureRuleKeys,
            ) as FeatureDefinitionRule;
            if (includeRuleIds && r.id != null) {
              (picked as Record<string, unknown>).id = stemRuleId(r.id);
            }
            return picked;
          }
          return rule;
        }

        if (r.type === "contextual-bandit-ref") {
          const cb = cbMap?.get(r.contextualBanditId);
          if (!cb) return null;

          if (cb.status === "draft") return null;

          const phaseCondition = getParsedCondition(groupMap, cb.condition);
          if (phaseCondition) {
            rule.condition = phaseCondition;
          }

          rule.coverage = cb.coverage;

          if (cb.hashAttribute) {
            rule.hashAttribute = cb.hashAttribute;
          }
          if (cb.seed) {
            rule.seed = cb.seed;
          }
          rule.hashVersion = 2;

          if (cb.status === "stopped") {
            return null;
          }

          rule.variations = cb.variations.map((v) => {
            const variation = r.variations?.find(
              (rv) => rv.variationId === v.id,
            );
            // Resolve like every other value emitter — a bare getJSONValue would
            // ship `$extends`/`@const:`/`@config:` refs to the SDK unresolved.
            // Contextual-bandit-ref has no `sparse` flag, but its config-backed
            // arms are authored as sparse patches through the same hooks/editor as
            // the experiment-ref (MAB) twin above, so they must resolve the same
            // way: sparse when config-backed, a full value otherwise.
            return variation
              ? valueForSDK(variation.value, !!defaultConfigKey)
              : null;
          });
          rule.weights = cb.variationWeights
            ? pairedWeightsToPositional(cb.variationWeights, cb.variations)
            : undefined;

          const cbCapable =
            capabilities === undefined ||
            capabilities.includes("contextualBandits");
          if (cbCapable) {
            rule.isContextualBandit = true;
            rule.attributesRequired = cb.contextualAttributes;
            rule.contexts = (cb.currentLeafWeights ?? []).map((lw) => ({
              leafId: lw.leafId,
              condition: lw.condition,
              weights: pairedWeightsToPositional(lw.weights, cb.variations),
            }));
          }

          rule.key = cb.trackingKey;
          rule.meta = includeExperimentNames
            ? cb.variations.map((v) => ({ key: v.key, name: v.name }))
            : cb.variations.map((v) => ({ key: v.key }));
          rule.phase = "0";
          if (includeExperimentNames) rule.name = cb.name;

          if (shouldExpandSavedGroups && savedGroupsMap && organization) {
            if (rule.condition)
              recursiveWalk(
                rule.condition,
                replaceSavedGroups(savedGroupsMap, organization!),
              );
          }
          if (metadataOptions) {
            const cbMetadata = buildPayloadMetadata<ExperimentMetadata>(
              {
                project: cb.project,
                tags: cb.tags,
              },
              metadataOptions,
              projectsMap,
            );
            if (cbMetadata) rule.metadata = cbMetadata;
          }

          if (allowedKeys) {
            const picked = pick(
              rule,
              allowedKeys.featureRuleKeys,
            ) as FeatureDefinitionRule;
            if (includeRuleIds && r.id != null) {
              (picked as Record<string, unknown>).id = stemRuleId(r.id);
            }
            return picked;
          }
          return rule;
        }

        const condition = getParsedCondition(
          groupMap,
          r.condition,
          r.savedGroups,
        );
        if (condition) {
          rule.condition = condition;
        }

        const prerequisites = (r?.prerequisites ?? [])
          ?.map((p) => {
            const condition = getParsedCondition(groupMap, p.condition);
            if (!condition) return null;
            return {
              id: p.id,
              condition,
            };
          })
          .filter(isDefined);
        if (!hasPrerequisites && prerequisites?.length) return null;
        if (prerequisites?.length) {
          rule.parentConditions = prerequisites;
        }

        if (r.type === "force") {
          rule.force = valueForSDK(r.value, r.sparse);
        } else if (r.type === "experiment") {
          // Inline experiment values have no `sparse` flag, but config-backed arms
          // are authored as sparse patches (like the experiment-ref twins), so a
          // bare resolve would drop the base config. Resolve sparse when backed.
          rule.variations = r.values.map((v) =>
            valueForSDK(v.value, !!defaultConfigKey),
          );

          rule.coverage = r.coverage;

          rule.weights = r.values
            .map((v) => v.weight)
            .map((w) => (w < 0 ? 0 : w > 1 ? 1 : w))
            .map((w) => roundVariationWeight(w));

          rule.meta = r.values.map((v, i) => ({
            key: i + "",
            ...(v.name ? { name: v.name } : {}),
          }));

          if (r.trackingKey) {
            rule.key = r.trackingKey;
          }
          if (r.hashAttribute) {
            rule.hashAttribute = r.hashAttribute;
          }
          if (r.fallbackAttribute) {
            rule.fallbackAttribute = r.fallbackAttribute;
          }
          if (r.disableStickyBucketing) {
            rule.disableStickyBucketing = r.disableStickyBucketing;
          }
          if (r.bucketVersion) {
            rule.bucketVersion = r.bucketVersion;
          }
          if (r.minBucketVersion) {
            rule.minBucketVersion = r.minBucketVersion;
          }
          if (r?.namespace && r.namespace.enabled && r.namespace.name) {
            applyNamespaceToPayload(rule, r.namespace, namespacesMap);
          }
        } else if (r.type === "rollout") {
          const monitorInfo = rampMonitoredRuleMap?.get(r.id);

          // Monitored rollout rules need hashAttribute + seed to emit experiment-mode
          // payload (tracking key, stable bucketing). Fall back to feature.id (matches
          // the SDK's own `rule.seed || featureId` fallback for force-coverage rules)
          // for older rules that predate the seed-at-write-time backfill.
          // New rules always have seed persisted as rule.id via addIdsToFlatRules.
          if (monitorInfo && r.hashAttribute) {
            const monitoredSeed = r.seed || feature.id;
            // Reuse rollout bucketing so monitored steps do not cause variation hopping.
            const clampedCoverage =
              r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;

            const defaultValue = revision
              ? (revision.defaultValue ?? feature.defaultValue)
              : feature.defaultValue;

            rule.variations = [
              valueForSDK(r.value, r.sparse),
              // valueForSDK (not a bare resolve): a config-backed default is a pure
              // config (`{}` for the base), so a bare resolve would serve an empty
              // object to the control arm instead of the config's value.
              valueForSDK(defaultValue),
            ];
            rule.weights = [0.5, 0.5];
            // Set coverage = 2 * step.coverage so getBucketRanges naturally
            // produces the non-adjacent layout:
            //   treatment (var 0) = [0, step.coverage)
            //   control   (var 1) = [0.5, 0.5 + step.coverage)
            //
            // getBucketRanges accumulates start by raw weight (0.5), not by
            // coverage*weight, so the control arm always starts at 0.5 regardless
            // of coverage. This keeps arms disjoint and monotonically enrolled:
            // on a step-up from C₁ → C₂ only users in [C₁,C₂) and [0.5+C₁,0.5+C₂)
            // are newly enrolled — no existing user changes arm.
            //
            // Works identically for old SDKs (no bucketingV2) since they call the
            // same getBucketRanges fallback with this coverage value.
            rule.coverage = Math.min(clampedCoverage * 2, 1);

            rule.hashAttribute = r.hashAttribute;
            rule.seed = monitoredSeed;
            // Match the rollout rule's hash version exactly to prevent variation
            // hopping between monitored/unmonitored steps. New rules store hashVersion
            // explicitly (defaulting to 2); old rules without the field stay on 1.
            rule.hashVersion = r.hashVersion ?? 1;
            rule.key = `ramp_${monitorInfo.rampScheduleId}`;
            rule.meta = includeExperimentNames
              ? [
                  { key: "0", name: "Variation" },
                  { key: "1", name: "Control", passthrough: true },
                ]
              : [{ key: "0" }, { key: "1", passthrough: true }];
            rule.phase = "0";
            // Sticky bucketing must be disabled for monitored steps: the ranges
            // shift as coverage increases, and a stale sticky-bucket assignment
            // would lock a user to the wrong arm or prevent new enrollment.
            rule.disableStickyBucketing = true;
            if (includeExperimentNames) {
              rule.name = `${feature.id} - Monitored Ramp`;
            }
          } else {
            if (monitorInfo && !r.hashAttribute) {
              logger.warn(
                {
                  featureId: feature.id,
                  ruleId: r.id,
                  rampScheduleId: monitorInfo.rampScheduleId,
                },
                "Monitored ramp rule missing hashAttribute — falling back to force rollout payload",
              );
            }
            rule.force = valueForSDK(r.value, r.sparse);
            const clampedCoverage =
              r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;
            if (clampedCoverage < 1) {
              rule.coverage = clampedCoverage;
              if (r.hashAttribute) {
                rule.hashAttribute = r.hashAttribute;
              }
              if (r.seed) {
                rule.seed = r.seed;
              }
              if (r.hashVersion) {
                rule.hashVersion = r.hashVersion;
              }
            }
          }
        } else if (r.type === "safe-rollout") {
          const safeRollout = safeRolloutMap.get(r.safeRolloutId);

          if (r.status === "released") {
            const variationValue = r.variationValue;
            if (isNil(variationValue)) return null;

            // If a variation has been rolled out to 100%
            rule.force = valueForSDK(variationValue);
          } else if (r.status === "rolled-back") {
            const controlValue = r.controlValue;
            if (isNil(controlValue)) return null;

            // Return control value if rolled back. Feature default value might not be the same as the control value.
            rule.force = valueForSDK(controlValue);
          } else {
            if (
              safeRollout?.rampUpSchedule.rampUpCompleted ||
              !safeRollout?.rampUpSchedule.enabled
            ) {
              rule.coverage = 1; // Always 100% right now
            } else {
              rule.coverage =
                safeRollout?.rampUpSchedule?.steps[
                  safeRollout?.rampUpSchedule.step
                ]?.percent ?? 1;
            }

            rule.hashAttribute = r.hashAttribute;

            rule.seed = r.seed;

            rule.hashVersion = 2;

            rule.variations = [
              valueForSDK(r.controlValue),
              valueForSDK(r.variationValue),
            ];
            const varWeights = 0.5;
            rule.weights = [varWeights, varWeights];
            rule.key = r.trackingKey;
            rule.meta = includeExperimentNames
              ? [
                  { key: "0", name: "Control" },
                  { key: "1", name: "Variation" },
                ]
              : [{ key: "0" }, { key: "1" }];
            rule.phase = "0";
            if (includeExperimentNames) {
              rule.name = `${feature.id} - Safe Rollout`;
            }
          }
        }
        if (shouldExpandSavedGroups && savedGroupsMap && organization) {
          if (rule.condition)
            recursiveWalk(
              rule.condition,
              replaceSavedGroups(savedGroupsMap, organization!),
            );
          if (rule.parentConditions)
            recursiveWalk(
              rule.parentConditions,
              replaceSavedGroups(savedGroupsMap, organization!),
            );
        }
        if (allowedKeys) {
          const picked = pick(
            rule,
            allowedKeys.featureRuleKeys,
          ) as FeatureDefinitionRule;
          if (includeRuleIds && r.id != null) {
            picked.id = stemRuleId(r.id);
          }
          return picked;
        }
        return rule;
      })
      ?.filter(isRule) ?? []),
  ];

  let def: FeatureDefinition = {
    // Route through valueForSDK (not a bare resolve) so a config-backed feature's
    // default gets its base config injected when stored as a pure patch.
    defaultValue: valueForSDK(defaultValue),
    rules: defRules,
  };
  if (def.rules && !def.rules.length) {
    delete def.rules;
  }

  if (metadataOptions) {
    const featureMetadata = buildPayloadMetadata<FeatureMetadata>(
      {
        project: feature.project,
        customFields: feature.customFields,
        tags: feature.tags,
      },
      metadataOptions,
      projectsMap,
    );
    if (featureMetadata) def.metadata = featureMetadata;
  }

  if (allowedKeys) {
    def = pick(def, allowedKeys.featureKeys) as FeatureDefinition;
  }

  return def;
}

/**
 * Populate `environmentRecord` values for env keys whose `Environment.parent`
 * chain has a defined ancestor. Only used for non-rule env fields (`enabled`,
 * `prerequisites`); rules declare their own scope on the unified array.
 * Pure.
 */
export function applyEnvironmentInheritance<T>(
  environments: Environment[],
  environmentRecord: Record<string, T>,
): Record<string, T> {
  const environmentParents = Object.fromEntries(
    environments.filter((env) => env.parent).map((env) => [env.id, env.parent]),
  );
  const mutableClone = cloneDeep(environmentRecord || {});
  Object.keys(environmentParents).forEach((env) => {
    if (mutableClone[env]) return;
    // If no definition for the environment exists, recursively inherit from the parent environments.
    // A `visited` set bails out on cyclic parent chains as if no parent was set.
    let baseEnv = environmentParents[env];
    const visited = new Set<string>([env]);
    while (baseEnv && typeof mutableClone[baseEnv] === "undefined") {
      if (visited.has(baseEnv)) {
        logger.warn(
          { env, cycle: [...visited, baseEnv] },
          "Cycle detected in environment parent chain; skipping inheritance",
        );
        baseEnv = undefined;
        break;
      }
      visited.add(baseEnv);
      baseEnv = environmentParents[baseEnv];
    }
    // If a valid parent was found, copy its value in the record
    if (baseEnv) {
      mutableClone[env] = cloneDeep(mutableClone[baseEnv]);
    }
  });
  return mutableClone;
}

// Map ancestor envId -> ordered list of inheriting child envIds whose own
// entry is missing from `originalEnvSettings`. A child with explicit env
// settings has been customized for the feature and should NOT inherit rules
// from its ancestor (matches `applyEnvironmentInheritance`'s gating).
// Children are returned in `orgEnvs` order so expansions are deterministic.
export function buildInheritedChildrenByAncestor(
  orgEnvs: Pick<Environment, "id" | "parent">[],
  originalEnvSettings: Record<string, unknown>,
): Map<string, string[]> {
  const parentOf = new Map<string, string>();
  for (const env of orgEnvs) {
    if (env.parent) parentOf.set(env.id, env.parent);
  }
  const childrenByAncestor = new Map<string, string[]>();
  for (const env of orgEnvs) {
    if (originalEnvSettings[env.id]) continue;
    let ancestor = parentOf.get(env.id);
    // Bail out on cyclic parent chains as if no parent was set.
    const visited = new Set<string>([env.id]);
    while (ancestor && !originalEnvSettings[ancestor]) {
      if (visited.has(ancestor)) {
        logger.warn(
          { env: env.id, cycle: [...visited, ancestor] },
          "Cycle detected in environment parent chain; skipping inheritance",
        );
        ancestor = undefined;
        break;
      }
      visited.add(ancestor);
      ancestor = parentOf.get(ancestor);
    }
    if (!ancestor) continue;
    const list = childrenByAncestor.get(ancestor);
    if (list) list.push(env.id);
    else childrenByAncestor.set(ancestor, [env.id]);
  }
  return childrenByAncestor;
}

// Append each ancestor's inheriting children to a rule's `environments`
// (preserves original order; children are inserted right after their
// ancestor). No-op for `allEnvironments: true` or empty-scope rules.
export function expandRuleEnvsForInheritance(
  rule: FeatureRule,
  childrenByAncestor: Map<string, string[]>,
): FeatureRule {
  if (rule.allEnvironments) return rule;
  if (childrenByAncestor.size === 0) return rule;
  const envs = rule.environments || [];
  if (envs.length === 0) return rule;
  const seen = new Set<string>();
  const expanded: string[] = [];
  for (const e of envs) {
    if (!seen.has(e)) {
      seen.add(e);
      expanded.push(e);
    }
    for (const child of childrenByAncestor.get(e) || []) {
      if (!seen.has(child)) {
        seen.add(child);
        expanded.push(child);
      }
    }
  }
  if (expanded.length === envs.length) return rule;
  return { ...rule, environments: expanded } as FeatureRule;
}
