import { SavedGroupInterface } from "shared/src/types";
import { SDKAttribute } from "back-end/types/organization";
import {
  StatsigSavedGroup,
  StatsigCondition,
} from "@/services/importing/statsig/types";
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

    // Collect all conditions from all rules
    const allConditions: StatsigCondition[] = [];
    rules.forEach((rule) => {
      if (rule.conditions && rule.conditions.length > 0) {
        allConditions.push(...rule.conditions);
      }
    });

    if (allConditions.length === 0) {
      return "{}";
    }

    // Transform all conditions to GrowthBook format
    const transformed = transformStatsigConditionsToGB(allConditions);
    return transformed.condition;
  }

  if (segment.type === "id_list") {
    // ID List type - convert to GrowthBook "list" type
    const statsigAttributeKey = segment.idType || "id";
    const gbAttributeKey = mapStatsigAttributeToGB(statsigAttributeKey);

    // Ensure the attribute exists before using it
    await ensureAttributeExists(
      gbAttributeKey,
      existingAttributeSchema,
      apiCall,
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

    // Extract attribute names from the condition and ensure they exist
    if (segment.rules) {
      const allConditions = segment.rules.flatMap(
        (rule) => rule.conditions || [],
      );
      const uniqueAttributeNames = new Set(
        allConditions.map((cond) => mapStatsigAttributeToGB(cond.type)),
      );

      // Ensure all attributes exist
      for (const attributeName of uniqueAttributeNames) {
        await ensureAttributeExists(
          attributeName,
          existingAttributeSchema,
          apiCall,
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
