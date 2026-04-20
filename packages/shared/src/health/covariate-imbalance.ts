import { z } from "zod";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";
import { getIntersectionBaseMetricIds } from "shared/experiments";
import {
  ExperimentSnapshotAnalysis,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";

export const MetricVariationCovariateImbalanceResultValidator = z.object({
  metricId: z.string(),
  variation: z.number(),
  isImbalanced: z.boolean(),
  baselineSampleSize: z.number(),
  variationSampleSize: z.number(),
  baselineMean: z.number(),
  variationMean: z.number(),
  baselineStandardError: z.number().optional(),
  variationStandardError: z.number().optional(),
  pValue: z.number(),
  errorMessage: z.string().optional(),
});

export type MetricVariationCovariateImbalanceResult = z.infer<
  typeof MetricVariationCovariateImbalanceResultValidator
>;

export const SingleGroupCovariateImbalanceResultValidator = z.object({
  isImbalanced: z.boolean(),
  pValueThreshold: z.number(),
  numMetrics: z.number(),
  numMetricsImbalanced: z.number(),
  metricVariationCovariateImbalanceResults: z.array(
    MetricVariationCovariateImbalanceResultValidator,
  ),
});

export type SingleGroupCovariateImbalanceResult = z.infer<
  typeof SingleGroupCovariateImbalanceResultValidator
>;

export const CovariateImbalanceResultValidator = z.object({
  isImbalanced: z.boolean(),
  pValueThreshold: z.number(),
  numGoalMetrics: z.number(),
  numGoalMetricsImbalanced: z.number(),
  numGuardrailMetrics: z.number(),
  numGuardrailMetricsImbalanced: z.number(),
  numSecondaryMetrics: z.number(),
  numSecondaryMetricsImbalanced: z.number(),
  metricVariationCovariateImbalanceResults: z.array(
    MetricVariationCovariateImbalanceResultValidator,
  ),
});

export type CovariateImbalanceResult = z.infer<
  typeof CovariateImbalanceResultValidator
>;

function statSigFrequentist(pValue: number, pValueThreshold: number): boolean {
  return pValue < pValueThreshold;
}

export interface CovariateImbalanceTableRow {
  metricId: string;
  variation: number;
  isImbalanced: boolean;
  baselineSampleSize: number;
  variationSampleSize: number;
  baselineMean: number;
  variationMean: number;
  baselineStandardError?: number;
  variationStandardError?: number;
  pValue: number;
  errorMessage?: string;
}

function tabulateCovariateImbalanceByGroup(
  overallResult: ExperimentReportResultDimension,
  metrics: string[],
  covariateImbalanceTable: CovariateImbalanceTableRow[],
  pValueThreshold: number,
  tabulatedMetricVariationByKey: Map<string, CovariateImbalanceTableRow>,
): SingleGroupCovariateImbalanceResult {
  let isImbalanced = false;
  let processedMetrics = 0;
  let numMetricsImbalanced = 0;

  if (overallResult.variations.length > 1) {
    const baselineMetrics = overallResult.variations[0].metrics;

    for (
      let variationIndex = 1;
      variationIndex < overallResult.variations.length;
      variationIndex += 1
    ) {
      const treatmentMetrics = overallResult.variations[variationIndex].metrics;

      for (const metricId of metrics) {
        const metricVariationKey = `${metricId}\0${variationIndex}`;
        const existingRow =
          tabulatedMetricVariationByKey.get(metricVariationKey);
        if (existingRow) {
          processedMetrics += 1;
          if (existingRow.isImbalanced) {
            isImbalanced = true;
            numMetricsImbalanced += 1;
          }
          continue;
        }

        const baselineMetric = baselineMetrics[metricId];
        const treatmentMetric = treatmentMetrics[metricId];

        if (
          !baselineMetric ||
          !treatmentMetric ||
          treatmentMetric.errorMessage
        ) {
          continue;
        }

        processedMetrics += 1;

        let metricIsImbalanced = false;
        let pValueForTable: number | undefined;

        if (typeof treatmentMetric.pValue === "number") {
          metricIsImbalanced = statSigFrequentist(
            treatmentMetric.pValue,
            pValueThreshold,
          );
          pValueForTable = treatmentMetric.pValue;
        }

        if (pValueForTable === undefined) {
          continue;
        }

        if (metricIsImbalanced) {
          isImbalanced = true;
          numMetricsImbalanced += 1;
        }
        const baselineStandardError =
          baselineMetric.users > 0 && baselineMetric.stats?.stddev
            ? baselineMetric.stats.stddev / Math.sqrt(baselineMetric.users)
            : 0;
        const variationStandardError =
          treatmentMetric.users > 0 && treatmentMetric.stats?.stddev
            ? treatmentMetric.stats.stddev / Math.sqrt(treatmentMetric.users)
            : 0;
        const row: CovariateImbalanceTableRow = {
          metricId,
          variation: variationIndex,
          isImbalanced: metricIsImbalanced,
          baselineSampleSize: baselineMetric.users,
          variationSampleSize: treatmentMetric.users,
          baselineMean: baselineMetric.cr,
          variationMean: treatmentMetric.cr,
          baselineStandardError,
          variationStandardError,
          pValue: pValueForTable,
          errorMessage: treatmentMetric.errorMessage,
        };
        covariateImbalanceTable.push(row);
        tabulatedMetricVariationByKey.set(metricVariationKey, row);
      }
    }
  }

  return {
    isImbalanced,
    pValueThreshold,
    numMetrics: processedMetrics,
    numMetricsImbalanced,
    metricVariationCovariateImbalanceResults: covariateImbalanceTable,
  };
}

export function tabulateCovariateImbalance(
  analysis: ExperimentSnapshotAnalysis,
  goalMetrics: string[],
  guardrailMetrics: string[],
  secondaryMetrics: string[],
  metricSettings: Pick<MetricForSnapshot, "id">[],
): CovariateImbalanceResult {
  const covariateImbalanceTable: CovariateImbalanceTableRow[] = [];
  const overallResult = analysis.results.find(
    (dimension: ExperimentReportResultDimension) => dimension.name === "",
  );

  if (!overallResult || overallResult.variations.length <= 1) {
    return {
      isImbalanced: false,
      pValueThreshold: DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE,
      numGoalMetrics: 0,
      numGoalMetricsImbalanced: 0,
      numGuardrailMetrics: 0,
      numGuardrailMetricsImbalanced: 0,
      numSecondaryMetrics: 0,
      numSecondaryMetricsImbalanced: 0,
      metricVariationCovariateImbalanceResults: covariateImbalanceTable,
    };
  }

  const allExperimentMetricIds = metricSettings.map((m) => m.id);
  const goalMetricsForTable = getIntersectionBaseMetricIds(
    goalMetrics,
    allExperimentMetricIds,
  );
  const guardrailMetricsForTable = getIntersectionBaseMetricIds(
    guardrailMetrics,
    allExperimentMetricIds,
  );
  const secondaryMetricsForTable = getIntersectionBaseMetricIds(
    secondaryMetrics,
    allExperimentMetricIds,
  );

  // Bonferroni: use threshold / nTests for significance (single p-value stored)
  const pValueThreshold = DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE;
  const numVariations = overallResult.variations.length;
  const nTests = Math.max(
    1,
    (numVariations - 1) *
      (goalMetricsForTable.length + guardrailMetricsForTable.length),
  );
  const adjustedThreshold = pValueThreshold / nTests;

  const tabulatedMetricVariationByKey = new Map<
    string,
    CovariateImbalanceTableRow
  >();

  const goalMetricsResult = tabulateCovariateImbalanceByGroup(
    overallResult,
    goalMetricsForTable,
    covariateImbalanceTable,
    adjustedThreshold,
    tabulatedMetricVariationByKey,
  );
  const guardrailMetricsResult = tabulateCovariateImbalanceByGroup(
    overallResult,
    guardrailMetricsForTable,
    covariateImbalanceTable,
    adjustedThreshold,
    tabulatedMetricVariationByKey,
  );
  const secondaryMetricsResult = tabulateCovariateImbalanceByGroup(
    overallResult,
    secondaryMetricsForTable,
    covariateImbalanceTable,
    adjustedThreshold,
    tabulatedMetricVariationByKey,
  );

  const isImbalanced =
    goalMetricsResult.isImbalanced || guardrailMetricsResult.isImbalanced;

  return {
    isImbalanced,
    pValueThreshold,
    numGoalMetrics: goalMetricsResult.numMetrics,
    numGoalMetricsImbalanced: goalMetricsResult.numMetricsImbalanced,
    numGuardrailMetrics: guardrailMetricsResult.numMetrics,
    numGuardrailMetricsImbalanced: guardrailMetricsResult.numMetricsImbalanced,
    numSecondaryMetrics: secondaryMetricsResult.numMetrics,
    numSecondaryMetricsImbalanced: secondaryMetricsResult.numMetricsImbalanced,
    metricVariationCovariateImbalanceResults: covariateImbalanceTable,
  };
}
