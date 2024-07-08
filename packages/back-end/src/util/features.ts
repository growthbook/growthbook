import isEqual from "lodash/isEqual";
import {
  ConditionInterface,
  FeatureRule as FeatureDefinitionRule,
} from "@growthbook/growthbook";
import { includeExperimentInPayload, isDefined } from "shared/util";
import {
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
  SavedGroupTargeting,
} from "../../types/feature";
import { FeatureDefinitionWithProject } from "../../types/api";
import { GroupMap } from "../../types/saved-group";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { ExperimentInterface } from "../../types/experiment";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { getCurrentEnabledState } from "./scheduleRules";

// eslint-disable-next-line
type GroupMapValue = GroupMap extends Map<any, infer I> ? I : never;

function getSavedGroupCondition(
  group: GroupMapValue,
  groupMap: GroupMap,
  include: boolean
): null | ConditionInterface {
  if (group.type === "condition") {
    try {
      const cond = JSON.parse(
        replaceSavedGroupsInCondition(group.condition || "{}", groupMap)
      );
      return include ? cond : { $not: cond };
    } catch (e) {
      return null;
    }
  }

  if (!group.attributeKey) return null;

  return {
    [group.attributeKey]: { [include ? "$in" : "$nin"]: group.values || [] },
  };
}

export function getParsedCondition(
  groupMap: GroupMap,
  condition?: string,
  savedGroups?: SavedGroupTargeting[]
) {
  const conditions: ConditionInterface[] = [];
  if (condition && condition !== "{}") {
    try {
      const cond = JSON.parse(
        replaceSavedGroupsInCondition(condition, groupMap)
      );
      if (cond) conditions.push(cond);
    } catch (e) {
      // ignore condition parse errors here
    }
  }

  if (savedGroups) {
    savedGroups.forEach(({ ids, match }) => {
      const groups = ids
        .map((id) => groupMap.get(id))
        // Must either have at least 1 value or be a non-empty condition
        .filter((group) => {
          if (!group) return false;
          if (group.type === "condition") {
            if (!group.condition || group.condition === "{}") return false;
          } else {
            if (!group.values?.length) return false;
          }
          return true;
        }) as GroupMapValue[];
      if (!groups.length) return;

      // Add each group as a separate top-level AND
      if (match === "all") {
        groups.forEach((group) => {
          const cond = getSavedGroupCondition(group, groupMap, true);
          if (cond) conditions.push(cond);
        });
      }
      // Add one top-level AND with nested OR conditions
      else if (match === "any") {
        const ors: ConditionInterface[] = [];
        groups.forEach((group) => {
          const cond = getSavedGroupCondition(group, groupMap, true);
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
        groups.forEach((group) => {
          const cond = getSavedGroupCondition(group, groupMap, false);
          if (cond) conditions.push(cond);
        });
      }
    });
  }

  // No conditions
  if (!conditions.length) return undefined;
  // Exactly one condition, return it
  if (conditions.length === 1) {
    return conditions[0];
  }
  // Multiple conditions, AND them together
  return {
    $and: conditions,
  };
}

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap
) {
  const newString = condition.replace(
    // Ex: replace { $inGroup: "sdf8sd9f87s0dfs09d8" } with { $in: ["123, 345, 678, 910"]}
    /[\s|\n]*"\$(inGroup|notInGroup)"[\s|\n]*:[\s|\n]*"([^"]*)"[\s|\n]*/g,
    (match: string, operator: string, groupId: string) => {
      const newOperator = operator === "inGroup" ? "$in" : "$nin";
      const ids: (string | number)[] = groupMap.get(groupId)?.values ?? [];
      return `"${newOperator}": ${JSON.stringify(ids)}`;
    }
  );

  return newString;
}

export function isRuleEnabled(rule: FeatureRule): boolean {
  // Manually disabled
  if (!rule.enabled) return false;

  // Disabled because of an automatic schedule
  if (!getCurrentEnabledState(rule.scheduleRules || [], new Date())) {
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
  ruleFilter?: (rule: FeatureRule) => boolean | unknown
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
        return env.rules.filter(ruleFilter).some(isRuleEnabled);
      })
      .forEach((e) => environments.add(e));
  });

  return environments;
}

