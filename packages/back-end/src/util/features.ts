import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { FeatureInterface, FeatureValueType } from "../../types/feature";
import { GroupMap } from "../services/features";
import { FeatureDefinition, FeatureDefinitionRule } from "../../types/api";
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

// If changes to a feature are going to affect it's value in at least one environment
export function changesAffectFeatureValue(
  feature: FeatureInterface,
  updatedFeature: FeatureInterface
) {
  // If the feature was and still is archived, then the changes don't matter
  if (feature.archived && updatedFeature.archived) return false;

  const ignoredFields: (keyof FeatureInterface)[] = [
    "description",
    "owner",
    "dateUpdated",
    "tags",
    "revision",
    "draft",
  ];

  return !isEqual(
    omit(feature, ignoredFields),
    omit(updatedFeature, ignoredFields)
  );
}

export function getAffectedEnvs(
  feature: FeatureInterface,
  changedEnvs?: string[]
): string[] {
  const settings = feature.environmentSettings;
  if (!settings) return [];

  if (!changedEnvs) {
    changedEnvs = Object.keys(settings);
  }

  return changedEnvs.filter((e) => settings[e]?.enabled);
}

// When features change, determine which environments/projects are affected
// e.g. If a feature is disabled in all environments, then it's project won't be affected
export function getAffectedEnvironmentsAndProjects(
  changedFeatures: FeatureInterface[],
  allowedEnvs?: string[]
): {
  projects: Set<string>;
  environments: Set<string>;
} {
  // An empty string for projects means "All Projects", so that one is always affected
  const projects: Set<string> = new Set([""]);
  const environments: Set<string> = new Set();

  // Determine which specific environments/projects are affected by the changed features
  changedFeatures.forEach((feature) => {
    const affectedEnvs = getAffectedEnvs(feature, allowedEnvs);
    if (affectedEnvs.length > 0) {
      if (feature.project) projects.add(feature.project);
      affectedEnvs.forEach((env) => {
        environments.add(env);
      });
    }
  });

  return {
    projects,
    environments,
  };
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
  useDraft = false,
}: {
  feature: FeatureInterface;
  environment: string;
  groupMap: GroupMap;
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

  const def: FeatureDefinition = {
    defaultValue: getJSONValue(feature.valueType, defaultValue),
    rules:
      rules
        ?.filter((r) => r.enabled)
        ?.filter((r) => {
          return getCurrentEnabledState(r.scheduleRules || [], new Date());
        })
        ?.map((r) => {
          const rule: FeatureDefinitionRule = {};
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
        }) ?? [],
  };
  if (def.rules && !def.rules.length) {
    delete def.rules;
  }

  return def;
}
