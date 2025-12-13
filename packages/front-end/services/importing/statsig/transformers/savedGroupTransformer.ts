import { SavedGroupInterface } from "shared/types/groups";
import { SDKAttribute } from "back-end/types/organization";
import { StatsigSavedGroup } from "@/services/importing/statsig/types";
import { transformStatsigConditionsToGB } from "./ruleTransformer";
import { mapStatsigAttributeToGB } from "./attributeMapper";
import { ensureAttributeExists } from "./attributeCreator";

/**
 * Transform Statsig segment to GrowthBook saved group
 */
export async function transformStatsigSegmentToSavedGroup(
  segment: StatsigSavedGroup,
  existingAttributeSchema: SDKAttribute[],
  apiCall: (
    path: string,
    options?: { method: string; body: string },
  ) => Promise<unknown>,
  project?: string,
  skipAttributeMapping: boolean = false,
  _savedGroupIdMap?: Map<string, string>,
): Promise<
  Omit<
    SavedGroupInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >
> {
  function transformStatsigRulesToCondition(
    rules: StatsigSavedGroup["rules"],
  ): string {
    if (!rules || rules.length === 0) {
      return "{}";
    }

    // Transform each rule's conditions separately
    const ruleConditions: string[] = [];

    rules.forEach((rule) => {
      if (rule.conditions && rule.conditions.length > 0) {
        // Transform this rule's conditions to GrowthBook format
        const transformed = transformStatsigConditionsToGB(
          rule.conditions,
          skipAttributeMapping,
          undefined, // Don't resolve saved groups during saved group creation
        );
        if (transformed.condition && transformed.condition !== "{}") {
          ruleConditions.push(transformed.condition);
        }
      }
    });

    if (ruleConditions.length === 0) {
      return "{}";
    }

    // If only one rule, return its condition directly
    if (ruleConditions.length === 1) {
      return ruleConditions[0];
    }

    // Multiple rules - OR them together
    return JSON.stringify({
      $or: ruleConditions.map((cond) => JSON.parse(cond)),
    });
  }

  if (segment.type === "id_list") {
    // ID List type - convert to GrowthBook "list" type
    const statsigAttributeKey = segment.idType || "user_id";
    const gbAttributeKey = mapStatsigAttributeToGB(
      statsigAttributeKey,
      skipAttributeMapping,
    );

    // Ensure the attribute exists before using it
    await ensureAttributeExists(
      gbAttributeKey,
      existingAttributeSchema,
      apiCall,
      [], // No operators for id_list type
    );

    return {
      groupName: segment.id,
      owner: segment.lastModifierName || "",
      type: "list",
      attributeKey: gbAttributeKey,
      values: segment.ids || [],
      description: segment.description,
      projects: project ? [project] : [],
    };
  } else if (segment.type === "rule_based") {
    const condition = transformStatsigRulesToCondition(segment.rules);

    // Extract attribute names and operators from the condition and ensure they exist
    if (segment.rules) {
      const allConditions = segment.rules.flatMap(
        (rule) => rule.conditions || [],
      );

      // Group conditions by attribute name to collect operators
      const attributeOperatorMap = new Map<
        string,
        { attributeName: string; operators: string[] }
      >();

      allConditions.forEach((cond) => {
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
          attributeOperatorMap
            .get(attributeName)!
            .operators.push(cond.operator);
        }
      });

      // Ensure all attributes exist with their operators
      for (const {
        attributeName,
        operators,
      } of attributeOperatorMap.values()) {
        await ensureAttributeExists(
          attributeName,
          existingAttributeSchema,
          apiCall,
          operators,
        );
      }
    }

    return {
      groupName: segment.id,
      owner: segment.lastModifierName || "",
      type: "condition",
      condition: condition,
      description: segment.description,
      projects: project ? [project] : [],
    };
  }

  throw new Error(`Unknown segment type: ${segment.type}`);
}
