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

// --- Explorer chart: ECharts compare overlay (constants + series builders) ---

/** ECharts `z`: previous period draws under current bars/areas. */
export const COMPARE_OVERLAY_Z_PREVIOUS_UNDER = 1;
/** ECharts `z`: current period sits above overlapped comparison. */
export const COMPARE_OVERLAY_Z_CURRENT_OVER = 2;
/** ECharts `z`: dashed comparison line on top of current line strokes. */
export const COMPARE_OVERLAY_Z_PREVIOUS_LINE_ON_TOP = 3;

export const COMPARE_OVERLAY_AREA_FILL_OPACITY = 0.38;
export const COMPARE_OVERLAY_PREVIOUS_AREA_FILL_OPACITY = 0.42;
export const COMPARE_OVERLAY_BAR_GAP = "-100%";
export const COMPARE_OVERLAY_PREVIOUS_BAR_OPACITY = 0.55;
export const COMPARE_OVERLAY_CURRENT_BAR_WHEN_ABOVE_PREVIOUS_OPACITY = 0.72;
/** When any bucket in the series exceeds previous (no per-segment area opacity in ECharts). */
export const COMPARE_OVERLAY_AREA_FILL_WHEN_SERIES_ABOVE_ANY_BUCKET = 0.28;

const EXPLORER_BAR_CHART_TYPES: ExplorationConfig["chartType"][] = [
  "bar",
  "stackedBar",
  "stackedHorizontalBar",
  "horizontalBar",
];

function isExplorerBarChartType(
  chartType: ExplorationConfig["chartType"],
): boolean {
  return (EXPLORER_BAR_CHART_TYPES as readonly string[]).includes(chartType);
}

/**
 * Aligns comparison-period rows to the explorer’s current `sortedXValues` / series keys.
 * Returns `null` when there are no comparison rows.
 */
export function buildAlignedComparisonOverlayForExplorer(args: {
  sortedXValues: string[];
  comparisonRows: ProductAnalyticsResultRow[];
  submittedExploreState: ExplorationConfig;
  renderOpts: RenderOpts;
  sortedSeriesKeys: string[];
  firstDimensionIsDate: boolean;
}): Record<string, Record<string, number>> | null {
  if (!args.comparisonRows.length) return null;
  const { uniqueXValues, dataMap } = buildComparisonOverlaySeriesMaps(
    args.comparisonRows,
    args.submittedExploreState,
    args.renderOpts,
  );
  return alignComparisonOverlayToCategories(
    args.sortedXValues,
    dataMap,
    args.sortedSeriesKeys,
    Array.from(uniqueXValues),
    args.firstDimensionIsDate,
  );
}

export type ExplorerChartCompareSeriesMeta = {
  metricId: string;
  name: string;
};

/**
 * Builds ECharts `series` entries for the explorer chart (current and/or previous period),
 * including compare-overlap styling for bar and area charts.
 */
