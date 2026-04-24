import isEqual from "lodash/isEqual";
import {
  ConditionInterface,
  ParentConditionInterface,
} from "@growthbook/growthbook";
import {
  includeExperimentInPayload,
  isDefined,
  isMultiRangeNamespaceFormat,
  namespacesToMap,
  recursiveWalk,
  getNamespaceRanges,
  getNamespaceHashAttribute,
  NamespaceValue,
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
import { HoldoutInterface } from "shared/validators";
import {
  expandNestedSavedGroups,
  getJSONValue,
  getPayloadAllowedKeys,
  replaceSavedGroups,
  SDKCapability,
} from "shared/sdk-versioning";
import { OrganizationInterface, Environment } from "shared/types/organization";
import {
  FeatureInterface,
  FeatureRule,
  SavedGroupTargeting,
} from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { getCurrentEnabledState } from "./scheduleRules";

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
        const env = settings[e];
        if (!env?.rules) return false;
        return env.rules.filter(ruleFilter).some((r) => isRuleEnabled(r));
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
  namespaces,
  metadataOptions,
  projectsMap,
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
  capabilities?: SDKCapability[]; // undefined = all capabilities
  savedGroupReferencesEnabled?: boolean;
  organization?: OrganizationInterface;
  savedGroupsMap?: Record<string, SavedGroupInterface>;
  includeRuleIds?: boolean;
  includeExperimentNames?: boolean;
  /** Optional override: if provided, skips derivation from organization.settings.namespaces */
  namespaces?: Map<
    string,
    { hashAttribute?: string; seed?: string; format?: "legacy" | "multiRange" }
  >;
  metadataOptions?: MetadataOptions;
  projectsMap?: Map<string, ProjectInterface>;
}): FeatureDefinition | null {
  const settings = feature.environmentSettings?.[environment];

  // Don't include features which are disabled for this environment
  if (!settings || !settings.enabled || feature.archived) {
    return null;
  }

  const defaultValue = revision
    ? (revision.defaultValue ?? feature.defaultValue)
    : feature.defaultValue;

  const rules = revision
    ? (revision.rules?.[environment] ?? settings.rules)
    : settings.rules;

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
            force: getJSONValue(feature.valueType, feature.holdout.value),
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
          ...(includeRuleIds && r.id != null ? { id: r.id } : {}),
        } as FeatureDefinitionRule;

        // Experiment reference rules inherit everything from the experiment
        if (r.type === "experiment-ref") {
          const exp = experimentMap.get(r.experimentId);
          if (!exp) return null;

          if (!includeExperimentInPayload(exp)) return null;

          // Never include experiment drafts
          if (exp.status === "draft") return null;

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

          // Stopped experiment
          if (exp.status === "stopped") {
            const variation = r.variations.find(
              (v) => v.variationId === exp.releasedVariationId,
            );
            if (!variation) return null;

            // If a variation has been rolled out to 100%
            rule.force = getJSONValue(feature.valueType, variation.value);
          }
          // Running experiment
          else {
            rule.variations = getLatestPhaseVariations(exp).map((v) => {
              const variation = r.variations.find(
                (ruleVariation) => v.id === ruleVariation.variationId,
              );
              return variation
                ? getJSONValue(feature.valueType, variation.value)
                : null;
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
              (picked as Record<string, unknown>).id = r.id;
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
          rule.force = getJSONValue(feature.valueType, r.value);
        } else if (r.type === "experiment") {
          rule.variations = r.values.map((v) =>
            getJSONValue(feature.valueType, v.value),
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
          rule.force = getJSONValue(feature.valueType, r.value);
          const clampedCoverage =
            r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;
          // At 100% coverage, treat as a force rule so users without hashAttribute aren't excluded
          if (clampedCoverage < 1) {
            rule.coverage = clampedCoverage;
            if (r.hashAttribute) {
              rule.hashAttribute = r.hashAttribute;
            }
            if (r.seed) {
              rule.seed = r.seed;
            }
          }
        } else if (r.type === "safe-rollout") {
          const safeRollout = safeRolloutMap.get(r.safeRolloutId);

          if (r.status === "released") {
            const variationValue = r.variationValue;
            if (isNil(variationValue)) return null;

            // If a variation has been rolled out to 100%
            rule.force = getJSONValue(feature.valueType, variationValue);
          } else if (r.status === "rolled-back") {
            const controlValue = r.controlValue;
            if (isNil(controlValue)) return null;

            // Return control value if rolled back. Feature default value might not be the same as the control value.
            rule.force = getJSONValue(feature.valueType, controlValue);
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
              getJSONValue(feature.valueType, r.controlValue),
              getJSONValue(feature.valueType, r.variationValue),
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
            if (includeExperimentNames)
              rule.name = `${feature.id} - Safe Rollout`;
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
            picked.id = r.id;
          }
          return picked;
        }
        return rule;
      })
      ?.filter(isRule) ?? []),
  ];

  let def: FeatureDefinition = {
    defaultValue: getJSONValue(feature.valueType, defaultValue),
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

// Populates the values of `environmentRecord` for environment keys which are undefined in the record
// and have a parent (base) environment to inherit from which is defined.
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
    // If no definition for the environment exists, recursively inherit from the parent environments
    let baseEnv = environmentParents[env];
    while (baseEnv && typeof mutableClone[baseEnv] === "undefined") {
      baseEnv = environmentParents[baseEnv];
    }
    // If a valid parent was found, copy its value in the record
    if (baseEnv) {
      mutableClone[env] = cloneDeep(mutableClone[baseEnv]);
    }
  });
  return mutableClone;
}
