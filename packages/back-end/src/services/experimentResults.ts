import {
  computeRiskValues,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentInterface } from "back-end/types/experiment";
import { DifferenceType } from "back-end/types/stats";
import { findDimensionById } from "back-end/src/models/DimensionModel";

type ExperimentResultRow = {
  experimentName: string;
  experimentId: string;
  snapshotDate: string | null;
  snapshotId: string;
  dimensionId: string | null;
  dimensionName: string | null;
  dimensionValue: string | null;
  metricName: string | null;
  metricId: string;
  baselineVariationId: string | null;
  variationName: string | null;
  variationId: string | null;
  variationUsers: number;
  variationNumerator: number;
  variationDenominator: number | null;
  variationMean: number;
  variationStdDev: number | null;
  differenceType: DifferenceType;
  effect: number | null;
  chanceToBeatControl: number | null;
  relativeRisk: number | null;
  pValue: number | null;
  pValueAdjusted: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  ciLowerAdjusted: number | null;
  ciUpperAdjusted: number | null;
};

export async function getExperimentResultRows({
  experiment,
  snapshot,
  metricMap,
  dimension,
}: {
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotInterface;
  metricMap: Map<string, ExperimentMetricInterface>;
  dimension?: string;
}): Promise<ExperimentResultRow[]> {
  const dimensionName = dimension
    ? (await findDimensionById(dimension, experiment.organization))?.name ||
      dimension?.split(":")?.[1] ||
      dimension
    : null;

  const rows: ExperimentResultRow[] = [];

  snapshot.analyses.forEach((analysis) => {
    analysis.results.forEach((result) => {
      result.variations.forEach((variation, i) => {
        Object.entries(variation.metrics).forEach(
          ([metricId, metricResult]) => {
            const metric = metricMap.get(metricId);
            const baselineMetric = result.variations?.[0]?.metrics?.[metricId];
            let relativeRisk: number | null = null;
            if (baselineMetric) {
              const riskValues = computeRiskValues(
                metricResult,
                baselineMetric.cr
              );
              relativeRisk = riskValues.relativeRisk;
            }
            const row: ExperimentResultRow = {
              experimentName: experiment.name,
              experimentId: experiment.id,
              snapshotId: snapshot.id,
              snapshotDate: snapshot.runStarted?.toISOString() ?? null,
              dimensionId: dimension ?? null,
              dimensionName: dimensionName,
              dimensionValue: dimension ? result.name : null,
              metricName: metric?.name ?? null,
              metricId: metricId,
              baselineVariationId: experiment.variations[0]?.id ?? "0",
              variationName: experiment.variations[i]?.name ?? null,
              variationId: experiment.variations[i]?.id ?? `${i}`,
              variationUsers: metricResult.users,
              variationNumerator: metricResult.value,
              variationDenominator: metricResult.denominator ?? null,
              variationMean: metricResult.cr,
              variationStdDev: metricResult.stats?.stddev ?? null,
              differenceType: analysis.settings.differenceType,
              effect: metricResult.expected ?? null,
              chanceToBeatControl: metricResult.chanceToWin ?? null,
              relativeRisk: relativeRisk ?? null,
              pValue: metricResult.pValue ?? null,
              pValueAdjusted: metricResult.pValueAdjusted ?? null,
              ciLower: metricResult.ci?.[0] ?? null,
              ciUpper: metricResult.ci?.[1] ?? null,
              ciLowerAdjusted: metricResult.ciAdjusted?.[0] ?? null,
              ciUpperAdjusted: metricResult.ciAdjusted?.[1] ?? null,
            };
            rows.push(row);
          }
        );
      });
    });
  });
  return rows;
}
