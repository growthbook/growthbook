import {
  SnapshotMetric,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "./DefinitionsContext";
import {
  defaultMaxPercentChange,
  defaultMinPercentChange,
  defaultMinSampleSize,
} from "./metrics";

export function hasEnoughData(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  if (!baseline?.value || !stats?.value) return false;

  const minSampleSize = metric.minSampleSize || defaultMinSampleSize;

  return Math.max(baseline.value, stats.value) >= minSampleSize;
}

export function isSuspiciousUplift(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const maxPercentChange = metric.maxPercentChange || defaultMaxPercentChange;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr >= maxPercentChange;
}

export function isBelowMinChange(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const minPercentChange = metric.minPercentChange || defaultMinPercentChange;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr < minPercentChange;
}

export function getRisk(
  riskVariation: number,
  metric: MetricInterface,
  variations: SnapshotVariation[]
) {
  const m = metric?.id;
  let risk: number;
  let riskCR: number;
  let relativeRisk: number;
  let showRisk = false;
  const baseline = variations[0]?.metrics?.[m];

  if (riskVariation > 0) {
    const stats = variations[riskVariation]?.metrics?.[m];
    risk = stats?.risk?.[metric?.inverse ? 0 : 1];
    riskCR = stats?.cr;
    showRisk =
      risk !== null &&
      riskCR > 0 &&
      hasEnoughData(baseline, stats, metric) &&
      !isSuspiciousUplift(baseline, stats, metric);
  } else {
    risk = -1;
    variations.forEach((v, i) => {
      if (!i) return;
      const stats = v.metrics[m];
      if (!hasEnoughData(baseline, stats, metric)) {
        return;
      }
      if (isSuspiciousUplift(baseline, stats, metric)) {
        return;
      }

      const vRisk = stats?.risk?.[metric?.inverse ? 1 : 0];
      if (vRisk > risk) {
        risk = vRisk;
        riskCR = stats?.cr;
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
  experiment: ExperimentInterfaceStringDates,
  variations: SnapshotVariation[]
) {
  const { getMetricById } = useDefinitions();
  const [riskVariation, setRiskVariation] = useState(() => {
    // Calculate the total risk for each variation across all metrics
    const sums: number[] = Array(variations.length).fill(0);
    experiment.metrics.forEach((m) => {
      const metric = getMetricById(m);
      if (!metric) return;

      const baseline = variations[0].metrics[m];
      if (!baseline || !baseline.cr) return;

      let controlMax = 0;
      variations.forEach((v, i) => {
        if (!i) return;
        const stats = variations[i].metrics[m];

        if (!stats || !stats.risk || !stats.cr) {
          return;
        }
        if (!hasEnoughData(baseline, stats, metric)) {
          return;
        }
        if (isSuspiciousUplift(baseline, stats, metric)) {
          return;
        }

        const controlRisk =
          (metric?.inverse ? stats.risk[1] : stats.risk[0]) / baseline.cr;

        controlMax = Math.max(controlMax, controlRisk);
        sums[i] += (metric?.inverse ? stats.risk[0] : stats.risk[1]) / stats.cr;
      });
      sums[0] += controlMax;
    });

    // Default to the variation with the lowest total risk
    return sums.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[0][1];
  });

  const hasRisk =
    Object.values(variations[1]?.metrics || {}).filter(
      (x) => x.risk?.length > 0
    ).length > 0;

  return [hasRisk, riskVariation, setRiskVariation] as const;
}

export function useDomain(
  experiment: ExperimentInterfaceStringDates,
  variations: SnapshotVariation[]
): [number, number] {
  const { getMetricById } = useDefinitions();

  let lowerBound: number, upperBound: number;
  experiment.metrics?.forEach((m) => {
    const metric = getMetricById(m);
    if (!metric) return;

    const baseline = variations[0].metrics[m];

    experiment.variations?.forEach((v, i) => {
      if (!variations[i]?.metrics?.[m]) return;
      const stats = { ...variations[i].metrics[m] };

      // Skip baseline
      if (!i) return;
      if (!hasEnoughData(baseline, stats, metric)) return;
      if (isSuspiciousUplift(baseline, stats, metric)) return;

      const ci = stats.ci || [];
      if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
      if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
    });
  });
  return [lowerBound, upperBound];
}
