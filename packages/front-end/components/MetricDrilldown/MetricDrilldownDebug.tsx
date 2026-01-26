import { FC, useMemo } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
  BayesianVariationResponseIndividual,
  FrequentistVariationResponseIndividual,
  BaselineResponse,
} from "shared/types/stats";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { ExperimentTableRow } from "@/services/experiments";
import EmptyState from "@/components/EmptyState";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";

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
 * Override the metricSnapshotSettings based on the supplemental result
 * to ensure the tooltip / information in the modal is correct
 */
function getSupplementalMetricSnapshotSettings(
  baseSettings: ExperimentTableRow["metricSnapshotSettings"],
  supplementalField: keyof NonNullable<SnapshotMetric["supplementalResults"]>,
): ExperimentTableRow["metricSnapshotSettings"] {
  if (!baseSettings) return baseSettings;

  switch (supplementalField) {
    case "cupedUnadjusted":
    case "noVarianceReduction":
      return {
        ...baseSettings,
        regressionAdjustmentEnabled: false,
      };
    case "flatPrior":
      return {
        ...baseSettings,
        properPrior: false,
      };
    default:
      return baseSettings;
  }
}

/**
 * Create a ExperimentTableRow with data overridden by supplemental results
 */
function createSupplementalRow(
  baseRow: ExperimentTableRow,
  description: string,
  supplementalField: keyof NonNullable<SnapshotMetric["supplementalResults"]>,
): ExperimentTableRow {
  const newVariations = baseRow.variations.map((variation) => {
    const supplemental = variation.supplementalResults?.[supplementalField] as
      | BayesianVariationResponseIndividual
      | FrequentistVariationResponseIndividual
      | BaselineResponse
      | undefined;

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
    metricSnapshotSettings: getSupplementalMetricSnapshotSettings(
      baseRow.metricSnapshotSettings,
      supplementalField,
    ),
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
  const {
    snapshot,
    analysis,
    setAnalysisSettings,
    mutateSnapshot: mutate,
  } = useSnapshot();

  const varianceReductionRows = useMemo(() => {
    if (!row) return [];

    const hasCupedUnadjusted = row.variations.some(
      (v) => v.supplementalResults?.cupedUnadjusted,
    );
    const hasUnstratified = row.variations.some(
      (v) => v.supplementalResults?.unstratified,
    );
    const hasNoVarianceReduction = row.variations.some(
      (v) => v.supplementalResults?.noVarianceReduction,
    );

    if (!hasCupedUnadjusted && !hasUnstratified && !hasNoVarianceReduction) {
      return [];
    }

    const cupedEnabled = hasCupedUnadjusted || hasNoVarianceReduction;

    const postStratFromRealizedSettings = row.variations.some(
      (v) => v.realizedSettings?.postStratificationApplied,
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
            "cupedUnadjusted",
          ),
        );
      }

      if (hasUnstratified) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED On, Post-stratification Off",
            "unstratified",
          ),
        );
      }

      if (hasNoVarianceReduction) {
        rows.push(
          createSupplementalRow(
            row,
            "CUPED Off, Post-stratification Off",
            "noVarianceReduction",
          ),
        );
      }
    } else if (cupedEnabled) {
      if (hasCupedUnadjusted) {
        rows.push(createSupplementalRow(row, "CUPED Off", "cupedUnadjusted"));
      }
    } else if (postStratEnabled) {
      if (hasUnstratified) {
        rows.push(
          createSupplementalRow(row, "Post-stratification Off", "unstratified"),
        );
      }
    }

    return rows;
  }, [row]);

  const priorRows = useMemo(() => {
    if (!row) return [];

    const hasFlatPrior = row.variations.some(
      (v) => v.supplementalResults?.flatPrior,
    );

    if (!hasFlatPrior) return [];

    const rows: ExperimentTableRow[] = [];

    rows.push({
      ...row,
      label: createRowLabel("Proper Prior"),
    });

    rows.push(createSupplementalRow(row, "Flat Prior", "flatPrior"));

    return rows;
  }, [row]);

  const cappingRows = useMemo(() => {
    if (!row) return [];

    const hasUncapped = row.variations.some(
      (v) => v.supplementalResults?.uncapped,
    );

    if (!hasUncapped) return [];

    const rows: ExperimentTableRow[] = [];

    rows.push({
      ...row,
      label: createRowLabel("Capped"),
    });

    rows.push(createSupplementalRow(row, "Uncapped", "uncapped"));

    return rows;
  }, [row]);

  const hasAnySupplementalData =
    varianceReductionRows.length > 0 ||
    priorRows.length > 0 ||
    cappingRows.length > 0;

  if (!row) {
    return null;
  }

  if (!hasAnySupplementalData) {
    return (
      <Box mt="7">
        <EmptyState
          title="No Analysis Adjustments"
          description="When analysis adjustments like CUPED, post-stratification, or metric capping are applied, this tab will show the individual impact of each technique on your results."
          leftButton={null}
          rightButton={null}
        />
      </Box>
    );
  }

  return (
    <>
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
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={mutate}
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
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={mutate}
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
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={mutate}
          />
        </div>
      )}
    </>
  );
};

export default MetricDrilldownDebug;
