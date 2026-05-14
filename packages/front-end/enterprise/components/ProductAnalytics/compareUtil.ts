import { format } from "date-fns";
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

export type ComparisonTooltipSeriesPeriod = "current" | "previous" | "neutral";

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
export const COMPARE_OVERLAY_Z_PREVIOUS_UNDER = 1;
/** ECharts `z`: current period sits above overlapped comparison. */
export const COMPARE_OVERLAY_Z_CURRENT_OVER = 2;
/** ECharts `z`: dashed comparison line on top of current line strokes. */
export const COMPARE_OVERLAY_Z_PREVIOUS_LINE_ON_TOP = 3;

export const COMPARE_OVERLAY_BAR_GAP = "-100%";
/** Opacity applied on hover to the bar/area being hovered, so the overlapping
 * period underneath shows through. Defaults stay solid; only hover dims. */
export const COMPARE_OVERLAY_CURRENT_BAR_HOVER_OPACITY = 0.72;
export const COMPARE_OVERLAY_PREVIOUS_BAR_HOVER_OPACITY = 0.55;
export const COMPARE_OVERLAY_AREA_HOVER_OPACITY = 0.38;
export const COMPARE_OVERLAY_PREVIOUS_AREA_HOVER_OPACITY = 0.42;

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
            // Overlap only for non-stacked bars (single pair per category slot).
            // Stacked current vs previous use separate stack ids; -100% barGap
            // would collapse the two stacks onto the same slot.
            ...(!isStacked ? { barGap: COMPARE_OVERLAY_BAR_GAP } : {}),
            z: isPrevious
              ? COMPARE_OVERLAY_Z_PREVIOUS_UNDER
              : COMPARE_OVERLAY_Z_CURRENT_OVER,
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

export function computeBigNumberComparisonTrend(
  exploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): BigNumberComparisonTrend | null {
  return computeBigNumberComparisonTrendForMetricIndex(
    exploration,
    comparisonExploration,
    submittedExploreState,
    getFactMetricById,
    0,
  );
}
