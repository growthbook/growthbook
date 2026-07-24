import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import {
  ExperimentReportVariation,
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
import {
  DataSourceInterfaceWithParams,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { getValidDate } from "shared/dates";
import { includeExperimentInPayload } from "shared/util";
import { isExperimentIncrementalEnabled } from "shared/enterprise";
import { isNil, omit } from "lodash";
import {
  FactTableDefinition,
  FactMetricInterface,
  FactTableColumnType,
} from "shared/types/fact-table";
import {
  ExperimentMetricDefinition,
  getAllMetricIdsFromExperiment,
  getEqualWeights,
  getLatestPhaseVariations,
  getMetricResultStatus,
  getMetricSampleSize,
  hasEnoughData,
  isFactMetric,
  isMetricGroupId,
  isRatioMetric,
  isSuspiciousUplift,
  quantileMetricType,
  expandMetricGroups,
  createAutoSliceDataForMetric,
  generateSliceString,
  generateSelectAllSliceString,
  parseSliceQueryString,
  SliceDataForMetric,
} from "shared/experiments";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { ReactElement } from "react";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
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

/**
 * Returns the `statusUpdateSchedule.startAt` Date for an experiment if it
 * parses to a future date, otherwise null. Past-dated and missing schedules
 * both map to "start immediately" so they flow through the start-now path.
 */
export function getFutureScheduledStartDate(
  experiment: ExperimentInterfaceStringDates,
): Date | null {
  const raw = experiment.statusUpdateSchedule?.startAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  return parsed > new Date() ? parsed : null;
}

export type ExperimentTableRow = {
  label: string | ReactElement;
  metric: ExperimentMetricDefinition;
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
  isHiddenByFilter?: boolean;
  labelOnly?: boolean;
};

export function useDomain(
  variations: ExperimentReportVariation[], // must be ordered, baseline first
  rows: ExperimentTableRow[],
  differenceType: DifferenceType,
  // When the analysis uses one-sided intervals (e.g. safe rollouts), one CI
  // bound is "fake" (±Infinity). In that case we anchor the open side at 0
  // rather than inferring a finite extent from it, so the domain is "0 +
  // padding around the real bound" instead of "[ci, ci]".
  oneSided = false,
): [number, number] {
  const { metricDefaults } = useOrganizationMetricDefaults();

  let lowerBound = 0;
  let upperBound = 0;
  let hasBound = false;

  const addBounds = (nextLower: number, nextUpper: number) => {
    if (!Number.isFinite(nextLower) || !Number.isFinite(nextUpper)) return;
    if (!hasBound) {
      lowerBound = nextLower;
      upperBound = nextUpper;
      hasBound = true;
      return;
    }
    lowerBound = Math.min(lowerBound, nextLower);
    upperBound = Math.max(upperBound, nextUpper);
  };

  const getFallbackHalfSpan = (...values: number[]) => {
    const finite = values.filter((v) => Number.isFinite(v));
    const maxAbs = finite.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    // Keep a visible range for near-zero one-sided CIs.
    return Math.max(maxAbs * 0.6, 0.01);
  };
  rows.forEach((row) => {
    // Skip metric slice rows that are hidden (not expanded)
    if (row.isHiddenByFilter) {
      return;
    }

    const baselineVariation = variations?.[0];
    if (baselineVariation?.index === undefined) return;
    const baseline = row.variations[baselineVariation.index];
    if (!baseline) return;
    variations?.forEach((v: ExperimentReportVariation, i) => {
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

      const [ci0, ci1] = ci;
      const expected = Number.isFinite(stats.expected ?? NaN)
        ? (stats.expected as number)
        : 0;

      const loFinite = Number.isFinite(ci0);
      const hiFinite = Number.isFinite(ci1);

      if (oneSided) {
        // One bound is fake (±Infinity). Build the extent from the *real*
        // values only — the finite bound and the point estimate — plus 0 as a
        // reference. Because we take min/max, 0 only widens the domain when it
        // is actually the extreme (the real CI sits entirely on one side of
        // it); a "proper" CI that has drifted across 0 keeps its real bounds
        // and 0 simply sits interior. The open side is drawn out to the plot
        // edge by the consuming graph.
        const realValues = [expected, 0];
        if (loFinite) realValues.push(ci0);
        if (hiFinite) realValues.push(ci1);
        addBounds(Math.min(...realValues), Math.max(...realValues));
      } else if (loFinite && hiFinite) {
        addBounds(ci0, ci1);
      } else if (!loFinite && hiFinite) {
        // One-sided [-Infinity, X]: infer a symmetric-ish finite left extent.
        const halfSpan = getFallbackHalfSpan(ci1, expected);
        addBounds(Math.min(expected, 0) - halfSpan, ci1);
      } else if (loFinite && !hiFinite) {
        // One-sided [Y, Infinity]: infer a symmetric-ish finite right extent.
        const halfSpan = getFallbackHalfSpan(ci0, expected);
        addBounds(ci0, Math.max(expected, 0) + halfSpan);
      } else {
        // Degenerate [±Infinity, ±Infinity] - keep the row visible around expected.
        const halfSpan = getFallbackHalfSpan(expected);
        addBounds(expected - halfSpan, expected + halfSpan);
      }
    });
  });

  if (!hasBound) {
    return [-0.05, 0.05];
  }

  lowerBound = lowerBound <= 0 ? lowerBound : 0;
  upperBound = upperBound >= 0 ? upperBound : 0;

  // Ensure we always cross 0 with at least a small visual delta.
  const span = Math.max(upperBound - lowerBound, 0.01);
  const minZeroDelta = Math.max(span * 0.03, 0.005);
  if (lowerBound >= 0) lowerBound = -minZeroDelta;
  if (upperBound <= 0) upperBound = minZeroDelta;

  return [lowerBound, upperBound];
}

export function applyMetricOverrides<T extends ExperimentMetricDefinition>(
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

/**
 * True when a stopped experiment is still serving its released variation —
 * i.e. a temporary rollout. Delegates to `includeExperimentInPayload` so the
 * predicate stays aligned with what the SDK actually emits (archived
 * experiments, missing released variation, no linked changes, etc. all
 * correctly exclude themselves).
 */
export function hasTempRollout(
  exp: Pick<
    ExperimentInterfaceStringDates,
    | "status"
    | "archived"
    | "excludeFromPayload"
    | "releasedVariationId"
    | "hasVisualChangesets"
    | "hasURLRedirects"
    | "linkedFeatures"
    | "phases"
  >,
): boolean {
  return (
    exp.status === "stopped" &&
    includeExperimentInPayload(exp as ExperimentInterfaceStringDates)
  );
}

// Detailed-status values that belong in the "State" column (data/setup
// problems with a running experiment) rather than the "Result" column.
// Kept in sync with the cases in `statusIndicatorData.ts`.
export const HEALTH_DETAILED_STATUSES = ["No data", "Unhealthy"] as const;

export function isHealthDetailedStatus(detailedStatus?: string): boolean {
  if (!detailedStatus) return false;
  return (HEALTH_DETAILED_STATUSES as readonly string[]).includes(
    detailedStatus,
  );
}

/**
 * Display string for the "State" column. Returns the experiment's health
 * `detailedStatus` (e.g. "No data", "Unhealthy") when one is set, otherwise
 * "Temp Rollout" when the experiment is a temp rollout, otherwise "".
 */
export function getHealthStatus(
  exp: Pick<
    ExperimentInterfaceStringDates,
    | "status"
    | "archived"
    | "excludeFromPayload"
    | "releasedVariationId"
    | "hasVisualChangesets"
    | "hasURLRedirects"
    | "linkedFeatures"
    | "phases"
  >,
  detailedStatus?: string,
): string {
  if (isHealthDetailedStatus(detailedStatus)) return detailedStatus ?? "";
  if (hasTempRollout(exp)) return "Temp Rollout";
  return "";
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
  localStorageKey,
  watchedExperimentIds,
  controlledSearchValue,
}: {
  allExperiments: ExperimentInterfaceStringDates[];
  defaultSortField?: keyof ComputedExperimentInterface;
  defaultSortDir?: -1 | 1;
  filterResults?: (
    items: ComputedExperimentInterface[],
  ) => ComputedExperimentInterface[];
  localStorageKey: string;
  watchedExperimentIds?: string[];
  // When provided, drives filtering from a stored search string (e.g. a
  // dashboard block's saved filter) instead of a user-typed input. Bypasses the
  // URL `q` param so it doesn't leak into or clobber the page's search state.
  controlledSearchValue?: string;
}) {
  const {
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
    getSavedGroupById,
    metricGroups,
  } = useDefinitions();
  const { getOwnerDisplay } = useUser();
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
        ownerName: getOwnerDisplay(exp.owner),
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
        hasTempRollout: hasTempRollout(exp),
        healthStatus: getHealthStatus(exp, statusIndicator.detailedStatus),
      };
    },
    [getExperimentMetricById, getOwnerDisplay, getProjectById],
  );

  return useSearch({
    items: experiments,
    localStorageKey,
    defaultSortField,
    defaultSortDir,
    updateSearchQueryOnChange: controlledSearchValue === undefined,
    controlledSearchValue,
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
        if (
          getLatestPhaseVariations(item).some((v) => !!v.screenshots?.length)
        ) {
          has.push("screenshots");
        }
        if (item.hasTempRollout) {
          has.push("rollout", "tempRollout");
        }
        return has;
      },
      variations: (item) => getLatestPhaseVariations(item).length,
      variation: (item) => getLatestPhaseVariations(item).map((v) => v.name),
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
  minPercentChange: number;
  currentMetricTotal: number;
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
}: {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  metric: ExperimentMetricDefinition;
  denominator?: ExperimentMetricDefinition;
  metricDefaults: MetricDefaults;
  minSampleSize: number;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
  snapshotDate: Date;
  phaseStartDate: Date;
  isLatestPhase: boolean;
  experimentStatus?: ExperimentStatus;
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
  const minPercentChange =
    metric.minPercentChange ?? metricDefaults.minPercentageChange ?? 0;
  const suspiciousChangeReason = suspiciousChange
    ? `A suspicious result occurs when the percent change exceeds your maximum percent change (${percentFormatter.format(
        suspiciousThreshold,
      )}).`
    : "";

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

  // Max numerator value across baseline and variation
  const currentMetricTotal = Math.max(baseline.value ?? 0, stats.value ?? 0);

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
    minPercentChange,
    currentMetricTotal,
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
  const defaultVariations = getDefaultVariations(2);
  return {
    ...templateWithoutTemplateFields,
    variations: defaultVariations,
    phases: [
      {
        dateStarted: new Date().toISOString().substr(0, 16),
        dateEnded: new Date().toISOString().substr(0, 16),
        name: "Main",
        reason: "",
        variationWeights: getEqualWeights(2),
        variations: defaultVariations.map((v) => ({
          id: v.id,
          status: "active" as const,
        })),
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

export function datasourceHasWritableEphemeralPipeline(
  datasource: DataSourceInterfaceWithParams | null | undefined,
  hasPipelineModeFeature: boolean,
): boolean {
  const pipelineSettings = datasource?.settings?.pipelineSettings;
  return (
    !!datasource?.properties?.supportsWritingTables &&
    !!pipelineSettings?.allowWriting &&
    pipelineSettings?.mode === "ephemeral" &&
    !!pipelineSettings?.writeDataset &&
    hasPipelineModeFeature
  );
}

export function getHonoredPrecomputedUnitDimensionIds(
  precomputedUnitDimensionIds: string[] | undefined,
  datasource: DataSourceInterfaceWithParams | null | undefined,
  hasPipelineModeFeature: boolean,
): string[] {
  if (
    !datasourceHasWritableEphemeralPipeline(datasource, hasPipelineModeFeature)
  ) {
    return [];
  }
  return precomputedUnitDimensionIds ?? [];
}

export function getIsExperimentIncludedInIncrementalRefresh(
  datasource: DataSourceInterfaceWithParams | undefined,
  experimentId: string | undefined,
  experimentType: ExperimentInterfaceStringDates["type"],
): boolean {
  const pipelineSettings = datasource?.settings.pipelineSettings;
  if (!pipelineSettings) return false;

  // For the New Experiment form (no experimentId yet) we want to know
  // whether any experiment created on this datasource would default into
  // incremental refresh. That's true when `mode === "incremental"` and
  // there's no include-list scoping it down. Per-experiment opt-in lists
  // do not affect new (unsaved) experiments.
  if (!experimentId) {
    return (
      pipelineSettings.allowWriting === true &&
      pipelineSettings.mode === "incremental" &&
      pipelineSettings.includedExperimentIds === undefined
    );
  }

  return isExperimentIncrementalEnabled(
    pipelineSettings,
    experimentId,
    experimentType,
  );
}

// Returns updated pipeline settings that disable incremental refresh for the
// given experiment. Mirror of `getPipelineSettingsAfterReenablingExperiment`.
//
// - Always drops the experiment from `incrementalOptInExperimentIds`
//   (the opt-in signal in non-incremental modes).
// - Adds it to `excludedExperimentIds` only when `mode === "incremental"`,
//   since excluded is only consulted in that mode.
export function getPipelineSettingsAfterDisablingExperiment(
  pipelineSettings: DataSourcePipelineSettings | undefined,
  experimentId: string,
): DataSourcePipelineSettings | undefined {
  if (!pipelineSettings) return pipelineSettings;

  const next: DataSourcePipelineSettings = { ...pipelineSettings };

  const optIn = next.incrementalOptInExperimentIds;
  if (optIn?.includes(experimentId)) {
    const filtered = optIn.filter((id) => id !== experimentId);
    next.incrementalOptInExperimentIds =
      filtered.length > 0 ? filtered : undefined;
  }

  if (next.mode === "incremental") {
    const excluded = next.excludedExperimentIds ?? [];
    if (!excluded.includes(experimentId)) {
      next.excludedExperimentIds = [...excluded, experimentId];
    }
  }

  return next;
}

// Returns updated pipeline settings that re-enable incremental refresh for
// the given experiment. Mirror of `getPipelineSettingsAfterDisablingExperiment`.
//
// - Always drops the experiment from `excludedExperimentIds`
//   (the "force off" signal in incremental mode).
// - Adds it to `incrementalOptInExperimentIds` only when `mode === "ephemeral"`,
//   since opt-in is ignored in incremental mode and disabled mode doesn't
//   run anything.
export function getPipelineSettingsAfterReenablingExperiment(
  pipelineSettings: DataSourcePipelineSettings | undefined,
  experimentId: string,
): DataSourcePipelineSettings | undefined {
  if (!pipelineSettings) return pipelineSettings;

  const next: DataSourcePipelineSettings = { ...pipelineSettings };

  const excluded = next.excludedExperimentIds;
  if (excluded?.includes(experimentId)) {
    const filtered = excluded.filter((id) => id !== experimentId);
    next.excludedExperimentIds = filtered.length > 0 ? filtered : undefined;
  }

  if (next.mode === "ephemeral") {
    const optIn = next.incrementalOptInExperimentIds ?? [];
    if (!optIn.includes(experimentId)) {
      next.incrementalOptInExperimentIds = [...optIn, experimentId];
    }
  }

  return next;
}

// Extracts available metrics and groups (for result filtering) from experiment metrics
export function getAvailableMetricsFilters({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricGroups,
  getExperimentMetricById,
}: {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricGroups: MetricGroupInterface[];
  getExperimentMetricById: (id: string) => ExperimentMetricDefinition | null;
}): {
  groups: { id: string; name: string }[];
  metrics: { id: string; name: string }[];
} {
  // Get all unique metric IDs (expanded from groups)
  const expandedGoals = expandMetricGroups(goalMetrics, metricGroups);
  const expandedSecondaries = expandMetricGroups(
    secondaryMetrics,
    metricGroups,
  );
  const expandedGuardrails = expandMetricGroups(guardrailMetrics, metricGroups);
  const allExpandedMetricIds = new Set([
    ...expandedGoals,
    ...expandedSecondaries,
    ...expandedGuardrails,
  ]);

  // Get groups
  const groupIdsMap = new Map<string, boolean>();
  [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach((id) => {
    if (isMetricGroupId(id)) {
      groupIdsMap.set(id, true);
    }
  });
  const groupIds = Array.from(groupIdsMap.keys());
  const groups: { id: string; name: string }[] = groupIds
    .map((id) => {
      const group = metricGroups.find((g) => g.id === id);
      return group ? { id: group.id, name: group.name } : null;
    })
    .filter((g): g is { id: string; name: string } => g !== null);

  // Get individual metrics (allExpandedMetricIds only contains individual metric IDs, not groups)
  const metrics: { id: string; name: string }[] = Array.from(
    allExpandedMetricIds,
  )
    .map((id) => {
      const metric = getExperimentMetricById(id);
      return metric ? { id: metric.id, name: metric.name } : null;
    })
    .filter((m): m is { id: string; name: string } => m !== null);

  return { groups, metrics };
}

// Extracts available metric tags (for result filtering) from expanded experiment metrics
export function getAvailableMetricTags({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricGroups,
  getExperimentMetricById,
}: {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricGroups: MetricGroupInterface[];
  getExperimentMetricById: (id: string) => ExperimentMetricDefinition | null;
}): string[] {
  const expandedGoals = expandMetricGroups(goalMetrics, metricGroups);
  const expandedSecondaries = expandMetricGroups(
    secondaryMetrics,
    metricGroups,
  );
  const expandedGuardrails = expandMetricGroups(guardrailMetrics, metricGroups);

  const allMetricTagsSet: Set<string> = new Set();
  [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
    (metricId) => {
      const metric = getExperimentMetricById(metricId);
      metric?.tags?.forEach((tag) => {
        allMetricTagsSet.add(tag);
      });
    },
  );
  return Array.from(allMetricTagsSet);
}

export interface AvailableSliceTag {
  id: string;
  datatypes: Record<string, FactTableColumnType>;
  isSelectAll?: boolean;
}

// Extracts all available slice tags (for result filtering) from experiment metrics.
// Includes both auto slices and custom slices, plus "select all" options for each column.
export function getAvailableSliceTags({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  customMetricSlices,
  metricGroups,
  factTables,
  getExperimentMetricById,
  getFactTableById,
}: {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }> | null;
  metricGroups: MetricGroupInterface[];
  factTables: FactTableDefinition[];
  getExperimentMetricById: (id: string) => ExperimentMetricDefinition | null;
  getFactTableById: (id: string) => FactTableDefinition | null;
}): AvailableSliceTag[] {
  const sliceTagsMap = new Map<
    string,
    { datatypes: Record<string, FactTableColumnType>; isSelectAll?: boolean }
  >();

  // Build factTableMap for parseSliceQueryString
  const factTableMap: Record<string, FactTableDefinition> = {};
  factTables.forEach((table) => {
    factTableMap[table.id] = table;
  });

  // Expand all metrics
  const expandedGoals = expandMetricGroups(goalMetrics, metricGroups);
  const expandedSecondaries = expandMetricGroups(
    secondaryMetrics,
    metricGroups,
  );
  const expandedGuardrails = expandMetricGroups(guardrailMetrics, metricGroups);

  // Track all columns that appear in slices for "select all" generation
  const columnSet = new Set<string>();
  const columnDatatypeMap = new Map<string, FactTableColumnType>();

  // Extract from customMetricSlices
  // For custom slices, only generate the exact combinations defined (no permutations)
  if (customMetricSlices && customMetricSlices.length > 0) {
    customMetricSlices.forEach((group) => {
      // Build the exact slice combination for this group
      const slices: Record<string, string> = {};

      group.slices.forEach((slice) => {
        // Use the first level for each column (custom slices define one combination)
        const level = slice.levels[0] || "";
        slices[slice.column] = level;
      });

      // Generate a single tag for this exact combination
      const tag = generateSliceString(slices);
      // Parse the tag to get datatypes using parseSliceQueryString
      const sliceLevels = parseSliceQueryString(tag, factTableMap);
      const datatypes: Record<string, FactTableColumnType> = {};
      sliceLevels.forEach((sl) => {
        datatypes[sl.column] = sl.datatype;
        // Track column for "select all" generation
        columnSet.add(sl.column);
        if (sl.datatype) {
          columnDatatypeMap.set(sl.column, sl.datatype);
        }
      });
      sliceTagsMap.set(tag, { datatypes });
    });
  }

  // Extract from auto slice data for all fact metrics
  const allMetricIds = [
    ...expandedGoals,
    ...expandedSecondaries,
    ...expandedGuardrails,
  ];

  allMetricIds.forEach((metricId) => {
    const metric = getExperimentMetricById(metricId);

    if (metric && isFactMetric(metric)) {
      const factMetric = metric as FactMetricInterface;
      const factTableId = factMetric.numerator?.factTableId;

      if (factTableId) {
        const factTable = getFactTableById(factTableId);

        if (factTable) {
          const autoSliceData = createAutoSliceDataForMetric({
            parentMetric: metric,
            factTable,
            includeOther: true,
          });

          // Extract tags from slice data
          autoSliceData.forEach((slice: SliceDataForMetric) => {
            // Generate single dimension tags
            slice.sliceLevels.forEach((sliceLevel) => {
              const value = sliceLevel.levels[0] || "";
              const tag = generateSliceString({ [sliceLevel.column]: value });
              const datatypes = sliceLevel.datatype
                ? { [sliceLevel.column]: sliceLevel.datatype }
                : {};
              sliceTagsMap.set(tag, { datatypes });
              // Track column for "select all" generation
              columnSet.add(sliceLevel.column);
              if (sliceLevel.datatype) {
                columnDatatypeMap.set(sliceLevel.column, sliceLevel.datatype);
              }
            });

            // Generate combined tag for multi-dimensional slices
            if (slice.sliceLevels.length > 1) {
              const slices: Record<string, string> = {};
              slice.sliceLevels.forEach((sl) => {
                slices[sl.column] = sl.levels[0] || "";
              });
              const comboTag = generateSliceString(slices);
              // Parse the tag to get datatypes using parseSliceQueryString
              const sliceLevels = parseSliceQueryString(comboTag, factTableMap);
              const datatypes: Record<string, FactTableColumnType> = {};
              sliceLevels.forEach((sl) => {
                datatypes[sl.column] = sl.datatype;
                // Track column for "select all" generation
                columnSet.add(sl.column);
                if (sl.datatype) {
                  columnDatatypeMap.set(sl.column, sl.datatype);
                }
              });
              sliceTagsMap.set(comboTag, { datatypes });
            }
          });
        }
      }
    }
  });

  // Generate "select all" tags for each column (format: dim:column, no equals sign)
  columnSet.forEach((column) => {
    const datatype = columnDatatypeMap.get(column) || "string";
    const selectAllTag = generateSelectAllSliceString(column);
    sliceTagsMap.set(selectAllTag, {
      datatypes: { [column]: datatype },
      isSelectAll: true,
    });
  });

  const sliceTags = Array.from(sliceTagsMap.entries()).map(
    ([id, { datatypes, isSelectAll }]) => ({ id, datatypes, isSelectAll }),
  );

  // Sort slices: group by column(s), put "select all" first, then regular values, then empty values
  return sliceTags.sort((a, b) => {
    // Extract column name from tag
    const getColumnFromTag = (tag: string): string => {
      if (!tag.startsWith("dim:")) return "";
      const withoutDim = tag.substring(4);
      const equalsIndex = withoutDim.indexOf("=");
      return decodeURIComponent(
        withoutDim.slice(0, equalsIndex >= 0 ? equalsIndex : undefined),
      );
    };

    const aColumn = getColumnFromTag(a.id);
    const bColumn = getColumnFromTag(b.id);
    const columnCompare = aColumn.localeCompare(bColumn);
    if (columnCompare !== 0) return columnCompare;

    // Same column: "select all" comes first
    if (a.isSelectAll && !b.isSelectAll) return -1;
    if (!a.isSelectAll && b.isSelectAll) return 1;

    // Both are regular slices, parse normally
    const aLevels = a.isSelectAll
      ? []
      : parseSliceQueryString(a.id, factTableMap);
    const bLevels = b.isSelectAll
      ? []
      : parseSliceQueryString(b.id, factTableMap);

    // For same first column, check if it's a multi-column slice
    if (aLevels.length !== bLevels.length) {
      // Single column slices come before multi-column
      return aLevels.length - bLevels.length;
    }

    // Compare each column level
    for (let i = 0; i < Math.min(aLevels.length, bLevels.length); i++) {
      const aValue = aLevels[i]?.levels[0] || "";
      const bValue = bLevels[i]?.levels[0] || "";
      const aDatatype = aLevels[i]?.datatype;
      const bDatatype = bLevels[i]?.datatype;

      // Empty values go to the end
      if (aValue === "" && bValue !== "") return 1;
      if (aValue !== "" && bValue === "") return -1;

      // Both non-empty or both empty: compare normally
      if (aValue !== bValue) {
        // Special handling for boolean: true comes before false
        if (aDatatype === "boolean" && bDatatype === "boolean") {
          if (aValue === "true" && bValue === "false") return -1;
          if (aValue === "false" && bValue === "true") return 1;
        }
        return aValue.localeCompare(bValue);
      }
    }

    // Fallback to ID comparison
    return a.id.localeCompare(b.id);
  });
}
