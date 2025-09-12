import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { StatSigFeatureGate, StatSigRule } from "../types";
import { transformStatSigConditionsToGB } from "./ruleTransformer";
import { mapStatSigAttributeToGB } from "./attributeMapper";

/**
 * Transform StatSig feature gate to GrowthBook feature
 */
export function transformStatSigFeatureGateToGB(
  featureGate: StatSigFeatureGate,
  availableEnvironments: string[],
  existingAttributeSchema: any[],
  apiCall: (path: string, options?: unknown) => Promise<unknown>,
): Omit<FeatureInterface, "organization" | "dateCreated" | "dateUpdated" | "version"> {
  const { id, name, description, isEnabled, rules, tags, owner } = featureGate;

  // Determine value type - StatSig feature gates are typically boolean
  const valueType: "boolean" | "string" | "number" | "json" = "boolean";
  const defaultValue = "false"; // Default to false for feature gates

  // Transform rules to GrowthBook format per environment
  const environmentSettings: FeatureInterface["environmentSettings"] = {};
  
  // Initialize all available environments
  availableEnvironments.forEach(envKey => {
    environmentSettings[envKey] = {
      enabled: isEnabled,
      rules: [],
    };
  });
  
  // Process each StatSig rule and assign to appropriate environments
  rules.forEach((rule, ruleIndex) => {
    try {
      const transformedCondition = transformStatSigConditionsToGB(rule.conditions);
      
      // Determine which environments this rule applies to
      const targetEnvironments = rule.environments === null 
        ? availableEnvironments // null means all environments
        : rule.environments || []; // specific environments or empty array
      
      // Create the appropriate rule type based on passPercentage
      let gbRule: FeatureRule;
      
      if (rule.passPercentage === 100) {
        // Create a force rule for 100% pass percentage
        gbRule = {
          type: "force",
          id: rule.id || `rule_${ruleIndex}`,
          description: rule.name || `Rule ${ruleIndex + 1}`,
          condition: transformedCondition.condition,
          enabled: true,
          value: "true", // Feature gates are boolean, so true when rule matches
          savedGroups: transformedCondition.savedGroups.map(id => ({ match: "all", ids: [id] })),
          prerequisites: transformedCondition.prerequisites.map(id => ({
            id,
            condition: JSON.stringify({ value: true }), // Prerequisite must be true
          })),
        };
      } else {
        // Create a rollout rule for partial pass percentage
        gbRule = {
          type: "rollout",
          id: rule.id || `rule_${ruleIndex}`,
          description: rule.name || `Rule ${ruleIndex + 1}`,
          condition: transformedCondition.condition,
          enabled: true,
          value: "true", // Feature gates are boolean, so true when rule matches
          coverage: rule.passPercentage / 100, // Convert percentage to decimal
          hashAttribute: "id", // Default hash attribute for rollouts
          savedGroups: transformedCondition.savedGroups.map(id => ({ match: "all", ids: [id] })),
          prerequisites: transformedCondition.prerequisites.map(id => ({
            id,
            condition: JSON.stringify({ value: true }), // Prerequisite must be true
          })),
        };
      }
      
      // Add the rule to all target environments
      targetEnvironments.forEach(envKey => {
        if (environmentSettings[envKey]) {
          environmentSettings[envKey].rules.push(gbRule);
        }
      });
      
    } catch (error) {
      console.error(`Error transforming rule ${rule.id}:`, error);
    }
  });

  // Format owner information
  const ownerString = owner 
    ? `${owner.ownerName} (${owner.ownerEmail})`
    : "";

  return {
    id,
    description: description || "",
    valueType,
    defaultValue,
    environmentSettings,
    owner: ownerString,
    tags: tags || [],
  };
}

/**
 * Check if a StatSig feature gate has meaningful changes compared to existing GrowthBook feature
 */
export function hasFeatureChanges(
  statsigFeature: StatSigFeatureGate,
  existingFeature: FeatureInterface,
): boolean {
  // Compare basic properties
  if (statsigFeature.description !== existingFeature.description) {
    return true;
  }
  
  if (statsigFeature.tags?.join(",") !== existingFeature.tags?.join(",")) {
    return true;
  }
  
  // Compare environment settings
  const envKey = "production"; // Default environment
  const existingEnv = existingFeature.environmentSettings[envKey];
  
  if (!existingEnv) {
    return true; // No existing environment settings
  }
  
  if (existingEnv.enabled !== statsigFeature.isEnabled) {
    return true;
  }
  
  // Compare rules (simplified comparison)
  if (existingEnv.rules.length !== statsigFeature.rules.length) {
    return true;
  }
  
  // More detailed rule comparison could be added here
  
  return false;
}
