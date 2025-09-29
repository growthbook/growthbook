import { ConditionInterface } from "@growthbook/growthbook-react";
import { StatsigCondition } from "@/services/importing/statsig/types";
import { mapStatsigAttributeToGB } from "./attributeMapper";

export type TransformedCondition = {
  condition: string; // JSON string for targeting conditions
  savedGroups: string[]; // Array of saved group IDs
  prerequisites?: string[]; // Array of prerequisite feature IDs
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
): TransformedCondition {
  const targetingConditions: StatsigCondition[] = [];
  const savedGroups: string[] = [];
  const prerequisites: string[] = [];
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
        case "passes_gate":
        case "fails_gate":
          // These become prerequisites
          prerequisites.push(String(targetValue));
          return;
        case "passes_segment":
        case "fails_segment":
          // These become saved groups
          savedGroups.push(String(targetValue));
          return;
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
    str_contains_none: "$not",
    lt: "$lt",
    gt: "$gt",
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
    const { type, operator, targetValue, field } = condition;
    const gbOperator = operatorMap[operator] || "$eq";

    // For custom_field type, use the field value as the attribute name
    // Otherwise, use the type as the attribute name
    const attributeName = type === "custom_field" ? field : type;
    const gbAttributeName = mapStatsigAttributeToGB(
      attributeName,
      skipAttributeMapping,
    );

    if (operator === "str_contains_none") {
      const values = Array.isArray(targetValue) ? targetValue : [targetValue];
      conditionObj[gbAttributeName] = {
        $not: { $regex: values.join("|") },
      };
    } else if (operator === "is_null") {
      conditionObj[gbAttributeName] = { $exists: false };
    } else if (operator === "is_not_null") {
      conditionObj[gbAttributeName] = { $exists: true };
    } else if (gbOperator === "$in" || gbOperator === "$nin") {
      const values = Array.isArray(targetValue) ? targetValue : [targetValue];
      conditionObj[gbAttributeName] = { [gbOperator]: values };
    } else if (gbOperator === "$regex") {
      if (Array.isArray(targetValue)) {
        conditionObj[gbAttributeName] = { $regex: targetValue.join("|") };
      } else {
        conditionObj[gbAttributeName] = { $regex: String(targetValue) };
      }
    } else if (gbOperator === "$not") {
      conditionObj[gbAttributeName] = { $not: targetValue };
    } else {
      conditionObj[gbAttributeName] = { [gbOperator]: targetValue };
    }
  });

  return JSON.stringify(conditionObj);
}
