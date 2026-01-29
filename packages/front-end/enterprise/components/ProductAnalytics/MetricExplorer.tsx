import React, { useState, useMemo, useEffect } from "react";
import { Flex, Box, Text, Button } from "@radix-ui/themes";
import { PiChartBar, PiTable, PiCode, PiPlus, PiArrowsClockwise } from "react-icons/pi";
import isEqual from "lodash/isEqual";
import MetricExplorerSettings from "./MetricExplorerSettings";
import ExplorerChart from "./ExplorerChart";
import DateRangePicker from "./DateRangePicker";
import GranularitySelector from "./GranularitySelector";
import GraphTypeSelector from "./GraphTypeSelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ExploreState, ExploreSeries, ExploreSeriesType } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { exploreStateToBlockFormat, blockFormatToExploreState } from "./exploreStateAdapter";
import { useExploreData } from "./useExploreData";
import { FactMetricInterface, FactTableInterface } from "shared/types/fact-table";

// Available colors for series
export const SERIES_COLORS = [
  "#8b5cf6", // Violet
  "#3b82f6", // Blue
  "#06b6d4", // Cyan
  "#22c55e", // Green
  "#eab308", // Yellow
  "#f97316", // Orange
  "#ef4444", // Red
  "#ec4899", // Pink
  "#6b7280", // Gray
];


// Helper to generate unique IDs
let seriesIdCounter = 0;
const generateSeriesId = () => `series_${++seriesIdCounter}`;

export const createNewSeries = (type: ExploreSeriesType): ExploreSeries => {
  const baseNames: Record<ExploreSeriesType, string> = {
    metric: "Metric Series",
    factTable: "Fact Table Series",
    sql: "SQL Series",
  };

  const defaultConfigs: Record<ExploreSeriesType, ExploreSeries["config"]> = {
    metric: { factMetricId: "", metricType: "proportion" },
    factTable: { factTableId: "", valueType: "count" },
    sql: { datasourceId: "", sql: "" },
  };

  return {
    id: generateSeriesId(),
    type,
    name: baseNames[type],
    color: "", // Colors are now automatically assigned
    config: defaultConfigs[type],
  };
};

export const getSeriesIcon = (type: ExploreSeriesType, size = 16) => {
  const icons: Record<ExploreSeriesType, React.ReactNode> = {
    metric: <PiChartBar size={size} />,
    factTable: <PiTable size={size} />,
    sql: <PiCode size={size} />,
  };
  return icons[type];
};

export const getSeriesLabel = (type: ExploreSeriesType) => {
  const labels: Record<ExploreSeriesType, string> = {
    metric: "Metric",
    factTable: "Fact Table",
    sql: "SQL Query",
  };
  return labels[type];
};

