import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import normal from "@stdlib/stats/base/dists/normal";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { MetricDefaults } from "back-end/types/organization";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import cloneDeep from "lodash/cloneDeep";
import { getValidDate } from "shared/dates";
import { isNil } from "lodash";
import { FactTableInterface } from "back-end/types/fact-table";
import {
  ExperimentMetricInterface,
  getMetricResultStatus,
  getMetricSampleSize,
  hasEnoughData,
  isBinomialMetric,
  isSuspiciousUplift,
  quantileMetricType,
} from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { getExperimentMetricFormatter } from "@/services/metrics";

export type ExperimentTableRow = {
  label: string;
  metric: ExperimentMetricInterface;
  metricOverrideFields: string[];
  variations: SnapshotMetric[];
  rowClass?: string;
  metricSnapshotSettings?: MetricSnapshotSettings;
  isGuardrail?: boolean;
};

export function getRisk(
  stats: SnapshotMetric,
  baseline: SnapshotMetric,
  metric: ExperimentMetricInterface,
  metricDefaults: MetricDefaults,
  // separate CR because sometimes "baseline" above is the variation
  baselineCR: number
): { risk: number; relativeRisk: number; showRisk: boolean } {
  const statsRisk = stats.risk?.[1] ?? 0;
  let risk: number;
  let relativeRisk: number;
  if (stats.riskType === "relative") {
    risk = statsRisk * baselineCR;
    relativeRisk = statsRisk;
  } else {
    // otherwise it is absolute, including legacy snapshots
    // that were missing `riskType` field
    risk = statsRisk;
    relativeRisk = baselineCR ? statsRisk / baselineCR : 0;
  }
  const showRisk =
    baseline.cr > 0 &&
    hasEnoughData(baseline, stats, metric, metricDefaults) &&
    !isSuspiciousUplift(baseline, stats, metric, metricDefaults);
  return { risk, relativeRisk, showRisk };
}

export function getRiskByVariation(
  riskVariation: number,
  row: ExperimentTableRow,
  metricDefaults: MetricDefaults
) {
  const baseline = row.variations[0];

  if (riskVariation > 0) {
    const stats = row.variations[riskVariation];
    return getRisk(stats, baseline, row.metric, metricDefaults, baseline.cr);
  } else {
    let risk = -1;
    let relativeRisk = 0;
    let showRisk = false;
    // get largest risk for all variations as the control "risk"
    row.variations.forEach((stats, i) => {
      if (!i) return;

      // baseline and stats are inverted here, because we want to get the risk for the control
      // so we also use the `stats` cr for the relative risk, which in this case is actually
      // the baseline
      const {
        risk: vRisk,
        relativeRisk: vRelativeRisk,
        showRisk: vShowRisk,
      } = getRisk(baseline, stats, row.metric, metricDefaults, baseline.cr);
      if (vRisk > risk) {
        risk = vRisk;
        relativeRisk = vRelativeRisk;
        showRisk = vShowRisk;
      }
    });
    return {
      risk,
      relativeRisk,
      showRisk,
    };
  }
}

export function hasRisk(rows: ExperimentTableRow[]) {
  return rows.filter((row) => row.variations[1]?.risk?.length).length > 0;
}

export function useDomain(
  variations: ExperimentReportVariationWithIndex[], // must be ordered, baseline first
  rows: ExperimentTableRow[]
): [number, number] {
  const { metricDefaults } = useOrganizationMetricDefaults();

  let lowerBound = 0;
  let upperBound = 0;
  rows.forEach((row) => {
    const baseline = row.variations[variations[0].index];
    if (!baseline) return;
    variations?.forEach((v: ExperimentReportVariationWithIndex, i) => {
      // Skip for baseline
      if (!i) return;

      // Skip if missing or bad data
      const stats = row.variations[v.index];
      if (!stats) return;
      if (!hasEnoughData(baseline, stats, row.metric, metricDefaults)) {
        return;
      }
      if (isSuspiciousUplift(baseline, stats, row.metric, metricDefaults)) {
        return;
      }

      let ci = stats?.ciAdjusted ?? stats.ci ?? [0, 0];
      // If adjusted values are Inf, use unadjusted
      if (Math.abs(ci[0]) === Infinity || Math.abs(ci[1]) === Infinity) {
        ci = stats.ci ?? [0, 0];
      }
      if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
      if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
    });
  });
  lowerBound = lowerBound <= 0 ? lowerBound : 0;
  upperBound = upperBound >= 0 ? upperBound : 0;
  return [lowerBound, upperBound];
}

