import { formatInTimeZone } from "date-fns-tz";
import { parseWarehouseDate } from "shared/dates";
import type { FactMetricInterface } from "shared/types/fact-table";
import {
  buildComparisonDateRangeForMode,
  calculateProductAnalyticsDateRange,
  computeBigNumberTrend,
  createComparisonAlignmentResolver,
} from "shared/enterprise";
import type { ComparisonAlignmentStrategy, ValueAxis } from "shared/enterprise";
import type {
  ComparisonMode,
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  formatDateByGranularity,
  getExplorationRenderOpts,
  getEffectiveMetricValue,
  type RenderOpts,
  type ResolvedGranularity,
} from "@/enterprise/components/ProductAnalytics/util";

type BigNumberComparisonTrend = {
  currentValue: number;
  previousValue: number;
  /** Signed fractional change, e.g. -0.12 for −12%. */
  pctChange: number;
};

/**
 * Formats a date range, collapsing the month/year shared by both endpoints to
 * the end so it reads once:
 * - same day:          "May 3, 2026"
 * - same month + year: "May 3 – 7, 2026"
 * - same year:         "May 3 – Jun 4, 2026"
 * - otherwise:         "Dec 30, 2025 – Jan 2, 2026"
 */
export function formatCollapsedDateRange(
  startDate: Date,
  endDate: Date,
  timeZone = "UTC",
): string {
  const fmt = (d: Date, pattern: string) =>
    formatInTimeZone(d, timeZone, pattern);

  const sameYear = fmt(startDate, "yyyy") === fmt(endDate, "yyyy");
  const sameMonth = sameYear && fmt(startDate, "MMM") === fmt(endDate, "MMM");
  const sameDay = sameMonth && fmt(startDate, "d") === fmt(endDate, "d");

  if (sameDay) return fmt(startDate, "MMM d, yyyy");
  if (sameMonth) {
    return `${fmt(startDate, "MMM d")} – ${fmt(endDate, "d, yyyy")}`;
  }
  if (sameYear) {
    return `${fmt(startDate, "MMM d")} – ${fmt(endDate, "MMM d, yyyy")}`;
  }
  return `${fmt(startDate, "MMM d, yyyy")} – ${fmt(endDate, "MMM d, yyyy")}`;
}

export function formatExplorerDateRangeHeading(dr: {
  startDate: Date;
  endDate: Date;
}): string {
  return formatCollapsedDateRange(dr.startDate, dr.endDate);
}