export function buildExplorerChartComparisonSeriesList(params: {
  chartType: ExplorationConfig["chartType"];
  sourceDataMap: Record<string, Record<string, number>>;
  sourceSeriesMeta: Record<string, ExplorerChartCompareSeriesMeta>;
  sourceSeriesKeys: string[];
  sourceSortedXValues: string[];
  numMetrics: number;
  numDimensions: number;
  isStacked: boolean;
  compareOverlayActive: boolean;
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  } | null;
  previousAlignedMap?: Record<string, Record<string, number>> | null;
  previous?: boolean;
  seriesColor: (index: number) => string;
  comparisonSeriesColor: (index: number) => string;
  animate: boolean;
}): unknown[] {
  const {
    chartType,
    sourceDataMap,
    sourceSeriesMeta,
    sourceSeriesKeys,
    sourceSortedXValues,
    numMetrics,
    numDimensions,
    isStacked,
    compareOverlayActive,
    comparisonPeriodLabels,
    seriesColor,
    comparisonSeriesColor,
    animate,
  } = params;
  const isPrevious = params.previous ?? false;
  const previousAlignedMap = params.previousAlignedMap ?? null;

  return sourceSeriesKeys
    .map((seriesKey, idx) => {
      const { name } = sourceSeriesMeta[seriesKey];
      const seriesDataMap = sourceDataMap[seriesKey];
      const displayName = comparisonPeriodLabels
        ? formatComparisonMetricLabel(
            name,
            isPrevious
              ? comparisonPeriodLabels.previousLabel
              : comparisonPeriodLabels.currentLabel,
          )
        : name;
      const color = isPrevious ? comparisonSeriesColor(idx) : seriesColor(idx);

      if (isPrevious && chartType === "line") {
        const data = sourceSortedXValues.map((x) => [
          new Date(x).getTime(),
          seriesDataMap[x] ?? 0,
        ]);

        return {
          name: displayName,
          data,
          color,
          type: "line" as const,
          animation: animate,
          animationDuration: animate ? 300 : 0,
          animationEasing: "linear" as const,
          showSymbol: false,
          symbol: "circle" as const,
          symbolSize: 4,
          lineStyle: { type: "dashed" as const, width: 2, opacity: 0.75 },
          z: COMPARE_OVERLAY_Z_PREVIOUS_LINE_ON_TOP,
        };
      }

      if (isExplorerBarChartType(chartType)) {
        if (
          numMetrics === 1 &&
          numDimensions === 1 &&
          !isPrevious &&
          !compareOverlayActive
        ) {
          const data = sourceSortedXValues.map((x, i) => ({
            value: seriesDataMap[x] ?? 0,
            itemStyle: { color: seriesColor(i) },
          }));
          return { name: displayName, data, type: "bar" as const };
        }

        const prevForSeries = previousAlignedMap?.[seriesKey];
        const data =
          compareOverlayActive && !isPrevious && prevForSeries
            ? sourceSortedXValues.map((x) => {
                const curr = seriesDataMap[x] ?? 0;
                const prev = prevForSeries[x] ?? 0;
                return curr > prev
                  ? {
                      value: curr,
                      itemStyle: {
                        opacity:
                          COMPARE_OVERLAY_CURRENT_BAR_WHEN_ABOVE_PREVIOUS_OPACITY,
                      },
                    }
                  : curr;
              })
            : sourceSortedXValues.map((x) => seriesDataMap[x] ?? 0);
        if (compareOverlayActive) {
          return {
            name: displayName,
            data,
            color,
            type: "bar" as const,
            stack: getComparisonStackId(isPrevious, isStacked),
            // Overlap only for non-stacked bars (single pair per category slot).
            // Stacked current vs previous use separate stack ids; -100% barGap
            // would collapse the two stacks onto the same slot.
            ...(!isStacked ? { barGap: COMPARE_OVERLAY_BAR_GAP } : {}),
            z: isPrevious
              ? COMPARE_OVERLAY_Z_PREVIOUS_UNDER
              : COMPARE_OVERLAY_Z_CURRENT_OVER,
            ...(isPrevious
              ? { itemStyle: { opacity: COMPARE_OVERLAY_PREVIOUS_BAR_OPACITY } }
              : {}),
          };
        }
        return {
          name: displayName,
          data,
          color,
          type: "bar" as const,
          stack: getComparisonStackId(isPrevious, isStacked),
        };
      }

      if (chartType === "line" || chartType === "area") {
        const data = sourceSortedXValues.map((x) => [
          new Date(x).getTime(),
          seriesDataMap[x] ?? 0,
        ]);
        let anyCurrentAbovePrev = false;
        if (chartType === "area" && !isPrevious && compareOverlayActive) {
          const prevMap = previousAlignedMap?.[seriesKey];
          if (prevMap) {
            anyCurrentAbovePrev = sourceSortedXValues.some(
              (x) => (seriesDataMap[x] ?? 0) > (prevMap[x] ?? 0),
            );
          }
        }

        if (chartType === "area" && isPrevious && compareOverlayActive) {
          return {
            name: displayName,
            data,
            color,
            type: "line" as const,
            animation: animate,
            animationDuration: animate ? 300 : 0,
            animationEasing: "linear" as const,
            showSymbol: false,
            symbol: "circle" as const,
            symbolSize: 4,
            lineStyle: { width: 1, opacity: 0.65 },
            areaStyle: {
              opacity: COMPARE_OVERLAY_PREVIOUS_AREA_FILL_OPACITY,
              color,
            },
            stack: getComparisonAreaPreviousStackId(),
            z: COMPARE_OVERLAY_Z_PREVIOUS_UNDER,
          };
        }

        const lineConfig = {
          name: displayName,
          data,
          color,
          type: "line" as const,
          animation: animate,
          animationDuration: animate ? 300 : 0,
          animationEasing: "linear" as const,
          symbol: "circle" as const,
          symbolSize: 4,
          ...(compareOverlayActive
            ? { z: COMPARE_OVERLAY_Z_CURRENT_OVER }
            : {}),
        };
        if (chartType === "line") return lineConfig;
        if (chartType === "area")
          return {
            ...lineConfig,
            areaStyle: compareOverlayActive
              ? {
                  opacity: anyCurrentAbovePrev
                    ? COMPARE_OVERLAY_AREA_FILL_WHEN_SERIES_ABOVE_ANY_BUCKET
                    : COMPARE_OVERLAY_AREA_FILL_OPACITY,
                }
              : {},
            stack: "stack",
          };
      }

      return undefined;
    })
    .filter((series) => series !== undefined);
}

