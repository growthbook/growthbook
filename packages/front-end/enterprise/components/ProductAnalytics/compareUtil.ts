import { format } from "date-fns";
import type { FactMetricInterface } from "shared/types/fact-table";
import {
  buildComparisonDateRange,
  calculateProductAnalyticsDateRange,
} from "shared/enterprise";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  getEffectiveMetricValue,
  getEffectiveShowAs,
  getIsRatioByIndex,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";

export type BigNumberComparisonTrend = {
  currentValue: number;
  previousValue: number;
  /** Signed fractional change, e.g. -0.12 for −12%. */
  pctChange: number;
};

function formatExplorerDateRangeHeading(dr: {
  startDate: Date;
  endDate: Date;
}): string {
  const s = format(dr.startDate, "MMM d, yyyy");
  const e = format(dr.endDate, "MMM d, yyyy");
  return s === e ? s : `${s} – ${e}`;
}

export function getComparisonPeriodLabels(
  dateRange: ExplorationConfig["dateRange"],
): { currentLabel: string; previousLabel: string } {
  const currentDr = calculateProductAnalyticsDateRange(dateRange);
  const prevDr = calculateProductAnalyticsDateRange(
    buildComparisonDateRange(dateRange),
  );
  return {
    currentLabel: formatExplorerDateRangeHeading(currentDr),
    previousLabel: formatExplorerDateRangeHeading(prevDr),
  };
}

export function formatComparisonMetricLabel(
  name: string,
  periodLabel: string,
): string {
  return `${name} (${periodLabel})`;
}

export function getComparisonStackId(
  isPrevious: boolean,
  isStacked: boolean,
): string | undefined {
  if (!isStacked) return undefined;
  return isPrevious ? "__pa_compare_prev__" : "__pa_compare_curr__";
}

/** Previous-period area series stack together but not onto current `stack`. */
export function getComparisonAreaPreviousStackId(): string {
  return "__pa_compare_area_prev__";
}

export function supportsAlwaysOnComparisonOverlay(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return (
    chartType === "line" ||
    chartType === "area" ||
    chartType === "bar" ||
    chartType === "stackedBar" ||
    chartType === "horizontalBar" ||
    chartType === "stackedHorizontalBar"
  );
}

