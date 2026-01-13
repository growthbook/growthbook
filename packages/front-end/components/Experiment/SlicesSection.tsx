import { FC, useEffect, useMemo, useState } from "react";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { Flex, TextField } from "@radix-ui/themes";
import { FaSearch } from "react-icons/fa";
import { ExperimentTableRow } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import EmptyState from "@/components/EmptyState";
import ResultsTable from "./ResultsTable";

interface SlicesSectionProps {
  metric: ExperimentMetricInterface;
  allRows: ExperimentTableRow[];
  variationNames: string[];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  baselineRow?: number;
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
  initialSearchTerm?: string;
}

const SlicesSection: FC<SlicesSectionProps> = ({
  metric,
  allRows,
  differenceType: initialDifferenceType,
  statsEngine,
  baselineRow = 0,
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
  initialSearchTerm = "",
}) => {
  const { getFactTableById } = useDefinitions();
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  
  // Update search term when initialSearchTerm changes
  useEffect(() => {
    setSearchTerm(initialSearchTerm);
  }, [initialSearchTerm]);
  
  // Add state for sorting
  const [sortBy, setSortBy] = useState<"significance" | "change" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null
  );
  
  // Add state for difference type (local state for this section)
  const [differenceType, setDifferenceType] = useState<DifferenceType>(
    initialDifferenceType
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
    <div className="mt-4">
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
        rows={filteredSliceRows}
        id={`${experimentId}_${metric.id}_slices`}
        resultGroup="secondary"
        tableRowAxis="dimension"
        labelHeader="Slice"
        renderLabelColumn={({ label }) => label}
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
      />
    </div>
  );
};

export default SlicesSection;
