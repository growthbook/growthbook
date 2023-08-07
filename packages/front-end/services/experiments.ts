import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import {
  MetricDefaults,
  OrganizationSettings,
} from "back-end/types/organization";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "shared/constants";
import { getValidDate } from "shared/dates";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatConversionRate,
} from "@/services/metrics";

export type ExperimentTableRow = {
  label: string;
  metric: MetricInterface;
  variations: SnapshotMetric[];
  rowClass?: string;
  regressionAdjustmentStatus?: MetricRegressionAdjustmentStatus;
  isGuardrail?: boolean;
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

  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
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
    metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0;

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

  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
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
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'number | boolean' is not assignable to type ... Remove this comment to see the full error message
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
  stats: SnapshotMetric,
  baseline: SnapshotMetric,
  metric: MetricInterface,
  metricDefaults: MetricDefaults
): { risk: number; relativeRisk: number; showRisk: boolean } {
  const risk = stats.risk?.[metric.inverse ? 0 : 1] ?? 0;
  const relativeRisk = stats.cr ? risk / stats.cr : 0;
  const showRisk =
    stats.cr > 0 &&
    hasEnoughData(baseline, stats, metric, metricDefaults) &&
    !isSuspiciousUplift(baseline, stats, metric, metricDefaults);
  return { risk, relativeRisk, showRisk };
}

export function getRiskByVariation(
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
    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message
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
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      if (vRisk > risk) {
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message
        risk = vRisk;
        riskCR = stats.cr;
      }
    });
    // @ts-expect-error TS(2454) If you come across this, please fix it!: Variable 'riskCR' is used before being assigned.
    showRisk = risk >= 0 && riskCR > 0;
  }
  if (showRisk) {
    // @ts-expect-error TS(2454) If you come across this, please fix it!: Variable 'riskCR' is used before being assigned.
    relativeRisk = risk / riskCR;
  }

  return {
    risk,
    // @ts-expect-error TS(2454) If you come across this, please fix it!: Variable 'relativeRisk' is used before being assig... Remove this comment to see the full error message
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
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
    });
  });
  // @ts-expect-error TS(2454) If you come across this, please fix it!: Variable 'lowerBound' is used before being assigne... Remove this comment to see the full error message
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

export function isStatSig(pValue: number, pValueThreshold: number): boolean {
  return pValue < pValueThreshold;
}

export function pValueFormatter(pValue: number): string {
  if (typeof pValue !== "number") {
    return "";
  }
  return pValue < 0.001 ? "<0.001" : pValue.toFixed(3);
}

export type IndexedPValue = {
  pValue: number;
  index: (number | string)[];
};

export function adjustPValuesBenjaminiHochberg(
  indexedPValues: IndexedPValue[]
): IndexedPValue[] {
  const newIndexedPValues = cloneDeep<IndexedPValue[]>(indexedPValues);
  const m = newIndexedPValues.length;

  newIndexedPValues.sort((a, b) => {
    return b.pValue - a.pValue;
  });
  newIndexedPValues.forEach((p, i) => {
    newIndexedPValues[i].pValue = Math.min((p.pValue * m) / (m - i), 1);
  });

  let tempval = newIndexedPValues[0].pValue;
  for (let i = 1; i < m; i++) {
    if (newIndexedPValues[i].pValue < tempval) {
      tempval = newIndexedPValues[i].pValue;
    } else {
      newIndexedPValues[i].pValue = tempval;
    }
  }
  return newIndexedPValues;
}

export function adjustPValuesHolmBonferroni(
  indexedPValues: IndexedPValue[]
): IndexedPValue[] {
  const newIndexedPValues = cloneDeep<IndexedPValue[]>(indexedPValues);
  const m = newIndexedPValues.length;
  newIndexedPValues.sort((a, b) => {
    return a.pValue - b.pValue;
  });
  newIndexedPValues.forEach((p, i) => {
    newIndexedPValues[i].pValue = Math.min(p.pValue * (m - i), 1);
  });

  let tempval = newIndexedPValues[0].pValue;
  for (let i = 1; i < m; i++) {
    if (newIndexedPValues[i].pValue > tempval) {
      tempval = newIndexedPValues[i].pValue;
    } else {
      newIndexedPValues[i].pValue = tempval;
    }
  }
  return newIndexedPValues;
}

