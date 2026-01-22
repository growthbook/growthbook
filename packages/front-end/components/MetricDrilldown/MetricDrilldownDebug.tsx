import { FC, useMemo } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  BayesianTestResult,
  DifferenceType,
  FrequentistTestResult,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { ExperimentTableRow } from "@/services/experiments";
import EmptyState from "@/components/EmptyState";
import ResultsTable from "@/components/Experiment/ResultsTable";

interface MetricDrilldownDebugProps {
  row?: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  setDifferenceType: (type: DifferenceType) => void;
  variationNames: string[];
  baselineRow?: number;
  setBaselineRow: (baseline: number) => void;
  variationFilter?: number[];
  setVariationFilter: (filter: number[] | undefined) => void;
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

function createRowLabel(description: string) {
  return (
    <Flex direction="column" gap="1" ml="2">
      <Text weight="medium">{description}</Text>
    </Flex>
  );
}

/**
 * Create a ExperimentTableRow with data overridden by supplemental results
 */
function createSupplementalRow(
  baseRow: ExperimentTableRow,
  description: string,
  supplementalField: keyof SnapshotMetric,
): ExperimentTableRow {
  const newVariations = baseRow.variations.map((variation) => {
    const supplemental = variation[supplementalField] as
      | BayesianTestResult
      | FrequentistTestResult;

    if (!supplemental) {
      return variation;
    }

    return {
      ...variation,
      ...supplemental,
    };
  });

  return {
    ...baseRow,
    label: createRowLabel(description),
    variations: newVariations,
  };
}

const MetricDrilldownDebug: FC<MetricDrilldownDebugProps> = ({
  row,
  metric,
  statsEngine,
  differenceType,
  setDifferenceType,
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
}) => {
  const varianceReductionRows = useMemo(() => {
    if (!row) return [];

    const hasCupedUnadjusted = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsCupedUnadjusted,
    );
    const hasUnstratified = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsUnstratified,
    );
    const hasNoVarianceReduction = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsNoVarianceReduction,
    );

    if (!hasCupedUnadjusted && !hasUnstratified && !hasNoVarianceReduction) {
      return [];
    }

    const cupedEnabled = hasCupedUnadjusted || hasNoVarianceReduction;

    const postStratFromRealizedSettings = row.variations.some(
      (v, i) =>
        i > baselineRow && v.realizedSettings?.postStratificationApplied,
    );
    const postStratEnabled =
      postStratFromRealizedSettings ||
      hasUnstratified ||
      hasNoVarianceReduction;

    const rows: ExperimentTableRow[] = [];

    const defaultDescParts: string[] = [];
    if (cupedEnabled) defaultDescParts.push("CUPED On");
    if (postStratEnabled) defaultDescParts.push("Post-stratification On");
    const defaultDesc =
      defaultDescParts.length > 0 ? defaultDescParts.join(", ") : "Default";

    rows.push({
      ...row,
      label: createRowLabel(defaultDesc),
    });

    if (cupedEnabled && postStratEnabled) {
      if (hasCupedUnadjusted) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED Off, Post-stratification On",
            "supplementalResultsCupedUnadjusted",
          ),
        );
      }

      if (hasUnstratified) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED On, Post-stratification Off",
            "supplementalResultsUnstratified",
          ),
        );
      }

      if (hasNoVarianceReduction) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED Off, Post-stratification Off",
            "supplementalResultsNoVarianceReduction",
          ),
        );
      }
    } else if (cupedEnabled) {
      if (hasCupedUnadjusted) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED Off",
            "supplementalResultsCupedUnadjusted",
          ),
        );
      }
    } else if (postStratEnabled) {
      if (hasUnstratified) {
        rows.push(
          createSupplementalRow(
            row,
            "Post-stratification Off",
            "supplementalResultsUnstratified",
          ),
        );
      }
    }

    return rows;
  }, [row, baselineRow]);

  const priorRows = useMemo(() => {
    if (!row) return [];

    const hasFlatPrior = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsFlatPrior,
    );

    if (!hasFlatPrior) return [];

    const rows: ExperimentTableRow[] = [];

    rows.push({
      ...row,
      label: createRowLabel("Proper Prior"),
    });

    rows.push(
      createSupplementalRow(row, "Flat Prior", "supplementalResultsFlatPrior"),
    );

    return rows;
  }, [row, baselineRow]);

  const cappingRows = useMemo(() => {
    if (!row) return [];

    const hasUncapped = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsUncapped,
    );

    if (!hasUncapped) return [];

    const rows: ExperimentTableRow[] = [];

    rows.push({
      ...row,
      label: createRowLabel("Capped"),
    });

    rows.push(
      createSupplementalRow(row, "Uncapped", "supplementalResultsUncapped"),
    );

    return rows;
  }, [row, baselineRow]);

  const hasAnySupplementalData =
    varianceReductionRows.length > 0 ||
    priorRows.length > 0 ||
    cappingRows.length > 0;

  if (!row) {
    return null;
  }

  return (
    <>
      {/* Show empty state if no supplemental data is available */}
      {!hasAnySupplementalData && (
        <Box mt="7">
          <EmptyState
            title="No Analysis Adjustments"
            description="When analysis adjustments like CUPED, post-stratification, or metric capping are applied, this tab will show the individual impact of each technique on your results."
            leftButton={null}
            rightButton={null}
          />
        </Box>
      )}

      {varianceReductionRows.length > 0 && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Variance Reduction Comparison
          </Heading>
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
            rows={varianceReductionRows}
            id={`${experimentId}_${metric.id}_variance_reduction_comparison`}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            setDifferenceType={setDifferenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
          />
        </div>
      )}

      {priorRows.length > 0 && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Prior Comparison
          </Heading>
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
            rows={priorRows}
            id={`${experimentId}_${metric.id}_prior_comparison`}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            setDifferenceType={setDifferenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
          />
        </div>
      )}

      {cappingRows.length > 0 && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Capping Comparison
          </Heading>
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
            rows={cappingRows}
            id={`${experimentId}_${metric.id}_capping_comparison`}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            setDifferenceType={setDifferenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
          />
        </div>
      )}
    </>
  );
};

export default MetricDrilldownDebug;
