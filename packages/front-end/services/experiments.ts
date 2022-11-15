import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { MetricDefaults } from "back-end/types/organization";
import { useOrganizationMetricDefaults } from "../hooks/useOrganizationMetricDefaults";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

export type ExperimentTableRow = {
  label: string;
  metric: MetricInterface;
  variations: SnapshotMetric[];
  rowClass?: string;
};

export function hasEnoughData(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface,
  metricDefaults: MetricDefaults
): boolean {
  if (!baseline?.value || !stats?.value) return false;

  const minSampleSize =
    metric.minSampleSize || metricDefaults.minimumSampleSize;

  return Math.max(baseline.value, stats.value) >= minSampleSize;
}

export function isSuspiciousUplift(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface,
  metricDefaults: MetricDefaults
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const maxPercentChange =
    metric.maxPercentChange || metricDefaults?.maxPercentageChange;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr >= maxPercentChange;
}

export function isBelowMinChange(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface,
  metricDefaults: MetricDefaults
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const minPercentChange =
    metric.minPercentChange || metricDefaults.minPercentageChange;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr < minPercentChange;
}

export function getRisk(
  riskVariation: number,
  row: ExperimentTableRow,
  metricDefaults: MetricDefaults
) {
  let risk: number;
  let riskCR: number;
  let relativeRisk: number;
  let showRisk = false;
  const baseline = row.variations[0];

  if (riskVariation > 0) {
    const stats = row.variations[riskVariation];
    risk = stats?.risk?.[row.metric.inverse ? 0 : 1];
    riskCR = stats?.cr;
    showRisk =
      risk !== null &&
      riskCR > 0 &&
      hasEnoughData(baseline, stats, row.metric, metricDefaults) &&
      !isSuspiciousUplift(baseline, stats, row.metric, metricDefaults);
  } else {
    risk = -1;
    row.variations.forEach((stats, i) => {
      if (!i) return;
      if (!hasEnoughData(baseline, stats, row.metric, metricDefaults)) {
        return;
      }
      if (isSuspiciousUplift(baseline, stats, row.metric, metricDefaults)) {
        return;
      }

      const vRisk = stats.risk?.[row.metric.inverse ? 1 : 0];
      if (vRisk > risk) {
        risk = vRisk;
        riskCR = stats.cr;
      }
    });
    showRisk = risk >= 0 && riskCR > 0;
  }
  if (showRisk) {
    relativeRisk = risk / riskCR;
  }

  return {
    risk,
    relativeRisk,
    showRisk,
  };
}

export function useRiskVariation(
  numVariations: number,
  rows: ExperimentTableRow[]
) {
  const { metricDefaults } = useOrganizationMetricDefaults();

  const [riskVariation, setRiskVariation] = useState(() => {
    // Calculate the total risk for each variation across all metrics
    const sums: number[] = Array(numVariations).fill(0);
    rows.forEach((row) => {
      const baseline = row.variations[0];
      if (!baseline || !baseline.cr) return;

      let controlMax = 0;
      row.variations.forEach((stats, i) => {
        if (!i) return;
        if (!stats || !stats.risk || !stats.cr) {
          return;
        }
        if (!hasEnoughData(baseline, stats, row.metric, metricDefaults)) {
          return;
        }
        if (isSuspiciousUplift(baseline, stats, row.metric, metricDefaults)) {
          return;
        }

        const controlRisk =
          (row.metric.inverse ? stats.risk[1] : stats.risk[0]) / baseline.cr;

        controlMax = Math.max(controlMax, controlRisk);
        sums[i] +=
          (row.metric.inverse ? stats.risk[0] : stats.risk[1]) / stats.cr;
      });
      sums[0] += controlMax;
    });

    // Default to the variation with the lowest total risk
    return sums.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[0][1];
  });

  const hasRisk =
    rows.filter((row) => row.variations[1]?.risk?.length).length > 0;

  return { hasRisk, riskVariation, setRiskVariation };
}
export function useDomain(
  variations: ExperimentReportVariation[],
  rows: ExperimentTableRow[]
): [number, number] {
  const { metricDefaults } = useOrganizationMetricDefaults();

  let lowerBound: number, upperBound: number;
  rows.forEach((row) => {
    const baseline = row.variations[0];
    if (!baseline) return;
    variations?.forEach((v, i) => {
      // Skip for baseline
      if (!i) return;

      // Skip if missing or bad data
      const stats = row.variations[i];
      if (!stats) return;
      if (!hasEnoughData(baseline, stats, row.metric, metricDefaults)) {
        return;
      }
      if (isSuspiciousUplift(baseline, stats, row.metric, metricDefaults)) {
        return;
      }

      const ci = stats.ci || [];
      if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
      if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
    });
  });
  return [lowerBound || 0, upperBound || 0];
}

export function applyMetricOverrides(
  metric: MetricInterface,
  experiment: ExperimentInterfaceStringDates
): MetricInterface {
  const metricOverride = experiment?.metricOverrides?.find(
    (mo) => mo.id === metric.id
  );
  if (metricOverride) {
    return { ...metric, ...metricOverride };
  }
  return metric;
}
