import React, { useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { DatasetType } from "shared/validators";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricTabContent from "./MetricTabContent";
import FactTableTabContent from "./FactTableTabContent";
import DatasourceTabContent from "./DatasourceTabContent";
import GroupBySection from "./GroupBySection";
import DatasourceConfigurator from "./DatasourceConfigurator";

export default function ExplorerSideBar() {
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
      const newType = value as DatasetType;
      changeDatasetType(newType);
    },
    [changeDatasetType],
  );

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center" height="32px" py="2">
        <Text weight="medium" mt="2">
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
        <Text weight="medium">Explorer Type</Text>
        <SelectField
          value={activeType}
          onChange={handleTabChange}
          sort={false}
          options={[
            { label: "Metric", value: "metric" },
            { label: "Fact Table", value: "fact_table" },
            { label: "Data Source", value: "data_source" },
          ]}
        />

        {activeType === "fact_table" && factTableDataset && (
          <>
            <Text weight="medium" mt="2">
              Fact Table
            </Text>
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

        {activeType === "data_source" && (
          <DatasourceConfigurator dataset={dataset} />
        )}
      </Flex>

      <Box p="0">
        {activeType === "metric" && <MetricTabContent />}
        {activeType === "fact_table" && <FactTableTabContent />}
        {activeType === "data_source" && <DatasourceTabContent />}
      </Box>

      {dataset?.values?.length > 0 && <GroupBySection />}
    </Flex>
  );
}
