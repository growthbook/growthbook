import React, { useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { DatasetType, FactTableValue } from "shared/validators";
import { PiArrowsClockwise } from "react-icons/pi";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import GraphTypeSelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GraphTypeSelector";
import DateRangePicker from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";
import GranularitySelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GranularitySelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import { createEmptyValue } from "@/enterprise/components/ProductAnalytics/util";
import SaveToDashboardModal from "@/enterprise/components/ProductAnalytics/SaveToDashboardModal";
import UpgradeModal from "@/components/Settings/UpgradeModal";
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
  const [showSaveToDashboardModal, setShowSaveToDashboardModal] =
    useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const {
    draftExploreState,
    setDraftExploreState,
    loading,
    handleSubmit,
    isSubmittable,
    isStale,
    error,
  } = useExplorerContext();
  const { factTables, project } = useDefinitions();
  const { hasCommercialFeature, permissionsUtil } = useUser();
  // Check if the user can create dashboards for the current project or globally
  const canCreateDashboards =
    permissionsUtil.canCreateGeneralDashboards({
      projects: [project],
    }) || permissionsUtil.canCreateGeneralDashboards({ projects: [] });
  // Check if the user can edit dashboards for the current project or globally
  const canEditDashboards =
    permissionsUtil.canUpdateGeneralDashboards(
      {
        projects: [project],
      },
      {},
    ) || permissionsUtil.canUpdateGeneralDashboards({ projects: [] }, {});
  const hasDashboardsFeature = hasCommercialFeature(
    "product-analytics-dashboards",
  );
  const saveToDashboardDisabledReason =
    !canEditDashboards && !canCreateDashboards
      ? "You do not have permission to create or edit dashboards."
      : !isSubmittable
        ? "Configure a valid exploration before saving."
        : undefined;

  const dataset = draftExploreState.dataset;
  const activeType: DatasetType = dataset?.type ?? "metric";
  const factTableDataset =
    activeType === "fact_table" && dataset?.type === "fact_table"
      ? dataset
      : null;

  return (
    <Flex
      direction="column"
      gap="4"
      p={renderingInDashboardSidebar ? "0" : "2"}
    >
      {showSaveToDashboardModal && (
        <SaveToDashboardModal
          close={() => setShowSaveToDashboardModal(false)}
        />
      )}
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="product-analytics-explorer"
          commercialFeature="product-analytics-dashboards"
        />
      )}
      {error && renderingInDashboardSidebar ? (
        <Callout status="error">{error}</Callout>
      ) : null}
      <Flex justify="end" height="32px" py="2">
        {!renderingInDashboardSidebar ? (
          <Tooltip
            body={saveToDashboardDisabledReason || ""}
            shouldDisplay={!!saveToDashboardDisabledReason}
          >
            <Button
              size="sm"
              ml="auto"
              disabled={!!saveToDashboardDisabledReason}
              onClick={() => {
                if (!hasDashboardsFeature) {
                  setShowUpgradeModal(true);
                } else {
                  setShowSaveToDashboardModal(true);
                }
              }}
            >
              <Flex align="center" justify="center" gap="2">
                <PaidFeatureBadge
                  commercialFeature="product-analytics-dashboards"
                  useTip={false}
                />
                Save to Dashboard
              </Flex>
            </Button>
          </Tooltip>
        ) : (
          <Flex direction="row" align="center" justify="between" width="100%">
            <DataSourceDropdown />
            <Tooltip
              body="Configuration has changed. Click to refresh the chart."
              shouldDisplay={isStale}
            >
              <Button
                size="sm"
                variant="solid"
                disabled={
                  loading ||
                  !draftExploreState?.dataset?.values?.length ||
                  !isSubmittable
                }
                onClick={() => handleSubmit({ force: true })}
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
      {renderingInDashboardSidebar && (
        <Flex
          direction="column"
          gap="4"
          flexBasis="wrap"
          p="3"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
          <Flex direction="column" gap="2">
            <Text weight="medium">Chart Type</Text>
            <GraphTypeSelector />
          </Flex>
          <Flex gap="2" wrap="wrap">
            <Flex direction="column" gap="2" style={{ minWidth: 0 }}>
              <Text weight="medium">Date Range</Text>
              <DateRangePicker shouldWrap />
            </Flex>
            <Flex direction="column" gap="2">
              <Text weight="medium">Date Granularity</Text>
              <GranularitySelector />
            </Flex>
          </Flex>
        </Flex>
      )}

      {activeType === "fact_table" && factTableDataset && (
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
          <Text weight="medium" mt="2">
            Fact Table
          </Text>
          <SelectField
            value={factTableDataset.factTableId ?? ""}
            disabled={
              !permissionsUtil.canRunFactQueries({ projects: [project] }) &&
              !permissionsUtil.canRunFactQueries({ projects: [] })
            }
            onChange={(factTableId) => {
              setDraftExploreState((prev) => {
                const prevDataset =
                  prev.dataset?.type === "fact_table" ? prev.dataset : null;
                return {
                  ...prev,
                  dataset: {
                    ...factTableDataset,
                    factTableId,
                    values: prevDataset?.values?.length
                      ? prevDataset.values
                      : [createEmptyValue("fact_table") as FactTableValue],
                  },
                };
              });
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
        </Flex>
      )}

      {activeType === "data_source" && (
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
          <DatasourceConfigurator dataset={dataset} />
        </Flex>
      )}
      <Box p="0">
        {activeType === "metric" && <MetricTabContent />}
        {activeType === "fact_table" && <FactTableTabContent />}
        {activeType === "data_source" && <DatasourceTabContent />}
      </Box>

      {dataset?.values?.length > 0 && <GroupBySection />}
    </Flex>
  );
}