function compareDateStringsAsc(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

/**
 * Maps comparison-period values onto the chart's x categories.
 *
 * - **Date first dimension:** comparison rows use a shifted calendar (different
 *   `dimensions[0]` strings). Align by **chronological rank** (same strategy as
 *   `useExplorationTableData` row pairing): i-th bucket in the current window
 *   pairs with the i-th bucket in the comparison window.
 * - **Non-date:** keys should match between periods (e.g. country); align by
 *   string equality on the category label.
 */
export function alignComparisonOverlayToCategories(
  sortedXValues: string[],
  comparisonDataMap: Record<string, Record<string, number>>,
  sortedSeriesKeys: string[],
  comparisonXValues: string[],
  firstDimensionIsDate: boolean,
): Record<string, Record<string, number>> {
  const aligned: Record<string, Record<string, number>> = {};

  if (!firstDimensionIsDate) {
    for (const seriesKey of sortedSeriesKeys) {
      const src = comparisonDataMap[seriesKey] ?? {};
      aligned[seriesKey] = {};
      for (const x of sortedXValues) {
        aligned[seriesKey][x] = src[x] ?? 0;
      }
    }
    return aligned;
  }

  const chronoCurrent = [...new Set(sortedXValues)].sort(compareDateStringsAsc);
  const chronoComp = [...new Set(comparisonXValues)].sort(
    compareDateStringsAsc,
  );
  const rankByCurrentX = new Map<string, number>();
  chronoCurrent.forEach((x, i) => {
    rankByCurrentX.set(x, i);
  });

  for (const seriesKey of sortedSeriesKeys) {
    const src = comparisonDataMap[seriesKey] ?? {};
    aligned[seriesKey] = {};
    for (const x of sortedXValues) {
      const rank = rankByCurrentX.get(x);
      const compKey = rank !== undefined ? chronoComp[rank] : undefined;
      aligned[seriesKey][x] = compKey !== undefined ? (src[compKey] ?? 0) : 0;
    }
  }
  return aligned;
}

function metricIdForDatasetValue(
  config: ExplorationConfig,
  metricIndex: number,
): string {
  const values = config.dataset?.values;
  if (!values?.[metricIndex]) return "";
  const v = values[metricIndex];
  return v.type === "metric" ? v.metricId : "";
}

function metricNameForDatasetValue(
  config: ExplorationConfig,
  metricIndex: number,
): string {
  return config.dataset?.values?.[metricIndex]?.name ?? `Metric ${metricIndex}`;
}

/**
 * Maps exploration rows into per-series maps keyed by the primary dimension (x).
 */
export function buildComparisonOverlaySeriesMaps(
  rows: ProductAnalyticsResultRow[],
  config: ExplorationConfig,
  renderOpts: RenderOpts,
): {
  uniqueXValues: Set<string>;
  dataMap: Record<string, Record<string, number>>;
  seriesMeta: Record<string, { metricId: string; name: string }>;
} {
  const uniqueXValues = new Set<string>();
  const dataMap: Record<string, Record<string, number>> = {};
  const seriesMeta: Record<string, { metricId: string; name: string }> = {};

  const numMetrics = config.dataset?.values?.length ?? 0;
  const numDimensions = config.dimensions?.length ?? 0;

  const bump = (seriesKey: string, x: string, y: number) => {
    uniqueXValues.add(x);
    if (!dataMap[seriesKey]) dataMap[seriesKey] = {};
    dataMap[seriesKey][x] = (dataMap[seriesKey][x] ?? 0) + y;
  };

  for (const row of rows) {
    const x = String(row.dimensions[0] ?? "");

    if (numMetrics > 1) {
      for (let mi = 0; mi < numMetrics; mi++) {
        const seriesKey = `__metric_${mi}__`;
        if (!seriesMeta[seriesKey]) {
          seriesMeta[seriesKey] = {
            metricId: metricIdForDatasetValue(config, mi),
            name: metricNameForDatasetValue(config, mi),
          };
        }
        const cell = row.values[mi];
        if (!cell) continue;
        bump(
          seriesKey,
          x,
          getEffectiveMetricValue(cell, {
            showAs: renderOpts.showAs,
            isRatio: renderOpts.isRatioByIndex[mi] ?? false,
          }),
        );
      }
      continue;
    }

    if (numMetrics === 0) continue;

    if (numDimensions > 1) {
      const group = row.dimensions
        .slice(1)
        .map((d) => d ?? "")
        .join(" — ");
      const seriesKey = `__group_${group}__`;
      if (!seriesMeta[seriesKey]) {
        seriesMeta[seriesKey] = {
          metricId: metricIdForDatasetValue(config, 0),
          name: group || metricNameForDatasetValue(config, 0),
        };
      }
      const cell = row.values[0];
      if (!cell) continue;
      bump(
        seriesKey,
        x,
        getEffectiveMetricValue(cell, {
          showAs: renderOpts.showAs,
          isRatio: renderOpts.isRatioByIndex[0] ?? false,
        }),
      );
      continue;
    }

    const seriesKey = "__single__";
    if (!seriesMeta[seriesKey]) {
      seriesMeta[seriesKey] = {
        metricId: metricIdForDatasetValue(config, 0),
        name: metricNameForDatasetValue(config, 0),
      };
    }
    const cell = row.values[0];
    if (!cell) continue;
    bump(
      seriesKey,
      x,
      getEffectiveMetricValue(cell, {
        showAs: renderOpts.showAs,
        isRatio: renderOpts.isRatioByIndex[0] ?? false,
      }),
    );
  }

  return { uniqueXValues, dataMap, seriesMeta };
}

export function computeBigNumberComparisonTrend(
  exploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): BigNumberComparisonTrend | null {
  if (
    !exploration?.result?.rows?.length ||
    !comparisonExploration?.result?.rows?.length
  ) {
    return null;
  }

  const renderOpts: RenderOpts = {
    showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
    isRatioByIndex: getIsRatioByIndex(submittedExploreState, getFactMetricById),
  };

  const currCell = exploration.result.rows[0]?.values[0];
  const prevCell = comparisonExploration.result.rows[0]?.values[0];
  if (!currCell || !prevCell) return null;

  const currentValue = getEffectiveMetricValue(currCell, {
    showAs: renderOpts.showAs,
    isRatio: renderOpts.isRatioByIndex[0] ?? false,
  });
  const previousValue = getEffectiveMetricValue(prevCell, {
    showAs: renderOpts.showAs,
    isRatio: renderOpts.isRatioByIndex[0] ?? false,
  });

  if (previousValue === 0) {
    return { currentValue, previousValue, pctChange: 0 };
  }

  return {
    currentValue,
    previousValue,
    pctChange: (currentValue - previousValue) / Math.abs(previousValue),
  };
}