export function setAdjustedPValuesOnResults(
  results: ExperimentReportResultDimension[],
  nonGuardrailMetrics: string[],
  adjustment: PValueCorrection
): void {
  if (!adjustment) {
    return;
  }

  let indexedPValues: IndexedPValue[] = [];
  results.forEach((r, i) => {
    r.variations.forEach((v, j) => {
      nonGuardrailMetrics.forEach((m) => {
        if (v.metrics[m]?.pValue !== undefined) {
          indexedPValues.push({
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message
            pValue: v.metrics[m].pValue,
            index: [i, j, m],
          });
        }
      });
    });
  });

  if (indexedPValues.length === 0) {
    return;
  }

  if (adjustment === "benjamini-hochberg") {
    indexedPValues = adjustPValuesBenjaminiHochberg(indexedPValues);
  } else if (adjustment === "holm-bonferroni") {
    indexedPValues = adjustPValuesHolmBonferroni(indexedPValues);
  }

  // modify results in place
  indexedPValues.forEach((ip) => {
    const ijk = ip.index;
    results[ijk[0]].variations[ijk[1]].metrics[ijk[2]].pValueAdjusted =
      ip.pValue;
  });
  return;
}

export type RowResults = {
  directionalStatus: "winning" | "losing";
  resultsStatus: "won" | "lost" | "draw" | "";
  resultsReason: string;
  enoughData: boolean;
  enoughDataMeta: EnoughDataMeta;
  significant: boolean;
  significantUnadjusted: boolean;
  significantReason: string;
  suspiciousChange: boolean;
  suspiciousChangeReason: string;
  belowMinChange: boolean;
  risk: number;
  relativeRisk: number;
  riskMeta: RiskMeta;
};
export type RiskMeta = {
  riskStatus: "ok" | "warning" | "danger";
  showRisk: boolean;
  riskFormatted: string;
  relativeRiskFormatted: string;
  riskReason: string;
};
export type EnoughDataMeta = {
  percentComplete: number;
  percentCompleteNumerator: number;
  percentCompleteDenominator: number;
  timeRemainingMs: number | null;
  showTimeRemaining: boolean;
  reason: string;
};
export function getRowResults({
  stats,
  baseline,
  metric,
  metricDefaults,
  minSampleSize,
  statsEngine,
  ciUpper,
  ciLower,
  pValueThreshold,
  snapshotDate,
  phaseStartDate,
  isLatestPhase,
  experimentStatus,
  displayCurrency,
}: {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  statsEngine: StatsEngine;
  metric: MetricInterface;
  metricDefaults: MetricDefaults;
  minSampleSize: number;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
  snapshotDate: Date;
  phaseStartDate: Date;
  isLatestPhase: boolean;
  experimentStatus: ExperimentStatus;
  displayCurrency: string;
}): RowResults {
  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const inverse = metric?.inverse;
  const directionalStatus: "winning" | "losing" =
    (stats.expected ?? 0) * (inverse ? -1 : 1) > 0 ? "winning" : "losing";

  let significant: boolean;
  let significantUnadjusted: boolean;
  let significantReason = "";
  if (statsEngine === "bayesian") {
    if (
      (stats.chanceToWin ?? 0) > ciUpper ||
      (stats.chanceToWin ?? 0) < ciLower
    ) {
      significant = true;
      significantUnadjusted = true;
    } else {
      significant = false;
      significantUnadjusted = false;
      significantReason = `This metric is not statistically significant. The chance to win it outside the CI interval [${percentFormatter.format(
        ciLower
      )}, ${percentFormatter.format(ciUpper)}].`;
    }
  } else {
    significant = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      pValueThreshold
    );
    significantUnadjusted = isStatSig(stats.pValue ?? 1, pValueThreshold);
    if (!significant) {
      significantReason = `This metric is not statistically significant. The p-value (${pValueFormatter(
        stats.pValueAdjusted ?? stats.pValue ?? 1
      )}) is greater than the threshold (${pValueFormatter(pValueThreshold)}).`;
    }
  }

  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const enoughDataReason = `This metric has a minimum sample size of ${minSampleSize}. There are only ${stats.value} samples in this variation and ${baseline.value} samples in the baseline.`;
  const percentComplete =
    minSampleSize > 0
      ? Math.max(stats.value, baseline.value) / minSampleSize
      : 1;
  const timeRemainingMs =
    percentComplete > 0.1
      ? ((snapshotDate.getTime() - getValidDate(phaseStartDate).getTime()) *
          (1 - percentComplete)) /
          percentComplete -
        (Date.now() - snapshotDate.getTime())
      : null;
  const showTimeRemaining =
    timeRemainingMs !== null && isLatestPhase && experimentStatus === "running";
  const enoughDataMeta: EnoughDataMeta = {
    percentComplete,
    percentCompleteNumerator: Math.max(stats.value, baseline.value),
    percentCompleteDenominator: minSampleSize,
    timeRemainingMs,
    showTimeRemaining,
    reason: enoughDataReason,
  };

  const suspiciousChange = isSuspiciousUplift(
    baseline,
    stats,
    metric,
    metricDefaults
  );
  const suspiciousChangeReason = suspiciousChange
    ? `A suspicious result occurs when the percent change exceeds your maximum percent change (${percentFormatter.format(
        (metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0) *
          100
      )}).`
    : "";

  const belowMinChange = isBelowMinChange(
    baseline,
    stats,
    metric,
    metricDefaults
  );

  const { risk, relativeRisk, showRisk } = getRisk(
    stats,
    baseline,
    metric,
    metricDefaults
  );
  const winRiskThreshold = metric.winRisk ?? defaultWinRiskThreshold;
  const loseRiskThreshold = metric.loseRisk ?? defaultLoseRiskThreshold;
  let riskStatus: "ok" | "warning" | "danger" = "ok";
  let riskReason = "";
  if (relativeRisk > winRiskThreshold && relativeRisk < loseRiskThreshold) {
    riskStatus = "warning";
    riskReason = `The relative risk (${percentFormatter.format(
      relativeRisk
    )}) exceeds the warning threshold (${percentFormatter.format(
      winRiskThreshold
    )}) for this metric.`;
  } else if (relativeRisk >= loseRiskThreshold) {
    riskStatus = "danger";
    riskReason = `The relative risk (${percentFormatter.format(
      relativeRisk
    )}) exceeds the danger threshold (${percentFormatter.format(
      loseRiskThreshold
    )}) for this metric.`;
  }
  let riskFormatted = "";
  if (metric.type !== "binomial") {
    riskFormatted = `${formatConversionRate(
      metric.type,
      risk,
      displayCurrency
    )} / user`;
  }
  const riskMeta: RiskMeta = {
    riskStatus,
    showRisk,
    riskFormatted: riskFormatted,
    relativeRiskFormatted: percentFormatter.format(relativeRisk),
    riskReason,
  };

  const _shouldHighlight = shouldHighlight({
    metric,
    baseline,
    stats,
    hasEnoughData: enoughData,
    suspiciousChange,
    belowMinChange,
  });

  let resultsStatus: "won" | "lost" | "draw" | "" = "";
  let resultsReason = "";
  if (statsEngine === "bayesian") {
    if (_shouldHighlight && (stats.chanceToWin ?? 0) > ciUpper) {
      resultsReason = `Significant win as the chance to win is above the ${percentFormatter.format(
        ciUpper
      )} threshold`;
      resultsStatus = "won";
    } else if (_shouldHighlight && (stats.chanceToWin ?? 0) < ciLower) {
      resultsReason = `Significant loss as the chance to win is below the ${percentFormatter.format(
        ciLower
      )} threshold`;
      resultsStatus = "lost";
    }
    if (
      enoughData &&
      belowMinChange &&
      ((stats.chanceToWin ?? 0) > ciUpper || (stats.chanceToWin ?? 0) < ciLower)
    ) {
      resultsReason =
        "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
      resultsStatus = "draw";
    }
  } else {
    if (_shouldHighlight && significant && directionalStatus === "winning") {
      resultsReason = `Significant win as the p-value is below the ${percentFormatter.format(
        pValueThreshold
      )} threshold`;
      resultsStatus = "won";
    } else if (
      _shouldHighlight &&
      significant &&
      directionalStatus === "losing"
    ) {
      resultsReason = `Significant loss as the p-value is above the ${percentFormatter.format(
        1 - pValueThreshold
      )} threshold`;
      resultsStatus = "lost";
    } else if (enoughData && significant && belowMinChange) {
      resultsReason =
        "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
      resultsStatus = "draw";
    }
  }

  return {
    directionalStatus,
    resultsStatus,
    resultsReason,
    enoughData,
    enoughDataMeta,
    significant,
    significantUnadjusted,
    significantReason,
    suspiciousChange,
    suspiciousChangeReason,
    belowMinChange,
    risk,
    relativeRisk,
    riskMeta,
  };
}
