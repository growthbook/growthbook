import React from "react";
import { Flex, Box, Text, Button } from "@radix-ui/themes";
import {
  PiChartBar,
  PiTable,
  PiCode,
  PiPlus,
  PiArrowsClockwise,
} from "react-icons/pi";
import { ExploreSeriesType } from "shared/enterprise";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricExplorerSettings from "./SideBar/MetricExplorerSettings";
import ExplorerChart from "./MainSection/ExplorerChart";
import DateRangePicker from "./MainSection/Toolbar/DateRangePicker";
import GranularitySelector from "./MainSection/Toolbar/GranularitySelector";
import GraphTypeSelector from "./MainSection/Toolbar/GraphTypeSelector";
import {
  exploreStateToBlockFormat,
  blockFormatToExploreState,
} from "./exploreStateAdapter";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import {
  SERIES_COLORS,
  getSeriesTag,
  getSeriesDisplayName,
} from "./util";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";

export const getSeriesIcon = (type: ExploreSeriesType, size = 16) => {
  const icons: Record<ExploreSeriesType, React.ReactNode> = {
    metric: <PiChartBar size={size} />,
    factTable: <PiTable size={size} />,
    sql: <PiCode size={size} />,
  };
  return icons[type];
};

function MetricExplorerContent() {
  const { getFactTableById, getFactMetricById } = useDefinitions();
  const {
    draftExploreState,
    submittedExploreState,
    selectedSeriesId,
    hasPendingChanges,
    exploreData,
    loading,
    setDraftExploreState,
    setSelectedSeriesId,
    handleUpdateGraph,
    handleAddSeries,
    handleUpdateSeries,
    handleDeleteSeries,
  } = useExplorerContext();

  // const firstDraftSeries = draftExploreState.series.find(
  //   (s) => s.type === "metric",
  // );
  // const draftFactMetric =
  //   firstDraftSeries && "factMetricId" in firstDraftSeries.config
  //     ? getFactMetricById(firstDraftSeries.config.factMetricId)
  //     : null;

  // const hasConfiguredSeries = submittedExploreState.series.length > 0;

  return (
    <Flex width="100%">

      {/* Main Section */}
      <Box
        style={{
          flex: "1 1 auto",
          minWidth: 0,
        }}
      >
        <ExplorerMainSection />
      </Box>

      {/* Sidebar */}
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
            setDraftExploreState(
              blockFormatToExploreState(block, draftExploreState),
            );
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
  return (
    <ExplorerProvider>
      <MetricExplorerContent />
    </ExplorerProvider>
  );
}
