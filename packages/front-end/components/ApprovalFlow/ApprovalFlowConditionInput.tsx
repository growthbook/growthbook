import React, { useState, useCallback, useRef } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FaMinusCircle, FaPlusCircle } from "react-icons/fa";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";

export type ApprovalEntityType =
  | "metrics"
  | "features"
  | "experiments"
  | "factTables";

// The fields that can be targeted for each entity type
type TargetableField = "tags" | "environments" | "projects";

interface FieldConfig {
  field: TargetableField;
  label: string;
  getOptions: () => { value: string; label: string }[];
}

interface ConditionRow {
  field: TargetableField;
  operator: "$in" | "$nin";
  values: string[];
}

interface Props {
  entityType: ApprovalEntityType;
  value: Record<string, unknown> | undefined;
  onChange: (condition: Record<string, unknown> | undefined) => void;
}

// Convert our conditions to JSON format compatible with evalCondition
// Uses $in for matching any of the values, $nin for excluding
function conditionsToJson(conditions: ConditionRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const cond of conditions) {
    if (cond.values.length === 0) continue;

    if (cond.values.length === 1) {
      // Single value - use simple equality or $ne
      if (cond.operator === "$in") {
        result[cond.field] = cond.values[0];
      } else {
        result[cond.field] = { $ne: cond.values[0] };
      }
    } else {
      // Multiple values - use $in or $nin
      result[cond.field] = { [cond.operator]: cond.values };
    }
  }

  return Object.keys(result).length > 0 ? result : {};
}

// Convert JSON back to our condition structure
function jsonToConditions(json: Record<string, unknown> | undefined): {
  conditions: ConditionRow[];
} {
  if (!json || Object.keys(json).length === 0) {
    return { conditions: [] };
  }

  const conditions: ConditionRow[] = [];
  const validFields: TargetableField[] = ["tags", "environments", "projects"];

  for (const [key, val] of Object.entries(json)) {
    if (!validFields.includes(key as TargetableField)) {
      continue;
    }

    const field = key as TargetableField;

    // Direct string value = single $in
    if (typeof val === "string") {
      conditions.push({
        field,
        operator: "$in",
        values: [val],
      });
    }
    // Object with $in
    else if (
      typeof val === "object" &&
      val !== null &&
      "$in" in val &&
      Array.isArray((val as Record<string, unknown>).$in)
    ) {
      conditions.push({
        field,
        operator: "$in",
        values: (val as Record<string, unknown>).$in as string[],
      });
    }
    // Object with $nin
    else if (
      typeof val === "object" &&
      val !== null &&
      "$nin" in val &&
      Array.isArray((val as Record<string, unknown>).$nin)
    ) {
      conditions.push({
        field,
        operator: "$nin",
        values: (val as Record<string, unknown>).$nin as string[],
      });
    }
    // Object with $ne (single value exclusion)
    else if (typeof val === "object" && val !== null && "$ne" in val) {
      const neVal = (val as Record<string, unknown>).$ne;
      if (typeof neVal === "string") {
        conditions.push({
          field,
          operator: "$nin",
          values: [neVal],
        });
      }
    }
  }

  return { conditions };
}

