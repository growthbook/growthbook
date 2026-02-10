import React, { useCallback } from "react";
import { Flex, Box, Text } from "@radix-ui/themes";
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
        <Text size="2" weight="medium">Explorer Type</Text>
        <SelectField
          value={activeType}
          onChange={handleTabChange}
          sort={false}
          options={[
            { label: "Metric", value: "metric" },
            { label: "Fact Table", value: "fact_table" },
            { label: "Database", value: "database" },
          ]}
        />


        {activeType === "fact_table" && factTableDataset && (
          <>
            <Text size="2" weight="medium" mt="2">Fact Table</Text>
            <SelectField
              value={factTableDataset.factTableId ?? ""}
              onChange={(factTableId) => {
                setDraftExploreState((prev) => ({
                  ...prev,
                  dataset: { ...factTableDataset, factTableId },
                }));
              }}
              options={factTables.map((ft) => ({
                label: ft.name,
                value: ft.id,
              }))}
              placeholder="Select fact table..."
            />
          </>
        )}

        {activeType === "database" && (
          <DatabaseConfigurator dataset={dataset} />
        )}
      </Flex>

      <Box p="0">
        {activeType === "metric" && <MetricTabContent />}
        {activeType === "fact_table" && <FactTableTabContent />}
        {activeType === "database" && <SqlTabContent />}
      </Box>

      {dataset?.values?.length > 0 && <GroupBySection />}
    </Flex>
  );
}
