import { ConditionInterface } from "@growthbook/growthbook-react";
import { FeatureInterface } from "shared/types/feature";
import { getDefaultPrerequisiteCondition } from "shared/util";
import { StatsigCondition } from "@/services/importing/statsig/types";
import { mapStatsigAttributeToGB } from "./attributeMapper";

export type TransformedCondition = {
  condition: string; // JSON string for targeting conditions
  savedGroups: Array<{
    ids: string[];
    match: "all" | "any" | "none";
  }>; // Array of saved group targeting
  prerequisites?: Array<{
    id: string;
    condition: string;
  }>; // Array of prerequisite feature conditions
  scheduleRules?: [
    start: { timestamp: string; enabled: boolean },
    end: { timestamp: string; enabled: boolean },
  ];
};

/**
 * Transform Statsig conditions to GrowthBook format
 */
export function transformStatsigConditionsToGB(
  conditions: StatsigCondition[],
  skipAttributeMapping: boolean = false,
  savedGroupIdMap?: Map<string, string>,
  featuresMap?: Map<string, FeatureInterface>,
): TransformedCondition {
  const targetingConditions: StatsigCondition[] = [];
  const savedGroups: Array<{ ids: string[]; match: "all" | "any" | "none" }> =
    [];
  const prerequisites: Array<{ id: string; condition: string }> = [];
  let startTime: string | null = null;
  let endTime: string | null = null;

  // Separate conditions into categories
  conditions.forEach((condition) => {
    const { type, operator, targetValue } = condition;

    // Handle special condition types
    if (type === "public") {
      // Everyone condition - no targeting needed
      return;
    }

    // Handle time-based conditions
    if (type === "time" && operator && targetValue) {
      const timestamp = new Date(Number(targetValue)).toISOString();
      if (operator === "after") {
        startTime = timestamp;
      } else if (operator === "before") {
        endTime = timestamp;
      }
      return;
    }

    if (operator === null || operator === undefined) {
      switch (type) {
        case "passes_gate": {
          // These become prerequisites - use default condition based on feature value type
          const prerequisiteFeatureId = String(targetValue);
          const prerequisiteFeature = featuresMap?.get(prerequisiteFeatureId);
          const condition =
            getDefaultPrerequisiteCondition(prerequisiteFeature);
          prerequisites.push({
            id: prerequisiteFeatureId,
            condition,
          });
          return;
        }
        case "fails_gate": {
          // These become prerequisites with not exists (not live) condition
          // For fails_gate, we always use $exists: false regardless of value type
          prerequisites.push({
            id: String(targetValue),
            condition: JSON.stringify({ value: { $exists: false } }),
          });
          return;
        }
        case "passes_segment": {
          // These become saved groups with inclusion
          const segmentName = String(targetValue);
          const savedGroupId = savedGroupIdMap?.get(segmentName);
          if (savedGroupId) {
            savedGroups.push({ ids: [savedGroupId], match: "all" });
          } else {
            console.warn(
              `Saved group ID not found for segment: ${segmentName}`,
            );
            // Fallback to using the name if ID not found
            savedGroups.push({ ids: [segmentName], match: "all" });
          }
          return;
        }
        case "fails_segment": {
          // These become saved groups with exclusion
          const segmentName = String(targetValue);
          const savedGroupId = savedGroupIdMap?.get(segmentName);
          if (savedGroupId) {
            savedGroups.push({ ids: [savedGroupId], match: "none" });
          } else {
            console.warn(
              `Saved group ID not found for segment: ${segmentName}`,
            );
            // Fallback to using the name if ID not found
            savedGroups.push({ ids: [segmentName], match: "none" });
          }
          return;
        }
        default:
          // Other null operator conditions go to targeting
          targetingConditions.push(condition);
          return;
      }
    }

    // All other conditions go to targeting
    targetingConditions.push(condition);
  });

  // Convert targeting conditions to GrowthBook format
  const conditionString =
    targetingConditions.length > 0
      ? transformTargetingConditions(targetingConditions, skipAttributeMapping)
      : "{}";

  // Create schedule rules tuple if we have both start and end times
  const scheduleRules:
    | [
        start: { timestamp: string; enabled: boolean },
        end: { timestamp: string; enabled: boolean },
      ]
    | undefined =
    startTime && endTime
      ? [
          { timestamp: startTime, enabled: true },
          { timestamp: endTime, enabled: false },
        ]
      : undefined;

  return {
    condition: conditionString,
    savedGroups,
    prerequisites: prerequisites?.length > 0 ? prerequisites : undefined,
    scheduleRules,
  };
}