export function applyMetricOverrides<T extends ExperimentMetricInterface>(
  metric: T,
  metricOverrides?: MetricOverride[]
): {
  newMetric: T;
  overrideFields: string[];
} {
  if (!metric || !metricOverrides) {
    return {
      newMetric: metric,
      overrideFields: [],
    };
  }
  const newMetric = cloneDeep<T>(metric);
  const overrideFields: string[] = [];
  const metricOverride = metricOverrides.find((mo) => mo.id === newMetric.id);
  if (metricOverride) {
    if (!isNil(metricOverride?.windowType)) {
      newMetric.windowSettings.type = metricOverride.windowType;
      overrideFields.push("windowType");
    }
    if (!isNil(metricOverride?.windowHours)) {
      newMetric.windowSettings.windowUnit = "hours";
      newMetric.windowSettings.windowValue = metricOverride.windowHours;
      overrideFields.push("windowHours");
    }
    if (!isNil(metricOverride?.delayHours)) {
      newMetric.windowSettings.delayHours = metricOverride.delayHours;
      overrideFields.push("delayHours");
    }
    if (!isNil(metricOverride?.winRisk)) {
      newMetric.winRisk = metricOverride.winRisk;
      overrideFields.push("winRisk");
    }
    if (!isNil(metricOverride?.loseRisk)) {
      newMetric.loseRisk = metricOverride.loseRisk;
      overrideFields.push("loseRisk");
    }
    if (!isNil(metricOverride?.regressionAdjustmentOverride)) {
      // only apply RA fields if doing an override
      newMetric.regressionAdjustmentOverride =
        metricOverride.regressionAdjustmentOverride;
      newMetric.regressionAdjustmentEnabled = !!metricOverride.regressionAdjustmentEnabled;
      overrideFields.push(
        "regressionAdjustmentOverride",
        "regressionAdjustmentEnabled"
      );
      if (!isNil(metricOverride?.regressionAdjustmentDays)) {
        newMetric.regressionAdjustmentDays =
          metricOverride.regressionAdjustmentDays;
        overrideFields.push("regressionAdjustmentDays");
      }
    }

    if (metricOverride?.properPriorOverride) {
      newMetric.priorSettings.override = true;
      newMetric.priorSettings.proper =
        metricOverride.properPriorEnabled ?? newMetric.priorSettings.proper;
      newMetric.priorSettings.mean =
        metricOverride.properPriorMean ?? newMetric.priorSettings.mean;
      newMetric.priorSettings.stddev =
        metricOverride.properPriorStdDev ?? newMetric.priorSettings.stddev;
      overrideFields.push("prior");
    }
  }
  return { newMetric, overrideFields };
}

