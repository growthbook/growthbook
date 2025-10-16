import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { StatsigFeatureGate, StatsigDynamicConfig } from "../types";
import { transformStatsigConditionsToGB } from "./ruleTransformer";
import { mapStatsigAttributeToGB } from "./attributeMapper";

/**
 * Transform Statsig feature gate or dynamic config to GrowthBook feature
 */
export function transformStatsigFeatureGateToGB(
  featureGate: StatsigFeatureGate | StatsigDynamicConfig,
  availableEnvironments: string[],
  _existingAttributeSchema: Array<{
    property: string;
    datatype:
      | "string"
      | "number"
      | "boolean"
      | "enum"
      | "secureString"
      | "string[]"
      | "number[]"
      | "secureString[]";
    archived?: boolean;
  }>,
  _apiCall: (path: string, options?: unknown) => Promise<unknown>,
  type: "featureGate" | "dynamicConfig" = "featureGate",
  project?: string,
  skipAttributeMapping: boolean = false,
  savedGroupIdMap?: Map<string, string>,
): Omit<
  FeatureInterface,
  "organization" | "dateCreated" | "dateUpdated" | "version"
> {
  const { id, description, isEnabled, rules, tags, owner } = featureGate;

  // Set value type and default value based on explicit type
  const isDynamicConfig = type === "dynamicConfig";

  const valueType: "boolean" | "string" | "number" | "json" = isDynamicConfig
    ? "json"
    : "boolean";
  const defaultValue = isDynamicConfig
    ? JSON.stringify((featureGate as StatsigDynamicConfig).defaultValue)
    : "false";

  // Transform rules to GrowthBook format per environment
  const environmentSettings: FeatureInterface["environmentSettings"] = {};

  // Initialize all available environments
  availableEnvironments.forEach((envKey) => {
    environmentSettings[envKey] = {
      enabled: isEnabled,
      rules: [],
    };
  });

  // Process each Statsig rule and assign to appropriate environments
  rules.forEach((rule, ruleIndex) => {
    try {
      const transformedCondition = transformStatsigConditionsToGB(
        rule.conditions,
        skipAttributeMapping,
        savedGroupIdMap,
      );

      // Determine which environments this rule applies to
      const targetEnvironments =
        rule.environments === null
          ? availableEnvironments // null means all environments
          : rule.environments || []; // specific environments or empty array

      // Create the appropriate rule type based on passPercentage
      let gbRule: FeatureRule;

      // Handle different rule types based on whether it's a dynamic config with variants
      if (isDynamicConfig && rule.variants && rule.variants.length > 0) {
        // Dynamic config with variants - create stacked rollout rules
        let cumulativeCoverage = 0;

        rule.variants.forEach((variant, variantIndex) => {
          const variantCoverage = variant.passPercentage / 100;
          const variantEndCoverage = cumulativeCoverage + variantCoverage;

          const variantRule: FeatureRule = {
            type: "rollout",
            id: `${rule.id}_variant_${variantIndex}`,
            description: `${rule.name || `Rule ${ruleIndex + 1}`} - ${variant.name}`,
            condition: transformedCondition.condition,
            enabled: true,
            value: JSON.stringify(variant.returnValue),
            coverage: variantEndCoverage,
            hashAttribute: mapStatsigAttributeToGB(
              "user_id",
              skipAttributeMapping,
            ),
            savedGroups: transformedCondition.savedGroups,
            prerequisites: transformedCondition.prerequisites,
            scheduleRules: transformedCondition.scheduleRules || [],
          };

          // Add the variant rule to all target environments
          targetEnvironments.forEach((envKey) => {
            if (environmentSettings[envKey]) {
              environmentSettings[envKey].rules.push(variantRule);
            }
          });

          cumulativeCoverage += variantCoverage;
        });

        // Skip the single rule creation below since we handled variants
        return;
      }

      // Single rule logic (feature gates or dynamic configs without variants)
      const ruleValue = isDynamicConfig
        ? JSON.stringify(rule.returnValue) // Dynamic config uses returnValue
        : "true"; // Feature gates are boolean

      if (rule.passPercentage === 100) {
        // Create a force rule for 100% pass percentage
        gbRule = {
          type: "force",
          id: rule.id || `rule_${ruleIndex}`,
          description: rule.name || `Rule ${ruleIndex + 1}`,
          condition: transformedCondition.condition,
          enabled: true,
          value: ruleValue,
          savedGroups: transformedCondition.savedGroups,
          prerequisites: transformedCondition.prerequisites,
          scheduleRules: transformedCondition.scheduleRules || [],
        };
      } else {
        // Create a rollout rule for partial pass percentage
        gbRule = {
          type: "rollout",
          id: rule.id || `rule_${ruleIndex}`,
          description: rule.name || `Rule ${ruleIndex + 1}`,
          condition: transformedCondition.condition,
          enabled: true,
          value: ruleValue,
          coverage: rule.passPercentage / 100, // Convert percentage to decimal
          hashAttribute: mapStatsigAttributeToGB(
            "user_id",
            skipAttributeMapping,
          ), // Default hash attribute for rollouts
          savedGroups: transformedCondition.savedGroups,
          prerequisites: transformedCondition.prerequisites,
          scheduleRules: transformedCondition.scheduleRules || [],
        };
      }

      // Add the rule to all target environments
      targetEnvironments.forEach((envKey) => {
        if (environmentSettings[envKey]) {
          environmentSettings[envKey].rules.push(gbRule);
        }
      });
    } catch (error) {
      console.error(`Error transforming rule ${rule.id}:`, error);
    }
  });

  // Format owner information
  const ownerString = owner ? `${owner.ownerName} (${owner.ownerEmail})` : "";

  return {
    id,
    description: description || "",
    valueType,
    defaultValue,
    environmentSettings,
    owner: ownerString,
    tags: tags || [],
    project: project || "",
  };
}
