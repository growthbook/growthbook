import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  getEffectiveMetricValue,
  getEffectiveShowAs,
  getIsRatioByIndex,
} from "shared/enterprise";
import type { FactMetricInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  formatDateByGranularity,
  type RenderOpts,
  type ResolvedGranularity,
} from "@/enterprise/components/ProductAnalytics/util";

const OVERLAY_SUPPORTED_CHART_TYPES = new Set<ExplorationConfig["chartType"]>([
  "line",
  "bar",
  "stackedBar",
  "horizontalBar",
  "stackedHorizontalBar",
]);

export function supportsComparisonOverlay(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return OVERLAY_SUPPORTED_CHART_TYPES.has(chartType);
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

export type PeriodTotal = {
  metricId: string;
  metricName: string;
  groupKey: string;
  currentTotal: number;
  previousTotal: number;
  delta: number;
  percentChange: string | null;
};

export type BucketComparison = {
  metricId: string;
  metricName: string;
  groupKey: string;
  bucketLabel: string;
  currentTotal: number;
  previousTotal: number;
  delta: number;
  percentChange: string | null;
};

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

function getSortedDateBuckets(rows: ProductAnalyticsResultRow[]): string[] {
  const buckets = new Set<string>();
  for (const row of rows) {
    const bucket = row.dimensions[0];
    if (bucket) {
      buckets.add(bucket);
    }
  }
  return Array.from(buckets).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
}

function getBucketLabel(
  bucket: string,
  granularity: ResolvedGranularity,
): string {
  return formatDateByGranularity(new Date(bucket), granularity);
}

export function computePeriodTotals(
  currentExploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): PeriodTotal[] {
  const currentRows = currentExploration?.result?.rows ?? [];
  const comparisonRows = comparisonExploration?.result?.rows ?? [];
  if (!currentRows.length && !comparisonRows.length) {
    return [];
  }

  const renderOpts = getRenderOpts(submittedExploreState, getFactMetricById);
  const valueCount = submittedExploreState.dataset?.values?.length ?? 0;
  const groupKeys = new Set<string>();

  for (const row of [...currentRows, ...comparisonRows]) {
    groupKeys.add(getGroupKey(row));
  }

  const totals: PeriodTotal[] = [];

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
      const delta = currentTotal - previousTotal;

      totals.push({
        metricId,
        metricName,
        groupKey,
        currentTotal,
        previousTotal,
        delta,
        percentChange: formatPercentChange(delta, previousTotal),
      });
    }
  }

  return totals;
}

export function computeBucketComparisons(
  currentExploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): BucketComparison[] {
  const currentRows = currentExploration?.result?.rows ?? [];
  const comparisonRows = comparisonExploration?.result?.rows ?? [];
  const dateDimension = submittedExploreState.dimensions?.find(
    (dimension) => dimension.dimensionType === "date",
  );
  if (!dateDimension || (!currentRows.length && !comparisonRows.length)) {
    return [];
  }

  const renderOpts = getRenderOpts(submittedExploreState, getFactMetricById);
  const resolvedGranularity = getDateGranularity(
    dateDimension.dateGranularity,
    calculateProductAnalyticsDateRange(submittedExploreState.dateRange),
  );
  const currentBuckets = getSortedDateBuckets(currentRows);
  const comparisonBuckets = getSortedDateBuckets(comparisonRows);
  const aligned = alignSeriesByIndex(
    currentBuckets.map((bucket) => {
      const rows = currentRows.filter((row) => row.dimensions[0] === bucket);
      return rows.reduce((sum, row) => {
        return (
          sum +
          row.values.reduce((rowSum, value, valueIndex) => {
            return (
              rowSum +
              getEffectiveMetricValue(value, {
                showAs: renderOpts.showAs,
                isRatio: renderOpts.isRatioByIndex[valueIndex] ?? false,
              })
            );
          }, 0)
        );
      }, 0);
    }),
    comparisonBuckets.map((bucket) => {
      const rows = comparisonRows.filter((row) => row.dimensions[0] === bucket);
      return rows.reduce((sum, row) => {
        return (
          sum +
          row.values.reduce((rowSum, value, valueIndex) => {
            return (
              rowSum +
              getEffectiveMetricValue(value, {
                showAs: renderOpts.showAs,
                isRatio: renderOpts.isRatioByIndex[valueIndex] ?? false,
              })
            );
          }, 0)
        );
      }, 0);
    }),
  );

  const valueCount = submittedExploreState.dataset?.values?.length ?? 0;
  const comparisons: BucketComparison[] = [];
  const length = Math.max(currentBuckets.length, comparisonBuckets.length);

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
    const groupKeys = new Set<string>();
    for (const row of [...currentRows, ...comparisonRows]) {
      groupKeys.add(getGroupKey(row));
    }

    for (const groupKey of groupKeys) {
      for (let bucketIndex = 0; bucketIndex < length; bucketIndex++) {
        const currentBucket = currentBuckets[bucketIndex];
        const comparisonBucket = comparisonBuckets[bucketIndex];
        const currentTotal = currentBucket
          ? sumMetricValues(
              currentRows.filter(
                (row) =>
                  row.dimensions[0] === currentBucket &&
                  getGroupKey(row) === groupKey,
              ),
              valueIndex,
              renderOpts,
            )
          : 0;
        const previousTotal = comparisonBucket
          ? sumMetricValues(
              comparisonRows.filter(
                (row) =>
                  row.dimensions[0] === comparisonBucket &&
                  getGroupKey(row) === groupKey,
              ),
              valueIndex,
              renderOpts,
            )
          : (aligned.previous[bucketIndex] ?? 0);
        const delta = currentTotal - previousTotal;
        const bucketLabel = currentBucket
          ? getBucketLabel(currentBucket, resolvedGranularity)
          : comparisonBucket
            ? getBucketLabel(comparisonBucket, resolvedGranularity)
            : `Bucket ${bucketIndex + 1}`;

        comparisons.push({
          metricId,
          metricName,
          groupKey,
          bucketLabel,
          currentTotal,
          previousTotal,
          delta,
          percentChange: formatPercentChange(delta, previousTotal),
        });
      }
    }
  }

  return comparisons;
}
