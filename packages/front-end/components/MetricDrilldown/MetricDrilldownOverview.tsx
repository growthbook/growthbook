import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus, LookbackOverride } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { isRatioMetric } from "shared/experiments";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { ExperimentTableRow } from "@/services/experiments";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import VariationStatsTable from "@/ui/VariationStatsTable";
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
  experimentStatus?: ExperimentStatus;
  variations: ExperimentReportVariation[];
  localBaselineRow: number;
  setLocalBaselineRow: (baseline: number) => void;
  localVariationFilter?: number[];
  setLocalVariationFilter: (filter: number[] | undefined) => void;
  goalMetrics: string[];
  secondaryMetrics: string[];
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  localDifferenceType: DifferenceType;
  setLocalDifferenceType: (type: DifferenceType) => void;
  sequentialTestingEnabled?: boolean;
  lookbackOverride?: LookbackOverride;
  timeSeriesMessage?: string;
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
  statsEngine,
  pValueCorrection,
  localDifferenceType,
  setLocalDifferenceType,
  sequentialTestingEnabled,
  lookbackOverride,
  timeSeriesMessage,
}: MetricDrilldownOverviewProps) {
  const [statsExpanded, setStatsExpanded] = useState(false);
  const { isAuthenticated } = useAuth();
  const { snapshot, analysis, setAnalysisSettings, mutateSnapshot } =
    useSnapshot();

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

  const statsTableRows = variations.map((variation, i) => ({
    variationIndex: i,
    variationName: variation.name,
    stats: row.variations[i],
    isBaseline: i === localBaselineRow,
  }));

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
        rows={[row]}
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
        visibleTimeSeriesRowIds={
          isAuthenticated ? [`${tableId}-${metric.id}-0`] : []
        }
        timeSeriesMessage={timeSeriesMessage}
        snapshot={snapshot}
        analysis={analysis}
        setAnalysisSettings={setAnalysisSettings}
        mutate={mutateSnapshot}
      />

      <Box>
        <Link color="dark" onClick={() => setStatsExpanded(!statsExpanded)}>
          <Flex align="center" gap="2">
            {statsExpanded ? (
              <FaCaretDown style={{ color: "var(--accent-a10)" }} />
            ) : (
              <FaCaretRight style={{ color: "var(--accent-a10)" }} />
            )}
            <Text
              size="3"
              weight="medium"
              style={{ color: "var(--color-text-high)" }}
            >
              Variation statistics
            </Text>
          </Flex>
        </Link>

        {statsExpanded && (
          <Box mt="3" maxWidth="500px">
            <VariationStatsTable metric={metric} rows={statsTableRows} />
          </Box>
        )}
      </Box>

      <Flex direction="column" gap="2">
        <Text size="4" weight="medium">
          Metric definition
        </Text>
        <MetricDrilldownMetadata
          statsEngine={statsEngine}
          lookbackOverride={lookbackOverride}
          row={row}
        />
        {isAuthenticated && (
          <Flex direction="row" gap="5">
            <MetricDrilldownMetricCard metric={metric} type="numerator" />
            {isRatioMetric(metric) && (
              <MetricDrilldownMetricCard metric={metric} type="denominator" />
            )}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

export default MetricDrilldownOverview;
