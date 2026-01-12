import { FC, useMemo, useState } from "react";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { Box, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { FaSearch } from "react-icons/fa";
import { ExperimentTableRow } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
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
}

const SlicesSection: FC<SlicesSectionProps> = ({
  metric,
  allRows,
  differenceType,
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
}) => {
  const { getFactTableById } = useDefinitions();
  const [searchTerm, setSearchTerm] = useState("");

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

  // Don't render anything if slices are not available at all
  if (!hasSliceData && !hasSlicesAvailable) {
    return null;
  }

  // Render empty state
  if (showEmptyState) {
    return (
      <Box
        style={{
          textAlign: "center",
          padding: "var(--space-8) var(--space-6)",
          backgroundColor: "var(--color-background-subtle)",
          borderRadius: "var(--radius-3)",
        }}
      >
        <Heading size="5" weight="medium" mb="3">
          View Analysis for a Pre-selected Set of Metric Dimensions
        </Heading>
        <Text
          size="3"
          style={{
            color: "var(--color-text-mid)",
            maxWidth: "700px",
            margin: "0 auto",
            display: "block",
          }}
        >
          Introducing <strong>Slices</strong>, metric dimensions that can be
          pre-defined at a global or local level and reused for granular
          analysis. Configure Slices in{" "}
          <strong>Fact Tables &gt; Edit Columns</strong> to make them available
          in Experiments.
        </Text>
      </Box>
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
        sequentialTestingEnabled={sequentialTestingEnabled}
        isTabActive={true}
        noStickyHeader={true}
        noTooltip={false}
        isBandit={false}
        showTimeSeriesButton={true}
        isHoldout={false}
      />
    </div>
  );
};

export default SlicesSection;
