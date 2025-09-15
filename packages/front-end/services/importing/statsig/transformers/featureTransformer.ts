import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { StatSigFeatureGate, StatSigDynamicConfig } from "../types";
import { transformStatsigConditionsToGB } from "./ruleTransformer";

/**
 * Transform Statsig feature gate or dynamic config to GrowthBook feature
 */
export function transformStatSigFeatureGateToGB(
  featureGate: StatSigFeatureGate | StatSigDynamicConfig,
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
): Omit<
  FeatureInterface,
  "organization" | "dateCreated" | "dateUpdated" | "version"
> {
  const { id, description, isEnabled, rules, tags, owner } = featureGate;

  // Set value type and default value based on explicit type
  const isDynamicConfig = type === "dynamicConfig";

  console.log("Feature transformer debug:", {
    id: featureGate.id,
    type,
    isDynamicConfig,
    hasDefaultValue: "defaultValue" in featureGate,
    hasVariants:
      isDynamicConfig &&
      (featureGate as StatSigDynamicConfig).rules.some(
        (r) => (r.variants?.length ?? 0) > 0,
      ),
  });

  const valueType: "boolean" | "string" | "number" | "json" = isDynamicConfig
    ? "json"
    : "boolean";
  const defaultValue = isDynamicConfig
    ? JSON.stringify((featureGate as StatSigDynamicConfig).defaultValue)
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

  // Process each StatSig rule and assign to appropriate environments
  rules.forEach((rule, ruleIndex) => {
    try {
      const transformedCondition = transformStatsigConditionsToGB(
        rule.conditions,
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
        console.log(
          "Processing variants for rule:",
          rule.id,
          "variants:",
          rule.variants.length,
        );
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
            hashAttribute: "id",
            savedGroups: transformedCondition.savedGroups.map((id) => ({
              match: "all",
              ids: [id],
            })),
            prerequisites: transformedCondition.prerequisites?.map((id) => ({
              id,
              condition: JSON.stringify({ value: true }),
            })),
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
          savedGroups: transformedCondition.savedGroups.map((id) => ({
            match: "all",
            ids: [id],
          })),
          prerequisites: transformedCondition.prerequisites?.map((id) => ({
            id,
            condition: JSON.stringify({ value: true }), // Prerequisite must be true
          })),
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
          hashAttribute: "id", // Default hash attribute for rollouts
          savedGroups: transformedCondition.savedGroups.map((id) => ({
            match: "all",
            ids: [id],
          })),
          prerequisites: transformedCondition.prerequisites?.map((id) => ({
            id,
            condition: JSON.stringify({ value: true }), // Prerequisite must be true
          })),
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

  const result = {
    id,
    description: description || "",
    valueType,
    defaultValue,
    environmentSettings,
    owner: ownerString,
    tags: tags || [],
    project: project || "",
  };

  console.log("Final feature result:", {
    id: result.id,
    valueType: result.valueType,
    defaultValue: result.defaultValue,
    rulesCount: Object.values(result.environmentSettings).reduce(
      (sum, env) => sum + env.rules.length,
      0,
    ),
  });

  return result;
}