export const getSeriesTag = (index: number): string => {
  // A, B, C, ... Z, AA, AB, etc.
  let tag = "";
  let n = index;
  do {
    tag = String.fromCharCode(65 + (n % 26)) + tag;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return tag;
};

// Helper to get series display name
function getSeriesDisplayName(
  series: ExploreSeries,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  getFactTableById: (id: string) => FactTableInterface | null,
): string {
  if (series.type === "metric") {
    const config = series.config;
    if ("factMetricId" in config && config.factMetricId) {
      const factMetric = getFactMetricById(config.factMetricId);
      return factMetric?.name || series.name;
    }
  } else if (series.type === "factTable") {
    const config = series.config;
    if ("factTableId" in config && config.factTableId) {
      const factTable = getFactTableById(config.factTableId);
      const valueTypeLabel =
        config.valueType === "count"
          ? "Count"
          : config.valueType === "unit_count"
            ? `${config.unit || "Units"} Count`
            : `Sum of ${config.valueColumn || "value"}`;
      return factTable ? `${factTable.name} (${valueTypeLabel})` : series.name;
    }
  }
  return series.name;
}

function MetricExplorerContent() {
  // Use definitions hook to get fact tables and fact metrics
  // This automatically loads them on initial mount
  const { getFactTableById, getFactMetricById } = useDefinitions();

  // Hook to fetch explore data
  const { data: exploreData, loading, error: exploreError, fetchData } = useExploreData();
  
  // Series state - array of series that can be added to the graph
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  
  const [draftExploreState, setDraftExploreState] = useState<ExploreState>({
    series: [],
    visualizationType: "timeseries",
    lookbackDays: 30,
    granularity: "day",
    globalRowFilters: [],
    groupBy: [],
  });

  const [submittedExploreState, setSubmittedExploreState] = useState<ExploreState>(draftExploreState);

  // Check if there are pending changes
  const hasPendingChanges = useMemo(() => {
    return !isEqual(draftExploreState, submittedExploreState);
  }, [draftExploreState, submittedExploreState]);

  // Handle update graph - submit explore state to backend
  const handleUpdateGraph = async () => {
    await fetchData(draftExploreState);
    setSubmittedExploreState(draftExploreState);
  };

  // Get first draft metric for UI controls
  const firstDraftSeries = draftExploreState.series.find(s => s.type === "metric");
  const draftFactMetric = firstDraftSeries && "factMetricId" in firstDraftSeries.config
    ? getFactMetricById(firstDraftSeries.config.factMetricId)
    : null;

  // Check if we have configured series and data
  const hasConfiguredSeries = submittedExploreState.series.length > 0;
  const hasData = exploreData !== null;

  const handleAddSeries = (type: ExploreSeriesType) => {
    const newSeries = createNewSeries(type);
    setDraftExploreState({
      ...draftExploreState,
      series: [...draftExploreState.series, newSeries],
    });
    setSelectedSeriesId(newSeries.id);
  };

  const handleUpdateSeries = (id: string, updates: Partial<ExploreSeries>) => {
    setDraftExploreState({
      ...draftExploreState,
      series: draftExploreState.series.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
  };

  const handleDeleteSeries = (id: string) => {
    const newSeries = draftExploreState.series.filter((s) => s.id !== id);
    setDraftExploreState({
      ...draftExploreState,
      series: newSeries,
    });
    if (selectedSeriesId === id) {
      setSelectedSeriesId(newSeries.length > 0 ? newSeries[0].id : null);
    }
  };

  const selectedSeries = draftExploreState.series.find((s) => s.id === selectedSeriesId);

  return (
    <Flex width="100%">
      <Box
        style={{
          flex: "1 1 auto",
          minWidth: 0,
        }}
      >
        <Flex direction="column" px="2" py="3" gap="3">
          <Flex justify="between" align="center">
            <Flex align="center" gap="3">
              {draftExploreState.series.length > 0 && (
                <GraphTypeSelector
                  block={exploreStateToBlockFormat(draftExploreState)}
                  setBlock={(block) => {
                    setDraftExploreState(blockFormatToExploreState(block, draftExploreState));
                  }}
                  factMetric={draftFactMetric || undefined}
                />
              )}
              {/* Show series tags being visualized */}
              <Flex align="center" gap="1">
                <Text size="1" style={{ color: "var(--gray-9)" }}>
                  Showing:
                </Text>
                {submittedExploreState.series.map((seriesItem, index) => (
                  <Tooltip key={seriesItem.id} body={getSeriesDisplayName(seriesItem, getFactMetricById, getFactTableById)}>
                    <Flex
                      align="center"
                      justify="center"
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "var(--radius-2)",
                        backgroundColor: seriesItem.color || SERIES_COLORS[index % SERIES_COLORS.length],
                        color: "white",
                        fontSize: "11px",
                        fontWeight: 600,
                      }}
                    >
                      {getSeriesTag(index)}
                    </Flex>
                  </Tooltip>
                ))}
              </Flex>
            </Flex>
            <Flex align="center" gap="3">
              <Button 
                size="2" 
                variant="solid" 
                disabled={!hasPendingChanges || loading}
                onClick={handleUpdateGraph}
              >
                <PiArrowsClockwise />
                Update
              </Button>
              <DateRangePicker 
                block={exploreStateToBlockFormat(draftExploreState)}
                setBlock={(block) => {
                  setDraftExploreState(blockFormatToExploreState(block, draftExploreState));
                }}
              />
              <GranularitySelector 
                block={exploreStateToBlockFormat(draftExploreState)}
                setBlock={(block) => {
                  setDraftExploreState(blockFormatToExploreState(block, draftExploreState));
                }}
              />
            </Flex>
          </Flex>

          {hasConfiguredSeries ? (
            <>
              <ExplorerChart
                series={submittedExploreState.series}
                data={exploreData}
                loading={loading}
                chartId={`metric-explorer-${submittedExploreState.series.map(s => s.id).join("-")}`}
              />
              {/* TODO: Update ExplorerDataTable to use new API response format */}
              {/* <ExplorerDataTable
                block={exploreStateToBlockFormat(submittedExploreState)}
                factMetric={draftFactMetric}
                allSeriesData={allSeriesData}
              /> */}
            </>
          ) : (
            <Flex
              align="center"
              justify="center"
              direction="column"
              gap="3"
              style={{
                minHeight: "400px",
                color: "var(--color-text-mid)",
                border: "2px dashed var(--gray-a3)",
                borderRadius: "var(--radius-4)",
              }}
            >
              <PiPlus size={32} style={{ opacity: 0.5 }} />
              <Text size="3" weight="medium">
                Add a series to get started
              </Text>
              <Text size="2" style={{ maxWidth: 350, textAlign: "center" }}>
                Use the sidebar to add metrics, fact table queries, or SQL to visualize your data
              </Text>
            </Flex>
          )}
        </Flex>
      </Box>
      <Box
        style={{
          flex: "0 0 320px",
          minWidth: "280px",
          maxWidth: "380px",
          padding: "var(--space-3)",
        }}
      >
        <MetricExplorerSettings
          block={exploreStateToBlockFormat(draftExploreState)}
          setBlock={(block) => {
            setDraftExploreState(blockFormatToExploreState(block, draftExploreState));
          }}
          series={draftExploreState.series}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
          onAddSeries={handleAddSeries}
          onUpdateSeries={handleUpdateSeries}
          onDeleteSeries={handleDeleteSeries}
        />
      </Box>
    </Flex>
  );
}

export default function MetricExplorer() {
  return <MetricExplorerContent />;
}
