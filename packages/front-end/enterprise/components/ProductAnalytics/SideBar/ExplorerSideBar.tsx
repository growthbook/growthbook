import React, { useState } from "react";
import { Flex, Box, IconButton } from "@radix-ui/themes";
import {
  DatasetType,
  FactTableValue,
  ExplorationConfig,
} from "shared/validators";
import { PiArrowsClockwise, PiLink } from "react-icons/pi";
import ShareUrlPopover from "@/ui/ShareUrlPopover";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import GraphTypeSelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GraphTypeSelector";
import FunnelGraphTypeSelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/FunnelGraphTypeSelector";
import DateRangePicker, {
  ComparisonDateControls,
} from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";
import GranularitySelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GranularitySelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import { formatExplorationDateRange } from "@/enterprise/components/ProductAnalytics/dateRangeLabels";
import Switch from "@/ui/Switch";
import {
  createEmptyValue,
  getInitialInlineFilters,
  showAsAppliesTo,
  stripExplorerDraftFields,
} from "@/enterprise/components/ProductAnalytics/util";
import SaveToDashboardModal from "@/enterprise/components/ProductAnalytics/SaveToDashboardModal";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import track from "@/services/track";
import MetricTabContent from "./MetricTabContent";
import FactTableTabContent from "./FactTableTabContent";
import DatasourceTabContent from "./DatasourceTabContent";
import SqlTabContent from "./SqlTabContent";
import FunnelTabContent from "./FunnelTabContent";
import GroupBySection from "./GroupBySection";
import ShowAsSection from "./ShowAsSection";
import DatasourceConfigurator from "./DatasourceConfigurator";
import SchemaBrowserSection from "./SchemaBrowserSection";

interface Props {
  renderingInDashboardSidebar?: boolean;
  dashboardDateRange?: ExplorationConfig["dateRange"];
  useDashboardDateControl?: boolean;
  onGlobalControlSettingsChange?: (settings: { dateRange?: boolean }) => void;
  onSubmit?: () => void;
}

