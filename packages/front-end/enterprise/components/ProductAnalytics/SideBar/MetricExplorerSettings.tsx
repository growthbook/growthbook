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
import { SERIES_COLORS, getSeriesTag } from "../util";
import { z } from "zod";
import { rowFilterOperators, rowFilterValidator } from "shared/validators";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import MetricTabContent from "./MetricTabContent";
import FactTableTabContent from "./FactTableTabContent";
import SqlTabContent from "./SqlTabContent";

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

// function createEmptyDataset(type: DatasetType): ProductAnalyticsDataset {
//   switch (type) {
//     case "metric":
//       return { type: "metric", values: [] };
//     case "fact_table":
//       return { type: "fact_table", factTableId: "", values: [] };
//     case "sql":
//       return {
//         type: "sql",
//         datasource: "",
//         sql: "",
//         timestampColumn: "",
//         columnTypes: {},
//         values: [],
//       };
//   }
// }


function getDatasetIcon(type: DatasetType, size = 16) {
  const icons: Record<DatasetType, React.ReactNode> = {
    metric: <PiChartBar size={size} />,
    fact_table: <PiTable size={size} />,
    sql: <PiCode size={size} />,
  };
  return icons[type];
}

export default function MetricExplorerSettings() {
  const { draftExploreState, setDraftExploreState, changeDatasetType } =
    useExplorerContext();
  const { factTables } = useDefinitions();

  const dataset = draftExploreState.dataset;
  const activeType: DatasetType = dataset?.type ?? "metric";
  const factTableDataset =
    activeType === "fact_table" && dataset?.type === "fact_table"
      ? dataset
      : null;

  const handleTabChange = useCallback(
    (value: string) => {
      changeDatasetType(value as DatasetType);
    },
    [changeDatasetType],
  );

  return (
    <Flex direction="column" gap="2">
      <Text size="3" weight="medium" mt="2">
        Configuration
      </Text>
      <Tabs value={activeType} onValueChange={handleTabChange}>
        <Flex>
          <Flex width="100%" direction="column" p="3" gap="2" style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
          }}>
            <Text size="2" weight="medium">
              Data Source
            </Text>

            <TabsList size="1" justify="center" style={{ border: "1px solid var(--gray-a3)", borderRadius: "var(--radius-4)" }}>
              <TabsTrigger value="metric">
                <Flex align="center" gap="2">
                  {getDatasetIcon("metric", 14)}
                  <Text size="2">Metric</Text>
                </Flex>
              </TabsTrigger>
              <TabsTrigger value="fact_table">
                <Flex align="center" gap="2">
                  {getDatasetIcon("fact_table", 14)}
                  <Text size="2">Fact table</Text>
                </Flex>
              </TabsTrigger>
              <TabsTrigger value="sql">
                <Flex align="center" gap="2">
                  {getDatasetIcon("sql", 14)}
                  <Text size="2">SQL</Text>
                </Flex>
              </TabsTrigger>
            </TabsList>

            {activeType === "fact_table" && factTableDataset && (
              <SelectField
                label="Fact table"
                value={factTableDataset.factTableId ?? ""}
                onChange={(factTableId) =>
                  setDraftExploreState((prev) => ({
                    ...prev,
                    dataset: {
                      ...factTableDataset,
                      factTableId,
                      values: factTableDataset.values,
                    },
                  }))
                }
                options={factTables.map((ft) => ({ label: ft.name, value: ft.id }))}
                placeholder="Select fact table..."
                forceUndefinedValueToNull
              />
            )}
          </Flex>
        </Flex>

        <Box px="0" mt="3" style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          backgroundColor: "var(--color-panel-translucent)",
        }}>
          <TabsContent value="metric">
            <Box p="3">
              <MetricTabContent />
            </Box>
          </TabsContent>
          <TabsContent value="fact_table">
            <Box p="3">
              <FactTableTabContent />
            </Box>
          </TabsContent>
          <TabsContent value="sql">
            <Box p="3">
              <SqlTabContent />
            </Box>
          </TabsContent>
        </Box>
      </Tabs>
    </Flex>
  );
}



