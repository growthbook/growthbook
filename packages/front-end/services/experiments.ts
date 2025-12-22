import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import {
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "shared/types/report";
import { MetricDefaults, SDKAttributeSchema } from "shared/types/organization";
import {
  ComputedExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentStatus,
  ExperimentTemplateInterface,
  MetricOverride,
} from "shared/types/experiment";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { getValidDate } from "shared/dates";
import { isNil, omit } from "lodash";
import { FactTableInterface } from "shared/types/fact-table";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  getEqualWeights,
  getMetricResultStatus,
  getMetricSampleSize,
  hasEnoughData,
  isBinomialMetric,
  isRatioMetric,
  isSuspiciousUplift,
  quantileMetricType,
} from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { ReactElement } from "react";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { getDefaultVariations } from "@/components/Experiment/NewExperimentForm";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import { RowError } from "@/components/Experiment/ResultsTable";
import { getDefaultRuleValue, NewExperimentRefRule } from "./features";

export const compareRows = (
  a: ExperimentTableRow,
  b: ExperimentTableRow,
  options: {
    sortBy: "significance" | "change";
    variationFilter: number[];
    metricDefaults: MetricDefaults;
    sortDirection: "asc" | "desc";
  },
) => {
  const { sortBy, variationFilter, metricDefaults, sortDirection } = options;

  const aVisibleVariations =
    a?.variations?.filter((_, index) => !variationFilter?.includes?.(index)) ??
    [];
  const bVisibleVariations =
    b?.variations?.filter((_, index) => !variationFilter?.includes?.(index)) ??
    [];

  const aBaseline = a?.variations?.[0];
  const bBaseline = b?.variations?.[0];

  const aVariationsWithEnoughData = aVisibleVariations.filter((v) => {
    const originalIndex = a?.variations?.indexOf(v) ?? -1;
    return (
      originalIndex > 0 &&
      v &&
      v.value != null &&
      v.value > 0 &&
      hasEnoughData(aBaseline, v, a?.metric, metricDefaults)
    );
  });
  const bVariationsWithEnoughData = bVisibleVariations.filter((v) => {
    const originalIndex = b?.variations?.indexOf(v) ?? -1;
    return (
      originalIndex > 0 &&
      v &&
      v.value != null &&
      v.value > 0 &&
      hasEnoughData(bBaseline, v, b?.metric, metricDefaults)
    );
  });

  if (
    aVariationsWithEnoughData.length === 0 &&
    bVariationsWithEnoughData.length === 0
  )
    return 0;
  if (aVariationsWithEnoughData.length === 0) return 1;
  if (bVariationsWithEnoughData.length === 0) return -1;

  const aSignificanceValues = aVariationsWithEnoughData.map((v) => {
    if (sortBy === "change") {
      return v?.expected ?? 0;
    } else {
      const usePValue =
        aVariationsWithEnoughData.some((v) => v?.pValue != null) ||
        bVariationsWithEnoughData.some((v) => v?.pValue != null);
      return usePValue ? (v?.pValue ?? 1) : (v?.chanceToWin ?? 0);
    }
  });
  const bSignificanceValues = bVariationsWithEnoughData.map((v) => {
    if (sortBy === "change") {
      return v?.expected ?? 0;
    } else {
      const usePValue =
        aVariationsWithEnoughData.some((v) => v?.pValue != null) ||
        bVariationsWithEnoughData.some((v) => v?.pValue != null);
      return usePValue ? (v?.pValue ?? 1) : (v?.chanceToWin ?? 0);
    }
  });

  if (aSignificanceValues.length === 0 && bSignificanceValues.length === 0)
    return 0;
  if (aSignificanceValues.length === 0) return 1;
  if (bSignificanceValues.length === 0) return -1;

  const aAggregatedValue =
    sortBy === "change"
      ? Math.max(...aSignificanceValues)
      : aVariationsWithEnoughData.some((v) => v?.pValue != null)
        ? Math.min(...aSignificanceValues)
        : Math.max(...aSignificanceValues);
  const bAggregatedValue =
    sortBy === "change"
      ? Math.max(...bSignificanceValues)
      : bVariationsWithEnoughData.some((v) => v?.pValue != null)
        ? Math.min(...bSignificanceValues)
        : Math.max(...bSignificanceValues);

  const comparisonResult =
    sortBy === "change"
      ? bAggregatedValue - aAggregatedValue
      : aVariationsWithEnoughData.some((v) => v?.pValue != null)
        ? aAggregatedValue - bAggregatedValue
        : bAggregatedValue - aAggregatedValue;

  return sortDirection === "desc" ? -comparisonResult : comparisonResult;
};

