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
        // For segments, we want nested segments (passes_segment / fails_segment)
        // to become saved group references via $savedGroups instead of being
        // treated as generic targeting attributes, so we let the transformer
        // populate the savedGroups array and then merge that into the condition.
        const transformed = transformStatsigConditionsToGB(
          rule.conditions,
          skipAttributeMapping,
          _savedGroupIdMap,
        );

        // Start from the base targeting condition (if any)
        let baseConditionObj: Record<string, unknown> = {};
        if (transformed.condition && transformed.condition !== "{}") {
          try {
            baseConditionObj = JSON.parse(transformed.condition) as Record<
              string,
              unknown
            >;
          } catch {
            // If parsing fails for some reason, fall back to an empty object
            baseConditionObj = {};
          }
        }

        // Merge any saved group references into the condition using $savedGroups
        const savedGroups = transformed.savedGroups || [];
        if (savedGroups.length > 0) {
          const includeIds: string[] = [];
          const excludeIds: string[] = [];

          savedGroups.forEach((sg) => {
            if (sg.match === "none") {
              excludeIds.push(...sg.ids);
            } else {
              // "all" (and any future inclusive matches) are treated as inclusion
              includeIds.push(...sg.ids);
            }
          });

          let savedGroupCondition: Record<string, unknown> | null = null;

          if (includeIds.length > 0) {
            savedGroupCondition = {
              $savedGroups: includeIds,
            };
          }

          if (excludeIds.length > 0) {
            const excludeClause: Record<string, unknown> = {
              $not: { $savedGroups: excludeIds },
            };

            if (!savedGroupCondition) {
              savedGroupCondition = excludeClause;
            } else {
              savedGroupCondition = {
                $and: [savedGroupCondition, excludeClause],
              };
            }
          }

          if (savedGroupCondition) {
            const hasBase =
              baseConditionObj && Object.keys(baseConditionObj).length > 0;
            if (!hasBase) {
              baseConditionObj = savedGroupCondition;
            } else {
              baseConditionObj = {
                $and: [baseConditionObj, savedGroupCondition],
              };
            }
          }
        }

        const hasFinalCondition =
          baseConditionObj && Object.keys(baseConditionObj).length > 0;

        if (hasFinalCondition) {
          ruleConditions.push(JSON.stringify(baseConditionObj));
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
