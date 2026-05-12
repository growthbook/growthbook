import {
  calculateComparisonDateRange,
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  getEffectiveMetricValue,
  getEffectiveShowAs,
  getIsRatioByIndex,
  type ExplorationColumn,
} from "shared/enterprise";
import type { FactMetricInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  getExplorationCellValue,
  type RenderOpts,
  type ResolvedGranularity,
} from "@/enterprise/components/ProductAnalytics/util";

const ALWAYS_ON_OVERLAY_CHART_TYPES = new Set<ExplorationConfig["chartType"]>([
  "line",
  "area",
  "bar",
  "stackedBar",
  "horizontalBar",
  "stackedHorizontalBar",
]);

const INLINE_COMPARISON_CHART_TYPES = new Set<ExplorationConfig["chartType"]>([
  "table",
  "timeseries-table",
  "bigNumber",
]);

const CATEGORICAL_OVERLAY_CHART_TYPES = new Set<ExplorationConfig["chartType"]>(
  ["bar", "stackedBar", "horizontalBar", "stackedHorizontalBar"],
);

export type ComparisonTrendDirection = "up" | "down" | "flat" | "none";

export type ComparisonTrend = {
  current: number;
  previous: number;
  delta: number;
  percentChange: string | null;
  direction: ComparisonTrendDirection;
};

export type PeriodSummary = {
  metricId: string;
  metricName: string;
  groupKey: string;
  totalTrend: ComparisonTrend;
  averageTrend?: ComparisonTrend;
  averageLabel?: ResolvedGranularity;
};

export function supportsAlwaysOnComparisonOverlay(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return ALWAYS_ON_OVERLAY_CHART_TYPES.has(chartType);
}

export function showsCompactComparisonSummary(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return !INLINE_COMPARISON_CHART_TYPES.has(chartType);
}

export function usesInlineComparison(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return INLINE_COMPARISON_CHART_TYPES.has(chartType);
}

export function showsComparisonOverview(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return chartType !== "bigNumber";
}

function formatShortUtcDate(date: Date, includeYear: boolean): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function formatShortInclusiveUtcDateRange(
  startDate: Date,
  endDate: Date,
  referenceDate: Date = new Date(),
): string {
  const startYear = startDate.getUTCFullYear();
  const endYear = endDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const endMonth = endDate.getUTCMonth();
  const referenceYear = referenceDate.getUTCFullYear();
  const includeYear =
    startYear !== endYear ||
    startYear !== referenceYear ||
    endYear !== referenceYear;
  const startDay = startDate.getUTCDate();
  const endDay = endDate.getUTCDate();

  if (startYear === endYear && startMonth === endMonth) {
    const month = startDate.toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    if (startDay === endDay) {
      return includeYear
        ? formatShortUtcDate(startDate, true)
        : `${month} ${startDay}`;
    }
    return includeYear
      ? `${month} ${startDay}–${endDay}, ${startYear}`
      : `${month} ${startDay}–${endDay}`;
  }

  if (startYear === endYear && !includeYear) {
    return `${formatShortUtcDate(startDate, false)}–${formatShortUtcDate(endDate, false)}`;
  }

  return `${formatShortUtcDate(startDate, true)}–${formatShortUtcDate(endDate, true)}`;
}

export function formatComparisonMetricLabel(
  metricName: string,
  periodLabel: string,
): string {
  return `${metricName} (${periodLabel})`;
}

export function getComparisonPeriodLabels(
  dateRange: ExplorationConfig["dateRange"],
  referenceDate: Date = new Date(),
): { currentLabel: string; previousLabel: string } {
  const currentRange = calculateProductAnalyticsDateRange(
    dateRange,
    referenceDate,
  );
  const previousRange = calculateComparisonDateRange(dateRange, referenceDate);
  const previousInclusiveEnd = new Date(currentRange.startDate);
  previousInclusiveEnd.setUTCHours(0, 0, 0, 0);
  previousInclusiveEnd.setUTCMilliseconds(
    previousInclusiveEnd.getUTCMilliseconds() - 1,
  );

  return {
    currentLabel: formatShortInclusiveUtcDateRange(
      currentRange.startDate,
      currentRange.endDate,
      referenceDate,
    ),
    previousLabel: formatShortInclusiveUtcDateRange(
      previousRange.startDate,
      previousInclusiveEnd,
      referenceDate,
    ),
  };
}