export function experimentDate(exp: ExperimentInterfaceStringDates): string {
  return (
    (exp.archived
      ? exp.dateUpdated
      : exp.status === "running"
        ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
        : exp.status === "stopped"
          ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
          : exp.dateCreated) ?? new Date().toISOString() // fallback to now
  );
}

export type ExperimentTableRow = {
  label: string | ReactElement;
  metric: ExperimentMetricInterface;
  metricOverrideFields: string[];
  variations: SnapshotMetric[];
  rowClass?: string;
  metricSnapshotSettings?: MetricSnapshotSettings;
  resultGroup: "goal" | "secondary" | "guardrail";
  error?: RowError;
  numSlices?: number;
  // Slice row properties
  isSliceRow?: boolean;
  parentRowId?: string;
  sliceId?: string;
  sliceLevels?: Array<{
    column: string;
    datatype: "string" | "boolean";
    levels: string[];
  }>;
  allSliceLevels?: string[];
  isHiddenByFilter?: boolean; // True if this row should be hidden due to slice level filtering
  isPinned?: boolean; // True if this slice level row is pinned
  labelOnly?: boolean; // True if this parent row should only show label (no stats) when slice filters are active
};

export function getRisk(
  stats: SnapshotMetric,
  baseline: SnapshotMetric,
  metric: ExperimentMetricInterface,
  metricDefaults: MetricDefaults,
  differenceType: DifferenceType,
  // separate CR because sometimes "baseline" above is the variation
  baselineCR: number,
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
    !isSuspiciousUplift(
      baseline,
      stats,
      metric,
      metricDefaults,
      differenceType,
    );
  return { risk, relativeRisk, showRisk };
}