export function pValueFormatter(pValue: number, digits: number = 3): string {
  if (typeof pValue !== "number") {
    return "";
  }
  return pValue < Math.pow(10, -digits)
    ? `<0.${"0".repeat(digits - 1)}1`
    : pValue.toFixed(digits);
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
        const pValue = v.metrics[m]?.pValue;
        if (pValue !== undefined) {
          indexedPValues.push({
            pValue: pValue,
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

export function adjustedCI(
  adjustedPValue: number,
  uplift: { dist: string; mean?: number; stddev?: number },
  zScore: number
): [number, number] {
  if (!uplift.mean) return [uplift.mean ?? 0, uplift.mean ?? 0];
  const adjStdDev = Math.abs(
    uplift.mean / normal.quantile(1 - adjustedPValue / 2, 0, 1)
  );
  const width = zScore * adjStdDev;
  return [uplift.mean - width, uplift.mean + width];
}

export function setAdjustedCIs(
  results: ExperimentReportResultDimension[],
  pValueThreshold: number
): void {
  const zScore = normal.quantile(1 - pValueThreshold / 2, 0, 1);
  results.forEach((r) => {
    r.variations.forEach((v) => {
      for (const key in v.metrics) {
        const pValueAdjusted = v.metrics[key].pValueAdjusted;
        const uplift = v.metrics[key].uplift;
        const ci = v.metrics[key].ci;
        if (pValueAdjusted === undefined) {
          continue;
        } else if (pValueAdjusted > 0.999999) {
          // set to Inf if adjusted pValue is 1
          v.metrics[key].ciAdjusted = [-Infinity, Infinity];
        } else if (
          pValueAdjusted !== undefined &&
          uplift !== undefined &&
          ci !== undefined
        ) {
          const adjCI = adjustedCI(pValueAdjusted, uplift, zScore);
          // only update if CI got wider, should never get more narrow
          if (adjCI[0] < ci[0] && adjCI[1] > ci[1]) {
            v.metrics[key].ciAdjusted = adjCI;
          } else {
            v.metrics[key].ciAdjusted = v.metrics[key].ci;
          }
        }
      }
    });
  });
  return;
}

export type RowResults = {
  directionalStatus: "winning" | "losing";
  resultsStatus: "won" | "lost" | "draw" | "";
  resultsReason: string;
  hasData: boolean;
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
  guardrailWarning: string;
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
  isGuardrail,
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
  getFactTableById,
}: {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  statsEngine: StatsEngine;
  metric: ExperimentMetricInterface;
  metricDefaults: MetricDefaults;
  isGuardrail: boolean;
  minSampleSize: number;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
  snapshotDate: Date;
  phaseStartDate: Date;
  isLatestPhase: boolean;
  experimentStatus: ExperimentStatus;
  displayCurrency: string;
  getFactTableById: (id: string) => null | FactTableInterface;
}): RowResults {
  const compactNumberFormatter = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  });
  const numberFormatter = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 4,
  });
  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const hasData = !!stats?.value && !!baseline?.value;
  const metricSampleSize = getMetricSampleSize(baseline, stats, metric);
  const baselineSampleSize = metricSampleSize.baselineValue ?? baseline.value;
  const variationSampleSize = metricSampleSize.variationValue ?? stats.value;
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const enoughDataReason =
    `This metric has a minimum ${
      quantileMetricType(metric) ? "sample size" : "total"
    } of ${minSampleSize}; this value must be reached in one variation before results are displayed. ` +
    `The total ${
      quantileMetricType(metric) ? "sample size" : "metric value"
    } of the variation is ${compactNumberFormatter.format(
      variationSampleSize
    )} and the baseline total is ${compactNumberFormatter.format(
      baselineSampleSize
    )}.`;
  const percentComplete =
    minSampleSize > 0
      ? Math.max(baselineSampleSize, variationSampleSize) / minSampleSize
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
    percentCompleteNumerator: Math.max(baselineSampleSize, variationSampleSize),
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
        metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0
      )}).`
    : "";

  const { risk, relativeRisk, showRisk } = getRisk(
    stats,
    baseline,
    metric,
    metricDefaults,
    baseline.cr
  );
  const winRiskThreshold = metric.winRisk ?? DEFAULT_WIN_RISK_THRESHOLD;
  const loseRiskThreshold = metric.loseRisk ?? DEFAULT_LOSE_RISK_THRESHOLD;
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

  const isBinomial = isBinomialMetric(metric);

  // TODO: support formatted risk for fact metrics
  if (!isBinomial) {
    riskFormatted = `${getExperimentMetricFormatter(
      metric,
      getFactTableById
    )(risk, { currency: displayCurrency })} / user`;
  }
  const riskMeta: RiskMeta = {
    riskStatus,
    showRisk,
    riskFormatted: riskFormatted,
    relativeRiskFormatted: percentFormatter.format(relativeRisk),
    riskReason,
  };

  const {
    belowMinChange,
    significant,
    significantUnadjusted,
    resultsStatus,
    directionalStatus,
  } = getMetricResultStatus({
    metric,
    metricDefaults,
    baseline,
    stats,
    ciLower,
    ciUpper,
    pValueThreshold,
    statsEngine,
  });

  let significantReason = "";
  if (!significant) {
    if (statsEngine === "bayesian") {
      significantReason = `This metric is not statistically significant. The chance to win is not less than ${percentFormatter.format(
        ciLower
      )} or greater than ${percentFormatter.format(ciUpper)}.`;
    } else {
      significantReason = `This metric is not statistically significant. The p-value (${pValueFormatter(
        stats.pValueAdjusted ?? stats.pValue ?? 1
      )}) is greater than the threshold (${pValueFormatter(pValueThreshold)}).`;
    }
  }

  let resultsReason = "";
  if (statsEngine === "bayesian") {
    if (resultsStatus === "won") {
      resultsReason = `Significant win as the chance to win is above the ${percentFormatter.format(
        ciUpper
      )} threshold and the change is in the desired direction.`;
    } else if (resultsStatus === "lost") {
      resultsReason = `Significant loss as the chance to win is below the ${percentFormatter.format(
        ciLower
      )} threshold and the change is not in the desired direction.`;
    } else if (resultsStatus === "draw") {
      resultsReason =
        "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    }
  } else {
    if (resultsStatus === "won") {
      resultsReason = `Significant win as the p-value is below the ${numberFormatter.format(
        pValueThreshold
      )} threshold`;
    } else if (resultsStatus === "lost") {
      resultsReason = `Significant loss as the p-value is below the ${numberFormatter.format(
        pValueThreshold
      )} threshold`;
    } else if (resultsStatus === "draw") {
      resultsReason =
        "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    }
  }

  let guardrailWarning = "";
  if (
    isGuardrail &&
    directionalStatus === "losing" &&
    resultsStatus !== "lost"
  ) {
    guardrailWarning =
      "Uplift for this guardrail metric may be in the undesired direction.";
  }

  return {
    directionalStatus,
    resultsStatus,
    resultsReason,
    hasData,
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
    guardrailWarning,
  };
}

export function getEffectLabel(differenceType: DifferenceType): string {
  if (differenceType === "absolute") {
    return "Absolute Change";
  }
  if (differenceType === "scaled") {
    return "Scaled Impact";
  }
  return "% Change";
}
