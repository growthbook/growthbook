import React, { useCallback, useState } from "react";
import { Flex, Box, Text, TextField, Separator } from "@radix-ui/themes";
import { PiChartBar, PiTable, PiCode, PiPlus, PiTrash, PiX, PiPencilSimple } from "react-icons/pi";
import type {
  ProductAnalyticsValue,
  MetricValue,
  FactTableValue,
  SqlValue,
} from "shared/validators";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "../ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { z } from "zod";
import { rowFilterOperators, rowFilterValidator } from "shared/validators";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import ValueCard from "./ValueCard";

type RowFilter = z.infer<typeof rowFilterValidator>;

type DatasetType = "metric" | "fact_table" | "sql";

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
  
    const values: SqlValue[] =
      draftExploreState.dataset?.type === "sql"
        ? draftExploreState.dataset.values
        : [];
  
    return (
      <Flex direction="column" gap="3">
        <Box
          style={{
            padding: "var(--space-3)",
            borderRadius: "var(--radius-2)",
            backgroundColor: "var(--gray-a2)",
          }}
        >
          <Text size="2" color="gray">
            SQL dataset configuration (datasource, query, timestamp column) coming
            soon.
          </Text>
        </Box>
        <Flex justify="between" align="center">
          <Text size="2" weight="medium">
            Values
          </Text>
          <Button size="sm" onClick={() => addValueToDataset("sql")}>
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
                updateValueInDataset(idx, { ...v, name } as SqlValue)
              }
              onDelete={() => deleteValueFromDataset(idx)}
              filters={v.rowFilters ?? []}
              onFiltersChange={(filters) =>
                updateValueInDataset(idx, { ...v, rowFilters: filters } as SqlValue)
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
                    } as SqlValue)
                  }
                  options={VALUE_TYPE_OPTIONS.map((o) => ({
                    label: o.label,
                    value: o.value,
                  }))}
                  placeholder="Select..."
                />
                <TextField.Root
                  size="2"
                  placeholder="Value column (optional)"
                  value={v.valueColumn ?? ""}
                  onChange={(e) =>
                    updateValueInDataset(idx, {
                      ...v,
                      valueColumn: e.target.value || null,
                    } as SqlValue)
                  }
                />
                <TextField.Root
                  size="2"
                  placeholder="Name (optional)"
                  value={v.name}
                  onChange={(e) =>
                    updateValueInDataset(idx, {
                      ...v,
                      name: e.target.value,
                    } as SqlValue)
                  }
                />
              </Flex>
            </ValueCard>
          ))}
        </Flex>
      </Flex>
    );
  }