export default function ApprovalFlowConditionInput({
  entityType,
  value,
  onChange,
}: Props) {
  const environments = useEnvironments();
  const { projects, tags } = useDefinitions();

  // Use ref to track if we've initialized from the value prop
  const initializedRef = useRef(false);

  // Parse existing value into conditions and officialOnly - only on first render
  const getInitialState = () => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return jsonToConditions(value);
    }
    return { conditions: [], officialOnly: false };
  };

  const initialState = getInitialState();
  const [conditions, setConditions] = useState<ConditionRow[]>(
    initialState.conditions
  );

  // Define available fields based on entity type
  const getFieldConfigs = useCallback((): FieldConfig[] => {
    const configs: FieldConfig[] = [];

    // Tags - available for all entity types
    configs.push({
      field: "tags",
      label: "Tags",
      getOptions: () => tags.map((t) => ({ value: t.id, label: t.id })),
    });

    // Environments - only for features
    if (entityType === "features") {
      configs.push({
        field: "environments",
        label: "Environments",
        getOptions: () =>
          environments.map((e) => ({ value: e.id, label: e.id })),
      });
    }

    // Projects - available for all entity types
    configs.push({
      field: "projects",
      label: "Projects",
      getOptions: () => projects.map((p) => ({ value: p.id, label: p.name })),
    });

    return configs;
  }, [entityType, environments, projects, tags]);

  const fieldConfigs = getFieldConfigs();

  const handleChange = useCallback(
    (newConditions: ConditionRow[]) => {
      setConditions(newConditions);

      const json = conditionsToJson(newConditions);
      if (Object.keys(json).length === 0) {
        onChange(undefined);
      } else {
        onChange(json);
      }
    },
    [onChange]
  );

  const addCondition = useCallback(() => {
    // Find a field that isn't already used
    const usedFields = new Set(conditions.map((c) => c.field));
    const availableField = fieldConfigs.find((f) => !usedFields.has(f.field));

    if (!availableField) {
      return;
    }

    const newCondition: ConditionRow = {
      field: availableField.field,
      operator: "$in",
      values: [],
    };
    handleChange([...conditions, newCondition]);
  }, [conditions, fieldConfigs, handleChange]);

  const removeCondition = useCallback(
    (index: number) => {
      const newConditions = conditions.filter((_, i) => i !== index);
      handleChange(newConditions);
    },
    [conditions, handleChange]
  );

  const updateCondition = useCallback(
    (index: number, updates: Partial<ConditionRow>) => {
      const newConditions = [...conditions];
      newConditions[index] = { ...newConditions[index], ...updates };

      // If field changed, reset values
      if (updates.field) {
        newConditions[index].values = [];
      }

      handleChange(newConditions);
    },
    [conditions, handleChange]
  );

  // Get available fields (excluding already used ones)
  const getAvailableFields = (currentField: TargetableField) => {
    const usedFields = new Set(
      conditions.map((c) => c.field).filter((f) => f !== currentField)
    );
    return fieldConfigs.filter((f) => !usedFields.has(f.field));
  };

  // Check if we can add more conditions (one per field type)
  const canAddCondition = conditions.length < fieldConfigs.length;

  return (
    <Box>
      {/* Conditions */}
      {conditions.length === 0 ? (
        <Box>
          <Text size="2" color="gray" className="font-italic">
            Applies to all {entityType} by default.
          </Text>
          <Box mt="2">
            <Text
              size="2"
              className="link-purple cursor-pointer font-weight-bold"
              onClick={addCondition}
            >
              <FaPlusCircle className="mr-1" />
              Add targeting condition
            </Text>
          </Box>
        </Box>
      ) : (
        <Box className="appbox bg-light p-3">
          {conditions.map((condition, index) => {
            const fieldConfig = fieldConfigs.find(
              (c) => c.field === condition.field
            );
            if (!fieldConfig) return null;

            const availableFields = getAvailableFields(condition.field);

            return (
              <Flex key={index} gap="2" align="end" mb="3" wrap="wrap">
                {index > 0 && (
                  <Text
                    size="2"
                    color="gray"
                    className="mb-2"
                    style={{ width: "40px" }}
                  >
                    AND
                  </Text>
                )}
                {index === 0 && conditions.length > 1 && (
                  <Text
                    size="2"
                    color="gray"
                    className="mb-2"
                    style={{ width: "40px" }}
                  >
                    IF
                  </Text>
                )}

                <Box style={{ minWidth: "150px", flex: 1 }}>
                  <SelectField
                    label={
                      index === 0 && conditions.length === 1 ? "If" : undefined
                    }
                    value={condition.field}
                    options={availableFields.map((c) => ({
                      label: c.label,
                      value: c.field,
                    }))}
                    onChange={(v) =>
                      updateCondition(index, { field: v as TargetableField })
                    }
                    sort={false}
                  />
                </Box>

                <Box style={{ minWidth: "140px", flex: 1 }}>
                  <SelectField
                    value={condition.operator}
                    options={[
                      { label: "includes any of", value: "$in" },
                      { label: "excludes all of", value: "$nin" },
                    ]}
                    onChange={(v) =>
                      updateCondition(index, {
                        operator: v as "$in" | "$nin",
                      })
                    }
                    sort={false}
                  />
                </Box>

                <Box style={{ minWidth: "250px", flex: 2 }}>
                  <MultiSelectField
                    value={condition.values}
                    onChange={(v) => updateCondition(index, { values: v })}
                    options={fieldConfig.getOptions()}
                    placeholder={`Select ${fieldConfig.label.toLowerCase()}...`}
                  />
                </Box>

                <button
                  type="button"
                  className="btn btn-link text-danger"
                  onClick={() => removeCondition(index)}
                  title="Remove condition"
                >
                  <FaMinusCircle />
                </button>
              </Flex>
            );
          })}

          {canAddCondition && (
            <Flex justify="start" mt="3">
              <Text
                size="2"
                className="link-purple cursor-pointer font-weight-bold"
                onClick={addCondition}
              >
                <FaPlusCircle className="mr-1" />
                Add condition
              </Text>
            </Flex>
          )}
        </Box>
      )}
    </Box>
  );
}
