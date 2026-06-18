import { formatInTimeZone } from "date-fns-tz";
import type { FactMetricInterface } from "shared/types/fact-table";
import {
  buildComparisonDateRange,
  calculateProductAnalyticsDateRange,
  createComparisonAlignmentResolver,
} from "shared/enterprise";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  formatDateByGranularity,
  getEffectiveMetricValue,
  getEffectiveShowAs,
  getIsRatioByIndex,
  type RenderOpts,
  type ResolvedGranularity,
} from "@/enterprise/components/ProductAnalytics/util";

type BigNumberComparisonTrend = {
  currentValue: number;
  previousValue: number;
  /** Signed fractional change, e.g. -0.12 for −12%. */
  pctChange: number;
};

export function formatExplorerDateRangeHeading(dr: {
  startDate: Date;
  endDate: Date;
}): string {
  const pattern = "MMM d, yyyy";
  const s = formatInTimeZone(dr.startDate, "UTC", pattern);
  const e = formatInTimeZone(dr.endDate, "UTC", pattern);
  return s === e ? s : `${s} – ${e}`;
}

export function getComparisonPeriodLabels(
  dateRange: ExplorationConfig["dateRange"],
  explicitPreviousDateRange?: ExplorationConfig["dateRange"],
): { currentLabel: string; previousLabel: string } {
  const currentDr = calculateProductAnalyticsDateRange(dateRange);
  const prevDr = calculateProductAnalyticsDateRange(
    explicitPreviousDateRange ?? buildComparisonDateRange(dateRange),
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

type ComparisonTooltipSeriesPeriod = "current" | "previous" | "neutral";

/**
 * Splits a compare-overlay series name into metric/series base and period
 * (same rules as tooltip row ordering).
 */
export function parseComparisonTooltipSeriesName(
  seriesName: string,
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  } | null,
): { baseName: string; period: ComparisonTooltipSeriesPeriod } {
  if (!comparisonPeriodLabels) {
    return { baseName: seriesName, period: "neutral" };
  }
  const { currentLabel, previousLabel } = comparisonPeriodLabels;
  const currentSuffix = ` (${currentLabel})`;
  const previousSuffix = ` (${previousLabel})`;
  if (seriesName === currentLabel) {
    return { baseName: "", period: "current" };
  }
  if (seriesName === previousLabel) {
    return { baseName: "", period: "previous" };
  }
  if (seriesName.endsWith(currentSuffix)) {
    return {
      baseName: seriesName.slice(0, -currentSuffix.length),
      period: "current",
    };
  }
  if (seriesName.endsWith(previousSuffix)) {
    return {
      baseName: seriesName.slice(0, -previousSuffix.length),
      period: "previous",
    };
  }
  return { baseName: seriesName, period: "neutral" };
}

function comparisonTooltipPeriodOrder(
  period: ComparisonTooltipSeriesPeriod,
): number {
  return period === "previous" ? 1 : 0;
}

/**
 * Orders axis-tooltip rows: alphabetically by metric/series label, and for
 * period-compare charts keeps current vs previous for the same metric adjacent
 * (current first, then previous).
 */
export function sortProductAnalyticsTooltipAxisItems<
  T extends { seriesName: string },
>(
  items: T[],
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  } | null,
): T[] {
  if (items.length <= 1) return [...items];
  if (!comparisonPeriodLabels) {
    return [...items].sort((a, b) =>
      a.seriesName.localeCompare(b.seriesName, undefined, {
        sensitivity: "base",
      }),
    );
  }
  return [...items].sort((a, b) => {
    const ka = parseComparisonTooltipSeriesName(
      a.seriesName,
      comparisonPeriodLabels,
    );
    const kb = parseComparisonTooltipSeriesName(
      b.seriesName,
      comparisonPeriodLabels,
    );
    const cmp = ka.baseName.localeCompare(kb.baseName, undefined, {
      sensitivity: "base",
    });
    if (cmp !== 0) return cmp;
    return (
      comparisonTooltipPeriodOrder(ka.period) -
      comparisonTooltipPeriodOrder(kb.period)
    );
  });
}