/**
 * Transform targeting conditions to GrowthBook condition string
 */
function transformTargetingConditions(
  conditions: StatsigCondition[],
  skipAttributeMapping: boolean = false,
): string {
  // Map Statsig operators to GrowthBook operators
  const operatorMap: Record<string, string> = {
    any: "$in",
    none: "$nin",
    str_contains_any: "$regex",
    str_contains_none: "$regex",
    str_matches: "$regex",
    any_case_sensitive: "$in",
    any_case_insensitive: "$in",
    none_case_sensitive: "$nin",
    none_case_insensitive: "$nin",
    lt: "$lt",
    gt: "$gt",
    lte: "$lte",
    gte: "$gte",
    version_lt: "$vlt",
    version_gt: "$vgt",
    version_lte: "$vlte",
    version_gte: "$vgte",
    before: "$lt",
    after: "$gt",
    on: "$eq",
    is_null: "$exists",
    is_not_null: "$exists",
  };

  const conditionObj: ConditionInterface = {};

  conditions.forEach((condition) => {
    const { type, operator, targetValue, field, customID } = condition;
    const gbOperator = operatorMap[operator] || "$eq";

    // Determine the attribute name:
    // - For custom_field type, use the field value
    // - For unit_id type with customID, use the customID (custom unit ID)
    // - Otherwise, use the type as the attribute name
    let attributeName: string;
    if (type === "custom_field") {
      attributeName = field || "custom_field";
    } else if (type === "unit_id" && customID) {
      attributeName = customID;
    } else {
      attributeName = type;
    }
    const gbAttributeName = mapStatsigAttributeToGB(
      attributeName,
      skipAttributeMapping,
    );

    // Initialize the attribute object if it doesn't exist
    if (!conditionObj[gbAttributeName]) {
      conditionObj[gbAttributeName] = {};
    }

    if (operator === "str_contains_any") {
      const values = Array.isArray(targetValue) ? targetValue : [targetValue];
      const escapedValues = values.map((v) =>
        String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      const regex = escapedValues.join("|");
      conditionObj[gbAttributeName] = { $regex: regex };
    } else if (operator === "str_contains_none") {
      const values = Array.isArray(targetValue) ? targetValue : [targetValue];
      const escapedValues = values.map((v) =>
        String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      const regex = escapedValues.join("|");
      conditionObj[gbAttributeName] = {
        $not: { $regex: regex },
      };
    } else if (operator === "is_null") {
      conditionObj[gbAttributeName] = { $exists: false };
    } else if (operator === "is_not_null") {
      conditionObj[gbAttributeName] = { $exists: true };
    } else if (gbOperator === "$in" || gbOperator === "$nin") {
      const values = Array.isArray(targetValue) ? targetValue : [targetValue];

      // Check if we already have a conflicting operator on this attribute
      const existingCondition = conditionObj[gbAttributeName];
      if (existingCondition && typeof existingCondition === "object") {
        if (gbOperator === "$nin" && "$in" in existingCondition) {
          // We have both $in and $nin - need to use $and
          conditionObj[gbAttributeName] = {
            $and: [
              { [gbAttributeName]: { $in: existingCondition.$in } },
              { [gbAttributeName]: { $nin: values } },
            ],
          };
        } else if (gbOperator === "$in" && "$nin" in existingCondition) {
          // Reverse case: existing $nin, new $nin
          conditionObj[gbAttributeName] = {
            $and: [
              { [gbAttributeName]: { $nin: existingCondition.$nin } },
              { [gbAttributeName]: { $in: values } },
            ],
          };
        } else {
          // No conflict, merge normally
          conditionObj[gbAttributeName][gbOperator] = values;
        }
      } else {
        conditionObj[gbAttributeName] = { [gbOperator]: values };
      }
    } else if (gbOperator === "$regex") {
      if (Array.isArray(targetValue)) {
        conditionObj[gbAttributeName] = { $regex: targetValue.join("|") };
      } else {
        conditionObj[gbAttributeName] = { $regex: String(targetValue) };
      }
    } else if (gbOperator === "$not") {
      conditionObj[gbAttributeName] = { $not: targetValue };
    } else {
      // Merge operators for the same attribute
      (conditionObj[gbAttributeName] as Record<string, unknown>)[gbOperator] =
        targetValue;
    }
  });

  return JSON.stringify(conditionObj);
}
