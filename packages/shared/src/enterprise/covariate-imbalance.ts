import { z } from "zod";
import {
  ExperimentSnapshotAnalysis,
  SnapshotMetric,
} from "back-end/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "back-end/types/report";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";

export const MetricVariationCovariateImbalanceResultValidator = z.object({
  metricId: z.string(),
  variation: z.number(),
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

function statSigBayesian(chanceToWin: number, threshold: number): boolean {
  return chanceToWin < threshold || chanceToWin > 1 - threshold;
}

function pValueFromChanceToWin(chanceToWin: number): number {
  return Math.min(0.5 * (1 - chanceToWin), 0.5 * chanceToWin);
}

export interface CovariateImbalanceTableRow {
  metricId: string;
  variation: number;
  baselineSampleSize: number;
  variationSampleSize: number;
  baselineMean: number;
  variationMean: number;
  baselineStandardError?: number;
  variationStandardError?: number;
  pValue: number;
  errorMessage?: string;
}

function getMetric(
  metrics: Record<string, SnapshotMetric>,
  metricId: string,
): SnapshotMetric | undefined {
  return metrics[metricId];
}

function tabulateCovariateImbalanceByGroup(
  overallResult: ExperimentReportResultDimension,
  metrics: string[],
  covariateImbalanceTable: CovariateImbalanceTableRow[],
): SingleGroupCovariateImbalanceResult {
  const pValueThreshold = DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE;
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
        const baselineMetric = getMetric(baselineMetrics, metricId);
        const treatmentMetric = getMetric(treatmentMetrics, metricId);

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
          if (statSigFrequentist(treatmentMetric.pValue, pValueThreshold)) {
            metricIsImbalanced = true;
            pValueForTable = treatmentMetric.pValue;
          }
        } else if (typeof treatmentMetric.chanceToWin === "number") {
          const chanceThreshold = 0.5 * pValueThreshold;
          if (statSigBayesian(treatmentMetric.chanceToWin, chanceThreshold)) {
            metricIsImbalanced = true;
            pValueForTable = pValueFromChanceToWin(treatmentMetric.chanceToWin);
          }
        }

        if (!metricIsImbalanced || pValueForTable === undefined) {
          continue;
        }

        isImbalanced = true;
        numMetricsImbalanced += 1;
        const baselineStandardError =
          baselineMetric.users > 0 && baselineMetric.stats?.stddev
            ? baselineMetric.stats.stddev / Math.sqrt(baselineMetric.users)
            : 0;
        const variationStandardError =
          treatmentMetric.users > 0 && treatmentMetric.stats?.stddev
            ? treatmentMetric.stats.stddev / Math.sqrt(treatmentMetric.users)
            : 0;
        covariateImbalanceTable.push({
          metricId,
          variation: variationIndex,
          baselineSampleSize: baselineMetric.users,
          variationSampleSize: treatmentMetric.users,
          baselineMean: baselineMetric.cr,
          variationMean: treatmentMetric.cr,
          baselineStandardError,
          variationStandardError,
          pValue: pValueForTable,
          errorMessage: treatmentMetric.errorMessage,
        });
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
): CovariateImbalanceResult {
  const covariateImbalanceTable: CovariateImbalanceTableRow[] = [];
  const overallResult = analysis.results.find(
    (dimension) => dimension.name === "",
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

  const goalMetricsResult = tabulateCovariateImbalanceByGroup(
    overallResult,
    goalMetrics,
    covariateImbalanceTable,
  );
  const guardrailMetricsResult = tabulateCovariateImbalanceByGroup(
    overallResult,
    guardrailMetrics,
    covariateImbalanceTable,
  );
  const secondaryMetricsResult = tabulateCovariateImbalanceByGroup(
    overallResult,
    secondaryMetrics,
    covariateImbalanceTable,
  );

  const isImbalanced =
    goalMetricsResult.isImbalanced ||
    guardrailMetricsResult.isImbalanced ||
    secondaryMetricsResult.isImbalanced;

  return {
    isImbalanced,
    pValueThreshold: DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE,
    numGoalMetrics: goalMetricsResult.numMetrics,
    numGoalMetricsImbalanced: goalMetricsResult.numMetricsImbalanced,
    numGuardrailMetrics: guardrailMetricsResult.numMetrics,
    numGuardrailMetricsImbalanced: guardrailMetricsResult.numMetricsImbalanced,
    numSecondaryMetrics: secondaryMetricsResult.numMetrics,
    numSecondaryMetricsImbalanced: secondaryMetricsResult.numMetricsImbalanced,
    metricVariationCovariateImbalanceResults: covariateImbalanceTable,
  };
}
