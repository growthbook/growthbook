import { SavedGroupInterface } from "shared/src/types";
import { SDKAttribute } from "back-end/types/organization";
import {
  StatSigSavedGroup,
  StatSigCondition,
} from "@/services/importing/statsig/types";
import { transformStatSigConditionsToGB } from "./ruleTransformer";
import { mapStatSigAttributeToGB } from "./attributeMapper";
import { ensureAttributeExists } from "./attributeCreator";

/**
 * Transform StatSig segment to GrowthBook saved group
 */
export async function transformStatSigSegmentToSavedGroup(
  segment: StatSigSavedGroup,
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
  function transformStatSigRulesToCondition(
    rules: StatSigSavedGroup["rules"],
  ): string {
    if (!rules || rules.length === 0) {
      return "{}";
    }

    // Collect all conditions from all rules
    const allConditions: StatSigCondition[] = [];
    rules.forEach((rule) => {
      if (rule.conditions && rule.conditions.length > 0) {
        allConditions.push(...rule.conditions);
      }
    });

    if (allConditions.length === 0) {
      return "{}";
    }

    // Transform all conditions to GrowthBook format
    const transformed = transformStatSigConditionsToGB(allConditions);
    return transformed.condition;
  }

  if (segment.type === "id_list") {
    // ID List type - convert to GrowthBook "list" type
    const statSigAttributeKey = segment.idType || "id";
    const gbAttributeKey = mapStatSigAttributeToGB(statSigAttributeKey);

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
    const condition = transformStatSigRulesToCondition(segment.rules);

    // Extract attribute names from the condition and ensure they exist
    if (segment.rules) {
      const allConditions = segment.rules.flatMap(
        (rule) => rule.conditions || [],
      );
      const uniqueAttributeNames = new Set(
        allConditions.map((cond) => mapStatSigAttributeToGB(cond.type)),
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