function getComparisonStackId(
  isPrevious: boolean,
  isStacked: boolean,
): string | undefined {
  if (!isStacked) return undefined;
  return isPrevious ? "__pa_compare_prev__" : "__pa_compare_curr__";
}

/** Previous-period area series stack together but not onto current `stack`. */
function getComparisonAreaPreviousStackId(): string {
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

/**
 * Returns the comparison period’s primary-dimension key aligned to a current
 * bucket (same rules as {@link alignComparisonOverlayToCategories}).
 */
export function getAlignedComparisonDimensionKeyForTooltip(
  sortedXValues: string[],
  comparisonXValues: readonly string[],
  currentKey: string,
  firstDimensionIsDate: boolean,
): string | undefined {
  return createComparisonAlignmentResolver(
    sortedXValues,
    comparisonXValues,
    firstDimensionIsDate,
  )(currentKey);
}

/**
 * Maps comparison-period values onto the chart's x categories.
 *
 * - **Date first dimension:** comparison rows use a shifted calendar (different
 *   `dimensions[0]` strings). Prefer **calendar year-over-year** when the
 *   comparison series has a bucket for `currentDate − 1 year` (handles sparse /
 *   unequal bucket counts). Otherwise fall back to **chronological rank** (same
 *   idea as {@link buildAlignedComparisonRowLookup} / table compare): i-th bucket
 *   window pairs with the i-th bucket in the comparison window.
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
  const resolveComparisonKey = createComparisonAlignmentResolver(
    sortedXValues,
    comparisonXValues,
    firstDimensionIsDate,
  );

  for (const seriesKey of sortedSeriesKeys) {
    const src = comparisonDataMap[seriesKey] ?? {};
    aligned[seriesKey] = {};
    for (const x of sortedXValues) {
      const compKey = resolveComparisonKey(x);
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
const COMPARE_OVERLAY_Z_PREVIOUS_UNDER = 1;
/** ECharts `z`: current period sits above overlapped comparison. */
const COMPARE_OVERLAY_Z_CURRENT_OVER = 2;
/** ECharts `z`: dashed comparison line on top of current line strokes. */
const COMPARE_OVERLAY_Z_PREVIOUS_LINE_ON_TOP = 3;

const COMPARE_OVERLAY_BAR_GAP = "-100%";
/**
 * Compare-mode bar widths (see `currentBarWidth` / `previousBarWidth`). The
 * current bar uses a responsive percentage so it scales with the available width,
 * and the previous bar is sized in px as `current + 2 * frame` (computed from the
 * measured chart), so it frames the current bar by a fixed number of pixels per
 * side at any category count — a percentage would scale the frame with the bar.
 * Centering a wider bar behind a narrower one isn't possible on a single ECharts
 * category axis (unequal widths render side-by-side), so the current and previous
 * series are placed on two overlaid category axes that each center their own bars
 * — see the axis wiring in ExplorerChart.
 */
/** Base opacity for the previous-period bar (kept soft, behind current). */
const COMPARE_OVERLAY_PREVIOUS_BAR_BASE_OPACITY = 0.48;
/** Current bar dims to this on hover so the previous bar shows through behind it. */
const COMPARE_OVERLAY_CURRENT_BAR_HOVER_OPACITY = 0.8;
/** Border width of the previous-period bar's outline-only hover state. */
const COMPARE_OVERLAY_BAR_HOVER_BORDER_WIDTH = 2;
const COMPARE_OVERLAY_AREA_HOVER_OPACITY = 0.38;
const COMPARE_OVERLAY_PREVIOUS_AREA_HOVER_OPACITY = 0.42;

/**
 * ECharts axis-index key for the category axis (the axis bars are distributed
 * along). Compare mode overlays the previous period on a second category axis of
 * the same orientation so it can be a different width yet stay centered.
 */
export type CompareCategoryAxisKey = "xAxisIndex" | "yAxisIndex";
/** The previous period draws on the second (overlaid, hidden) category axis. */
const COMPARE_PREVIOUS_AXIS_INDEX = 1;

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
}): {
  alignedMap: Record<string, Record<string, number>>;
  comparisonXValues: string[];
} | null {
  if (!args.comparisonRows.length) return null;
  const { uniqueXValues, dataMap } = buildComparisonOverlaySeriesMaps(
    args.comparisonRows,
    args.submittedExploreState,
    args.renderOpts,
  );
  const comparisonXValues = Array.from(uniqueXValues);
  const alignedMap = alignComparisonOverlayToCategories(
    args.sortedXValues,
    dataMap,
    args.sortedSeriesKeys,
    comparisonXValues,
    args.firstDimensionIsDate,
  );
  return { alignedMap, comparisonXValues };
}

