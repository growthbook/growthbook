import React, { useMemo } from "react";
import { Flex, Box, Text } from "@radix-ui/themes";
import { PiTable, PiPlus } from "react-icons/pi";
import type { DatabaseValue } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import {
  generateUniqueValueName,
  getValueTypeLabel,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import ValueCard from "./ValueCard";

const VALUE_TYPE_OPTIONS: {
  value: "unit_count" | "count" | "sum";
  label: string;
}[] = [
  { value: "count", label: "Count" },
  { value: "unit_count", label: "Unit count" },
  { value: "sum", label: "Sum" },
];

export default function SqlTabContent() {
  const {
    draftExploreState,
    addValueToDataset,
    updateValueInDataset,
    deleteValueFromDataset,
  } = useExplorerContext();

  const dataset =
    draftExploreState.dataset?.type === "database"
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
      >
        <PiTable size={18} />
        <Text size="2" weight="medium" align="center">
          Select a table to begin configuring values and filters
        </Text>
      </Flex>
    );

  return (
    <>
      <Flex direction="column" gap="3">
        {columnOptions.length > 0 && (
          <Box>
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Values
              </Text>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addValueToDataset("database")}
              >
                <Flex align="center" gap="2">
                  <PiPlus size={14} />
                  Add value
                </Flex>
              </Button>
            </Flex>
            <Flex direction="column" gap="2">
              {values.map((v, idx) => (
                <ValueCard
                  key={idx}
                  index={idx}
                  name={v.name}
                  onNameChange={(name) =>
                    updateValueInDataset(idx, { ...v, name } as DatabaseValue)
                  }
                  onDelete={() => deleteValueFromDataset(idx)}
                  filters={v.rowFilters ?? []}
                  onFiltersChange={(filters) =>
                    updateValueInDataset(idx, {
                      ...v,
                      rowFilters: filters,
                    } as DatabaseValue)
                  }
                  columns={[]}
                >
                  <Flex direction="column" gap="2">
                    <SelectField
                      label="Value type"
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
                      <SelectField
                        label="Value column"
                        value={v.valueColumn ?? ""}
                        onChange={(val) =>
                          updateValueInDataset(idx, {
                            ...v,
                            valueColumn: val,
                          } as DatabaseValue)
                        }
                        options={columnOptions}
                        placeholder="Select..."
                      />
                    )}
                  </Flex>
                </ValueCard>
              ))}
            </Flex>
          </Box>
        )}
      </Flex>
    </>
  );
}
