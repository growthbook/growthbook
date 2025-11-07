import { z } from "zod";
import { ExperimentSnapshotAnalysis } from "back-end/types/experiment-snapshot";

export const MetricVariationCovariateImbalanceResultValidator = z.object({
  metricId: z.string(),
  variation: z.number(),
  errorMessage: z.string().optional(),
  baselineSampleSize: z.number().optional(),
  variationSampleSize: z.number().optional(),
  baselineMean: z.number().optional(),
  variationMean: z.number().optional(),
});

export type MetricVariationCovariateImbalanceResult = z.infer<
  typeof MetricVariationCovariateImbalanceResultValidator
>;

export const CovariateImbalanceResultValidator = z.object({
  isImbalanced: z.boolean(),
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

export function tabulateCovariateImbalance(
  analysis: ExperimentSnapshotAnalysis,
  goalMetrics: string[],
  secondaryMetrics: string[],
  guardrailMetrics: string[],
): CovariateImbalanceResult {
  return {
    isImbalanced: analysis.status === "success",
    numGoalMetrics: goalMetrics.length,
    numGoalMetricsImbalanced: goalMetrics.length,
    numGuardrailMetrics: guardrailMetrics.length,
    numGuardrailMetricsImbalanced: guardrailMetrics.length,
    numSecondaryMetrics: secondaryMetrics.length,
    numSecondaryMetricsImbalanced: secondaryMetrics.length,
    metricVariationCovariateImbalanceResults: [],
  };
}
