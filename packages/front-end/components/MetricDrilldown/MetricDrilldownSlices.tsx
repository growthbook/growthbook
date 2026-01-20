import { FC, useMemo, useState } from "react";
import { PiInfo } from "react-icons/pi";
import { ExperimentMetricInterface } from "shared/experiments";
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
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import EmptyState from "@/components/EmptyState";
import ResultsTable from "@/components/Experiment/ResultsTable";
import PremiumEmptyState from "@/components/PremiumEmptyState";

interface MetricDrilldownSlicesProps {
  metric: ExperimentMetricInterface;
  allRows: ExperimentTableRow[];
  variationNames: string[];
  differenceType: DifferenceType;
  setDifferenceType: (type: DifferenceType) => void;
  statsEngine: StatsEngine;
  baselineRow?: number;
  setBaselineRow: (baseline: number) => void;
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
  experimentStatus: ExperimentStatus;
  // Search and timeseries state (managed by parent to persist across tab switches)
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  visibleTimeSeriesRowIds: string[];
  setVisibleTimeSeriesRowIds: (ids: string[]) => void;
}

const MetricDrilldownSlices: FC<MetricDrilldownSlicesProps> = ({
  metric,
  allRows,
  differenceType,
  setDifferenceType,
  statsEngine,
  baselineRow = 0,
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
  searchTerm,
  setSearchTerm,
  visibleTimeSeriesRowIds,
  setVisibleTimeSeriesRowIds,
}) => {
  const { getFactTableById: _getFactTableById } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const tableId = `${experimentId}_${metric.id}_slices`;

  // Add state for sorting
  const [sortBy, setSortBy] = useState<
    "significance" | "change" | "metrics" | "metricTags" | null
  >(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null,
  );

  // Get the main row (non-slice row) for this metric
  // Ensure it's a clean row without slice properties for proper rendering
  const mainRow = useMemo(() => {
    const row = allRows.find((r) => !r.isSliceRow && r.metric.id === metric.id);
    if (!row) return undefined;

    // Create a clean row to ensure it renders as a standard metric row
    return {
      ...row,
      label: metric.name,
      isSliceRow: false,
      parentRowId: undefined,
      sliceId: undefined,
      sliceLevels: undefined,
      allSliceLevels: undefined,
      isHiddenByFilter: false,
    } as ExperimentTableRow;
  }, [allRows, metric.id, metric.name]);

  // Filter to get slice rows for this metric
  // Always show ALL slices in the modal regardless of expansion state in main table
  const sliceRows = useMemo(() => {
    return allRows.filter(
      (row) => row.isSliceRow && row.metric.id === metric.id,
    );
  }, [allRows, metric.id]);

  // Filter slices based on search term (but not the main row)
  const filteredSliceRows = useMemo(() => {
    if (!searchTerm) return sliceRows;

    const term = searchTerm.toLowerCase();
    return sliceRows.filter((row) => {
      const sliceName =
        typeof row.label === "string" ? row.label : row.metric.name;
      return sliceName.toLowerCase().includes(term);
    });
  }, [sliceRows, searchTerm]);

  // Sort filtered slices based on sortBy and sortDirection
  const sortedSliceRows = useMemo(() => {
    if (!sortBy || !sortDirection) return filteredSliceRows;

    // Find the first non-baseline variation index to use for sorting
    const sortVariationIndex =
      baselineRow === 0 ? 1 : baselineRow === 1 ? 0 : 1;

    return [...filteredSliceRows].sort((a, b) => {
      const aVariation = a.variations[sortVariationIndex];
      const bVariation = b.variations[sortVariationIndex];

      let aValue: number | undefined;
      let bValue: number | undefined;

      if (sortBy === "significance") {
        // For bayesian, use chanceToWin; for frequentist, use pValue
        if (statsEngine === "bayesian") {
          aValue = aVariation?.chanceToWin;
          bValue = bVariation?.chanceToWin;
        } else {
          aValue = aVariation?.pValue;
          bValue = bVariation?.pValue;
        }
      } else if (sortBy === "change") {
        aValue = aVariation?.uplift?.mean;
        bValue = bVariation?.uplift?.mean;
      }

      // Handle undefined values - push them to the end
      if (aValue === undefined && bValue === undefined) return 0;
      if (aValue === undefined) return 1;
      if (bValue === undefined) return -1;

      const comparison = aValue - bValue;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredSliceRows, sortBy, sortDirection, baselineRow, statsEngine]);

  // Combine main row with sorted slices (main row always first)
  const rowsToRender = useMemo(() => {
    return mainRow ? [mainRow, ...sortedSliceRows] : sortedSliceRows;
  }, [mainRow, sortedSliceRows]);

  // Determine what to render
  const hasSliceData = sliceRows.length > 0;
  const showEmptyState = !hasSliceData;

  // Render upgrade callout for users without the feature
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

  // Render empty state
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

  // Render slices data with ResultsTable
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
            {row.isSliceRow && (
              <Text size="1" style={{ color: "var(--color-text-low)" }}>
                {row.sliceLevels?.map((dl) => dl.column).join(" + ")}
              </Text>
            )}
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
        showTimeSeriesButton={true}
        isHoldout={false}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortDirection={sortDirection}
        setSortDirection={setSortDirection}
        initialVisibleTimeSeriesRowIds={visibleTimeSeriesRowIds}
        onVisibleTimeSeriesRowIdsChange={setVisibleTimeSeriesRowIds}
        totalMetricsCount={rowsToRender.length}
      />
    </Box>
  );
};

export default MetricDrilldownSlices;
