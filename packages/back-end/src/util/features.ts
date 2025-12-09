import isEqual from "lodash/isEqual";
import {
  ConditionInterface,
  FeatureRule as FeatureDefinitionRule,
  ParentConditionInterface,
} from "@growthbook/growthbook";
import { includeExperimentInPayload, isDefined } from "shared/util";
import { GroupMap } from "shared/types/groups";
import { cloneDeep, isNil } from "lodash";
import md5 from "md5";
import { FeatureDefinitionWithProject } from "shared/types/sdk";
import { HoldoutInterface } from "back-end/src/validators/holdout";
import {
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
  SavedGroupTargeting,
} from "back-end/types/feature";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { ExperimentInterface } from "back-end/types/experiment";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { Environment } from "back-end/types/organization";
import { SafeRolloutInterface } from "back-end/types/safe-rollout";
import { getCurrentEnabledState } from "./scheduleRules";

function getSavedGroupCondition(
  groupId: string,
  groupMap: GroupMap,
  include: boolean,
): null | ConditionInterface {
  const group = groupMap.get(groupId);
  if (!group) return null;
  if (group.type === "condition") {
    // For condition groups, combine condition + savedGroups using getParsedCondition
    const combined = getParsedCondition(
      groupMap,
      group.condition,
      group.savedGroups,
    );
    if (combined) {
      return include ? combined : { $not: combined };
    }
    return null;
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
          // Condition groups must be non-empty (check combined condition + savedGroups)
          const hasCondition = group.condition && group.condition !== "{}";
          const hasSavedGroups = group.savedGroups && group.savedGroups.length > 0;
          if (!hasCondition && !hasSavedGroups) return false;
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
  groupMap: GroupMap,
) {
  const newString = condition.replace(
    // Ex: replace { $inGroup: "sdf8sd9f87s0dfs09d8" } with { $in: ["123, 345, 678, 910"]}
    /[\s|\n]*"\$(inGroup|notInGroup)"[\s|\n]*:[\s|\n]*"([^"]*)"[\s|\n]*/g,
    (match: string, operator: string, groupId: string) => {
      const newOperator = operator === "inGroup" ? "$in" : "$nin";
      const ids: (string | number)[] = groupMap.get(groupId)?.values ?? [];
      return `"${newOperator}": ${JSON.stringify(ids)}`;
    },
  );

  return newString;
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

export function getHoldoutFeatureDefId(holdoutId: string) {
  return `$holdout:${holdoutId}`;
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
    { holdout: HoldoutInterface; experiment: ExperimentInterface }
  >;
}): FeatureDefinitionWithProject | null {
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

  // If the feature has a holdout and it's enabled for the environment, add holdout as a
  // pseudo force rule with a prerequisite condition. The environment being enabled is
  // already checked in the getAllPayloadHoldouts function.
  const holdoutRule: FeatureDefinitionRule[] =
    feature.holdout &&
    holdoutsMap &&
    holdoutsMap.get(feature.holdout.id)?.holdout.environmentSettings?.[
      environment
    ]?.enabled
      ? [
          {
            id: `holdout_${md5(feature.id + feature.holdout.id)}`,
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
          id: r.id,
        };

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
              (v) => v.variationId === exp.releasedVariationId,
            );
            if (!variation) return null;

            // If a variation has been rolled out to 100%
            rule.force = getJSONValue(feature.valueType, variation.value);
          }
          // Running experiment
          else {
            rule.variations = exp.variations.map((v) => {
              const variation = r.variations.find(
                (ruleVariation) => v.id === ruleVariation.variationId,
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
          if (r.seed) {
            rule.seed = r.seed;
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
            rule.meta = [
              { key: "0", name: "Control" },
              { key: "1", name: "Variation" },
            ];
            rule.phase = "0";
            rule.name = `${feature.id} - Safe Rollout`;
          }
        }
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

// Populates the values of `environmentRecord` for environment keys which are undefined in the record
// and have a parent (base) environment to inherit from which is defined.
export function applyEnvironmentInheritance<T>(
  environments: Environment[],
  environmentRecord: Record<string, T>,
): Record<string, T> {
  const environmentParents = Object.fromEntries(
    environments.filter((env) => env.parent).map((env) => [env.id, env.parent]),
  );
  const mutableClone = cloneDeep(environmentRecord);
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