export function getSDKPayloadKeys(
  environments: Set<string>,
  projects: Set<string>
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
  allowedEnvs: string[]
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
  ];

  if (
    allEnvKeys.some(
      (k) => !isEqual(originalFeature[k] ?? null, updatedFeature[k] ?? null)
    )
  ) {
    getEnabledEnvironments(
      [originalFeature, updatedFeature],
      allowedEnvs
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
  ruleFilter?: (rule: FeatureRule) => boolean | unknown
): SDKPayloadKey[] {
  const keys: SDKPayloadKey[] = [];

  features.forEach((feature) => {
    const environments = getEnabledEnvironments(
      feature,
      allowedEnvs,
      ruleFilter
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

// eslint-disable-next-line
export function getJSONValue(type: FeatureValueType, value: string): any {
  if (type === "json") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (type === "number") return parseFloat(value) || 0;
  if (type === "string") return value;
  if (type === "boolean") return value === "false" ? false : true;
  return null;
}

export function roundVariationWeight(num: number): number {
  return Math.round(num * 10000) / 10000;
}

export function getFeatureDefinition({
  feature,
  environment,
  groupMap,
  experimentMap,
  revision,
  returnRuleId = false,
}: {
  feature: FeatureInterface;
  environment: string;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  revision?: FeatureRevisionInterface;
  returnRuleId?: boolean;
}): FeatureDefinitionWithProject | null {
  const settings = feature.environmentSettings?.[environment];

  // Don't include features which are disabled for this environment
  if (!settings || !settings.enabled || feature.archived) {
    return null;
  }

  const defaultValue = revision
    ? revision.defaultValue ?? feature.defaultValue
    : feature.defaultValue;

  const rules = revision
    ? revision.rules?.[environment] ?? settings.rules
    : settings.rules;

  // convert prerequisites to force rules:
  const prerequisiteRules = (feature.prerequisites ?? [])
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
    .filter(isDefined);

  const isRule = (
    rule: FeatureDefinitionRule | null
  ): rule is FeatureDefinitionRule => !!rule;

  const defRules = [
    ...prerequisiteRules,
    ...(rules
      ?.filter(isRuleEnabled)
      ?.map((r) => {
        const rule: FeatureDefinitionRule = {};

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

          const condition = getParsedCondition(
            groupMap,
            phase.condition,
            phase.savedGroups
          );
          if (condition) {
            rule.condition = condition;
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
            rule.namespace = [
              phase.namespace.name,
              // eslint-disable-next-line
              parseFloat(phase.namespace.range[0] as any) || 0,
              // eslint-disable-next-line
              parseFloat(phase.namespace.range[1] as any) || 0,
            ];
          }

          if (phase.seed) {
            rule.seed = phase.seed;
          }
          rule.hashVersion = exp.hashVersion;

          // Stopped experiment
          if (exp.status === "stopped") {
            const variation = r.variations.find(
              (v) => v.variationId === exp.releasedVariationId
            );
            if (!variation) return null;

            // If a variation has been rolled out to 100%
            rule.force = getJSONValue(feature.valueType, variation.value);
          }
          // Running experiment
          else {
            rule.variations = exp.variations.map((v) => {
              const variation = r.variations.find(
                (ruleVariation) => v.id === ruleVariation.variationId
              );
              return variation
                ? getJSONValue(feature.valueType, variation.value)
                : null;
            });
            rule.weights = phase.variationWeights;
            rule.key = exp.trackingKey;
            rule.meta = exp.variations.map((v) => ({
              key: v.key,
              name: v.name,
            }));
            rule.phase = exp.phases.length - 1 + "";
            rule.name = exp.name;
          }
          if (returnRuleId) rule.id = r.id;
          return rule;
        }

        const condition = getParsedCondition(
          groupMap,
          r.condition,
          r.savedGroups
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
        if (prerequisites?.length) {
          rule.parentConditions = prerequisites;
        }

        if (r.type === "force") {
          rule.force = getJSONValue(feature.valueType, r.value);
        } else if (r.type === "experiment") {
          rule.variations = r.values.map((v) =>
            getJSONValue(feature.valueType, v.value)
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
            rule.namespace = [
              r.namespace.name,
              // eslint-disable-next-line
              parseFloat(r.namespace.range[0] as any) || 0,
              // eslint-disable-next-line
              parseFloat(r.namespace.range[1] as any) || 0,
            ];
          }
        } else if (r.type === "rollout") {
          rule.force = getJSONValue(feature.valueType, r.value);
          rule.coverage = r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;

          if (r.hashAttribute) {
            rule.hashAttribute = r.hashAttribute;
          }
        }
        if (returnRuleId) rule.id = r.id;
        return rule;
      })
      ?.filter(isRule) ?? []),
  ];

  const def: FeatureDefinitionWithProject = {
    defaultValue: getJSONValue(feature.valueType, defaultValue),
    project: feature.project,
    rules: defRules,
  };
  if (def.rules && !def.rules.length) {
    delete def.rules;
  }

  return def;
}
