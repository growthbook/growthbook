import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { StatsigExperiment } from "@/services/importing/statsig/types";
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

  const environmentSettings: FeatureInterface["environmentSettings"] = {};
  const allRules: FeatureRule[] = [];

  availableEnvironments.forEach((envKey) => {
    environmentSettings[envKey] = { enabled: true };
  });

  targetingRules.forEach((rule, ruleIndex) => {
    try {
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

      const targetEnvironments =
        rule.enabledEnvironments || availableEnvironments;

      const gbRule: FeatureRule = {
        type: "force",
        id: rule.id || `rule_${ruleIndex}`,
        description: rule.groupName,
        allEnvironments: false,
        environments: targetEnvironments,
        condition: transformedCondition.condition,
        enabled: true,
        value: rule.returnValueJSON,
        savedGroups: transformedCondition.savedGroups,
        prerequisites: transformedCondition.prerequisites,
        scheduleRules: transformedCondition.scheduleRules || [],
      };

      allRules.push(gbRule);
    } catch (error) {
      console.error(`Error transforming targeting rule ${rule.id}:`, error);
    }
  });

  const experimentRefRule: FeatureRule = {
    type: "experiment-ref",
    id: `fr_${gbExperiment.id}`,
    description: "",
    allEnvironments: true,
    condition: "",
    enabled: true,
    experimentId: gbExperiment.id,
    variations: groups.map((group, index) => {
      const gbVariation = gbExperiment.variations.find(
        (v) => v.key === index.toString(),
      );
      return {
        variationId: gbVariation?.id || group.id,
        value: JSON.stringify(group.parameterValues),
      };
    }),
  };

  allRules.push(experimentRefRule);

  const ownerString = owner ? `${owner.ownerName} (${owner.ownerEmail})` : "";

  return {
    id,
    description: description || `Feature for experiment: ${name}`,
    valueType,
    defaultValue: valueType === "json" ? "{}" : "0",
    environmentSettings,
    rules: allRules,
    owner: ownerString,
    tags: tags || [],
    project: project || "",
  };
}
