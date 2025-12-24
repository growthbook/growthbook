import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { StatsigExperiment } from "../types";
import { transformStatsigConditionsToGB } from "./ruleTransformer";

/**
 * Parse Statsig inline targeting rules JSON
 */
function parseInlineTargetingRules(inlineTargetingRulesJSON: string): Array<{
  groupName: string;
  percentagePass: number;
  conditionJSON: Array<{
    conditionType: number;
    operator: number;
    value: unknown[];
    extraConfig: Record<string, unknown>;
  }>;
  returnValueJSON: string;
  id: string;
  salt: string;
  idType: string;
  rollouts: unknown[];
  enabledEnvironments?: string[];
}> {
  try {
    return JSON.parse(inlineTargetingRulesJSON);
  } catch (error) {
    console.error("Failed to parse inlineTargetingRulesJSON:", error);
    return [];
  }
}

/**
 * Transform Statsig experiment to GrowthBook experiment-ref feature
 */
export function transformStatsigExperimentToFeature(
  experiment: StatsigExperiment,
  availableEnvironments: string[],
  gbExperiment: { id: string; variations: Array<{ id: string; key: string }> },
  project?: string,
  skipAttributeMapping: boolean = false,
  savedGroupIdMap?: Map<string, string>,
): Omit<
  FeatureInterface,
  "organization" | "dateCreated" | "dateUpdated" | "version"
> {
  const {
    id,
    name,
    description,
    groups,
    owner,
    tags,
    inlineTargetingRulesJSON,
  } = experiment;

  // Parse targeting rules
  const targetingRules = parseInlineTargetingRules(inlineTargetingRulesJSON);

  // Determine value type based on parameterValues
  const hasNonEmptyParameterValues = groups.some((group) =>
    Object.values(group.parameterValues).some(
      (value) => value !== null && value !== undefined && value !== "",
    ),
  );
  const valueType: "boolean" | "string" | "number" | "json" =
    hasNonEmptyParameterValues ? "json" : "number";

  // Create environment settings
  const environmentSettings: FeatureInterface["environmentSettings"] = {};

  // Initialize all available environments
  availableEnvironments.forEach((envKey) => {
    environmentSettings[envKey] = {
      enabled: true,
      rules: [],
    };
  });

  // Process targeting rules
  targetingRules.forEach((rule, ruleIndex) => {
    try {
      // Convert Statsig condition format to our format
      const conditions = rule.conditionJSON.map((cond) => ({
        type: cond.conditionType.toString(),
        operator: cond.operator.toString(),
        targetValue: cond.value,
        field: undefined,
        customID: undefined,
      }));
      const transformedCondition = transformStatsigConditionsToGB(
        conditions,
        skipAttributeMapping,
        savedGroupIdMap,
      );

      // Determine which environments this rule applies to
      const targetEnvironments =
        rule.enabledEnvironments || availableEnvironments;

      // Create the rule
      const gbRule: FeatureRule = {
        type: "force",
        id: rule.id || `rule_${ruleIndex}`,
        description: rule.groupName,
        condition: transformedCondition.condition,
        enabled: true,
        value: rule.returnValueJSON,
        savedGroups: transformedCondition.savedGroups,
        prerequisites: transformedCondition.prerequisites,
        scheduleRules: transformedCondition.scheduleRules || [],
      };

      // Add the rule to all target environments
      targetEnvironments.forEach((envKey) => {
        if (environmentSettings[envKey]) {
          environmentSettings[envKey].rules.push(gbRule);
        }
      });
    } catch (error) {
      console.error(`Error transforming targeting rule ${rule.id}:`, error);
    }
  });

  // Add experiment-ref rule to all environments
  const experimentRefRule: FeatureRule = {
    type: "experiment-ref",
    id: `fr_${gbExperiment.id}`, // Use GrowthBook experiment ID
    description: "",
    condition: "",
    enabled: true,
    experimentId: gbExperiment.id, // Use GrowthBook experiment ID
    variations: groups.map((group, index) => {
      // Find the corresponding GB variation by matching the key
      const gbVariation = gbExperiment.variations.find(
        (v) => v.key === index.toString(),
      );
      return {
        variationId: gbVariation?.id || group.id, // Use GB variation ID
        value: JSON.stringify(group.parameterValues),
      };
    }),
  };

  // Add experiment-ref rule to all environments
  availableEnvironments.forEach((envKey) => {
    if (environmentSettings[envKey]) {
      environmentSettings[envKey].rules.push(experimentRefRule);
    }
  });

  // Format owner information
  const ownerString = owner ? `${owner.ownerName} (${owner.ownerEmail})` : "";

  return {
    id,
    description: description || `Feature for experiment: ${name}`,
    valueType,
    defaultValue: valueType === "json" ? "{}" : "0",
    environmentSettings,
    owner: ownerString,
    tags: tags || [],
    project: project || "",
  };
}
