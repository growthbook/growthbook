import React, { useMemo } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import { PiTable, PiPlus } from "react-icons/pi";
import type { DatabaseValue } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import {
  generateUniqueValueName,
  getValueTypeLabel,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import ValueCard from "./ValueCard";

const VALUE_TYPE_OPTIONS: {
  value: "unit_count" | "count" | "sum";
  label: string;
}[] = [
  { value: "count", label: "Count" },
  { value: "unit_count", label: "Unit count" },
  { value: "sum", label: "Sum" },
];

export default function DatasourceTabContent() {
  const { draftExploreState, addValueToDataset, updateValueInDataset } =
    useExplorerContext();

  const dataset =
    draftExploreState.dataset?.type === "data_source"
      ? draftExploreState.dataset
      : null;
  const values: DatabaseValue[] = dataset?.values || [];

  const columnOptions = useMemo(() => {
    return Object.entries(dataset?.columnTypes ?? {}).map(([name]) => ({
      label: name,
      value: name,
    }));
  }, [dataset?.columnTypes]);

  if (!dataset?.table)
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
        <Text weight="medium" align="center">
          Select a table to begin configuring values and filters
        </Text>
      </Flex>
    );

  return (
    <Flex direction="column">
      <Flex direction="column" gap="4">
        {columnOptions.length > 0 && !values.length && (
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
            <Text size="small" color="text-low">
              Add at least one value to chart
            </Text>
          </Flex>
        )}
      </Flex>
      {columnOptions.length > 0 && (
        <Flex direction="column" gap="4">
          {values.map((v, idx) => (
            <ValueCard key={idx} index={idx}>
              <Flex direction="column" gap="2">
                <Separator style={{ width: "100%" }} />
                <Text weight="medium" mt="2">
                  Value type
                </Text>
                <SelectField
                  value={v.valueType}
                  onChange={(val) =>
                    updateValueInDataset(idx, {
                      ...v,
                      valueType: val as "count" | "unit_count" | "sum",
                      name: generateUniqueValueName(
                        getValueTypeLabel(
                          val as "count" | "unit_count" | "sum",
                        ),
                        draftExploreState.dataset.values,
                      ),
                    } as DatabaseValue)
                  }
                  options={VALUE_TYPE_OPTIONS.filter(
                    (o) => o.value !== "unit_count",
                  ).map((o) => ({
                    label: o.label,
                    value: o.value,
                  }))}
                  placeholder="Select..."
                />
                {v.valueType === "sum" && (
                  <>
                    <Text weight="medium" mt="2">
                      Value column
                    </Text>
                    <SelectField
                      value={v.valueColumn ?? ""}
                      onChange={(val) =>
                        updateValueInDataset(idx, {
                          ...v,
                          valueColumn: val,
                        } as DatabaseValue)
                      }
                      options={columnOptions}
                      placeholder="Select column..."
                    />
                  </>
                )}
              </Flex>
            </ValueCard>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => addValueToDataset("data_source")}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} />
              Add value
            </Flex>
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