/** One category slot per (primary dimension value × series/attribute). */
export type IndividualBarComparePivotSlot = {
  x: string;
  seriesKey: string;
  attributeName: string;
  seriesKeyIndex: number;
};

/**
 * For non-stacked bar charts with compare, builds one axis category per attribute
 * slot and exactly two bar series (current vs previous) so `barGap: -100%` overlays
 * periods without ECharts mis-pairing multiple series.
 */
export function buildIndividualBarComparePivotSeriesAndCategories(args: {
  sortedXValues: string[];
  sortedSeriesKeys: string[];
  dataMap: Record<string, Record<string, number>>;
  previousAlignedMap: Record<string, Record<string, number>>;
  sourceSeriesMeta: Record<string, ExplorerChartCompareSeriesMeta>;
  comparisonPeriodLabels: { currentLabel: string; previousLabel: string };
  seriesColor: (index: number) => string;
  comparisonSeriesColor: (index: number) => string;
  animate: boolean;
}): {
  categoryAxisData: string[];
  slots: IndividualBarComparePivotSlot[];
  series: unknown[];
} | null {
  const {
    sortedXValues,
    sortedSeriesKeys,
    dataMap,
    previousAlignedMap,
    sourceSeriesMeta,
    comparisonPeriodLabels,
    seriesColor,
    comparisonSeriesColor,
    animate,
  } = args;

  if (!sortedSeriesKeys.length) return null;

  const slots: IndividualBarComparePivotSlot[] = [];
  for (const x of sortedXValues) {
    sortedSeriesKeys.forEach((seriesKey, seriesKeyIndex) => {
      slots.push({
        x,
        seriesKey,
        attributeName: sourceSeriesMeta[seriesKey]?.name ?? seriesKey,
        seriesKeyIndex,
      });
    });
  }

  const categoryAxisData = slots.map((s) => `${s.x}\n${s.attributeName}`);

  const currentData = slots.map((slot) => {
    const curr = dataMap[slot.seriesKey]?.[slot.x] ?? 0;
    const prev = previousAlignedMap[slot.seriesKey]?.[slot.x] ?? 0;
    const color = seriesColor(slot.seriesKeyIndex);
    if (curr > prev) {
      return {
        value: curr,
        itemStyle: {
          color,
          opacity: COMPARE_OVERLAY_CURRENT_BAR_WHEN_ABOVE_PREVIOUS_OPACITY,
        },
      };
    }
    return {
      value: curr,
      itemStyle: { color },
    };
  });

  const previousData = slots.map((slot) => ({
    value: previousAlignedMap[slot.seriesKey]?.[slot.x] ?? 0,
    itemStyle: {
      color: comparisonSeriesColor(slot.seriesKeyIndex),
      opacity: COMPARE_OVERLAY_PREVIOUS_BAR_OPACITY,
    },
  }));

  const series = [
    {
      name: comparisonPeriodLabels.currentLabel,
      type: "bar" as const,
      data: currentData,
      barGap: COMPARE_OVERLAY_BAR_GAP,
      z: COMPARE_OVERLAY_Z_CURRENT_OVER,
      animation: animate,
      animationDuration: animate ? 300 : 0,
      animationEasing: "cubicOut" as const,
    },
    {
      name: comparisonPeriodLabels.previousLabel,
      type: "bar" as const,
      data: previousData,
      barGap: COMPARE_OVERLAY_BAR_GAP,
      z: COMPARE_OVERLAY_Z_PREVIOUS_UNDER,
      animation: animate,
      animationDuration: animate ? 300 : 0,
      animationEasing: "cubicOut" as const,
    },
  ];

  return { categoryAxisData, slots, series };
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