export function formatPercentChange(
  delta: number,
  previous: number,
): string | null {
  if (previous === 0) {
    return null;
  }
  const percentChange = (delta / previous) * 100;
  const rounded =
    Math.abs(percentChange) >= 100
      ? Math.round(percentChange)
      : Math.round(percentChange * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function buildComparisonTrend(
  current: number,
  previous: number | null | undefined,
): ComparisonTrend {
  if (previous === null || previous === undefined || previous === 0) {
    return {
      current,
      previous: previous ?? 0,
      delta: current - (previous ?? 0),
      percentChange: null,
      direction: "none",
    };
  }

  const delta = current - previous;
  let direction: ComparisonTrendDirection = "flat";
  if (delta > 0) direction = "up";
  if (delta < 0) direction = "down";

  return {
    current,
    previous,
    delta,
    percentChange: formatPercentChange(delta, previous),
    direction,
  };
}

export function alignComparisonOverlayToCategories(
  chartType: ExplorationConfig["chartType"],
  sortedXValues: string[],
  comparisonDataMap: Record<string, Record<string, number>>,
  seriesKeys: string[],
  comparisonCategoryLabels: string[],
): Record<string, Record<string, number>> {
  const alignedComparisonDataMap: Record<string, Record<string, number>> = {};

  for (const seriesKey of seriesKeys) {
    alignedComparisonDataMap[seriesKey] = {};

    if (CATEGORICAL_OVERLAY_CHART_TYPES.has(chartType)) {
      for (const currentXValue of sortedXValues) {
        alignedComparisonDataMap[seriesKey][currentXValue] =
          comparisonDataMap[seriesKey]?.[currentXValue] ?? 0;
      }
      continue;
    }

    const comparisonSortedXValues = [...comparisonCategoryLabels].sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );
    const alignedComparisonXValues = sortedXValues.map(
      (_, index) => comparisonSortedXValues[index] ?? "",
    );

    alignedComparisonXValues.forEach((comparisonXValue, index) => {
      const currentXValue = sortedXValues[index];
      if (!currentXValue) return;
      alignedComparisonDataMap[seriesKey][currentXValue] = comparisonXValue
        ? (comparisonDataMap[seriesKey]?.[comparisonXValue] ?? 0)
        : 0;
    });
  }

  return alignedComparisonDataMap;
}

export function alignSeriesByIndex(
  currentBuckets: number[],
  comparisonBuckets: number[],
): { current: number[]; previous: number[] } {
  const length = Math.max(currentBuckets.length, comparisonBuckets.length);
  const current: number[] = [];
  const previous: number[] = [];

  for (let i = 0; i < length; i++) {
    current.push(currentBuckets[i] ?? 0);
    previous.push(comparisonBuckets[i] ?? 0);
  }

  return { current, previous };
}

function getRenderOpts(
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): RenderOpts {
  return {
    showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
    isRatioByIndex: getIsRatioByIndex(submittedExploreState, getFactMetricById),
  };
}

function getMetricName(
  submittedExploreState: ExplorationConfig,
  valueIndex: number,
  metricId: string,
): string {
  return submittedExploreState.dataset?.values?.[valueIndex]?.name ?? metricId;
}

function getGroupKey(row: ProductAnalyticsResultRow): string {
  return row.dimensions.slice(1).join(" - ");
}

function sumMetricValues(
  rows: ProductAnalyticsResultRow[],
  valueIndex: number,
  renderOpts: RenderOpts,
): number {
  return rows.reduce((sum, row) => {
    const value = row.values[valueIndex];
    if (!value) return sum;
    return (
      sum +
      getEffectiveMetricValue(value, {
        showAs: renderOpts.showAs,
        isRatio: renderOpts.isRatioByIndex[valueIndex] ?? false,
      })
    );
  }, 0);
}

function countDateBuckets(rows: ProductAnalyticsResultRow[]): number {
  const buckets = new Set<string>();
  for (const row of rows) {
    const bucket = row.dimensions[0];
    if (bucket) {
      buckets.add(bucket);
    }
  }
  return buckets.size;
}

export function findComparisonRow(
  currentRow: ProductAnalyticsResultRow,
  comparisonRows: ProductAnalyticsResultRow[],
  rowIndex: number,
  isTimeseries: boolean,
): ProductAnalyticsResultRow | null {
  if (isTimeseries) {
    return comparisonRows[rowIndex] ?? null;
  }

  const dimensionKey = currentRow.dimensions.join("||");
  return (
    comparisonRows.find((row) => row.dimensions.join("||") === dimensionKey) ??
    null
  );
}

export function getComparisonMetricValue(
  comparisonRow: ProductAnalyticsResultRow | null,
  column: ExplorationColumn,
  renderOpts: RenderOpts,
): number | null {
  if (!comparisonRow || column.kind !== "metric") {
    return null;
  }

  const raw = getExplorationCellValue(comparisonRow, column, renderOpts);
  if (raw === null || raw === "") {
    return null;
  }
  return typeof raw === "number" ? raw : Number(raw);
}

export function computePeriodSummary(
  currentExploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): PeriodSummary[] {
  const currentRows = currentExploration?.result?.rows ?? [];
  const comparisonRows = comparisonExploration?.result?.rows ?? [];
  if (!currentRows.length && !comparisonRows.length) {
    return [];
  }

  const renderOpts = getRenderOpts(submittedExploreState, getFactMetricById);
  const valueCount = submittedExploreState.dataset?.values?.length ?? 0;
  const dateDimension = submittedExploreState.dimensions?.find(
    (dimension) => dimension.dimensionType === "date",
  );
  const resolvedGranularity = dateDimension
    ? getDateGranularity(
        dateDimension.dateGranularity,
        calculateProductAnalyticsDateRange(submittedExploreState.dateRange),
      )
    : null;
  const groupKeys = new Set<string>();

  for (const row of [...currentRows, ...comparisonRows]) {
    groupKeys.add(getGroupKey(row));
  }

  const summaries: PeriodSummary[] = [];

  for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) {
    const datasetValue = submittedExploreState.dataset?.values?.[valueIndex];
    const metricId =
      datasetValue?.type === "metric"
        ? datasetValue.metricId
        : `value-${valueIndex}`;
    const metricName = getMetricName(
      submittedExploreState,
      valueIndex,
      metricId,
    );

    for (const groupKey of groupKeys) {
      const currentGroupRows = currentRows.filter(
        (row) => getGroupKey(row) === groupKey,
      );
      const comparisonGroupRows = comparisonRows.filter(
        (row) => getGroupKey(row) === groupKey,
      );
      const currentTotal = sumMetricValues(
        currentGroupRows,
        valueIndex,
        renderOpts,
      );
      const previousTotal = sumMetricValues(
        comparisonGroupRows,
        valueIndex,
        renderOpts,
      );
      const totalTrend = buildComparisonTrend(currentTotal, previousTotal);

      const summary: PeriodSummary = {
        metricId,
        metricName,
        groupKey,
        totalTrend,
      };

      if (dateDimension && resolvedGranularity) {
        const currentBucketCount = countDateBuckets(currentGroupRows);
        const previousBucketCount = countDateBuckets(comparisonGroupRows);
        if (currentBucketCount > 0 && previousBucketCount > 0) {
          const currentAverage = currentTotal / currentBucketCount;
          const previousAverage = previousTotal / previousBucketCount;
          summary.averageTrend = buildComparisonTrend(
            currentAverage,
            previousAverage,
          );
          summary.averageLabel = resolvedGranularity;
        }
      }

      summaries.push(summary);
    }
  }

  return summaries;
}

export function computeBigNumberComparisonTrend(
  currentExploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ComparisonTrend | null {
  const currentRow = currentExploration?.result?.rows?.[0];
  const comparisonRow = comparisonExploration?.result?.rows?.[0];
  if (!currentRow) {
    return null;
  }

  const renderOpts = getRenderOpts(submittedExploreState, getFactMetricById);
  const currentValue = getEffectiveMetricValue(currentRow.values[0], {
    showAs: renderOpts.showAs,
    isRatio: renderOpts.isRatioByIndex[0] ?? false,
  });
  const previousValue = comparisonRow
    ? getEffectiveMetricValue(comparisonRow.values[0], {
        showAs: renderOpts.showAs,
        isRatio: renderOpts.isRatioByIndex[0] ?? false,
      })
    : null;

  return buildComparisonTrend(currentValue, previousValue);
}
