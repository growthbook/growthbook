import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { useState } from "react";
import {
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import {
  MetricDefaults,
  OrganizationSettings,
} from "back-end/types/organization";
import { MetricOverride } from "back-end/types/experiment";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "@/constants/stats";
import { useOrganizationMetricDefaults } from "../hooks/useOrganizationMetricDefaults";

export type ExperimentTableRow = {
  label: string;
  metric: MetricInterface;
  variations: SnapshotMetric[];
  rowClass?: string;
  regressionAdjustmentStatus?: MetricRegressionAdjustmentStatus;
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

export function shouldHighlight({
  metric,
  baseline,
  stats,
  hasEnoughData,
  suspiciousChange,
  belowMinChange,
}: {
  metric: MetricInterface;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  hasEnoughData: boolean;
  suspiciousChange: boolean;
  belowMinChange: boolean;
}): boolean {
  return (
    metric &&
    baseline?.value &&
    stats?.value &&
    hasEnoughData &&
    !suspiciousChange &&
    !belowMinChange
  );
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
  metricOverrides?: MetricOverride[]
): {
  newMetric: MetricInterface;
  overrideFields: string[];
} {
  if (!metric || !metricOverrides) {
    return {
      newMetric: metric,
      overrideFields: [],
    };
  }
  const newMetric = cloneDeep<MetricInterface>(metric);
  const overrideFields: string[] = [];
  const metricOverride = metricOverrides.find((mo) => mo.id === newMetric.id);
  if (metricOverride) {
    if ("conversionWindowHours" in metricOverride) {
      newMetric.conversionWindowHours = metricOverride.conversionWindowHours;
      overrideFields.push("conversionWindowHours");
    }
    if ("conversionDelayHours" in metricOverride) {
      newMetric.conversionDelayHours = metricOverride.conversionDelayHours;
      overrideFields.push("conversionDelayHours");
    }
    if ("winRisk" in metricOverride) {
      newMetric.winRisk = metricOverride.winRisk;
      overrideFields.push("winRisk");
    }
    if ("loseRisk" in metricOverride) {
      newMetric.loseRisk = metricOverride.loseRisk;
      overrideFields.push("loseRisk");
    }
    if ("regressionAdjustmentOverride" in metricOverride) {
      // only apply RA fields if doing an override
      newMetric.regressionAdjustmentOverride =
        metricOverride.regressionAdjustmentOverride;
      newMetric.regressionAdjustmentEnabled = !!metricOverride.regressionAdjustmentEnabled;
      newMetric.regressionAdjustmentDays =
        metricOverride.regressionAdjustmentDays ??
        newMetric.regressionAdjustmentDays;
      overrideFields.push(
        "regressionAdjustmentOverride",
        "regressionAdjustmentEnabled",
        "regressionAdjustmentDays"
      );
    }
  }
  return { newMetric, overrideFields };
}

export function getRegressionAdjustmentsForMetric({
  metric,
  denominatorMetrics,
  experimentRegressionAdjustmentEnabled,
  organizationSettings,
  metricOverrides,
}: {
  metric: MetricInterface;
  denominatorMetrics: MetricInterface[];
  experimentRegressionAdjustmentEnabled: boolean;
  organizationSettings?: Partial<OrganizationSettings>; // can be RA fields from a snapshot of org settings
  metricOverrides?: MetricOverride[];
}): {
  newMetric: MetricInterface;
  metricRegressionAdjustmentStatus: MetricRegressionAdjustmentStatus;
} {
  const newMetric = cloneDeep<MetricInterface>(metric);

  // start with default RA settings
  let regressionAdjustmentEnabled = false;
  let regressionAdjustmentDays = DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
  let reason = "";

  // get RA settings from organization
  if (organizationSettings?.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
    regressionAdjustmentDays =
      organizationSettings?.regressionAdjustmentDays ??
      regressionAdjustmentDays;
  }
  if (experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
  }

  // get RA settings from metric
  if (metric?.regressionAdjustmentOverride) {
    regressionAdjustmentEnabled = !!metric?.regressionAdjustmentEnabled;
    regressionAdjustmentDays =
      metric?.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
    if (!regressionAdjustmentEnabled) {
      reason = "disabled in metric settings";
    }
  }

  // get RA settings from metric override
  if (metricOverrides) {
    const metricOverride = metricOverrides.find((mo) => mo.id === metric.id);
    if (metricOverride?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled = !!metricOverride?.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        metricOverride?.regressionAdjustmentDays ?? regressionAdjustmentDays;
      if (!regressionAdjustmentEnabled) {
        reason = "disabled by metric override";
      } else {
        reason = "";
      }
    }
  }

  // final gatekeeping
  if (regressionAdjustmentEnabled) {
    if (metric?.denominator) {
      const denominator = denominatorMetrics.find(
        (m) => m.id === metric?.denominator
      );
      if (denominator?.type === "count") {
        regressionAdjustmentEnabled = false;
        reason = "denominator is count";
      }
    }
  }
  if (metric?.aggregation) {
    regressionAdjustmentEnabled = false;
    reason = "custom aggregation";
  }

  if (!regressionAdjustmentEnabled) {
    regressionAdjustmentDays = 0;
  }

  newMetric.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  newMetric.regressionAdjustmentDays = regressionAdjustmentDays;

  return {
    newMetric,
    metricRegressionAdjustmentStatus: {
      metric: newMetric.id,
      regressionAdjustmentEnabled,
      regressionAdjustmentDays,
      reason,
    },
  };
}

export function isExpectedDirection(
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  const expected: number = stats?.expected ?? 0;
  if (metric.inverse) {
    return expected < 0;
  }
  return expected > 0;
}

export function isStatSig(
  stats: SnapshotMetric,
  pValueThreshold: number
): boolean {
  const pValue: number = stats?.pValue ?? 1;
  return pValue < pValueThreshold;
}

export function pValueFormatter(pValue: number): string {
  if (typeof pValue !== "number") {
    return "";
  }
  return pValue < 0.001 ? "<0.001" : pValue.toFixed(3);
}
