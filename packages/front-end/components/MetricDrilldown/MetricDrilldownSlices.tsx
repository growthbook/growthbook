import { FC, useMemo, useState } from "react";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { Box, Flex, Text, TextField } from "@radix-ui/themes";
import { FaSearch } from "react-icons/fa";
import { ExperimentTableRow } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import EmptyState from "@/components/EmptyState";
import ResultsTable from "@/components/Experiment/ResultsTable";

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
  setVisibleTimeSeriesRowIds: _setVisibleTimeSeriesRowIds,
}) => {
  const { getFactTableById } = useDefinitions();
  const tableId = `${experimentId}_${metric.id}_slices`;

  // Add state for sorting
  const [sortBy, setSortBy] = useState<
    "significance" | "change" | "custom" | null
  >(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null,
  );

  // Filter to get slice rows for this metric
  // Always show ALL slices in the modal regardless of expansion state in main table
  const sliceRows = useMemo(() => {
    return allRows.filter(
      (row) => row.isSliceRow && row.metric.id === metric.id,
    );
  }, [allRows, metric.id]);

  // Filter slices based on search term
  const filteredSliceRows = useMemo(() => {
    if (!searchTerm) return sliceRows;

    const term = searchTerm.toLowerCase();
    return sliceRows.filter((row) => {
      const sliceName =
        typeof row.label === "string" ? row.label : row.metric.name;
      return sliceName.toLowerCase().includes(term);
    });
  }, [sliceRows, searchTerm]);

  // Check if slices are available but not configured
  const hasSlicesAvailable = useMemo(() => {
    if (!isFactMetric(metric)) return false;

    const factTable = getFactTableById(metric.numerator.factTableId);
    if (!factTable) return false;

    // Check if fact table has any auto slice columns
    const hasAutoSliceColumns = factTable.columns.some(
      (col) => col.isAutoSliceColumn && !col.deleted,
    );

    return hasAutoSliceColumns;
  }, [metric, getFactTableById]);

  // Determine what to render
  const hasSliceData = sliceRows.length > 0;
  const showEmptyState = !hasSliceData && hasSlicesAvailable;

  // Render empty state
  if (showEmptyState) {
    return (
      <EmptyState
        title="View Analysis for Slices"
        description="Introducing Slices, metric dimensions that can be pre-defined at a global or local level and reused for granular analysis. Configure Slices in Fact Tables > Edit Columns to make them available in Experiments."
        leftButton={null}
        rightButton={null}
      />
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
        rows={filteredSliceRows}
        id={tableId}
        resultGroup="secondary"
        tableRowAxis="dimension"
        labelHeader="Slice"
        renderLabelColumn={({ label, row }) => (
          <Flex direction="column" gap="1" ml="4">
            <Text weight="medium">{label}</Text>
            <Text size="1" style={{ color: "var(--color-text-low)" }}>
              {row.sliceLevels?.map((dl) => dl.column).join(" + ")}
            </Text>
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
        totalMetricsCount={sliceRows.length}
      />
    </Box>
  );
};

export default MetricDrilldownSlices;