type ExplorerChartCompareSeriesMeta = {
  metricId: string;
  name: string;
};

/**
 * Compare mode for non-stacked bar / horizontalBar with multiple metrics (or grouped
 * series keys): flatten the category axis to one tick per (primary × seriesKey) and
 * emit `2 * K` sparse bar series so only current + previous render at each tick — avoids
 * global `barGap: '-100%'` collapsing every metric into one column while preserving
 * one legend entry per period per metric.
 */
export function buildExplorerCompareSparseFlatBarSeries(args: {
  sourceSortedXValues: string[];
  sourceSeriesKeys: string[];
  sourceSeriesMeta: Record<string, ExplorerChartCompareSeriesMeta>;
  currentDataMap: Record<string, Record<string, number>>;
  previousDataMap: Record<string, Record<string, number>>;
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  };
  seriesColor: (index: number) => string;
  comparisonSeriesColor: (index: number) => string;
  animate: boolean;
  /** Category-axis key; the previous period is placed on its overlaid sibling. */
  compareCategoryAxisKey: CompareCategoryAxisKey;
  /** Current bar width — a responsive percentage string (e.g. "58%"). */
  currentBarWidth: number | string;
  /** Previous bar width — px (= current + a fixed per-side frame) once measured. */
  previousBarWidth: number | string;
}): { flatCategoryData: string[]; series: unknown[] } {
  const {
    sourceSortedXValues,
    sourceSeriesKeys,
    sourceSeriesMeta,
    currentDataMap,
    previousDataMap,
    comparisonPeriodLabels,
    seriesColor,
    comparisonSeriesColor,
    animate,
    compareCategoryAxisKey,
    currentBarWidth,
    previousBarWidth,
  } = args;

  const K = sourceSeriesKeys.length;
  const X = sourceSortedXValues.length;
  if (K === 0) {
    return { flatCategoryData: [], series: [] };
  }
  const flatLen = X * K;

  const flatCategoryData: string[] = [];
  for (const x of sourceSortedXValues) {
    for (let ki = 0; ki < K; ki++) {
      const sk = sourceSeriesKeys[ki]!;
      const { name } = sourceSeriesMeta[sk] ?? { name: sk };
      flatCategoryData.push(`${x} — ${name}`);
    }
  }

  const barAnim = {
    animation: animate,
    animationDuration: animate ? 300 : 0,
    animationEasing: "linear" as const,
  };

  const series: unknown[] = [];

  for (let ki = 0; ki < K; ki++) {
    const sk = sourceSeriesKeys[ki]!;
    const { name } = sourceSeriesMeta[sk] ?? { name: sk };
    const currName = formatComparisonMetricLabel(
      name,
      comparisonPeriodLabels.currentLabel,
    );
    const prevName = formatComparisonMetricLabel(
      name,
      comparisonPeriodLabels.previousLabel,
    );

    const currData: (number | null)[] = [];
    const prevData: (number | null)[] = [];

    for (let j = 0; j < flatLen; j++) {
      const xi = Math.floor(j / K);
      const slotKi = j % K;
      const x = sourceSortedXValues[xi]!;
      if (slotKi === ki) {
        currData.push(currentDataMap[sk]?.[x] ?? 0);
        prevData.push(previousDataMap[sk]?.[x] ?? 0);
      } else {
        currData.push(null);
        prevData.push(null);
      }
    }

    // Current period: narrower, drawn on top. On hover it dims so the wider
    // previous bar behind it shows through.
    series.push({
      name: currName,
      type: "bar" as const,
      data: currData,
      color: seriesColor(ki),
      barWidth: currentBarWidth,
      barGap: COMPARE_OVERLAY_BAR_GAP,
      z: COMPARE_OVERLAY_Z_CURRENT_OVER,
      emphasis: {
        itemStyle: { opacity: COMPARE_OVERLAY_CURRENT_BAR_HOVER_OPACITY },
      },
      ...barAnim,
    });

    // Previous period: wider and centered behind the current bar (via the
    // overlaid category axis), so it frames it. On hover it becomes outline-only.
    series.push({
      name: prevName,
      type: "bar" as const,
      data: prevData,
      color: comparisonSeriesColor(ki),
      [compareCategoryAxisKey]: COMPARE_PREVIOUS_AXIS_INDEX,
      itemStyle: { opacity: COMPARE_OVERLAY_PREVIOUS_BAR_BASE_OPACITY },
      barWidth: previousBarWidth,
      barGap: COMPARE_OVERLAY_BAR_GAP,
      z: COMPARE_OVERLAY_Z_PREVIOUS_UNDER,
      emphasis: {
        itemStyle: {
          color: "transparent",
          opacity: 1,
          borderColor: comparisonSeriesColor(ki),
          borderWidth: COMPARE_OVERLAY_BAR_HOVER_BORDER_WIDTH,
        },
      },
      ...barAnim,
    });
  }

  return { flatCategoryData, series };
}

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
  previous?: boolean;
  seriesColor: (index: number) => string;
  comparisonSeriesColor: (index: number) => string;
  animate: boolean;
  /**
   * Category-axis key for compare-mode bars. When set, previous-period bars are
   * placed on the overlaid sibling axis so they can be wider yet stay centered.
   */
  compareCategoryAxisKey?: CompareCategoryAxisKey;
  /** Current bar width — a responsive percentage string (e.g. "58%"). */
  currentBarWidth?: number | string;
  /** Previous bar width — px (= current + a fixed per-side frame) once measured. */
  previousBarWidth?: number | string;
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
    compareCategoryAxisKey,
    currentBarWidth,
    previousBarWidth,
  } = params;
  const isPrevious = params.previous ?? false;

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

        const data = sourceSortedXValues.map((x) => seriesDataMap[x] ?? 0);
        if (compareOverlayActive) {
          return {
            name: displayName,
            data,
            color,
            type: "bar" as const,
            stack: getComparisonStackId(isPrevious, isStacked),
            barGap: COMPARE_OVERLAY_BAR_GAP,
            // The previous period is wider and drawn on the overlaid category
            // axis so it stays centered behind the narrower current bar/stack.
            barWidth: isPrevious ? previousBarWidth : currentBarWidth,
            z: isPrevious
              ? COMPARE_OVERLAY_Z_PREVIOUS_UNDER
              : COMPARE_OVERLAY_Z_CURRENT_OVER,
            ...(isPrevious
              ? {
                  // Previous: soft fill behind current; outline-only on hover.
                  ...(compareCategoryAxisKey
                    ? { [compareCategoryAxisKey]: COMPARE_PREVIOUS_AXIS_INDEX }
                    : {}),
                  itemStyle: {
                    opacity: COMPARE_OVERLAY_PREVIOUS_BAR_BASE_OPACITY,
                  },
                  emphasis: {
                    itemStyle: {
                      color: "transparent",
                      opacity: 1,
                      borderColor: color,
                      borderWidth: COMPARE_OVERLAY_BAR_HOVER_BORDER_WIDTH,
                    },
                  },
                }
              : {
                  // Current dims on hover so the previous bar shows through.
                  emphasis: {
                    itemStyle: {
                      opacity: COMPARE_OVERLAY_CURRENT_BAR_HOVER_OPACITY,
                    },
                  },
                }),
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
            areaStyle: { color },
            emphasis: {
              areaStyle: {
                opacity: COMPARE_OVERLAY_PREVIOUS_AREA_HOVER_OPACITY,
              },
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
            areaStyle: {},
            ...(compareOverlayActive
              ? {
                  emphasis: {
                    areaStyle: {
                      opacity: COMPARE_OVERLAY_AREA_HOVER_OPACITY,
                    },
                  },
                }
              : {}),
            stack: "stack",
          };
      }

      return undefined;
    })
    .filter((series) => series !== undefined);
}

