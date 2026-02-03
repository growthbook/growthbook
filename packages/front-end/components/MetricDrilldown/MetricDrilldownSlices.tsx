import { FC, useState, useMemo } from "react";
import { PiInfo } from "react-icons/pi";
import {
  ExperimentMetricInterface,
  ExperimentSortBy,
} from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { Box, Flex, Text, TextField, Tooltip } from "@radix-ui/themes";
import { FaSearch } from "react-icons/fa";
import { ExperimentTableRow } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import EmptyState from "@/components/EmptyState";
import ResultsTable from "@/components/Experiment/ResultsTable";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { useTableSorting } from "@/hooks/useTableSorting";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { filterRowsForMetricDrilldown } from "./helpers";

interface MetricDrilldownSlicesProps {
  metric: ExperimentMetricInterface;
  // Rows computed by parent using useExperimentTableRows
  rows: ExperimentTableRow[];
  variationNames: string[];
  differenceType: DifferenceType;
  setDifferenceType: (type: DifferenceType) => void;
  statsEngine: StatsEngine;
  // Controlled state from modal (shared across tabs)
  baselineRow: number;
  setBaselineRow: (row: number) => void;
  variationFilter?: number[];
  setVariationFilter: (filter: number[] | undefined) => void;
  // Props for ResultsTable
  experimentId: string;
  phase: number;
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  experimentStatus?: ExperimentStatus;
  // Initial sorting state (inherited from main table, managed locally)
  initialSortBy: ExperimentSortBy;
  initialSortDirection: "asc" | "desc" | null;
  // Search state (managed by parent to persist across tab switches)
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  // Timeseries state (managed by parent to persist across tab switches)
  visibleTimeSeriesRowIds: string[];
  setVisibleTimeSeriesRowIds: (ids: string[]) => void;
  // SSR polyfills for public pages
  ssrPolyfills?: SSRPolyfills;
  hideTimeSeries?: boolean;
  isReportContext?: boolean;
}

const MetricDrilldownSlices: FC<MetricDrilldownSlicesProps> = ({
  metric,
  rows,
  differenceType,
  setDifferenceType,
  statsEngine,
  baselineRow,
  setBaselineRow,
  variationFilter,
  setVariationFilter,
  experimentId,
  phase,
  variations,
  startDate,
  endDate,
  reportDate,
  isLatestPhase,
  pValueCorrection,
  sequentialTestingEnabled,
  experimentStatus,
  initialSortBy,
  initialSortDirection,
  searchTerm,
  setSearchTerm,
  visibleTimeSeriesRowIds,
  setVisibleTimeSeriesRowIds,
  ssrPolyfills,
  hideTimeSeries,
  isReportContext,
}) => {
  const { hasCommercialFeature } = useUser();

  // Get snapshot context - this will be the local context from LocalSnapshotProvider
  // when rendered inside MetricDrilldownModal
  const {
    snapshot,
    analysis,
    setAnalysisSettings,
    mutateSnapshot: mutate,
  } = useSnapshot();

  // Check the owning org's features (via SSR data) first, then fall back to current user's org
  const hasMetricSlicesFeature =
    ssrPolyfills?.hasCommercialFeature("metric-slices") ||
    hasCommercialFeature("metric-slices");
  const tableId = `${experimentId}_${metric.id}_slices`;

  // TODO: Do we stil need?
  const [sortBy, setSortBy] = useState<ExperimentSortBy>(initialSortBy);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    initialSortDirection,
  );

  const { mainRow, sliceRows, filteredSliceRows } = useMemo(() => {
    return filterRowsForMetricDrilldown(rows, metric.id, searchTerm);
  }, [rows, metric.id, searchTerm]);

  const rowsToSort = useMemo(() => {
    return mainRow ? [mainRow, ...filteredSliceRows] : filteredSliceRows;
  }, [mainRow, filteredSliceRows]);

  const rowsToRender = useTableSorting({
    rows: rowsToSort,
    sortBy,
    sortDirection,
    variationFilter: variationFilter ?? [],
  });

  const hasSliceData = sliceRows.length > 0;
  const showEmptyState = !hasSliceData;

  if (!hasSliceData && !hasMetricSlicesFeature) {
    return (
      <Box mt="5">
        <PremiumEmptyState
          title="Metric Slices"
          description="Discover which segments are driving your results. Automatically break down any metric by dimensions like product type, country, or device—no need to create separate metrics."
          commercialFeature="metric-slices"
          learnMoreLink="https://docs.growthbook.io/app/metrics#metric-slices"
        />
      </Box>
    );
  }

  if (showEmptyState) {
    return (
      <Box mt="7">
        <EmptyState
          title="No Metric Slices Configured"
          description="Metric slices let you see separate breakdowns for each value of a dimension (e.g., revenue by product type). Configure slices in your Fact Table columns to enable granular analysis."
          leftButton={null}
          rightButton={
            <a
              href="https://docs.growthbook.io/app/metrics#metric-slices"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline-primary"
            >
              Learn more
            </a>
          }
        />
      </Box>
    );
  }

  return (
    <Box mt="4">
      <Flex
        justify="between"
        align="center"
        mb="3"
        style={{ marginBottom: "12px" }}
      >
        <Flex align="center" gap="2">
          <div style={{ width: "300px" }}>
            <TextField.Root
              placeholder="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              size="2"
            >
              <TextField.Slot>
                <FaSearch />
              </TextField.Slot>
            </TextField.Root>
          </div>
        </Flex>
      </Flex>

      <ResultsTable
        experimentId={experimentId}
        dateCreated={reportDate}
        isLatestPhase={isLatestPhase}
        phase={phase}
        startDate={startDate}
        endDate={endDate}
        status={experimentStatus}
        variations={variations}
        baselineRow={baselineRow}
        setBaselineRow={setBaselineRow}
        variationFilter={variationFilter}
        setVariationFilter={setVariationFilter}
        rows={rowsToRender}
        id={tableId}
        resultGroup="secondary"
        tableRowAxis="dimension"
        labelHeader={
          <Flex align="center" gap="1">
            Slices{" "}
            <Tooltip content="Configure available slices on Fact Tables > Edit Columns">
              <Text color="violet">
                <PiInfo size={15} />
              </Text>
            </Tooltip>
          </Flex>
        }
        renderLabelColumn={({ label, row }) => (
          <Flex direction="column" gap="1" ml={row.isSliceRow ? "4" : "3"}>
            <Text weight="medium">{label}</Text>
            {row.isSliceRow ? (
              <Text size="1" style={{ color: "var(--color-text-low)" }}>
                {row.sliceLevels?.map((dl) => dl.column).join(" + ")}
              </Text>
            ) : null}
          </Flex>
        )}
        statsEngine={statsEngine}
        pValueCorrection={pValueCorrection}
        differenceType={differenceType}
        setDifferenceType={setDifferenceType}
        sequentialTestingEnabled={sequentialTestingEnabled}
        isTabActive={true}
        noStickyHeader={true}
        noTooltip={false}
        isBandit={false}
        showTimeSeriesButton={!hideTimeSeries}
        isHoldout={false}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortDirection={sortDirection}
        setSortDirection={setSortDirection}
        visibleTimeSeriesRowIds={visibleTimeSeriesRowIds}
        onVisibleTimeSeriesRowIdsChange={setVisibleTimeSeriesRowIds}
        totalMetricsCount={rowsToRender.length}
        snapshot={snapshot}
        analysis={analysis}
        setAnalysisSettings={setAnalysisSettings}
        mutate={mutate}
        isReportContext={isReportContext}
      />
    </Box>
  );
};

export default MetricDrilldownSlices;