export function getComparisonPeriodLabels(
  dateRange: ExplorationConfig["dateRange"],
  explicitPreviousDateRange?: ExplorationConfig["dateRange"],
  mode: ComparisonMode = "previousPeriod",
): { currentLabel: string; previousLabel: string } {
  const currentDr = calculateProductAnalyticsDateRange(dateRange);
  const prevDr = calculateProductAnalyticsDateRange(
    explicitPreviousDateRange ??
      buildComparisonDateRangeForMode(dateRange, mode),
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

/** One legend row per metric/series: current + previous swatch and the ECharts
 * series names needed to toggle each period on the chart. */
export type CompareChartLegendItem = {
  baseName: string;
  currentColor?: string;
  previousColor?: string;
  currentSeriesName?: string;
  previousSeriesName?: string;
};

function seriesConfigStringField(
  s: unknown,
  field: "name" | "color",
): string | undefined {
  if (s && typeof s === "object" && field in s) {
    const v = (s as Record<string, unknown>)[field];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/**
 * Groups compare-mode ECharts series into per-metric legend rows, preserving
 * series order. Returns `[]` for non-compare charts (their series names carry
 * no period suffix, so nothing groups).
 */
export function buildCompareChartLegendModel(
  seriesConfigs: unknown[],
  comparisonPeriodLabels: { currentLabel: string; previousLabel: string },
): CompareChartLegendItem[] {
  const order: string[] = [];
  const byBase = new Map<string, CompareChartLegendItem>();
  for (const s of seriesConfigs) {
    const name = seriesConfigStringField(s, "name");
    if (name === undefined) continue;
    const { baseName, period } = parseComparisonTooltipSeriesName(
      name,
      comparisonPeriodLabels,
    );
    if (period === "neutral") continue;
    if (!byBase.has(baseName)) {
      byBase.set(baseName, { baseName });
      order.push(baseName);
    }
    const item = byBase.get(baseName);
    if (!item) continue;
    const color = seriesConfigStringField(s, "color");
    if (period === "current") {
      item.currentColor = color;
      item.currentSeriesName = name;
    } else {
      item.previousColor = color;
      item.previousSeriesName = name;
    }
  }
  return order
    .map((b) => byBase.get(b))
    .filter((i): i is CompareChartLegendItem => i !== undefined);
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
  strategy?: ComparisonAlignmentStrategy,
): string | undefined {
  return createComparisonAlignmentResolver(
    sortedXValues,
    comparisonXValues,
    firstDimensionIsDate,
    strategy,
  )(currentKey);
}

/** Members who converted over the Population's member count. */
export type PopulationFraction = { numerator: number; populationCount: number };

/**
 * A chart point. A null value is a gap (no data, e.g. "% of Population" on a
 * day with no members), unlike a bucket with no rows, which reads as 0. A
 * "% of Population" point also carries its fraction, which the tooltip shows.
 */
export type ChartPoint = {
  value: number | null;
  fraction?: PopulationFraction;
};

// Sorted by time, not as strings: a warehouse's dates (`2026-09-01 02:00:00`)
// and the ISO dates filled in for missing buckets are formatted differently.
export function sortDateXValues(xValues: Iterable<string>): string[] {
  return Array.from(xValues).sort(
    (a, b) => parseWarehouseDate(a).getTime() - parseWarehouseDate(b).getTime(),
  );
}

// "% of Population" series keys. With no members there's no percentage, so a
// date these series have no bucket for is a gap, not 0.
export function getPopulationSeriesKeys(
  seriesMeta: Record<string, { valueIndex: number }>,
  renderOpts: RenderOpts,
): Set<string> {
  return new Set(
    Object.keys(seriesMeta).filter(
      (seriesKey) =>
        renderOpts.values[seriesMeta[seriesKey].valueIndex]?.showAs ===
        "percent_of_population",
    ),
  );
}

// Marks each date in `xValues` that a "% of Population" series has no bucket
// for as a gap, e.g. dates past the end of the current window that the axis
// reaches for a longer comparison window.
export function fillPopulationSeriesGaps(
  dataMap: Record<string, Record<string, ChartPoint>>,
  populationSeriesKeys: ReadonlySet<string>,
  xValues: readonly string[],
): void {
  for (const seriesKey of populationSeriesKeys) {
    const points = (dataMap[seriesKey] ??= {});
    for (const x of xValues) {
      if (!(x in points)) points[x] = { value: null };
    }
  }
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
 *
 * A bucket the comparison has no value for reads as 0, except in
 * `gapSeriesKeys` ("% of Population" series), where it's a gap: with no
 * members there's no percentage.
 */
export function alignComparisonOverlayToCategories(
  sortedXValues: string[],
  comparisonDataMap: Record<string, Record<string, ChartPoint>>,
  sortedSeriesKeys: string[],
  comparisonXValues: string[],
  firstDimensionIsDate: boolean,
  strategy?: ComparisonAlignmentStrategy,
  gapSeriesKeys: ReadonlySet<string> = new Set(),
): Record<string, Record<string, ChartPoint>> {
  const aligned: Record<string, Record<string, ChartPoint>> = {};
  const resolveComparisonKey = createComparisonAlignmentResolver(
    sortedXValues,
    comparisonXValues,
    firstDimensionIsDate,
    strategy,
  );

  for (const seriesKey of sortedSeriesKeys) {
    const src = comparisonDataMap[seriesKey] ?? {};
    aligned[seriesKey] = {};
    for (const x of sortedXValues) {
      const compKey = resolveComparisonKey(x);
      // Buckets past the end of a shorter comparison window read the same as a
      // matched bucket the comparison simply had no rows in.
      aligned[seriesKey][x] =
        compKey !== undefined && compKey in src
          ? src[compKey]
          : gapSeriesKeys.has(seriesKey)
            ? { value: null }
            : { value: 0 };
    }
  }
  return aligned;
}

function metricIdForDatasetValue(
  config: ExplorationConfig,
  metricIndex: number,
): string {
  if (config.dataset?.type === "funnel" || config.dataset?.type === "journey")
    return "";
  const values = config.dataset?.values;
  if (!values?.[metricIndex]) return "";
  const v = values[metricIndex];
  return v.type === "metric" ? v.metricId : "";
}

function metricNameForDatasetValue(
  renderOpts: RenderOpts,
  metricIndex: number,
): string {
  return renderOpts.values[metricIndex]?.seriesName ?? `Metric ${metricIndex}`;
}

function valueAxisForDatasetValue(
  renderOpts: RenderOpts,
  metricIndex: number,
): ValueAxis {
  return renderOpts.values[metricIndex]?.valueAxis ?? "primary";
}

export type ExplorerSeriesMeta = {
  metricId: string;
  name: string;
  /** The dataset value the series draws. */
  valueIndex: number;
  /** The value's axis, from its render options. */
  valueAxis: ValueAxis;
};

/**
 * Maps exploration rows into per-series maps keyed by the primary dimension (x).
 */
export function buildComparisonOverlaySeriesMaps(
  rows: ProductAnalyticsResultRow[],
  config: ExplorationConfig,
  renderOpts: RenderOpts,
): {
  uniqueXValues: Set<string>;
  dataMap: Record<string, Record<string, ChartPoint>>;
  seriesMeta: Record<string, ExplorerSeriesMeta>;
} {
  const uniqueXValues = new Set<string>();
  const dataMap: Record<string, Record<string, ChartPoint>> = {};
  const seriesMeta: Record<string, ExplorerSeriesMeta> = {};

  const numMetrics =
    config.dataset?.type !== "funnel" && config.dataset?.type !== "journey"
      ? (config.dataset?.values?.length ?? 0)
      : 0;
  const numDimensions = config.dimensions?.length ?? 0;

  const bump = (seriesKey: string, x: string, point: ChartPoint) => {
    uniqueXValues.add(x);
    const points = (dataMap[seriesKey] ??= {});
    const prev = points[x];
    const value =
      point.value === null
        ? (prev?.value ?? null)
        : (prev?.value ?? 0) + point.value;
    // A Population chart has one row per series and x (the parser allows one
    // dimension), so there's never a fraction already here to merge.
    points[x] = point.fraction
      ? { value, fraction: point.fraction }
      : { value };
  };
  const pointFor = (
    row: ProductAnalyticsResultRow,
    valueIndex: number,
  ): ChartPoint | null => {
    const cell = row.values?.[valueIndex];
    if (!cell) return null;
    const opts = renderOpts.values[valueIndex];
    const value = getEffectiveMetricValue(cell, opts, row.populationCount);
    // A "% of Population" point has a fraction whenever it has a value;
    // getEffectiveMetricValue decides when it has one.
    if (opts?.showAs === "percent_of_population" && value !== null) {
      const numerator = cell.numerator ?? 0;
      const populationCount = row.populationCount ?? 0;
      return { value, fraction: { numerator, populationCount } };
    }
    return { value };
  };

  for (const row of rows) {
    const x = String(row.dimensions[0] ?? "");

    if (numMetrics > 1) {
      for (let mi = 0; mi < numMetrics; mi++) {
        const seriesKey = `__metric_${mi}__`;
        if (!seriesMeta[seriesKey]) {
          seriesMeta[seriesKey] = {
            metricId: metricIdForDatasetValue(config, mi),
            name: metricNameForDatasetValue(renderOpts, mi),
            valueIndex: mi,
            valueAxis: valueAxisForDatasetValue(renderOpts, mi),
          };
        }
        const point = pointFor(row, mi);
        if (!point) continue;
        bump(seriesKey, x, point);
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
          name: group || metricNameForDatasetValue(renderOpts, 0),
          valueIndex: 0,
          valueAxis: valueAxisForDatasetValue(renderOpts, 0),
        };
      }
      const point = pointFor(row, 0);
      if (!point) continue;
      bump(seriesKey, x, point);
      continue;
    }

    const seriesKey = "__single__";
    if (!seriesMeta[seriesKey]) {
      seriesMeta[seriesKey] = {
        metricId: metricIdForDatasetValue(config, 0),
        name: metricNameForDatasetValue(renderOpts, 0),
        valueIndex: 0,
        valueAxis: valueAxisForDatasetValue(renderOpts, 0),
      };
    }
    const point = pointFor(row, 0);
    if (!point) continue;
    bump(seriesKey, x, point);
  }

  return { uniqueXValues, dataMap, seriesMeta };
}

// --- Explorer chart: second "% of Population" value axis ---

/**
 * The chart's value axis option: the primary axis alone, or with a second copy
 * changed by `secondaryAxisOverrides` (its title and labels). The second axis
 * sits on the right of a vertical chart and on top of a horizontal one. Grid
 * lines follow the primary axis only, and the second axis's ticks snap to them
 * so a value can be read across.
 */
export function buildValueAxes<T extends object>(
  primaryAxis: T,
  secondaryAxisOverrides: object | null,
  secondaryAxisPosition: "right" | "top",
): T | [T, T] {
  if (!secondaryAxisOverrides) return primaryAxis;
  const secondaryAxis = {
    ...primaryAxis,
    ...secondaryAxisOverrides,
    position: secondaryAxisPosition,
    alignTicks: true,
    splitLine: { show: false },
  };
  return [primaryAxis, secondaryAxis];
}

/**
 * Moves each series whose `valueAxis` is "secondary" onto the second value
 * axis. `valueAxisKey` is the value axis's index key: `yAxisIndex` on vertical
 * charts, `xAxisIndex` on horizontal ones, where `yAxisIndex` is the category
 * axis (compare mode already uses index 1 for the previous period's category
 * axis, which is kept). Stacked series get their own stack, so counts and
 * percents don't stack together.
 */
export function assignSecondaryValueAxis(
  seriesConfigs: unknown[],
  valueAxisKey: "xAxisIndex" | "yAxisIndex",
): unknown[] {
  return seriesConfigs.map((config) => {
    const seriesConfig = config as { valueAxis?: ValueAxis; stack?: string };
    if (seriesConfig.valueAxis !== "secondary") return config;
    return {
      ...seriesConfig,
      [valueAxisKey]: 1,
      ...(seriesConfig.stack !== undefined
        ? { stack: `${seriesConfig.stack}:secondary` }
        : {}),
    };
  });
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
 * How far the previous period extends past the current bar on each side, in px:
 * a share of the bar width, kept within [minPx, maxPx].
 */
export function compareBarFramePx(
  barWidth: number,
  minPx: number,
  maxPx: number,
  fraction: number,
): number {
  return Math.max(minPx, Math.min(maxPx, Math.round(barWidth * fraction)));
}
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
  comparisonAlignment?: ComparisonAlignmentStrategy;
}): {
  alignedMap: Record<string, Record<string, ChartPoint>>;
  comparisonXValues: string[];
} | null {
  if (!args.comparisonRows.length) return null;
  const { uniqueXValues, dataMap, seriesMeta } =
    buildComparisonOverlaySeriesMaps(
      args.comparisonRows,
      args.submittedExploreState,
      args.renderOpts,
    );
  const comparisonXValues = Array.from(uniqueXValues);
  const gapSeriesKeys = getPopulationSeriesKeys(seriesMeta, args.renderOpts);
  const alignedMap = alignComparisonOverlayToCategories(
    args.sortedXValues,
    dataMap,
    args.sortedSeriesKeys,
    comparisonXValues,
    args.firstDimensionIsDate,
    args.comparisonAlignment,
    gapSeriesKeys,
  );
  return { alignedMap, comparisonXValues };
}

/**
 * An ECharts data item: the point's value (paired with its time on a time
 * axis) and, for a "% of Population" point, the fraction the tooltip shows.
 */
type EChartsDataItem = {
  value: number | null | [number, number | null];
  fraction?: PopulationFraction;
};

/**
 * The series' data item at `x`. A series with no bucket at `x` reads as 0,
 * unlike a null point, which is a gap.
 */
function eChartsDataItemAt(
  map: Record<string, ChartPoint> | undefined,
  x: string,
  time?: number,
): EChartsDataItem {
  const point = map && x in map ? map[x] : { value: 0 };
  const value: EChartsDataItem["value"] =
    time === undefined ? point.value : [time, point.value];
  return point.fraction ? { value, fraction: point.fraction } : { value };
}

/** Each series config carries its `valueAxis`, for `assignSecondaryValueAxis`. */
type ExplorerChartCompareSeriesMeta = Pick<
  ExplorerSeriesMeta,
  "metricId" | "name" | "valueAxis"
>;

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
  currentDataMap: Record<string, Record<string, ChartPoint>>;
  previousDataMap: Record<string, Record<string, ChartPoint>>;
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
      flatCategoryData.push(`${x} — ${sourceSeriesMeta[sk].name}`);
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
    const { name, valueAxis } = sourceSeriesMeta[sk];
    const currName = formatComparisonMetricLabel(
      name,
      comparisonPeriodLabels.currentLabel,
    );
    const prevName = formatComparisonMetricLabel(
      name,
      comparisonPeriodLabels.previousLabel,
    );

    const currData: (EChartsDataItem | null)[] = [];
    const prevData: (EChartsDataItem | null)[] = [];

    for (let j = 0; j < flatLen; j++) {
      const xi = Math.floor(j / K);
      const slotKi = j % K;
      const x = sourceSortedXValues[xi]!;
      if (slotKi === ki) {
        currData.push(eChartsDataItemAt(currentDataMap[sk], x));
        prevData.push(eChartsDataItemAt(previousDataMap[sk], x));
      } else {
        currData.push(null);
        prevData.push(null);
      }
    }

    // Current period: narrower, drawn on top. On hover it dims so the wider
    // previous bar behind it shows through.
    series.push({
      name: currName,
      valueAxis,
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
      valueAxis,
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
  sourceDataMap: Record<string, Record<string, ChartPoint>>;
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
      const { name, valueAxis } = sourceSeriesMeta[seriesKey];
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
        const data = sourceSortedXValues.map((x) =>
          eChartsDataItemAt(seriesDataMap, x, parseWarehouseDate(x).getTime()),
        );

        return {
          name: displayName,
          valueAxis,
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
            ...eChartsDataItemAt(seriesDataMap, x),
            itemStyle: { color: seriesColor(i) },
          }));
          return {
            name: displayName,
            valueAxis,
            data,
            type: "bar" as const,
          };
        }

        const data = sourceSortedXValues.map((x) =>
          eChartsDataItemAt(seriesDataMap, x),
        );
        if (compareOverlayActive) {
          return {
            name: displayName,
            valueAxis,
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
          valueAxis,
          data,
          color,
          type: "bar" as const,
          stack: getComparisonStackId(isPrevious, isStacked),
        };
      }

      if (chartType === "line" || chartType === "area") {
        const data = sourceSortedXValues.map((x) =>
          eChartsDataItemAt(seriesDataMap, x, parseWarehouseDate(x).getTime()),
        );

        if (chartType === "area" && isPrevious && compareOverlayActive) {
          return {
            name: displayName,
            valueAxis,
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
          valueAxis,
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
 * Comparison trend for one metric column on the aggregate row (Big Number
 * view), from the same shared calculation as the server's trends.
 */
export function computeBigNumberComparisonTrendForMetricIndex(
  exploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  metricIndex: number,
): BigNumberComparisonTrend | null {
  const trend = computeBigNumberTrend(
    exploration,
    comparisonExploration,
    getExplorationRenderOpts(submittedExploreState, getFactMetricById),
    metricIndex,
  );
  return trend
    ? {
        currentValue: trend.currentValue,
        previousValue: trend.previousValue,
        pctChange: trend.pctChangeFraction,
      }
    : null;
}

/** One entry per `dataset.values` index (aligned with explorer metric slots). */
export function computeBigNumberComparisonTrends(
  exploration: ProductAnalyticsExploration | null,
  comparisonExploration: ProductAnalyticsExploration | null,
  submittedExploreState: ExplorationConfig,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): (BigNumberComparisonTrend | null)[] {
  const n =
    submittedExploreState.dataset?.type !== "funnel" &&
    submittedExploreState.dataset?.type !== "journey"
      ? (submittedExploreState.dataset?.values?.length ?? 0)
      : 0;
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

/**
 * Period sub-header for compare tooltips whose main header isn't itself a date
 * (e.g. category-axis bars): names the current and previous date ranges so the
 * "Current" / "Previous" rows below have temporal context.
 */
function buildComparePeriodSubHeader(comparisonPeriodLabels: {
  currentLabel: string;
  previousLabel: string;
}): string {
  return (
    `<div style="font-size:12px;margin-top:1px">${escapeHtmlForProductAnalyticsTooltip(
      comparisonPeriodLabels.currentLabel,
    )}</div>` +
    `<div style="font-size:12px;opacity:0.6;margin-top:1px">${escapeHtmlForProductAnalyticsTooltip(
      `Compared with ${comparisonPeriodLabels.previousLabel}`,
    )}</div>`
  );
}

type TooltipAxisItem = {
  axisValue: string | number;
  dataIndex?: number;
  marker: string;
  seriesName: string;
  value: number | [number, number];
  /** The series' data item here; null for the blank slots sparse bars are laid out with. */
  data?: EChartsDataItem | null;
  /** Series color, surfaced by ECharts on each axis-tooltip item. */
  color?: string;
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

type CompareTooltipMarkerStyle = "line" | "bar";

/**
 * Swatch for a compare-mode tooltip row, matched to how the series is drawn:
 * a line (solid current / dashed previous) or a bar (filled square, previous
 * translucent like its softer overlay fill).
 */
function compareTooltipMarker(
  color: string | undefined,
  isPrevious: boolean,
  markerStyle: CompareTooltipMarkerStyle,
): string {
  const c = color ?? "currentColor";
  if (markerStyle === "bar") {
    return `<span style="display:inline-block;width:11px;height:11px;border-radius:2px;background-color:${c};${
      isPrevious ? `opacity:${COMPARE_OVERLAY_PREVIOUS_BAR_BASE_OPACITY};` : ""
    }margin-right:8px;vertical-align:middle"></span>`;
  }
  return `<span style="display:inline-block;width:18px;border-top:3px ${
    isPrevious ? "dashed" : "solid"
  } ${c};border-radius:2px;margin-right:8px;vertical-align:middle"></span>`;
}

// Matches the fraction under each value in experiment results.
const fractionNumberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// A "% of Population" value's fraction, muted like the fraction in experiment
// results.
function populationFractionHtml({
  numerator,
  populationCount,
}: PopulationFraction): string {
  const fraction = `${fractionNumberFormatter.format(numerator)} / ${fractionNumberFormatter.format(populationCount)}`;
  return `<span style="font-size:11px;font-style:italic;opacity:0.6;margin-right:6px">${escapeHtmlForProductAnalyticsTooltip(fraction)}</span>`;
}

function buildGroupedCompareTooltipRows(
  formatNumber: (value: number) => string,
  items: Array<{
    marker: string;
    seriesName: string;
    value: number | [number, number];
    color?: string;
    data?: EChartsDataItem | null;
  }>,
  comparisonPeriodLabels: { currentLabel: string; previousLabel: string },
  markerStyle: CompareTooltipMarkerStyle,
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
    if (numValue === null || numValue === undefined) return "No data";
    const formatted =
      typeof numValue === "number" ? formatNumber(numValue) : String(numValue);
    const fraction = item.data?.fraction;
    return fraction ? populationFractionHtml(fraction) + formatted : formatted;
  };

  // Stacked "Current" / "Previous" row: swatch + label on the left, value
  // right-aligned. Previous is rendered muted to recede behind current.
  const periodRow = (
    item: (typeof items)[0],
    label: string,
    isPrevious: boolean,
  ): string => {
    const labelStyle = isPrevious ? "opacity:0.6" : "";
    const valueStyle = isPrevious ? "opacity:0.6" : "font-weight:700";
    return (
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-top:3px">` +
      `<span style="display:flex;align-items:center">${compareTooltipMarker(
        item.color,
        isPrevious,
        markerStyle,
      )}<span style="${labelStyle}">${label}</span></span>` +
      `<span style="${valueStyle}">${fmtVal(item)}</span>` +
      `</div>`
    );
  };

  const neutralRow = (item: (typeof items)[0]): string =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-top:3px"><span>${item.marker}${escapeHtmlForProductAnalyticsTooltip(item.seriesName)}</span><span style="font-weight:700">${fmtVal(item)}</span></div>`;

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

    const marginTop = blockIndex === 0 ? "0" : "8px";
    blockIndex += 1;

    const inner: string[] = [];
    if (title) {
      inner.push(`<div style="font-weight:600">${title}</div>`);
    }
    if (currentItem) {
      inner.push(periodRow(currentItem, "Current", false));
    }
    if (previousItem) {
      inner.push(periodRow(previousItem, "Previous", true));
    }
    for (const n of neutrals) {
      inner.push(neutralRow(n));
    }
    if (!title && !currentItem && !previousItem) {
      for (const it of group) {
        inner.push(neutralRow(it));
      }
    }
    blocks.push(`<div style="margin-top:${marginTop}">${inner.join("")}</div>`);
  }
  return blocks.join("");
}

type BuildExplorerChartTooltipFormatterArgs = {
  chartType: ExplorationConfig["chartType"];
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
  comparisonAlignment?: ComparisonAlignmentStrategy;
};

export function buildExplorerChartTooltipFormatter({
  chartType,
  resolvedGranularity,
  compositeCategoryAxisTooltip = false,
  firstDimensionIsDate,
  comparisonPeriodLabels,
  showLineAreaCompareTooltipDates,
  alignedComparisonOverlay,
  sortedXValues,
  seriesConfigsLength,
  formatNumber,
  comparisonAlignment,
}: BuildExplorerChartTooltipFormatterArgs):
  | ((params: unknown) => string)
  | undefined {
  const useDateGranularityTooltip =
    Boolean(resolvedGranularity) && !compositeCategoryAxisTooltip;

  // Most empty points are the blank slots sparse bars are laid out with, which
  // have no data item. A "% of Population" bucket with no members is a data
  // item with no value, shown as "No data".
  const isShownItem = (item: Omit<TooltipAxisItem, "dataIndex">) => {
    if (tooltipItemNumericValue(item) !== null) return true;
    const data = item.data ?? null;
    return data !== null && tooltipItemNumericValue(data) === null;
  };

  // The value cell's HTML. A "% of Population" value is preceded by its
  // fraction.
  const formatItemValueHtml = (item: Omit<TooltipAxisItem, "dataIndex">) => {
    const numValue = tooltipItemNumericValue(item);
    const formatted = numValue !== null ? formatNumber(numValue) : "No data";
    const valueHtml = `<b>${formatted}</b>`;
    if (numValue === null) return valueHtml;

    const fraction = item.data?.fraction;
    return fraction ? populationFractionHtml(fraction) + valueHtml : valueHtml;
  };

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
      const items = itemsSorted.filter(isShownItem);
      if (!items.length) return "";

      const rawAxisValue = items[0].axisValue;
      const date =
        typeof rawAxisValue === "number"
          ? new Date(rawAxisValue)
          : parseWarehouseDate(String(rawAxisValue));
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
            : parseWarehouseDate(String(rawAxisValue)).getTime();
        const currentX = sortedXValues.find(
          (xv) => parseWarehouseDate(xv).getTime() === axisMs,
        );
        if (
          currentX !== undefined &&
          !Number.isNaN(parseWarehouseDate(currentX).getTime())
        ) {
          const compKey = getAlignedComparisonDimensionKeyForTooltip(
            sortedXValues,
            alignedComparisonOverlay.comparisonXValues,
            currentX,
            firstDimensionIsDate,
            comparisonAlignment,
          );
          const currentFormatted = formatDateByGranularity(
            parseWarehouseDate(currentX),
            dateGranularity,
          );
          if (
            compKey !== undefined &&
            !Number.isNaN(parseWarehouseDate(compKey).getTime())
          ) {
            const prevFormatted = formatDateByGranularity(
              parseWarehouseDate(compKey),
              dateGranularity,
            );
            groupedLineAreaCompareRows = true;
            header = `<div style="font-weight:600;font-size:13px">${escapeHtmlForProductAnalyticsTooltip(currentFormatted)}</div><div style="font-size:12px;opacity:0.6;margin-top:1px">${escapeHtmlForProductAnalyticsTooltip(`Compared with ${prevFormatted}`)}</div>`;
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

      // Group into Current / Previous rows when comparing — for line/area (the
      // date-aligned `groupedLineAreaCompareRows` case) and for bar/stacked-bar
      // with a date dimension (which also lands in this branch).
      const isBar = isExplorerBarChartType(chartType);
      const useGroupedCompareRows =
        Boolean(comparisonPeriodLabels) &&
        (groupedLineAreaCompareRows || isBar);
      const seriesRows =
        useGroupedCompareRows && comparisonPeriodLabels
          ? buildGroupedCompareTooltipRows(
              formatNumber,
              items,
              comparisonPeriodLabels,
              isBar ? "bar" : "line",
            )
          : items
              .map((item) => {
                const valueHtml = formatItemValueHtml(item);
                return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker ?? ""}${item.seriesName ?? ""}</span><span>${valueHtml}</span></div>`;
              })
              .join("");

      const headerMargin = useGroupedCompareRows ? "8px" : "4px";
      return `<div><div style="margin-bottom:${headerMargin}">${header}</div>${seriesRows}</div>`;
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
      const items = itemsSorted.filter((item) => {
        if (!isShownItem(item)) return false;
        if (tooltipItemNumericValue(item) !== null) return true;
        if (!compositeCategoryAxisTooltip || !comparisonPeriodLabels) {
          return true;
        }
        // A sparse bar's slot holds one metric; the other metrics' empty
        // points only lay it out.
        const { baseName } = parseComparisonTooltipSeriesName(
          item.seriesName,
          comparisonPeriodLabels,
        );
        return String(item.axisValue).endsWith(` — ${baseName}`);
      });
      if (!items.length) return "";

      const rawAxisValue = items[0].axisValue;
      let header =
        typeof rawAxisValue === "number"
          ? formatNumber(rawAxisValue)
          : String(rawAxisValue);

      // Compare ON: group each metric/series into stacked Current / Previous
      // rows (same layout as line/area). Bars use a square swatch; previous
      // recedes via a muted value, matching the chart's softer previous fill.
      if (comparisonPeriodLabels) {
        // Sparse-flat bars label each slot "<category> — <metric>"; the metric
        // is already shown as the group title, so trim it from the header to
        // leave just the dimension value.
        if (compositeCategoryAxisTooltip) {
          const { baseName } = parseComparisonTooltipSeriesName(
            items[0].seriesName,
            comparisonPeriodLabels,
          );
          const suffix = ` — ${baseName}`;
          if (baseName && header.endsWith(suffix)) {
            header = header.slice(0, -suffix.length);
          }
        }
        const seriesRows = buildGroupedCompareTooltipRows(
          formatNumber,
          items,
          comparisonPeriodLabels,
          isExplorerBarChartType(chartType) ? "bar" : "line",
        );
        const headerHtml =
          `<div style="font-weight:600">${escapeHtmlForProductAnalyticsTooltip(
            header,
          )}</div>` + buildComparePeriodSubHeader(comparisonPeriodLabels);
        return `<div><div style="margin-bottom:8px">${headerHtml}</div>${seriesRows}</div>`;
      }

      const seriesRows = items
        .map((item) => {
          const valueHtml = formatItemValueHtml(item);
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker ?? ""}${item.seriesName ?? ""}</span><span>${valueHtml}</span></div>`;
        })
        .join("");

      return `<div><div style="margin-bottom:4px">${header}</div>${seriesRows}</div>`;
    };
  }

  return undefined;
}