/**
 * Comparison trend for one metric column on the aggregate row (Big Number view).
 */
export function computeBigNumberComparisonTrendForMetricIndex(
  exploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  metricIndex: number,
): BigNumberComparisonTrend | null {
  if (
    !exploration?.result?.rows?.length ||
    !comparisonExploration?.result?.rows?.length ||
    metricIndex < 0
  ) {
    return null;
  }

  const renderOpts: RenderOpts = {
    showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
    isRatioByIndex: getIsRatioByIndex(submittedExploreState, getFactMetricById),
  };

  const currCell = exploration.result.rows[0]?.values[metricIndex];
  const prevCell = comparisonExploration.result.rows[0]?.values[metricIndex];
  if (!currCell || !prevCell) return null;

  const isRatio = renderOpts.isRatioByIndex[metricIndex] ?? false;
  const currentValue = getEffectiveMetricValue(currCell, {
    showAs: renderOpts.showAs,
    isRatio,
  });
  const previousValue = getEffectiveMetricValue(prevCell, {
    showAs: renderOpts.showAs,
    isRatio,
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

/** One entry per `dataset.values` index (aligned with explorer metric slots). */
export function computeBigNumberComparisonTrends(
  exploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): (BigNumberComparisonTrend | null)[] {
  const n = submittedExploreState.dataset?.values?.length ?? 0;
  return Array.from({ length: n }, (_, metricIndex) =>
    computeBigNumberComparisonTrendForMetricIndex(
      exploration,
      comparisonExploration,
      submittedExploreState,
      getFactMetricById,
      metricIndex,
    ),
  );
}

function escapeHtmlForProductAnalyticsTooltip(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type TooltipAxisItem = {
  axisValue: string | number;
  dataIndex?: number;
  marker: string;
  seriesName: string;
  value: number | [number, number];
};

/** Axis tooltips include every series; sparse bars use nulls so ECharts may omit `value`. */
function tooltipItemNumericValue(item: { value: unknown }): number | null {
  const v = item.value;
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const n = v[1];
    return typeof n === "number" && !Number.isNaN(n) ? n : null;
  }
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function buildGroupedLineAreaCompareTooltipRows(
  formatNumber: (value: number) => string,
  items: Array<{
    marker: string;
    seriesName: string;
    value: number | [number, number];
  }>,
  comparisonPeriodLabels: { currentLabel: string; previousLabel: string },
): string {
  const groupKey = (seriesName: string) => {
    const { baseName } = parseComparisonTooltipSeriesName(
      seriesName,
      comparisonPeriodLabels,
    );
    return baseName === "" ? "\0pivot\0" : baseName;
  };
  const parse = (seriesName: string) =>
    parseComparisonTooltipSeriesName(seriesName, comparisonPeriodLabels);

  const fmtVal = (item: (typeof items)[0]) => {
    const numValue = Array.isArray(item.value) ? item.value[1] : item.value;
    return typeof numValue === "number"
      ? formatNumber(numValue)
      : String(numValue);
  };

  let idx = 0;
  const blocks: string[] = [];
  let blockIndex = 0;
  while (idx < items.length) {
    const key = groupKey(items[idx].seriesName);
    const group: typeof items = [];
    while (idx < items.length && groupKey(items[idx].seriesName) === key) {
      group.push(items[idx]);
      idx += 1;
    }
    const currentItem = group.find(
      (it) => parse(it.seriesName).period === "current",
    );
    const previousItem = group.find(
      (it) => parse(it.seriesName).period === "previous",
    );
    const neutrals = group.filter(
      (it) => parse(it.seriesName).period === "neutral",
    );

    const baseName = parse(group[0].seriesName).baseName;
    const title =
      baseName.trim() !== ""
        ? escapeHtmlForProductAnalyticsTooltip(baseName)
        : null;

    const marginTop = blockIndex === 0 ? "0" : "6px";
    blockIndex += 1;

    const inner: string[] = [];
    if (title) {
      inner.push(`<div style="font-weight:600">${title}</div>`);
    }
    if (currentItem || previousItem) {
      inner.push(
        `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px">`,
      );
      inner.push(
        currentItem
          ? `<span>${currentItem.marker}<b>${fmtVal(currentItem)}</b></span>`
          : `<span></span>`,
      );
      inner.push(
        previousItem
          ? `<span>${previousItem.marker}<b>${fmtVal(previousItem)}</b></span>`
          : `<span></span>`,
      );
      inner.push(`</div>`);
    }
    for (const n of neutrals) {
      inner.push(
        `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px"><span>${n.marker}${escapeHtmlForProductAnalyticsTooltip(n.seriesName)}</span><span><b>${fmtVal(n)}</b></span></div>`,
      );
    }
    if (!title && !currentItem && !previousItem) {
      for (const it of group) {
        inner.push(
          `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px"><span>${it.marker}${escapeHtmlForProductAnalyticsTooltip(it.seriesName)}</span><span><b>${fmtVal(it)}</b></span></div>`,
        );
      }
    }
    blocks.push(`<div style="margin-top:${marginTop}">${inner.join("")}</div>`);
  }
  return blocks.join("");
}

type BuildExplorerChartTooltipFormatterArgs = {
  resolvedGranularity: ResolvedGranularity | null;
  /** When true, category axis labels are not raw dates (e.g. compare sparse-flat bars). */
  compositeCategoryAxisTooltip?: boolean;
  firstDimensionIsDate: boolean;
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  } | null;
  showLineAreaCompareTooltipDates: boolean;
  alignedComparisonOverlay: { comparisonXValues: string[] } | null;
  sortedXValues: string[];
  seriesConfigsLength: number;
  formatNumber: (value: number) => string;
};

export function buildExplorerChartTooltipFormatter({
  resolvedGranularity,
  compositeCategoryAxisTooltip = false,
  firstDimensionIsDate,
  comparisonPeriodLabels,
  showLineAreaCompareTooltipDates,
  alignedComparisonOverlay,
  sortedXValues,
  seriesConfigsLength,
  formatNumber,
}: BuildExplorerChartTooltipFormatterArgs):
  | ((params: unknown) => string)
  | undefined {
  const useDateGranularityTooltip =
    Boolean(resolvedGranularity) && !compositeCategoryAxisTooltip;

  if (useDateGranularityTooltip && resolvedGranularity) {
    const dateGranularity = resolvedGranularity;
    return (params: unknown) => {
      const itemsRaw = (Array.isArray(params) ? params : [params]) as Omit<
        TooltipAxisItem,
        "dataIndex"
      >[];
      if (!itemsRaw.length) return "";
      const itemsSorted = sortProductAnalyticsTooltipAxisItems(
        itemsRaw,
        comparisonPeriodLabels,
      );
      const items = itemsSorted.filter(
        (item) => tooltipItemNumericValue(item) !== null,
      );
      if (!items.length) return "";

      const rawAxisValue = items[0].axisValue;
      const date =
        typeof rawAxisValue === "number"
          ? new Date(rawAxisValue)
          : new Date(String(rawAxisValue));
      let header: string;
      let groupedLineAreaCompareRows = false;
      if (
        showLineAreaCompareTooltipDates &&
        alignedComparisonOverlay &&
        comparisonPeriodLabels
      ) {
        const axisMs =
          typeof rawAxisValue === "number"
            ? rawAxisValue
            : new Date(String(rawAxisValue)).getTime();
        const currentX = sortedXValues.find(
          (xv) => new Date(xv).getTime() === axisMs,
        );
        if (
          currentX !== undefined &&
          !Number.isNaN(new Date(currentX).getTime())
        ) {
          const compKey = getAlignedComparisonDimensionKeyForTooltip(
            sortedXValues,
            alignedComparisonOverlay.comparisonXValues,
            currentX,
            firstDimensionIsDate,
          );
          const currentFormatted = formatDateByGranularity(
            new Date(currentX),
            dateGranularity,
          );
          if (
            compKey !== undefined &&
            !Number.isNaN(new Date(compKey).getTime())
          ) {
            const prevFormatted = formatDateByGranularity(
              new Date(compKey),
              dateGranularity,
            );
            groupedLineAreaCompareRows = true;
            header = `<div>${escapeHtmlForProductAnalyticsTooltip(`Current: ${currentFormatted}`)}</div><div style="font-size:12px;opacity:0.9">${escapeHtmlForProductAnalyticsTooltip(`Previous: ${prevFormatted}`)}</div>`;
          } else {
            header = escapeHtmlForProductAnalyticsTooltip(
              `Current: ${currentFormatted}`,
            );
          }
        } else {
          header = escapeHtmlForProductAnalyticsTooltip(
            formatDateByGranularity(date, dateGranularity),
          );
        }
      } else {
        header = escapeHtmlForProductAnalyticsTooltip(
          formatDateByGranularity(date, dateGranularity),
        );
      }

      const seriesRows =
        groupedLineAreaCompareRows && comparisonPeriodLabels
          ? buildGroupedLineAreaCompareTooltipRows(
              formatNumber,
              items,
              comparisonPeriodLabels,
            )
          : items
              .map((item) => {
                const numValue = tooltipItemNumericValue(item);
                const formatted =
                  numValue !== null ? formatNumber(numValue) : "";
                return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker ?? ""}${item.seriesName ?? ""}</span><span><b>${formatted}</b></span></div>`;
              })
              .join("");

      return `<div><div style="margin-bottom:4px">${header}</div>${seriesRows}</div>`;
    };
  }

  if (seriesConfigsLength > 1) {
    return (params: unknown) => {
      const itemsRaw = (Array.isArray(params) ? params : [params]) as Omit<
        TooltipAxisItem,
        "dataIndex"
      >[];
      if (!itemsRaw.length) return "";
      const itemsSorted = sortProductAnalyticsTooltipAxisItems(
        itemsRaw,
        comparisonPeriodLabels,
      );
      const items = itemsSorted.filter(
        (item) => tooltipItemNumericValue(item) !== null,
      );
      if (!items.length) return "";

      const rawAxisValue = items[0].axisValue;
      const header =
        typeof rawAxisValue === "number"
          ? formatNumber(rawAxisValue)
          : String(rawAxisValue);

      const seriesRows = items
        .map((item) => {
          const numValue = tooltipItemNumericValue(item);
          const formatted = numValue !== null ? formatNumber(numValue) : "";
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker ?? ""}${item.seriesName ?? ""}</span><span><b>${formatted}</b></span></div>`;
        })
        .join("");

      return `<div><div style="margin-bottom:4px">${header}</div>${seriesRows}</div>`;
    };
  }

  return undefined;
}