export default function ExplorerSideBar({
  renderingInDashboardSidebar = false,
  dashboardDateRange,
  useDashboardDateControl = false,
  onGlobalControlSettingsChange,
  onSubmit,
}: Props) {
  const [showSaveToDashboardModal, setShowSaveToDashboardModal] =
    useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const {
    draftExploreState,
    setDraftExploreState,
    exploration,
    compareEnabled,
    setCompareEnabled,
    comparisonExploration,
    loading,
    handleSubmit,
    isSubmittable,
    isStale,
    needsFetch,
    error,
    trackingSource,
    submittedExploreState,
    managedWarehouseUnavailable,
  } = useExplorerContext();
  const { factTables, getFactMetricById, getFactTableById, project } =
    useDefinitions();
  const { hasCommercialFeature, permissionsUtil } = useUser();
  const canCreateDashboards = permissionsUtil.canCreateGeneralDashboards({
    projects: [project],
  });
  const canEditDashboards = permissionsUtil.canUpdateGeneralDashboards(
    { projects: [project] },
    {},
  );
  const hasDashboardsFeature = hasCommercialFeature(
    "product-analytics-dashboards",
  );
  const saveToDashboardDisabledReason =
    !canEditDashboards && !canCreateDashboards
      ? "You do not have permission to create or edit dashboards in this project."
      : !isSubmittable
        ? "Configure a valid exploration before saving."
        : loading || isStale || needsFetch
          ? "Run the updated exploration before saving to a dashboard."
          : undefined;

  const dataset = draftExploreState.dataset;
  const activeType: DatasetType = dataset?.type ?? "metric";
  const factTableDataset =
    activeType === "fact_table" && dataset?.type === "fact_table"
      ? dataset
      : null;
  const isSqlSetupState =
    activeType === "sql" &&
    dataset?.type === "sql" &&
    Object.keys(dataset.columnTypes).length === 0;

  const hasFunnelInputs =
    dataset?.type === "funnel" && !!dataset.steps?.some((s) => !!s.factTable);
  const hasInputs =
    dataset?.type === "funnel"
      ? hasFunnelInputs
      : (dataset?.values?.length ?? 0) > 0;
  const showComparisonDateControls =
    compareEnabled &&
    draftExploreState.dateRange.predefined === "customDateRange" &&
    Boolean(draftExploreState.dateRange.startDate) &&
    Boolean(draftExploreState.dateRange.endDate);
  const isTimeSeriesChart = ["line", "area", "timeseries-table"].includes(
    draftExploreState.chartType,
  );
  const usesInheritedDashboardDateRange = Boolean(
    dashboardDateRange && useDashboardDateControl,
  );

  return (
    <Flex
      direction="column"
      gap="4"
      p={renderingInDashboardSidebar ? "0" : "2"}
    >
      {showSaveToDashboardModal && (
        <SaveToDashboardModal
          close={() => setShowSaveToDashboardModal(false)}
          config={stripExplorerDraftFields(draftExploreState)}
          exploration={exploration}
          compareEnabled={compareEnabled}
          previousTimeFrame={draftExploreState.previousTimeFrame ?? null}
          comparisonExplorationId={comparisonExploration?.id ?? null}
          trackingSource={trackingSource}
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
      <Flex justify="end" align="center" height="32px" py="2" gap="2">
        {!renderingInDashboardSidebar ? (
          <>
            <Tooltip
              body={saveToDashboardDisabledReason || ""}
              shouldDisplay={!!saveToDashboardDisabledReason}
            >
              <Button
                size="sm"
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
                    inheritColor
                  />
                  Save to Dashboard
                </Flex>
              </Button>
            </Tooltip>
            <ShareUrlPopover
              title="Share this exploration"
              description="Anyone in your organization with read access to the Data Source this exploration uses, can open this exploration."
              trigger={
                <IconButton
                  size="2"
                  variant="solid"
                  color="violet"
                  aria-label="Share exploration link"
                  style={{ height: 32, width: 32 }}
                >
                  <PiLink size={20} />
                </IconButton>
              }
              side="bottom"
              align="end"
              onCopy={
                trackingSource
                  ? () => {
                      track("Product Analytics Explorer: Copy Link Clicked", {
                        source: trackingSource,
                        type: draftExploreState.type,
                        chart_type: draftExploreState.chartType,
                      });
                    }
                  : undefined
              }
            />
          </>
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
                disabled={loading || !hasInputs || !isSubmittable}
                onClick={() =>
                  onSubmit ? onSubmit() : handleSubmit({ force: isStale })
                }
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
      {renderingInDashboardSidebar && isSqlSetupState ? (
        <Callout status="info">
          Run the SQL query to configure the chart.
        </Callout>
      ) : null}
      {renderingInDashboardSidebar && activeType === "sql" && (
        <SchemaBrowserSection />
      )}
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
            <Flex direction="row" align="center" justify="between" width="100%">
              <Text weight="medium">Chart Type</Text>
              <Switch
                label="Compare"
                value={compareEnabled}
                onChange={setCompareEnabled}
                disabled={!submittedExploreState || managedWarehouseUnavailable}
              />
            </Flex>
            {activeType === "funnel" ? (
              <FunnelGraphTypeSelector />
            ) : (
              <GraphTypeSelector />
            )}
          </Flex>
          <Flex direction="column" gap="2" width="100%" style={{ minWidth: 0 }}>
            <Flex justify="between" align="center" gap="2" width="100%">
              <Text weight="medium">Date Range</Text>
              {dashboardDateRange ? (
                <Switch
                  size="1"
                  value={useDashboardDateControl}
                  onChange={(checked) =>
                    onGlobalControlSettingsChange?.({ dateRange: checked })
                  }
                  label={
                    <Flex direction="row" align="center" gap="1">
                      <Text size="small" weight="medium">
                        Use dashboard date filter
                      </Text>
                      <Tooltip
                        body={
                          useDashboardDateControl
                            ? "This block uses the dashboard date range."
                            : "This block overrides the dashboard date filter."
                        }
                      />
                    </Flex>
                  }
                />
              ) : null}
            </Flex>
            {dashboardDateRange && useDashboardDateControl ? (
              <Flex
                p="2"
                style={{
                  border: "1px solid var(--gray-a3)",
                  borderRadius: "var(--radius-3)",
                  backgroundColor: "var(--gray-a2)",
                }}
              >
                <Text size="medium" color="text-low">
                  {formatExplorationDateRange(dashboardDateRange)}
                </Text>
              </Flex>
            ) : showComparisonDateControls ? (
              <ComparisonDateControls fullWidth />
            ) : (
              <DateRangePicker fullWidth />
            )}
          </Flex>
          {isTimeSeriesChart && !usesInheritedDashboardDateRange && (
            <Flex direction="column" gap="2" width="100%">
              <Text weight="medium">Date Granularity</Text>
              <GranularitySelector />
            </Flex>
          )}
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
                const newFactTable = factTableId
                  ? getFactTableById(factTableId)
                  : null;
                const baseValues = prevDataset?.values?.length
                  ? prevDataset.values
                  : [createEmptyValue("fact_table") as FactTableValue];
                // Seed alwaysInlineFilter columns on every value (newly
                // created or carried over). getInitialInlineFilters is a
                // no-op when the column is already in rowFilters, so this
                // is safe to apply on each fact-table change.
                const values = newFactTable
                  ? baseValues.map((v) => ({
                      ...v,
                      rowFilters: getInitialInlineFilters(
                        newFactTable,
                        v.rowFilters,
                      ),
                    }))
                  : baseValues;
                return {
                  ...prev,
                  dataset: {
                    ...factTableDataset,
                    factTableId,
                    values,
                  },
                } as ExplorationConfig;
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
      {!renderingInDashboardSidebar && activeType === "sql" && (
        <SchemaBrowserSection />
      )}
      <Box p="0">
        {activeType === "metric" && <MetricTabContent />}
        {activeType === "fact_table" && <FactTableTabContent />}
        {activeType === "data_source" && <DatasourceTabContent />}
        {activeType === "sql" && <SqlTabContent />}
        {activeType === "funnel" && <FunnelTabContent />}
      </Box>

      {activeType !== "funnel" &&
        showAsAppliesTo(draftExploreState, getFactMetricById) && (
          <ShowAsSection />
        )}
      {hasInputs && <GroupBySection />}
    </Flex>
  );
}
