import { Flex, Text } from "@radix-ui/themes";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { isRatioMetric } from "shared/experiments";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { ExperimentTableRow } from "@/services/experiments";
import { MetricDrilldownMetadata } from "./MetricDrilldownMetadata";
import MetricDrilldownMetricCard from "./MetricDrilldownMetricCard";

interface MetricDrilldownOverviewProps {
  row: ExperimentTableRow;
  experimentId: string;
  reportDate: Date;
  isLatestPhase: boolean;
  phase: number;
  startDate: string;
  endDate: string;
  experimentStatus: ExperimentStatus;
  variations: ExperimentReportVariation[];
  localBaselineRow: number;
  setLocalBaselineRow: (baseline: number) => void;
  localVariationFilter?: number[];
  setLocalVariationFilter: (filter: number[] | undefined) => void;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  localDifferenceType: DifferenceType;
  setLocalDifferenceType: (type: DifferenceType) => void;
  sequentialTestingEnabled?: boolean;
}

function MetricDrilldownOverview({
  row,
  experimentId,
  reportDate,
  isLatestPhase,
  phase,
  startDate,
  endDate,
  experimentStatus,
  variations,
  localBaselineRow,
  setLocalBaselineRow,
  localVariationFilter,
  setLocalVariationFilter,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics: _guardrailMetrics,
  statsEngine,
  pValueCorrection,
  localDifferenceType,
  setLocalDifferenceType,
  sequentialTestingEnabled,
}: MetricDrilldownOverviewProps) {
  const { metric } = row;
  const tableId = `${experimentId}_${metric.id}_modal`;

  // Determine result group based on metric categorization
  const resultGroup: "goal" | "secondary" | "guardrail" = goalMetrics.includes(
    metric.id,
  )
    ? "goal"
    : secondaryMetrics.includes(metric.id)
      ? "secondary"
      : "guardrail";

  const labelHeader =
    resultGroup === "goal"
      ? "Goal Metric"
      : resultGroup === "secondary"
        ? "Secondary Metric"
        : "Guardrail Metric";

  // Create a clean row without slice-specific properties for the overview
  // This ensures the metric is always rendered as a standard metric row, not as a slice
  const cleanRow: ExperimentTableRow = {
    ...row,
    label: metric.name, // Use metric name instead of potentially being a slice label
    isSliceRow: false,
    parentRowId: undefined,
    sliceId: undefined,
    sliceLevels: undefined,
    allSliceLevels: undefined,
    isHiddenByFilter: false,
  };

  return (
    <Flex direction="column" gap="6">
      <ResultsTable
        experimentId={experimentId}
        dateCreated={reportDate}
        isLatestPhase={isLatestPhase}
        phase={phase}
        startDate={startDate}
        endDate={endDate}
        status={experimentStatus}
        variations={variations}
        baselineRow={localBaselineRow}
        setBaselineRow={setLocalBaselineRow}
        variationFilter={localVariationFilter}
        setVariationFilter={setLocalVariationFilter}
        rows={[cleanRow]}
        id={tableId}
        resultGroup={resultGroup}
        tableRowAxis="metric"
        labelHeader={labelHeader}
        renderLabelColumn={({ label }) => (
          <Text weight="bold" ml="4">
            {label}
          </Text>
        )}
        statsEngine={statsEngine}
        pValueCorrection={pValueCorrection}
        differenceType={localDifferenceType}
        setDifferenceType={setLocalDifferenceType}
        sequentialTestingEnabled={sequentialTestingEnabled}
        isTabActive={true}
        noStickyHeader={true}
        noTooltip={false}
        isBandit={false}
        isHoldout={false}
        forceTimeSeriesVisible={true}
      />

      <Flex direction="column" gap="2">
        <Text size="4" weight="medium">
          Metric definition
        </Text>
        <MetricDrilldownMetadata statsEngine={statsEngine} row={row} />
        <Flex direction="row" gap="5">
          <MetricDrilldownMetricCard metric={metric} type="numerator" />
          {isRatioMetric(metric) && (
            <MetricDrilldownMetricCard metric={metric} type="denominator" />
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}

export default MetricDrilldownOverview;
