import React, { ReactNode } from "react";
import { Flex, Box } from "@radix-ui/themes";
import {
  DatasetType,
  FactTableValue,
  ExplorationConfig,
} from "shared/validators";
import { PiArrowsClockwise } from "react-icons/pi";
import {
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import GraphTypeSelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/GraphTypeSelector";
import FunnelGraphTypeSelector from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/FunnelGraphTypeSelector";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import type { DateRangeCompareValue } from "@/enterprise/components/ProductAnalytics/DateRangeComparePanel";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import DashboardFilterInheritTag from "@/enterprise/components/Dashboards/DashboardEditor/DashboardEditorSidebar/DashboardFilterInheritTag";
import DashboardFilterSummary from "@/enterprise/components/Dashboards/DashboardEditor/DashboardEditorSidebar/DashboardFilterSummary";
import {
  createEmptyValue,
  getInitialInlineFilters,
  isTimelessSqlExploration,
  showAsAppliesTo,
} from "@/enterprise/components/ProductAnalytics/util";
import { useOptionalSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import ExplorerPageActions from "@/enterprise/components/ProductAnalytics/ExplorerPageActions";
import MetricTabContent from "./MetricTabContent";
import FactTableTabContent from "./FactTableTabContent";
import DatasourceTabContent from "./DatasourceTabContent";
import SqlTabContent from "./SqlTabContent";
import FunnelTabContent from "./FunnelTabContent";
import GroupBySection from "./GroupBySection";
import SaveFunnelMetricAction from "./SaveFunnelMetricAction";
import ShowAsSection from "./ShowAsSection";
import DatasourceConfigurator from "./DatasourceConfigurator";
import SchemaBrowserSection from "./SchemaBrowserSection";

interface Props {
  renderingInDashboardSidebar?: boolean;
  dashboardDateRange?: ExplorationConfig["dateRange"];
  useDashboardDateControl?: boolean;
  onGlobalControlSettingsChange?: (settings: { dateRange?: boolean }) => void;
  // Editing an inherited date range claims it for the block. Not
  // onGlobalControlSettingsChange, which reseeds the draft from the block's stored
  // config and would discard the value just picked.
  onClaimDashboardDateRange?: (value: DateRangeCompareValue) => void;
  onSubmit?: () => void;
  hideHeaderActions?: boolean;
  headerActions?: ReactNode;
  hideDataSourceSelector?: boolean;
  /** When true, only show explore chart controls (no SQL schema browser). */
  sqlExploreConfigOnly?: boolean;
  dashboardHeaderLeadingContent?: ReactNode;
}

export default function ExplorerSideBar({
  renderingInDashboardSidebar = false,
  dashboardDateRange,
  useDashboardDateControl = false,
  onGlobalControlSettingsChange,
  onClaimDashboardDateRange,
  onSubmit,
  hideHeaderActions = false,
  headerActions,
  hideDataSourceSelector = false,
  sqlExploreConfigOnly = false,
  dashboardHeaderLeadingContent,
}: Props) {
  const {
    draftExploreState,
    setDraftExploreState,
    compareEnabled,
    comparisonMode,
    loading,
    handleSubmit,
    isSubmittable,
    isStale,
    error,
  } = useExplorerContext();
  const { factTables, getFactMetricById, getFactTableById, project } =
    useDefinitions();
  const { permissionsUtil } = useUser();
  const dataset = draftExploreState.dataset;
  const activeType: DatasetType = dataset?.type ?? "metric";
  const sqlEditorContext = useOptionalSqlEditorContext();
  const viewMode = sqlEditorContext?.viewMode ?? "explore";
  const showSqlSchemaBrowser =
    activeType === "sql" && !sqlExploreConfigOnly && viewMode === "dataset";
  const showChartControls =
    sqlExploreConfigOnly || activeType !== "sql" || viewMode === "explore";
  const factTableDataset =
    activeType === "fact_table" && dataset?.type === "fact_table"
      ? dataset
      : null;
  const isSqlSetupState =
    activeType === "sql" &&
    dataset?.type === "sql" &&
    Object.keys(dataset.columnTypes).length === 0;

  const hasFunnelInputs =
    dataset?.type === "funnel" && !!dataset.steps?.some((s) => !!s.factTableId);
  const hasInputs =
    dataset?.type === "funnel"
      ? hasFunnelInputs
      : (dataset?.values?.length ?? 0) > 0;
  const dateRangeValue: DateRangeCompareValue = {
    dateRange: draftExploreState.dateRange,
    comparison: compareEnabled
      ? {
          enabled: true,
          mode: comparisonMode,
          previousTimeFrame: draftExploreState.previousTimeFrame,
        }
      : null,
    granularity:
      draftExploreState.dimensions.find((d) => d.dimensionType === "date")
        ?.dateGranularity ?? "auto",
  };

  const applyDateRange = ({
    dateRange,
    comparison,
    granularity,
  }: DateRangeCompareValue) => {
    // Targets the block, not the draft, so it can't race the setter below.
    if (useDashboardDateControl) {
      onClaimDashboardDateRange?.({ dateRange, comparison, granularity });
    }
    setDraftExploreState((prev) => {
      const next = {
        ...prev,
        dateRange,
        ...(granularity
          ? {
              dimensions: prev.dimensions.map((d) =>
                d.dimensionType === "date"
                  ? { ...d, dateGranularity: granularity }
                  : d,
              ),
            }
          : {}),
      };
      if (!comparison?.enabled) {
        const {
          previousTimeFrame: _,
          comparisonMode: __,
          ...withoutCompare
        } = next;
        return withoutCompare;
      }
      return {
        ...next,
        comparisonMode: resolveComparisonMode(comparison),
        previousTimeFrame: resolveComparisonPreviousTimeFrame(
          dateRange,
          comparison,
        ),
      };
    });
  };

  const emptyStaticDimension = draftExploreState.dimensions.some(
    (d) => d.dimensionType === "static" && d.values.length === 0,
  );
  const updateDisabledReason =
    hasInputs && !isSubmittable
      ? emptyStaticDimension
        ? "Select at least one value for the pinned dimension before updating."
        : "Configure a valid exploration before updating."
      : undefined;

  const isTimeSeriesChart = ["line", "area", "timeseries-table"].includes(
    draftExploreState.chartType,
  );
  const dateControlsDisabled = isTimelessSqlExploration(draftExploreState);
  return (
    <Flex
      direction="column"
      gap="4"
      p={renderingInDashboardSidebar ? "0" : "2"}
      height={
        showSqlSchemaBrowser && !renderingInDashboardSidebar
          ? "100%"
          : undefined
      }
    >
      {error && renderingInDashboardSidebar ? (
        <Callout status="error">{error}</Callout>
      ) : null}
      {hideHeaderActions ? null : headerActions ? (
        <Flex justify="end" align="center" height="32px" py="2" gap="2">
          {headerActions}
        </Flex>
      ) : renderingInDashboardSidebar ? (
        <Flex justify="end" align="center" height="32px" py="2" gap="2">
          <Flex
            direction="row"
            align="center"
            justify={
              hideDataSourceSelector && !dashboardHeaderLeadingContent
                ? "end"
                : "between"
            }
            width="100%"
          >
            {dashboardHeaderLeadingContent ??
              (hideDataSourceSelector ? null : <DataSourceDropdown />)}
            <Tooltip
              body={
                updateDisabledReason ||
                "Configuration has changed. Click to refresh the chart."
              }
              shouldDisplay={!!updateDisabledReason || isStale}
            >
              <Button
                size="md"
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
        </Flex>
      ) : (
        <Flex justify="end" align="center" height="32px" py="2" gap="2">
          <ExplorerPageActions />
        </Flex>
      )}
      {renderingInDashboardSidebar &&
      showSqlSchemaBrowser &&
      isSqlSetupState ? (
        <Callout status="info">
          Test the query before configuring the exploration.
        </Callout>
      ) : null}
      {showSqlSchemaBrowser && (
        <SchemaBrowserSection fullHeight={!renderingInDashboardSidebar} />
      )}
      {renderingInDashboardSidebar && showChartControls && (
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
          {/* Date Range is the only filter these blocks follow, so the count is
              0 or 1. */}
          {dashboardDateRange ? (
            <DashboardFilterSummary
              customCount={useDashboardDateControl ? 0 : 1}
              onRevertAll={() =>
                onGlobalControlSettingsChange?.({ dateRange: true })
              }
            />
          ) : null}
          <Flex direction="column" gap="2">
            <Text weight="medium">Chart Type</Text>
            {activeType === "funnel" ? (
              <FunnelGraphTypeSelector />
            ) : (
              <GraphTypeSelector />
            )}
          </Flex>
          <Tooltip
            body="Update your SQL query to return a date or timestamp column to filter by date."
            shouldDisplay={dateControlsDisabled}
            usePortal
            style={{ display: "block", width: "100%" }}
          >
            <Flex
              direction="column"
              gap="2"
              width="100%"
              style={{ minWidth: 0 }}
            >
              <Flex justify="between" align="center" gap="2" width="100%">
                <Text weight="medium">Date Range</Text>
                {dashboardDateRange ? (
                  <DashboardFilterInheritTag
                    label="Date Range"
                    inherited={useDashboardDateControl}
                    onRevert={() =>
                      onGlobalControlSettingsChange?.({ dateRange: true })
                    }
                  />
                ) : null}
              </Flex>
              {/* Editable while inheriting — the draft carries the dashboard's
                  range, and applying a change claims it. */}
              <DateRangeCompareDropdown
                fullWidth
                showCompare
                showGranularity={isTimeSeriesChart}
                value={dateRangeValue}
                onChange={applyDateRange}
                disabled={dateControlsDisabled}
              />
            </Flex>
          </Tooltip>
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
            size="legacy"
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
      <Box p="0">
        {activeType === "metric" && <MetricTabContent />}
        {activeType === "fact_table" && <FactTableTabContent />}
        {activeType === "data_source" && <DatasourceTabContent />}
        {activeType === "sql" && showChartControls && <SqlTabContent />}
        {activeType === "funnel" && <FunnelTabContent />}
      </Box>

      {showChartControls &&
        activeType !== "funnel" &&
        showAsAppliesTo(draftExploreState, getFactMetricById) && (
          <ShowAsSection />
        )}
      {showChartControls && hasInputs && <GroupBySection />}
      {activeType === "funnel" && renderingInDashboardSidebar && (
        <SaveFunnelMetricAction />
      )}
    </Flex>
  );
}
