import React, { useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { DatasetType } from "shared/validators";
import { PiArrowsClockwise } from "react-icons/pi";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import GraphTypeSelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GraphTypeSelector";
import DateRangePicker from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";
import GranularitySelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GranularitySelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import MetricTabContent from "./MetricTabContent";
import FactTableTabContent from "./FactTableTabContent";
import DatasourceTabContent from "./DatasourceTabContent";
import GroupBySection from "./GroupBySection";
import DatasourceConfigurator from "./DatasourceConfigurator";

interface Props {
  renderingInDashboardSidebar?: boolean;
}

export default function ExplorerSideBar({
  renderingInDashboardSidebar = false,
}: Props) {
  const {
    draftExploreState,
    setDraftExploreState,
    changeDatasetType,
    autoSubmitEnabled,
    loading,
    handleSubmit,
    isSubmittable,
    isStale,
    error,
  } = useExplorerContext();
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
      {error && renderingInDashboardSidebar ? (
        <Callout status="error">{error}</Callout>
      ) : null}
      <Flex justify="between" align="center" height="32px" py="2">
        {!renderingInDashboardSidebar ? (
          <Button size="sm" ml="auto">
            Save to Dashboard
          </Button>
        ) : (
          <Flex direction="row" align="center" justify="between" width="100%">
            <DataSourceDropdown />
            <Tooltip
              body="Configuration has changed. Click to refresh the chart."
              shouldDisplay={isStale}
            >
              <Button
                size="sm"
                variant={autoSubmitEnabled ? "outline" : "solid"}
                disabled={
                  loading ||
                  !draftExploreState?.dataset?.values?.length ||
                  !isSubmittable
                }
                onClick={handleSubmit}
              >
                <Flex align="center" gap="2">
                  <PiArrowsClockwise />
                  Update
                  {isStale && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "var(--amber-9)",
                        flexShrink: 0,
                      }}
                      aria-hidden
                    />
                  )}
                </Flex>
              </Button>
            </Tooltip>
          </Flex>
        )}
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
        {!renderingInDashboardSidebar ? (
          <>
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
          </>
        ) : (
          <Flex direction="column" gap="2" flexBasis="wrap">
            <Flex direction="column" gap="2">
              <Text weight="medium">Chart Type</Text>
              <GraphTypeSelector />
            </Flex>
            <Flex
              direction="column"
              gap="2"
              width="fit-content"
              flexBasis="wrap"
            >
              <Text weight="medium">Date Range</Text>
              <DateRangePicker shouldWrap={renderingInDashboardSidebar} />
            </Flex>
            <Flex direction="column" gap="2">
              <Text weight="medium">Date Granularity</Text>
              <GranularitySelector />
            </Flex>
          </Flex>
        )}

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
              options={factTables
                .filter((f) => f.datasource === draftExploreState.datasource)
                .map((ft) => ({
                  label: ft.name,
                  value: ft.id,
                }))}
              placeholder="Select fact table..."
              forceUndefinedValueToNull
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