export function getRiskByVariation(
  riskVariation: number,
  row: ExperimentTableRow,
  metricDefaults: MetricDefaults,
  differenceType: DifferenceType,
) {
  const baseline = row.variations[0];

  if (riskVariation > 0) {
    const stats = row.variations[riskVariation];
    return getRisk(
      stats,
      baseline,
      row.metric,
      metricDefaults,
      differenceType,
      baseline.cr,
    );
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
      } = getRisk(
        baseline,
        stats,
        row.metric,
        metricDefaults,
        differenceType,
        baseline.cr,
      );
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

export function useDomain(
  variations: ExperimentReportVariationWithIndex[], // must be ordered, baseline first
  rows: ExperimentTableRow[],
  differenceType: DifferenceType,
): [number, number] {
  const { metricDefaults } = useOrganizationMetricDefaults();

  let lowerBound = 0;
  let upperBound = 0;
  rows.forEach((row) => {
    // Skip metric slice rows that are hidden (not expanded or pinned)
    if (row.isHiddenByFilter) {
      return;
    }

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
      if (
        isSuspiciousUplift(
          baseline,
          stats,
          row.metric,
          metricDefaults,
          differenceType,
        )
      ) {
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
  metricOverrides?: MetricOverride[],
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
      newMetric.windowSettings.delayUnit = "hours";
      newMetric.windowSettings.delayValue = metricOverride.delayHours;
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
      newMetric.regressionAdjustmentEnabled =
        !!metricOverride.regressionAdjustmentEnabled;
      overrideFields.push(
        "regressionAdjustmentOverride",
        "regressionAdjustmentEnabled",
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

export function useExperimentSearch({
  allExperiments,
  defaultSortField = "date",
  defaultSortDir = -1,
  filterResults,
  localStorageKey = "experiments",
  watchedExperimentIds,
}: {
  allExperiments: ExperimentInterfaceStringDates[];
  defaultSortField?: keyof ComputedExperimentInterface;
  defaultSortDir?: -1 | 1;
  filterResults?: (
    items: ComputedExperimentInterface[],
  ) => ComputedExperimentInterface[];
  localStorageKey?: string;
  watchedExperimentIds?: string[];
}) {
  const {
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
    getSavedGroupById,
    metricGroups,
  } = useDefinitions();
  const { getUserDisplay } = useUser();
  const getExperimentStatusIndicator = useExperimentStatusIndicator();

  const experiments: ComputedExperimentInterface[] = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;
      const statusIndicator = getExperimentStatusIndicator(exp);
      const statusSortOrder = statusIndicator.sortOrder;
      const lastPhase = exp.phases?.[exp.phases?.length - 1] || {};
      const rawSavedGroup = lastPhase?.savedGroups || [];
      const savedGroupIds = rawSavedGroup.map((g) => g.ids).flat();
      const isWatched = watchedExperimentIds?.includes(exp.id) ?? false;

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.goalMetrics
          .map((m) => getExperimentMetricById(m)?.name)
          .filter(Boolean),
        datasource: getDatasourceById(exp.datasource)?.name || "",
        savedGroups: savedGroupIds.map(
          (id) => getSavedGroupById(id)?.groupName,
        ),
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: exp.archived
          ? "archived"
          : exp.status === "draft"
            ? "drafts"
            : exp.status,
        date: experimentDate(exp),
        statusIndicator,
        statusSortOrder,
        isWatched,
      };
    },
    [getExperimentMetricById, getProjectById, getUserDisplay],
  );

  return useSearch({
    items: experiments,
    localStorageKey,
    defaultSortField,
    defaultSortDir,
    updateSearchQueryOnChange: true,
    searchFields: ["name^3", "trackingKey^2", "hypothesis^2", "description"],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.status === "draft") is.push("draft");
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        if (item.results === "won") {
          is.push("winner");
          is.push("won");
        }
        if (item.results === "lost") {
          is.push("loser");
          is.push("lost");
        }
        if (item.results === "inconclusive") is.push("inconclusive");
        if (item.results === "dnf") is.push("dnf");
        if (item.hasVisualChangesets) is.push("visual");
        if (item.hasURLRedirects) is.push("redirect");
        if (item.isWatched) is.push("watched");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.hasVisualChangesets) {
          has.push("visualChange", "visualChanges");
        }
        if (item.hasURLRedirects) has.push("redirect", "redirects");
        if (item.linkedFeatures?.length) has.push("features", "feature");
        if (item.hypothesis?.trim()?.length) has.push("hypothesis");
        if (item.description?.trim()?.length) has.push("description");
        if (item.variations.some((v) => !!v.screenshots?.length)) {
          has.push("screenshots");
        }
        if (
          item.status === "stopped" &&
          !item.excludeFromPayload &&
          (item.linkedFeatures?.length ||
            item.hasURLRedirects ||
            item.hasVisualChangesets)
        ) {
          has.push("rollout", "tempRollout");
        }
        return has;
      },
      variations: (item) => item.variations.length,
      variation: (item) => item.variations.map((v) => v.name),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      key: (item) => item.trackingKey,
      trackingKey: (item) => item.trackingKey,
      id: (item) => [item.id, item.trackingKey],
      status: (item) => item.status,
      result: (item) =>
        item.status === "stopped" ? item.results || "unfinished" : "unfinished",
      owner: (item) => [item.owner, item.ownerName],
      tag: (item) => item.tags,
      project: (item) => [item.project, item.projectName],
      feature: (item) => item.linkedFeatures || [],
      datasource: (item) => item.datasource,
      metric: (item) => [
        ...(item.metricNames ?? []),
        ...getAllMetricIdsFromExperiment(item, true, metricGroups),
      ],
      savedgroup: (item) => item.savedGroups || [],
      goal: (item) => [...(item.metricNames ?? []), ...item.goalMetrics],
    },
    filterResults,
  });
}

