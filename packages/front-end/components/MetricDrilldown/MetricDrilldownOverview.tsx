import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import {
  DifferenceType,
  PValueCorrection,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus, LookbackOverride } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { MetricTimeSeries } from "shared/validators";
import {
  getNonRollupAggregation,
  isFactMetric,
  isRatioMetric,
} from "shared/experiments";
import ResultsTable from "@/components/Experiment/ResultsTable";
import {
  ExperimentTableRow,
  getClusterSubUnitsLabel,
  getClusterUnitsLabel,
} from "@/services/experiments";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import VariationStatsTable from "@/ui/VariationStatsTable";
import { IdentifierCode } from "@/components/Experiment/AssignmentQueryFields";
import { MetricDrilldownMetadata } from "./MetricDrilldownMetadata";
import MetricDrilldownMetricCard from "./MetricDrilldownMetricCard";
import { type DrilldownDimensionInfo } from "./useMetricDrilldownContext";

interface MetricDrilldownOverviewProps {
  row: ExperimentTableRow;
  experimentId: string;
  significanceThresholds: SignificanceThresholds;
  reportDate: Date;
  isLatestPhase: boolean;
  phase: number;
  startDate: string;
  endDate: string;
  experimentStatus?: ExperimentStatus;
  variations: ExperimentReportVariation[];
  localBaselineRow?: number;
  setLocalBaselineRow?: (baseline: number) => void;
  localVariationFilter?: number[];
  setLocalVariationFilter?: (filter: number[] | undefined) => void;
  goalMetrics: string[];
  secondaryMetrics: string[];
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  localDifferenceType?: DifferenceType;
  setLocalDifferenceType?: (type: DifferenceType) => void;
  sequentialTestingEnabled?: boolean;
  lookbackOverride?: LookbackOverride;
  timeSeriesMessage?: string;
  preloadedTimeSeries?: MetricTimeSeries;
  dimensionInfo?: DrilldownDimensionInfo;
  valueColumnWidth?: number;
  labelMaxWidth?: number;
  oneSided?: boolean;
}

function MetricDrilldownOverview({
  row,
  experimentId,
  significanceThresholds,
  reportDate,
  isLatestPhase,
  phase,
  startDate,
  endDate,
  experimentStatus,
  variations,
  setLocalBaselineRow,
  localVariationFilter,
  setLocalVariationFilter,
  goalMetrics,
  secondaryMetrics,
  statsEngine,
  pValueCorrection,
  localDifferenceType = "relative",
  setLocalDifferenceType,
  sequentialTestingEnabled,
  lookbackOverride,
  timeSeriesMessage,
  preloadedTimeSeries,
  dimensionInfo,
  localBaselineRow = 0,
  valueColumnWidth,
  labelMaxWidth,
  oneSided = false,
}: MetricDrilldownOverviewProps) {
  const [statsExpanded, setStatsExpanded] = useState(false);
  const { isAuthenticated } = useAuth();
  const { snapshot, analysis, setAnalysisSettings, mutate } = useSnapshot();

  const { metric } = row;
  const tableId = `${experimentId}_${metric.id}_modal`;

  // Time series: ExperimentMetricTimeSeriesGraphWrapper shows a message when there are no data points (or while loading).

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

  const settings = snapshot?.settings;
  const clusterIdentifier = settings?.exposureQueryIdentifierType;
  const subUnitIdentifier = settings?.clusterSubUnitIdentifier;
  const isClusterLevelMetric =
    !!settings?.isClusterExperiment &&
    !!clusterIdentifier &&
    !!subUnitIdentifier &&
    !!settings.clusterLevelMetricIds?.includes(metric.id);
  // Cluster-level metrics either can't join the sub-unit, or use an
  // aggregation (e.g. max) that can't be summed across sub-units.
  const nonRollupAggregation =
    isClusterLevelMetric && isFactMetric(metric)
      ? getNonRollupAggregation(metric)
      : null;

  const clusterUnitsLabel = getClusterUnitsLabel(settings);
  const subUnitsLabel = getClusterSubUnitsLabel(settings, metric.id);

  const statsTableRows = variations.map((variation, i) => ({
    variationIndex: i,
    variationName: variation.name,
    stats: row.variations[i],
    isBaseline: i === localBaselineRow,
  }));

  return (
    <Flex direction="column" gap="6">
      {isClusterLevelMetric && (
        <Callout status="info">
          Analyzed per <IdentifierCode>{clusterIdentifier}</IdentifierCode>, not
          per <IdentifierCode>{subUnitIdentifier}</IdentifierCode>:{" "}
          {nonRollupAggregation ? (
            <>
              <IdentifierCode>{nonRollupAggregation}</IdentifierCode> values
              can&apos;t be added up across each{" "}
              <IdentifierCode>{subUnitIdentifier}</IdentifierCode>
            </>
          ) : (
            <>
              this metric&apos;s fact table has no{" "}
              <IdentifierCode>{subUnitIdentifier}</IdentifierCode>
            </>
          )}
          , so each <IdentifierCode>{clusterIdentifier}</IdentifierCode> counts
          as one unit.
        </Callout>
      )}
      <ResultsTable
        experimentId={experimentId}
        significanceThresholds={significanceThresholds}
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
        preloadedTimeSeries={preloadedTimeSeries}
        dimensionId={dimensionInfo?.id}
        dimensionValue={dimensionInfo?.rawValue}
        valueColumnWidth={valueColumnWidth}
        labelMaxWidth={labelMaxWidth}
        oneSided={oneSided}
        snapshot={snapshot}
        analysis={analysis}
        setAnalysisSettings={setAnalysisSettings}
        // Forwarded to BaselineChooserColumnLabel, which appends analyses
        // to the current snapshot in place — need `inPlace: true` so the
        // heavy fetch refreshes (id-keyed auto-upgrade won't fire here).
        mutate={() => mutate({ inPlace: true })}
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
            <VariationStatsTable
              metric={metric}
              rows={statsTableRows}
              unitsLabel={clusterUnitsLabel}
              subUnitsLabel={subUnitsLabel}
            />
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
