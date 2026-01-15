import { FC, useMemo } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { Flex, Heading, Text } from "@radix-ui/themes";
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
  // Props needed for ResultsTable
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

/**
 * Create a label with metric name and description using Flex layout
 */
function createRowLabel(metricName: string, description: string) {
  return (
    <Flex direction="column" gap="1" ml="4">
      <Text weight="medium">{metricName}</Text>
      <Text size="1" style={{ color: "var(--color-text-low)" }}>
        {description}
      </Text>
    </Flex>
  );
}

/**
 * Create a row with variations overridden by supplemental results
 */
function createSupplementalRow(
  baseRow: ExperimentTableRow,
  description: string,
  supplementalField: keyof SnapshotMetric,
): ExperimentTableRow {
  const newVariations = baseRow.variations.map((variation) => {
    const supplemental = variation[supplementalField] as
      | SnapshotMetric
      | undefined;
    if (!supplemental) {
      return variation;
    }
    // Merge supplemental results over the original variation
    return {
      ...variation,
      ...supplemental,
    };
  });

  return {
    ...baseRow,
    label: createRowLabel(baseRow.metric.name, description),
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
  // Generate rows for Variance Reduction Comparison (CUPED + Post-stratification matrix)
  const varianceReductionRows = useMemo(() => {
    if (!row) return [];

    // Check if we have supplemental results (only check non-baseline variations)
    const hasCupedUnadjusted = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsCupedUnadjusted,
    );
    const hasUnstratified = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsUnstratified,
    );
    const hasNoVarianceReduction = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsNoVarianceReduction,
    );

    // If no supplemental data exists, don't render the table
    if (!hasCupedUnadjusted && !hasUnstratified && !hasNoVarianceReduction) {
      return [];
    }

    // Determine what's enabled based on supplemental data existence
    // If CUPED unadjusted exists, CUPED was on for the default
    const cupedEnabled = hasCupedUnadjusted || hasNoVarianceReduction;

    // Check for post-stratification in two ways:
    // 1. Check realizedSettings (if backend provides it)
    // 2. Infer from hasUnstratified (if unstratified supplemental exists, post-strat was on for default)
    const postStratFromRealizedSettings = row.variations.some(
      (v, i) =>
        i > baselineRow && v.realizedSettings?.postStratificationApplied,
    );
    const postStratEnabled =
      postStratFromRealizedSettings ||
      hasUnstratified ||
      hasNoVarianceReduction;

    const rows: ExperimentTableRow[] = [];

    // Build description for the default row
    const defaultDescParts: string[] = [];
    if (cupedEnabled) defaultDescParts.push("CUPED On");
    if (postStratEnabled) defaultDescParts.push("Post-stratification On");
    const defaultDesc =
      defaultDescParts.length > 0 ? defaultDescParts.join(", ") : "Default";

    // Main row (default settings)
    rows.push({
      ...row,
      label: createRowLabel(metric.name, defaultDesc),
    });

    // Add rows based on what's enabled
    if (cupedEnabled && postStratEnabled) {
      // Both enabled: show matrix of 4 rows
      // CUPED off, Post-strat on
      if (hasCupedUnadjusted) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED Off, Post-stratification On",
            "supplementalResultsCupedUnadjusted",
          ),
        );
      }
      // CUPED on, Post-strat off
      if (hasUnstratified) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED On, Post-stratification Off",
            "supplementalResultsUnstratified",
          ),
        );
      }
      // CUPED off, Post-strat off
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
      // Only CUPED enabled: show CUPED on/off
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
      // Only Post-strat enabled: show Post-strat on/off
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
  }, [row, metric.name, baselineRow]);

  // Generate rows for Bayesian Prior comparison
  const priorRows = useMemo(() => {
    if (!row) return [];

    // Check if we have flat prior results (only check non-baseline variations)
    const hasFlatPrior = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsFlatPrior,
    );

    // Only show comparison if we have supplemental data
    if (!hasFlatPrior) return [];

    const rows: ExperimentTableRow[] = [];

    // Main row with Proper Prior
    rows.push({
      ...row,
      label: createRowLabel(metric.name, "Proper Prior"),
    });

    // Add Flat Prior comparison row
    rows.push(
      createSupplementalRow(row, "Flat Prior", "supplementalResultsFlatPrior"),
    );

    return rows;
  }, [row, metric.name, baselineRow]);

  // Generate rows for Capping comparison
  const cappingRows = useMemo(() => {
    if (!row) return [];

    // Check if we have uncapped results (only check non-baseline variations)
    const hasUncapped = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsUncapped,
    );

    // Only show comparison if we have supplemental data
    if (!hasUncapped) return [];

    const rows: ExperimentTableRow[] = [];

    // Main row with Capped
    rows.push({
      ...row,
      label: createRowLabel(metric.name, "Capped"),
    });

    // Add Uncapped comparison row
    rows.push(
      createSupplementalRow(row, "Uncapped", "supplementalResultsUncapped"),
    );

    return rows;
  }, [row, metric.name, baselineRow]);

  // Check if any supplemental data is available
  const hasAnySupplementalData =
    varianceReductionRows.length > 0 ||
    priorRows.length > 0 ||
    cappingRows.length > 0;

  // If row is not available, don't render
  if (!row) {
    return null;
  }

  return (
    <>
      {/* Show empty state if no supplemental data is available */}
      {!hasAnySupplementalData && (
        <EmptyState
          title="No data available"
          description="When data becomes available, it will automatically populate this tab. This tab shows comparisons to help you understand the impact of variance reduction techniques like CUPED (regression adjustment using pre-experiment data) and post-stratification (balancing across user attributes), as well as the effect of metric capping and Bayesian priors on your results."
          leftButton={null}
          rightButton={null}
        />
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
