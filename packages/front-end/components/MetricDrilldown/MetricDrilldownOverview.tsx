import { Box, Text } from "@radix-ui/themes";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { ExperimentTableRow } from "@/services/experiments";
import styles from "./MetricDrilldownOverview.module.scss";

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

  // Determine result group based on metric categorization
  const resultGroup: "goal" | "secondary" | "guardrail" = goalMetrics.includes(
    metric.id,
  )
    ? "goal"
    : secondaryMetrics.includes(metric.id)
      ? "secondary"
      : "guardrail";
  return (
    <Box className={styles.metricDrilldownOverviewResultsTableWrapper}>
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
        rows={[row]}
        id={`${experimentId}_${metric.id}_modal`}
        resultGroup={resultGroup}
        tableRowAxis="metric"
        labelHeader=""
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
    </Box>
  );
}

export default MetricDrilldownOverview;
