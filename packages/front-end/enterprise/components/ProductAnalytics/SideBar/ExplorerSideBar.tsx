import React, { useCallback } from "react";
import { Flex, Box, Text } from "@radix-ui/themes";
import { PiChartBar, PiTable, PiCode } from "react-icons/pi";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricTabContent from "./MetricTabContent";
import FactTableTabContent from "./FactTableTabContent";
import SqlTabContent from "./SqlTabContent";
import GroupBySection from "./GroupBySection";
import DatabaseConfigurator from "./DatabaseConfigurator";

type DatasetType = "metric" | "fact_table" | "database";

function getDatasetIcon(type: DatasetType, size = 16) {
  const icons: Record<DatasetType, React.ReactNode> = {
    metric: <PiChartBar size={size} />,
    fact_table: <PiTable size={size} />,
    database: <PiCode size={size} />,
  };
  return icons[type];
}

export default function ExplorerSideBar() {
  const {
    draftExploreState,
    setDraftExploreState,
    changeDatasetType,
    addValueToDataset,
  } = useExplorerContext();
  const { factTables, datasources } = useDefinitions();

  const dataset = draftExploreState.dataset;
  const activeType: DatasetType = dataset?.type ?? "metric";
  const factTableDataset =
    activeType === "fact_table" && dataset?.type === "fact_table"
      ? dataset
      : null;

  const handleTabChange = useCallback(
    (value: string) => {
      const newType = value as DatasetType;
      changeDatasetType(newType);

      // If switching to SQL and datasources are available, default to the first one
      if (newType === "database" && datasources.length > 0) {
        setDraftExploreState((prev) => ({
          ...prev,
          dataset: {
            ...prev.dataset,
            datasource: datasources[0].id,
          },
        }));
      }
    },
    [changeDatasetType, datasources, setDraftExploreState],
  );

  return (
    <Flex direction="column" gap="2">
      <Flex justify="between" align="center">
        <Text size="3" weight="medium" mt="2">
          Configuration
        </Text>
        <Button size="sm">Save to Dashboard</Button>
      </Flex>
      <Tabs value={activeType} onValueChange={handleTabChange}>
        <Flex>
          <Flex
            width="100%"
            direction="column"
            p="3"
            gap="2"
            style={{
              border: "1px solid var(--gray-a3)",
              borderRadius: "var(--radius-4)",
              backgroundColor: "var(--color-panel-translucent)",
            }}
          >
            <Text size="2" weight="medium">
              Data Source
            </Text>

            <TabsList
              size="1"
              justify="center"
              style={{
                border: "1px solid var(--gray-a3)",
                borderRadius: "var(--radius-4)",
              }}
            >
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
              <TabsTrigger value="database">
                <Flex align="center" gap="2">
                  {getDatasetIcon("database", 14)}
                  <Text size="2">Database</Text>
                </Flex>
              </TabsTrigger>
            </TabsList>

            {activeType === "fact_table" && factTableDataset && (
              <SelectField
                label="Fact table"
                value={factTableDataset.factTableId ?? ""}
                onChange={(factTableId) => {
                  setDraftExploreState((prev) => ({
                    ...prev,
                    dataset: {
                      ...factTableDataset,
                      factTableId,
                      // Resets values to empty array
                      values: [],
                    },
                  }));
                  addValueToDataset("fact_table");
                }}
                options={factTables.map((ft) => ({
                  label: ft.name,
                  value: ft.id,
                }))}
                placeholder="Select fact table..."
                forceUndefinedValueToNull
              />
            )}
            {activeType === "database" && (
              <DatabaseConfigurator dataset={dataset} />
            )}
          </Flex>
        </Flex>

        <Box
          px="0"
          mt="3"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
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
          <TabsContent value="database">
            <Box p="3">
              <SqlTabContent />
            </Box>
          </TabsContent>
        </Box>
      </Tabs>

      {dataset?.values?.length > 0 && <GroupBySection />}
    </Flex>
  );
}