export type RowResults = {
  directionalStatus: "winning" | "losing";
  resultsStatus: "won" | "lost" | "draw" | "";
  resultsReason: string;
  hasData: boolean;
  enoughData: boolean;
  enoughDataMeta: EnoughDataMeta;
  hasScaledImpact: boolean;
  significant: boolean;
  significantUnadjusted: boolean;
  significantReason: string;
  suspiciousChange: boolean;
  suspiciousThreshold: number;
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
export type EnoughDataMetaZeroValues = {
  reason: "baselineZero" | "variationZero";
  reasonText: string;
};
export type EnoughDataMetaNotEnoughData = {
  reason: "notEnoughData";
  reasonText: string;
  percentComplete: number;
  percentCompleteNumerator: number;
  percentCompleteDenominator: number;
  timeRemainingMs: number | null;
  showTimeRemaining: boolean;
};
export type EnoughDataMeta =
  | EnoughDataMetaZeroValues
  | EnoughDataMetaNotEnoughData;
export function getRowResults({
  stats,
  baseline,
  metric,
  denominator,
  metricDefaults,
  isGuardrail,
  minSampleSize,
  statsEngine,
  differenceType,
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
  differenceType: DifferenceType;
  metric: ExperimentMetricInterface;
  denominator?: ExperimentMetricInterface;
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

  const hasScaledImpact =
    !isRatioMetric(metric, denominator) && !quantileMetricType(metric);
  const hasData = !!stats?.value && !!baseline?.value;
  const metricSampleSize = getMetricSampleSize(baseline, stats, metric);
  const baselineSampleSize = metricSampleSize.baselineValue ?? baseline.value;
  const variationSampleSize = metricSampleSize.variationValue ?? stats.value;
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);

  const reason: EnoughDataMeta["reason"] =
    baseline.value === 0
      ? "baselineZero"
      : stats.value === 0
        ? "variationZero"
        : "notEnoughData";

  const enoughDataMeta: EnoughDataMeta = (() => {
    switch (reason) {
      case "notEnoughData": {
        const reasonText =
          `This metric has a minimum ${
            quantileMetricType(metric) ? "sample size" : "total"
          } of ${minSampleSize}; this value must be reached in one variation before results are displayed. ` +
          `The total ${
            quantileMetricType(metric) ? "sample size" : "metric value"
          } of the variation is ${compactNumberFormatter.format(
            variationSampleSize,
          )} and the baseline total is ${compactNumberFormatter.format(
            baselineSampleSize,
          )}.`;
        const percentComplete =
          minSampleSize > 0
            ? Math.max(baselineSampleSize, variationSampleSize) / minSampleSize
            : 1;
        const timeRemainingMs =
          percentComplete !== null && percentComplete > 0.1
            ? ((snapshotDate.getTime() -
                getValidDate(phaseStartDate).getTime()) *
                (1 - percentComplete)) /
                percentComplete -
              (Date.now() - snapshotDate.getTime())
            : null;
        const showTimeRemaining =
          timeRemainingMs !== null &&
          isLatestPhase &&
          experimentStatus === "running";
        return {
          percentComplete,
          percentCompleteNumerator: Math.max(
            baselineSampleSize,
            variationSampleSize,
          ),
          percentCompleteDenominator: minSampleSize,
          timeRemainingMs,
          showTimeRemaining,
          reason,
          reasonText,
        };
        break;
      }
      case "baselineZero": {
        const reasonText = `Statistics can only be displayed once the baseline has a non-zero value.`;
        return {
          reason,
          reasonText,
        };
        break;
      }
      case "variationZero": {
        const reasonText = `Statistics can only be displayed once the variation has a non-zero value.`;
        return {
          reason,
          reasonText,
        };
      }
    }
  })();
  const suspiciousChange = isSuspiciousUplift(
    baseline,
    stats,
    metric,
    metricDefaults,
    differenceType,
  );
  const suspiciousThreshold =
    metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0;
  const suspiciousChangeReason = suspiciousChange
    ? `A suspicious result occurs when the percent change exceeds your maximum percent change (${percentFormatter.format(
        suspiciousThreshold,
      )}).`
    : "";

  const { risk, relativeRisk, showRisk } = getRisk(
    stats,
    baseline,
    metric,
    metricDefaults,
    differenceType,
    baseline.cr,
  );
  const winRiskThreshold = metric.winRisk ?? DEFAULT_WIN_RISK_THRESHOLD;
  const loseRiskThreshold = metric.loseRisk ?? DEFAULT_LOSE_RISK_THRESHOLD;
  let riskStatus: "ok" | "warning" | "danger" = "ok";
  let riskReason = "";
  if (relativeRisk > winRiskThreshold && relativeRisk < loseRiskThreshold) {
    riskStatus = "warning";
    riskReason = `The relative risk (${percentFormatter.format(
      relativeRisk,
    )}) exceeds the warning threshold (${percentFormatter.format(
      winRiskThreshold,
    )}) for this metric.`;
  } else if (relativeRisk >= loseRiskThreshold) {
    riskStatus = "danger";
    riskReason = `The relative risk (${percentFormatter.format(
      relativeRisk,
    )}) exceeds the danger threshold (${percentFormatter.format(
      loseRiskThreshold,
    )}) for this metric.`;
  }
  let riskFormatted = "";

  const isBinomial = isBinomialMetric(metric);

  // TODO: support formatted risk for fact metrics
  if (!isBinomial) {
    riskFormatted = `${getExperimentMetricFormatter(metric, getFactTableById)(
      risk,
      { currency: displayCurrency },
    )} / user`;
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
    differenceType,
  });

  let significantReason = "";
  if (!significant) {
    if (statsEngine === "bayesian") {
      significantReason = `This metric is not statistically significant. The chance to win is not less than ${percentFormatter.format(
        ciLower,
      )} or greater than ${percentFormatter.format(ciUpper)}.`;
    } else {
      significantReason = `This metric is not statistically significant. The p-value (${pValueFormatter(
        stats.pValueAdjusted ?? stats.pValue ?? 1,
      )}) is greater than the threshold (${pValueFormatter(pValueThreshold)}).`;
    }
  }

  let resultsReason = "";
  if (statsEngine === "bayesian") {
    if (resultsStatus === "won") {
      resultsReason = `Significant win as the chance to win is above the ${percentFormatter.format(
        ciUpper,
      )} threshold and the change is in the desired direction.`;
    } else if (resultsStatus === "lost") {
      resultsReason = `Significant loss as the chance to win is below the ${percentFormatter.format(
        ciLower,
      )} threshold and the change is not in the desired direction.`;
    } else if (resultsStatus === "draw") {
      resultsReason =
        "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    }
  } else {
    if (resultsStatus === "won") {
      resultsReason = `Significant win as the p-value is below the ${numberFormatter.format(
        pValueThreshold,
      )} threshold`;
    } else if (resultsStatus === "lost") {
      resultsReason = `Significant loss as the p-value is below the ${numberFormatter.format(
        pValueThreshold,
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
    hasScaledImpact,
    significant,
    significantUnadjusted,
    significantReason,
    suspiciousChange,
    suspiciousThreshold,
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
    return "Change";
  }
  if (differenceType === "scaled") {
    return "Scaled Impact";
  }
  return "% Change";
}

export function convertTemplateToExperiment(
  template: ExperimentTemplateInterface,
): Partial<ExperimentInterfaceStringDates> {
  const templateWithoutTemplateFields = omit(template, [
    "id",
    "organization",
    "owner",
    "dateCreated",
    "dateUpdated",
    "templateMetadata",
    "targeting",
  ]);
  return {
    ...templateWithoutTemplateFields,
    variations: getDefaultVariations(2),
    phases: [
      {
        dateStarted: new Date().toISOString().substr(0, 16),
        dateEnded: new Date().toISOString().substr(0, 16),
        name: "Main",
        reason: "",
        variationWeights: getEqualWeights(2),
        ...template.targeting,
      },
    ],
    templateId: template.id,
  };
}

export function convertTemplateToExperimentRule({
  template,
  defaultValue,
  attributeSchema,
}: {
  template: ExperimentTemplateInterface;
  defaultValue: string;
  attributeSchema?: SDKAttributeSchema;
}): Partial<NewExperimentRefRule> {
  const templateWithoutTemplateFields = omit(template, [
    "id",
    "organization",
    "owner",
    "dateCreated",
    "dateUpdated",
    "templateMetadata",
    "targeting",
    "type",
  ]);
  if ("skipPartialData" in templateWithoutTemplateFields) {
    // @ts-expect-error Mangled types
    templateWithoutTemplateFields.skipPartialData =
      templateWithoutTemplateFields.skipPartialData ? "strict" : "loose";
  }
  return {
    ...(getDefaultRuleValue({
      defaultValue,
      attributeSchema,
      ruleType: "experiment-ref-new",
    }) as NewExperimentRefRule),
    ...templateWithoutTemplateFields,
    ...template.targeting,
    templateId: template.id,
  };
}

export function convertExperimentToTemplate(
  experiment: ExperimentInterfaceStringDates,
): Partial<ExperimentTemplateInterface> {
  const latestPhase = experiment.phases[experiment.phases.length - 1];
  const template = {
    templateMetadata: {
      name: `${experiment.name} Template`,
      description: `Template based on ${experiment.name}`,
    },
    project: experiment.project,
    type: "standard" as const,
    hypothesis: experiment.hypothesis,
    tags: experiment.tags,
    datasource: experiment.datasource,
    exposureQueryId: experiment.exposureQueryId,
    hashAttribute: experiment.hashAttribute,
    fallbackAttribute: experiment.fallbackAttribute,
    disableStickyBucketing: experiment.disableStickyBucketing,
    goalMetrics: experiment.goalMetrics,
    secondaryMetrics: experiment.secondaryMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
    activationMetric: experiment.activationMetric,
    statsEngine: experiment.statsEngine,
    targeting: {
      coverage: latestPhase.coverage,
      savedGroups: latestPhase.savedGroups,
      prerequisites: latestPhase.prerequisites,
      condition: latestPhase.condition,
    },
  };
  return template;
}

export function getIsExperimentIncludedInIncrementalRefresh(
  datasource: DataSourceInterfaceWithParams | undefined,
  experimentId: string | undefined,
): boolean {
  const isPipelineIncrementalEnabled =
    datasource?.settings.pipelineSettings?.mode === "incremental";
  if (!isPipelineIncrementalEnabled) {
    return false;
  }

  const includedExperimentIds =
    datasource?.settings.pipelineSettings?.includedExperimentIds;
  const excludedExperimentIds =
    datasource?.settings.pipelineSettings?.excludedExperimentIds;

  if (experimentId && excludedExperimentIds?.includes(experimentId)) {
    return false;
  }

  // If no specific experiment IDs are set, all experiments are included
  // If experimentId is not provided, consider it included for the New Experiment form
  if (includedExperimentIds === undefined || !experimentId) {
    return true;
  }

  return includedExperimentIds.includes(experimentId);
}
