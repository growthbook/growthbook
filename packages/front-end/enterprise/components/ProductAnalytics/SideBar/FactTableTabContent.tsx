import React from "react";
import { Flex, Text, Separator } from "@radix-ui/themes";
import { PiTable, PiPlus } from "react-icons/pi";
import type { FactTableValue } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  generateUniqueValueName,
  VALUE_TYPE_OPTIONS,
  getValueTypeLabel,
} from "@/enterprise/components/ProductAnalytics/util";
import ValueCard from "./ValueCard";

export default function FactTableTabContent() {
  const {
    draftExploreState,
    addValueToDataset,
    updateValueInDataset,
    deleteValueFromDataset,
  } = useExplorerContext();
  const { getFactTableById } = useDefinitions();

  const dataset =
    draftExploreState.dataset?.type === "fact_table"
      ? draftExploreState.dataset
      : null;
  const factTable = dataset
    ? getFactTableById(dataset.factTableId ?? "")
    : null;

  const numericColumns =
    factTable?.columns?.filter((c) => c.datatype === "number") ?? [];
  const allColumns =
    factTable?.columns?.map((c) => ({ label: c.column, value: c.column })) ??
    [];
  const values: FactTableValue[] =
    draftExploreState.dataset?.type === "fact_table"
      ? draftExploreState.dataset.values
      : [];

  if (!dataset) return null;

  if (!dataset.factTableId)
    return (
      <Flex
        justify="center"
        align="center"
        height="100%"
        direction="column"
        gap="2"
        px="4"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-3)",
          padding: "var(--space-3)",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <PiTable size={18} />
        <Text size="2" weight="medium" align="center">
          Select a fact table to begin configuring values and filters
        </Text>
      </Flex>
    );

  return (
    <Flex direction="column" gap="4">
      {!values.length && (
        <Flex
          justify="center"
          align="center"
          height="100%"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-3)",
            padding: "var(--space-3)",
            backgroundColor: "var(--color-panel-translucent)",
            height: "100%",
            width: "100%",
          }}
        >
          <Text size="1" color="gray">
            Add at least one value to chart
          </Text>
        </Flex>
      )}
      {dataset.values.map((v, idx) => (
        <ValueCard key={idx} index={idx}>
          <Flex direction="column" gap="2">
            <Separator style={{ width: "100%" }} />
            <Text size="2" weight="medium" mt="2">
              Value type
            </Text>
            <SelectField
              value={v.valueType}
              onChange={(val) =>
                updateValueInDataset(idx, {
                  ...v,
                  valueType: val as "count" | "unit_count" | "sum",
                  name: generateUniqueValueName(
                    getValueTypeLabel(val as "count" | "unit_count" | "sum"),
                    draftExploreState.dataset.values,
                  ),
                } as FactTableValue)
              }
              options={VALUE_TYPE_OPTIONS.map((o) => ({
                label: o.label,
                value: o.value,
              }))}
              placeholder="Select..."
            />
            {v.valueType === "sum" && (
              <>
                <Text size="2" weight="medium" mt="2">
                  Value column
                </Text>
                <SelectField
                  value={v.valueColumn ?? ""}
                  onChange={(val) =>
                    updateValueInDataset(idx, {
                      ...v,
                      valueColumn: val || null,
                    } as FactTableValue)
                  }
                  options={numericColumns.map((c) => ({
                    label: c.column,
                    value: c.column,
                  }))}
                  placeholder="Select column..."
                  forceUndefinedValueToNull
                />
              </>
            )}
          </Flex>
        </ValueCard>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => addValueToDataset("fact_table")}
      >
        <Flex align="center" gap="2">
          <PiPlus size={14} />
          Add value
        </Flex>
      </Button>
    </Flex>
  );
}
