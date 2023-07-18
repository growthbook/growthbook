import isEqual from "lodash/isEqual";
import { FeatureRule as FeatureDefinitionRule } from "@growthbook/growthbook";
import {
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
} from "../../types/feature";
import { FeatureDefinition } from "../../types/api";
import { GroupMap } from "../../types/saved-group";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { ExperimentInterface } from "../../types/experiment";
import { getCurrentEnabledState } from "./scheduleRules";

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap
) {
  const newString = condition.replace(
    // Ex: replace { $inGroup: "sdf8sd9f87s0dfs09d8" } with { $in: ["123, 345, 678, 910"]}
    /[\s|\n]*"\$(inGroup|notInGroup)"[\s|\n]*:[\s|\n]*"([^"]*)"[\s|\n]*/g,
    (match: string, operator: string, groupId: string) => {
      const newOperator = operator === "inGroup" ? "$in" : "$nin";
      const ids: string[] | number[] = groupMap.get(groupId) ?? [];
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

  return true;
}

export function getEnabledEnvironments(
  features: FeatureInterface | FeatureInterface[],
  ruleFilter?: (rule: FeatureRule) => boolean | unknown
): Set<string> {
  if (!Array.isArray(features)) features = [features];

  const environments = new Set<string>();
  features.forEach((feature) => {
    const settings = feature.environmentSettings || {};

    Object.keys(settings)
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
  updatedFeature: FeatureInterface
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
  if (allEnvKeys.some((k) => !isEqual(originalFeature[k], updatedFeature[k]))) {
    getEnabledEnvironments([originalFeature, updatedFeature]).forEach((e) =>
      environments.add(e)
    );
  }

  const allEnvs = new Set([
    ...Object.keys(originalFeature.environmentSettings),
    ...Object.keys(updatedFeature.environmentSettings),
  ]);

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
  ruleFilter?: (rule: FeatureRule) => boolean | unknown
): SDKPayloadKey[] {
  const keys: SDKPayloadKey[] = [];

  features.forEach((feature) => {
    const environments = getEnabledEnvironments(feature, ruleFilter);
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
  useDraft = false,
}: {
  feature: FeatureInterface;
  environment: string;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  useDraft?: boolean;
}): FeatureDefinition | null {
  const settings = feature.environmentSettings?.[environment];

  // Don't include features which are disabled for this environment
  if (!settings || !settings.enabled || feature.archived) {
    return null;
  }

  const draft = feature.draft;
  if (!draft?.active) {
    useDraft = false;
  }

  const defaultValue = useDraft
    ? draft?.defaultValue ?? feature.defaultValue
    : feature.defaultValue;

  const rules = useDraft
    ? draft?.rules?.[environment] ?? settings.rules
    : settings.rules;

  const isRule = (
    rule: FeatureDefinitionRule | null
  ): rule is FeatureDefinitionRule => !!rule;

  const def: FeatureDefinition = {
    defaultValue: getJSONValue(feature.valueType, defaultValue),
    rules:
      rules
        ?.filter(isRuleEnabled)
        ?.map((r) => {
          const rule: FeatureDefinitionRule = {};

          // Experiment reference rules inherit everything from the experiment
          if (r.type === "experiment-ref") {
            const exp = experimentMap.get(r.experimentId);
            if (!exp) return null;

            if (exp.status === "stopped") {
              // If a variation has been rolled out to 100%
              if (exp.releasedVariationId) {
                const variation = r.variations.find(
                  (v) => v.variationId === exp.releasedVariationId
                );
                rule.force = variation
                  ? getJSONValue(feature.valueType, variation.value)
                  : null;
                return rule;
              }
              // Otherwise, the experiment is stopped, skip this rule
              else {
                return null;
              }
            }

            // Get current experiment phase and use it to set rule properties
            const phase = exp.phases[exp.phases.length - 1];
            if (!phase) return null;

            if (phase.condition) {
              rule.condition = JSON.parse(
                replaceSavedGroupsInCondition(phase.condition, groupMap)
              );
            }

            rule.variations = exp.variations.map((v) => {
              const variation = r.variations.find(
                (ruleVariation) => v.id === ruleVariation.variationId
              );
              return variation
                ? getJSONValue(feature.valueType, variation.value)
                : null;
            });

            rule.coverage = phase.coverage;

            rule.weights = phase.variationWeights;

            rule.key = exp.trackingKey;
            if (exp.hashAttribute) {
              rule.hashAttribute = exp.hashAttribute;
            }

            if (phase.namespace) {
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
            rule.hashVersion = 2;
            rule.meta = exp.variations.map((v) => ({
              key: v.key,
              name: v.name,
            }));
            rule.phase = exp.phases.length - 1 + "";

            return rule;
          }

          if (r.condition && r.condition !== "{}") {
            try {
              rule.condition = JSON.parse(
                replaceSavedGroupsInCondition(r.condition, groupMap)
              );
            } catch (e) {
              // ignore condition parse errors here
            }
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

            if (r.trackingKey) {
              rule.key = r.trackingKey;
            }
            if (r.hashAttribute) {
              rule.hashAttribute = r.hashAttribute;
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
            rule.coverage =
              r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;

            if (r.hashAttribute) {
              rule.hashAttribute = r.hashAttribute;
            }
          }
          return rule;
        })
        ?.filter(isRule) ?? [],
  };
  if (def.rules && !def.rules.length) {
    delete def.rules;
  }

  return def;
}
