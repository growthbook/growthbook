import {
  computeRiskValues,
  ExperimentMetricInterface,
} from "shared/experiments";
import { getSRMValue } from "shared/health";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentInterface } from "back-end/types/experiment";
import { DifferenceType } from "back-end/types/stats";
import { findDimensionById } from "back-end/src/models/DimensionModel";

export type ExperimentResultRow = {
  experimentName: string;
  experimentId: string;
  snapshotId: string;
  snapshotDate: string | null;
  dimensionId: string | null;
  dimensionName: string | null;
  dimensionValue: string | null;
  metricName: string | null;
  metricId: string;
  baselineVariationName: string | null;
  baselineVariationId: string | null;
  baselineVariationUnits: number | null;
  baselineVariationNumerator: number | null;
  baselineVariationDenominator: number | null;
  baselineVariationMean: number | null;
  baselineVariationStdDev: number | null;
  variationName: string | null;
  variationId: string | null;
  variationUnits: number;
  variationNumerator: number;
  variationDenominator: number | null;
  variationMean: number;
  variationStdDev: number | null;
  differenceType: DifferenceType;
  effect: number | null;
  chanceToWin: number | null;
  relativeRisk: number | null;
  pValue: number | null;
  pValueCorrected: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  ciLowerCorrected: number | null;
  ciUpperCorrected: number | null;
  srmPValue: number | null;
  totalMultipleExposureUnits: number | null;
  totalUnits: number | null;
};

export async function getExperimentResultRows({
  experiment,
  snapshot,
  metricMap,
  dimension,
}: {
  experiment: Pick<
    ExperimentInterface,
    "id" | "name" | "variations" | "organization" | "type"
  >;
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

  const srm = getSRMValue(experiment.type ?? "standard", snapshot);
  const multipleExposures = snapshot.multipleExposures;
  const totalUnits = snapshot.health?.traffic.overall.variationUnits.reduce(
    (a, b) => a + b,
    0
  );

  snapshot.analyses.forEach((analysis) => {
    // Only keep default 3 analyses of 3 difference types
    if (analysis.settings.baselineVariationIndex !== 0) {
      return;
    }
    analysis.results.forEach((result) => {
      result.variations.forEach((variation, i) => {
        // skip if the variation is the control
        if (i === 0) {
          return;
        }
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
              baselineVariationName: experiment.variations[0]?.name ?? null,
              baselineVariationUnits: baselineMetric?.users ?? null,
              baselineVariationNumerator: baselineMetric?.value ?? null,
              baselineVariationDenominator: baselineMetric?.denominator ?? null,
              baselineVariationMean: baselineMetric?.cr ?? null,
              baselineVariationStdDev: baselineMetric?.stats?.stddev ?? null,
              variationName: experiment.variations[i]?.name ?? null,
              variationId: experiment.variations[i]?.id ?? `${i}`,
              variationUnits: metricResult.users,
              variationNumerator: metricResult.value,
              variationDenominator: metricResult.denominator ?? null,
              variationMean: metricResult.cr,
              variationStdDev: metricResult.stats?.stddev ?? null,
              differenceType: analysis.settings.differenceType,
              effect: metricResult.expected ?? null,
              chanceToWin: metricResult.chanceToWin ?? null,
              relativeRisk: relativeRisk ?? null,
              pValue: metricResult.pValue ?? null,
              pValueCorrected: metricResult.pValueAdjusted ?? null,
              ciLower: metricResult.ci?.[0] ?? null,
              ciUpper: metricResult.ci?.[1] ?? null,
              ciLowerCorrected: metricResult.ciAdjusted?.[0] ?? null,
              ciUpperCorrected: metricResult.ciAdjusted?.[1] ?? null,
              srmPValue: srm ?? null,
              totalMultipleExposureUnits: multipleExposures ?? null,
              totalUnits: totalUnits ?? null,
            };
            rows.push(row);
          }
        );
      });
    });
  });
  return rows;
}
