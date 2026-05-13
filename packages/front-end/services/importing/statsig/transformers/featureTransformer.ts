import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { SDKAttribute } from "shared/types/organization";
import {
  StatsigFeatureGate,
  StatsigDynamicConfig,
} from "@/services/importing/statsig/types";
import { transformStatsigConditionsToGB } from "./ruleTransformer";
import { mapStatsigAttributeToGB } from "./attributeMapper";
import { ensureAttributeExists } from "./attributeCreator";

/**
 * Transform Statsig feature gate or dynamic config to GrowthBook feature
 */
export async function transformStatsigFeatureGateToGB(
  featureGate: StatsigFeatureGate | StatsigDynamicConfig,
  availableEnvironments: string[],
  existingAttributeSchema: SDKAttribute[],
  apiCall: (path: string, options?: unknown) => Promise<unknown>,
  type: "featureGate" | "dynamicConfig" = "featureGate",
  project?: string,
  skipAttributeMapping: boolean = false,
  savedGroupIdMap?: Map<string, string>,
  featuresMap?: Map<string, FeatureInterface>,
): Promise<
  Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >
> {
  const { id, description, isEnabled, rules, tags, owner } = featureGate;

  // Extract attribute names and operators from all rules' conditions and ensure they exist
  if (rules && apiCall && existingAttributeSchema) {
    const allConditions = rules.flatMap((rule) => rule.conditions || []);

    // Group conditions by attribute name to collect operators
    const attributeOperatorMap = new Map<
      string,
      { attributeName: string; operators: string[] }
    >();

    allConditions.forEach((cond) => {
      // Skip special condition types that are transformed, not treated as attributes
      // Note: "time" with an operator is transformed to scheduleRules, but "time" without
      // an operator should be treated as an attribute, so we don't skip it here
      if (
        cond.type === "passes_segment" ||
        cond.type === "fails_segment" ||
        cond.type === "passes_gate" ||
        cond.type === "fails_gate" ||
        (cond.type === "time" && cond.operator)
      ) {
        return;
      }

      // Determine the attribute name:
      // - For custom_field type, use the field value
      // - For unit_id type with customID, use the customID (custom unit ID)
      // - Otherwise, use the type as the attribute name
      let statsigAttributeName: string;
      if (cond.type === "custom_field") {
        statsigAttributeName = cond.field || "custom_field";
      } else if (cond.type === "unit_id" && cond.customID) {
        statsigAttributeName = cond.customID;
      } else {
        statsigAttributeName = cond.type;
      }

      const attributeName = mapStatsigAttributeToGB(
        statsigAttributeName,
        skipAttributeMapping,
      );
      if (!attributeOperatorMap.has(attributeName)) {
        attributeOperatorMap.set(attributeName, {
          attributeName,
          operators: [],
        });
      }
      if (cond.operator) {
        attributeOperatorMap.get(attributeName)!.operators.push(cond.operator);
      }
    });

    // Ensure all attributes exist with their operators
    for (const { attributeName, operators } of attributeOperatorMap.values()) {
      await ensureAttributeExists(
        attributeName,
        existingAttributeSchema,
        apiCall,
        operators,
      );
    }
  }

  // Set value type and default value based on explicit type
  const isDynamicConfig = type === "dynamicConfig";

  const valueType: "boolean" | "string" | "number" | "json" = isDynamicConfig
    ? "json"
    : "boolean";
  const defaultValue = isDynamicConfig
    ? JSON.stringify((featureGate as StatsigDynamicConfig).defaultValue)
    : "false";

  const environmentSettings: FeatureInterface["environmentSettings"] = {};
  const allRules: FeatureRule[] = [];
  const stampEnv = (r: FeatureRule, envs: string[] | "all"): FeatureRule =>
    envs === "all"
      ? { ...r, allEnvironments: true }
      : { ...r, allEnvironments: false, environments: envs };

  availableEnvironments.forEach((envKey) => {
    environmentSettings[envKey] = { enabled: isEnabled };
  });

  // Process each Statsig rule and assign to appropriate environments
  rules.forEach((rule, ruleIndex) => {
    try {
      const transformedCondition = transformStatsigConditionsToGB(
        rule.conditions,
        skipAttributeMapping,
        savedGroupIdMap,
        featuresMap,
      );

      const targetEnvironments: string[] | "all" =
        rule.environments === null ? "all" : rule.environments || [];

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
            allEnvironments: false,
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

          allRules.push(stampEnv(variantRule, targetEnvironments));

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
        gbRule = {
          type: "force",
          id: rule.id || `rule_${ruleIndex}`,
          description: rule.name || `Rule ${ruleIndex + 1}`,
          allEnvironments: false,
          condition: transformedCondition.condition,
          enabled: true,
          value: ruleValue,
          savedGroups: transformedCondition.savedGroups,
          prerequisites: transformedCondition.prerequisites,
          scheduleRules: transformedCondition.scheduleRules || [],
        };
      } else {
        gbRule = {
          type: "rollout",
          id: rule.id || `rule_${ruleIndex}`,
          description: rule.name || `Rule ${ruleIndex + 1}`,
          allEnvironments: false,
          condition: transformedCondition.condition,
          enabled: true,
          value: ruleValue,
          coverage: rule.passPercentage / 100,
          hashAttribute: mapStatsigAttributeToGB(
            "user_id",
            skipAttributeMapping,
          ),
          savedGroups: transformedCondition.savedGroups,
          prerequisites: transformedCondition.prerequisites,
          scheduleRules: transformedCondition.scheduleRules || [],
        };
      }

      allRules.push(stampEnv(gbRule, targetEnvironments));
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
    rules: allRules,
    owner: ownerString,
    tags: tags || [],
    project: project || "",
  };
}
