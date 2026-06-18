import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts/core";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsRunComparisonPayload,
} from "shared/validators";
import { isManagedWarehousePendingQueryError } from "shared/util";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import {
  shouldChartSectionShow,
  getEffectiveMetricValue,
  computeDimensionTotals,
  getIsRatioByIndex,
  getEffectiveShowAs,
  getSharedUnit,
  showAsAppliesTo,
  formatDateByGranularity,
  type ResolvedGranularity,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import {
  buildAlignedComparisonOverlayForExplorer,
  buildComparisonOverlaySeriesMaps,
  buildExplorerChartComparisonSeriesList,
  buildExplorerCompareSparseFlatBarSeries,
  computeBigNumberComparisonTrends,
  getComparisonPeriodLabels,
  parseComparisonTooltipSeriesName,
  sortProductAnalyticsTooltipAxisItems,
  supportsAlwaysOnComparisonOverlay,
  buildExplorerChartTooltipFormatter,
  type CompareCategoryAxisKey,
} from "@/enterprise/components/ProductAnalytics/comparison-chart";
import ComparisonTrendLabel from "@/enterprise/components/ProductAnalytics/ComparisonTrendLabel";

const CHART_ID = "explorer-chart";

const CHART_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#06b6d4",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#6b7280",
];

const COMPARISON_SERIES_COLORS = [
  "#d97706",
  "#a8a29e",
  "#fbbf24",
  "#9ca3af",
  "#78716c",
];

// Simple number formatter
function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function seriesNameFromEChartsSeriesConfig(s: unknown): string | undefined {
  if (
    s &&
    typeof s === "object" &&
    "name" in s &&
    typeof (s as { name: unknown }).name === "string"
  ) {
    return (s as { name: string }).name;
  }
  return undefined;
}

/** Legend + series list order: group each metric’s current then previous (same as axis tooltip). */
function sortSeriesConfigsForCompareLegendOrder(
  seriesConfigs: unknown[],
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  },
): unknown[] {
  const tagged = seriesConfigs.map((cfg) => ({
    cfg,
    seriesName: seriesNameFromEChartsSeriesConfig(cfg) ?? "",
  }));
  return sortProductAnalyticsTooltipAxisItems(
    tagged,
    comparisonPeriodLabels,
  ).map((row) => row.cfg);
}

export default function ExplorerChart({
  exploration,
  comparisonExploration = null,
  compareEnabled = false,
  error,
  submittedExploreState,
  loading,
  animate = true,
  submittedPreviousTimeFrame = null,
  serverBigNumberTrends = null,
}: {
  exploration: ProductAnalyticsExploration | null;
  comparisonExploration?: ProductAnalyticsExploration | null;
  compareEnabled?: boolean;
  error: string | null;
  submittedExploreState: ExplorationConfig;
  loading: boolean;
  /** When false, ECharts entry animations are disabled (e.g. for already-seen charts). */
  animate?: boolean;
  submittedPreviousTimeFrame?: ExplorationConfig["dateRange"] | null;
  serverBigNumberTrends?:
    | ProductAnalyticsRunComparisonPayload["bigNumberTrends"]
    | null;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";
  const gridLineColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const chartsContext = useDashboardCharts();
  const { getFactMetricById } = useDefinitions();

  // ECharts only auto-resizes on window resize, not when its parent container
  // changes (e.g. a dashboard block being resized via react-grid-layout or the
  // editing drawer collapsing). Observe the wrapper and call resize() so the
  // chart always fills its block.
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // Measured plot box. Compare-mode bars are sized in px off this so the previous
  // bar can frame the current one by a fixed pixel amount at any category count.
  const [chartBoxSize, setChartBoxSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // Callback ref: attaches the observer when the chart box mounts (it renders
  // conditionally), keeps the chart filling its block, and tracks its size.
  const attachChartWrapper = useCallback((el: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      const chart = chartInstanceRef.current;
      if (chart && !chart.isDisposed()) chart.resize();
      const width = el.clientWidth;
      const height = el.clientHeight;
      setChartBoxSize((prev) =>
        prev &&
        Math.abs(prev.width - width) < 4 &&
        Math.abs(prev.height - height) < 4
          ? prev
          : { width, height },
      );
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    resizeObserverRef.current = ro;
  }, []);
  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  const renderOpts: RenderOpts = useMemo(
    () => ({
      showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
      isRatioByIndex: getIsRatioByIndex(
        submittedExploreState,
        getFactMetricById,
      ),
    }),
    [submittedExploreState, getFactMetricById],
  );

  // Y-axis label: reflects whether we're rendering raw totals or per-unit
  // averages. Only populated when showAs applies (otherwise the toggle is
  // hidden and the number's meaning is carried by the metric/series name).
  const valueAxisName = useMemo(() => {
    if (!showAsAppliesTo(submittedExploreState, getFactMetricById)) return "";
    if (renderOpts.showAs === "total") return "Total";
    const sharedUnit = getSharedUnit(submittedExploreState);
    return sharedUnit ? `Per ${sharedUnit}` : "Per unit";
  }, [submittedExploreState, getFactMetricById, renderOpts.showAs]);

  const bigNumberComparisonTrends = useMemo(() => {
    if (!compareEnabled) return null;
    if (serverBigNumberTrends?.length) {
      return serverBigNumberTrends.map((t) =>
        t
          ? {
              currentValue: t.currentValue,
              previousValue: t.previousValue,
              pctChange: t.pctChangeFraction,
            }
          : null,
      );
    }
    return computeBigNumberComparisonTrends(
      exploration,
      comparisonExploration,
      submittedExploreState,
      getFactMetricById,
    );
  }, [
    compareEnabled,
    exploration,
    comparisonExploration,
    submittedExploreState,
    getFactMetricById,
    serverBigNumberTrends,
  ]);

  const bigNumberCards = useMemo(() => {
    if (
      !exploration?.result?.rows?.length ||
      submittedExploreState.chartType !== "bigNumber"
    ) {
      return null;
    }
    const row = exploration.result.rows[0];
    const valuesMeta = submittedExploreState.dataset?.values ?? [];
    return valuesMeta.map((v, metricIndex) => {
      const cell = row?.values[metricIndex];
      const value = cell
        ? getEffectiveMetricValue(cell, {
            showAs: renderOpts.showAs,
            isRatio: renderOpts.isRatioByIndex[metricIndex] ?? false,
          })
        : 0;
      return {
        value,
        label: v.name?.trim() ? v.name : `Metric ${metricIndex + 1}`,
      };
    });
  }, [
    exploration?.result?.rows,
    submittedExploreState,
    renderOpts.showAs,
    renderOpts.isRatioByIndex,
  ]);

  // Transform ProductAnalyticsResult + exploreState to ECharts format
  const chartConfig = useMemo(() => {
    if (
      !exploration?.result?.rows?.length ||
      !submittedExploreState ||
      ["table", "timeseries-table", "bigNumber"].includes(
        submittedExploreState.chartType,
      )
    )
      return null;
    const rows = exploration.result.rows;

    // Resolve date granularity for tooltip formatting
    const dateDimension = submittedExploreState.dimensions?.find(
      (d) => d.dimensionType === "date",
    );
    const resolvedGranularity: ResolvedGranularity | null = dateDimension
      ? getDateGranularity(
          dateDimension.dateGranularity,
          calculateProductAnalyticsDateRange(submittedExploreState.dateRange),
        )
      : null;
    const chartType = submittedExploreState.chartType;
    const firstDimensionIsDate =
      submittedExploreState.dimensions?.[0]?.dimensionType === "date";
    const isHorizontalBar =
      chartType === "horizontalBar" || chartType === "stackedHorizontalBar";
    const isStacked =
      chartType === "stackedBar" || chartType === "stackedHorizontalBar";

    const { uniqueXValues, dataMap, seriesMeta } =
      buildComparisonOverlaySeriesMaps(rows, submittedExploreState, renderOpts);

    const numMetrics = submittedExploreState?.dataset?.values?.length ?? 0;
    const numDimensions = submittedExploreState?.dimensions?.length ?? 0;

    // 2. Compute cumulative totals for sorting
    const seriesTotals: Record<string, number> = {};
    for (const [seriesKey, seriesData] of Object.entries(dataMap)) {
      seriesTotals[seriesKey] = Object.values(seriesData).reduce(
        (sum, v) => sum + v,
        0,
      );
    }
    const sortedSeriesKeys = Object.keys(dataMap).sort(
      (a, b) => seriesTotals[b] - seriesTotals[a],
    );

    const isBarType = [
      "bar",
      "stackedBar",
      "stackedHorizontalBar",
      "horizontalBar",
    ].includes(chartType);

    // Bar charts: sort categories by total value; timeseries: chronological
    let sortedXValues: string[];
    if (isBarType) {
      const xValueTotals = computeDimensionTotals(rows, 0, renderOpts);
      // Horizontal bars render bottom-to-top, so sort ascending for largest on top
      sortedXValues = Array.from(uniqueXValues).sort((a, b) =>
        isHorizontalBar
          ? xValueTotals[a] - xValueTotals[b]
          : xValueTotals[b] - xValueTotals[a],
      );
    } else {
      sortedXValues = Array.from(uniqueXValues).sort();
    }

    // 3. Build Series (ordered by cumulative total, highest first)
    const seriesColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
    const comparisonSeriesColor = (i: number) =>
      COMPARISON_SERIES_COLORS[i % COMPARISON_SERIES_COLORS.length];

    const compareOverlayActive =
      compareEnabled &&
      Boolean(comparisonExploration?.result?.rows?.length) &&
      supportsAlwaysOnComparisonOverlay(chartType);

    // Compare-mode bars draw the (wider) previous period on a second category
    // axis overlaid on the first, so it stays centered behind the current bar.
    const compareCategoryAxisKey: CompareCategoryAxisKey = isHorizontalBar
      ? "yAxisIndex"
      : "xAxisIndex";
    const needsDualCompareAxis = compareOverlayActive && isBarType;

    const comparisonPeriodLabels = compareOverlayActive
      ? getComparisonPeriodLabels(
          submittedExploreState.dateRange,
          submittedPreviousTimeFrame ?? undefined,
        )
      : null;

    const alignedComparisonOverlay =
      compareOverlayActive && comparisonExploration?.result?.rows?.length
        ? buildAlignedComparisonOverlayForExplorer({
            sortedXValues,
            comparisonRows: comparisonExploration.result.rows,
            submittedExploreState,
            renderOpts,
            sortedSeriesKeys,
            firstDimensionIsDate,
          })
        : null;
    const alignedComparisonDataForCurrent =
      alignedComparisonOverlay?.alignedMap ?? null;

    const sparseFlatCompareBars =
      compareOverlayActive &&
      !isStacked &&
      (chartType === "bar" || chartType === "horizontalBar") &&
      Boolean(alignedComparisonDataForCurrent) &&
      Boolean(comparisonPeriodLabels);

    const showLineAreaCompareTooltipDates =
      (chartType === "line" || chartType === "area") &&
      compareOverlayActive &&
      Boolean(comparisonPeriodLabels) &&
      Boolean(alignedComparisonOverlay) &&
      firstDimensionIsDate;

    // Compare-mode bar widths. The current bar is sized in px to ~75% of the
    // category band — matching ECharts' default bar width so it scales with the
    // available space like a normal (compare-off) bar — and the previous bar is
    // `current + 2 * frame`, framing it by a fixed pixel amount per side at any
    // category count (a percentage would scale the frame). On dense charts the
    // current width is capped so the wider previous bar still fits in the band.
    // Until the plot is measured, both fall back to responsive percentages.
    const COMPARE_BAR_FRAME_PX = 7;
    const COMPARE_BAR_CURRENT_FRACTION = 0.75;
    const compareBarWidths: {
      current: number | string | undefined;
      previous: number | string | undefined;
    } = (() => {
      if (!needsDualCompareAxis) {
        return { current: undefined, previous: undefined };
      }
      if (!chartBoxSize) {
        return { current: "75%", previous: "81%" };
      }
      const numTicks = Math.max(
        1,
        sparseFlatCompareBars
          ? sortedXValues.length * sortedSeriesKeys.length
          : sortedXValues.length,
      );
      // Plot extent along the category axis, matching the grid insets set on the
      // ECharts option below (legend pushes the top down ~58px when shown).
      const plotExtent = isHorizontalBar
        ? Math.max(1, chartBoxSize.height - 58 - chartBoxSize.height * 0.1)
        : chartBoxSize.width * (1 - 0.08 - 0.05);
      const band = plotExtent / numTicks;
      const frameTotal = 2 * COMPARE_BAR_FRAME_PX;
      const maxCurrent = Math.max(4, band - frameTotal - 2);
      const currentPx = Math.max(
        4,
        Math.min(Math.round(band * COMPARE_BAR_CURRENT_FRACTION), maxCurrent),
      );
      return { current: currentPx, previous: currentPx + frameTotal };
    })();

    let categoryAxisValues: string[] = sortedXValues;
    let seriesConfigs: unknown[];

    if (sparseFlatCompareBars && alignedComparisonDataForCurrent) {
      const built = buildExplorerCompareSparseFlatBarSeries({
        sourceSortedXValues: sortedXValues,
        sourceSeriesKeys: sortedSeriesKeys,
        sourceSeriesMeta: seriesMeta,
        currentDataMap: dataMap,
        previousDataMap: alignedComparisonDataForCurrent,
        comparisonPeriodLabels: comparisonPeriodLabels!,
        seriesColor,
        comparisonSeriesColor,
        animate,
        compareCategoryAxisKey,
        currentBarWidth: compareBarWidths.current ?? "58%",
        previousBarWidth: compareBarWidths.previous ?? "66%",
      });
      seriesConfigs = built.series;
      categoryAxisValues = built.flatCategoryData;
    } else {
      seriesConfigs = buildExplorerChartComparisonSeriesList({
        chartType,
        sourceDataMap: dataMap,
        sourceSeriesMeta: seriesMeta,
        sourceSeriesKeys: sortedSeriesKeys,
        sourceSortedXValues: sortedXValues,
        numMetrics,
        numDimensions,
        isStacked,
        compareOverlayActive,
        comparisonPeriodLabels,
        seriesColor,
        comparisonSeriesColor,
        animate,
        compareCategoryAxisKey: needsDualCompareAxis
          ? compareCategoryAxisKey
          : undefined,
        currentBarWidth: compareBarWidths.current,
        previousBarWidth: compareBarWidths.previous,
      });

      if (compareOverlayActive && alignedComparisonDataForCurrent) {
        seriesConfigs = [
          ...seriesConfigs,
          ...buildExplorerChartComparisonSeriesList({
            chartType,
            sourceDataMap: alignedComparisonDataForCurrent,
            sourceSeriesMeta: seriesMeta,
            sourceSeriesKeys: sortedSeriesKeys,
            sourceSortedXValues: sortedXValues,
            numMetrics,
            numDimensions,
            isStacked,
            compareOverlayActive,
            comparisonPeriodLabels,
            previous: true,
            seriesColor,
            comparisonSeriesColor,
            animate,
            compareCategoryAxisKey: needsDualCompareAxis
              ? compareCategoryAxisKey
              : undefined,
            currentBarWidth: compareBarWidths.current,
            previousBarWidth: compareBarWidths.previous,
          }),
        ];
      }
    }

    if (comparisonPeriodLabels && seriesConfigs.length > 1) {
      seriesConfigs = sortSeriesConfigsForCompareLegendOrder(
        seriesConfigs,
        comparisonPeriodLabels,
      );
    }

    const legendShow = seriesConfigs.length > 0;

    const axisPointerLabelFormatter =
      resolvedGranularity && !sparseFlatCompareBars
        ? (params: { value: string | number }) => {
            const date =
              typeof params.value === "number"
                ? new Date(params.value)
                : new Date(String(params.value));
            return formatDateByGranularity(date, resolvedGranularity);
          }
        : undefined;

    // Define the category axis (shows the dimension labels)
    const categoryAxis = {
      type: chartType === "line" || chartType === "area" ? "time" : "category",
      data: categoryAxisValues,
      nameLocation: "middle" as const,
      nameTextStyle: {
        fontSize: 14,
        fontWeight: "bold",
        padding: [10, 0],
        color: textColor,
      },
      axisLabel: {
        color: textColor,
        rotate: isHorizontalBar ? 0 : -45,
        hideOverlap: true,
      },
      // Only attach the axisPointer key when we actually have a formatter to
      // apply. Setting `axisPointer: undefined` overwrites ECharts' default
      ...(axisPointerLabelFormatter
        ? {
            axisPointer: {
              label: { formatter: axisPointerLabelFormatter },
            },
          }
        : {}),
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    };

    // Define the value axis (shows the numeric values)
    const valueAxis = {
      type: "value" as const,
      scale: false,
      name: valueAxisName,
      nameLocation: "middle" as const,
      nameGap: 50,
      nameTextStyle: {
        fontSize: 14,
        fontWeight: "bold",
        padding: [40, 0],
        color: textColor,
      },
      axisLabel: { color: textColor, formatter: formatNumber },
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    };

    // Compare-mode bars overlay the previous period on a second category axis
    // (same categories, hidden) so a wider previous bar stays centered behind
    // the current one. The value axis stays shared so both periods use the same
    // scale and the auto-rounded value labels are preserved.
    // Keep the overlaid axis "shown" (so its axisPointer participates and the
    // linked axis tooltip still gathers the previous-period series — a fully
    // hidden axis is dropped from the tooltip), but hide every visual so it
    // overlays the primary axis invisibly.
    const secondaryCategoryAxis = needsDualCompareAxis
      ? {
          ...categoryAxis,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          axisPointer: { label: { show: false } },
        }
      : null;
    const categoryAxisOption = secondaryCategoryAxis
      ? [categoryAxis, secondaryCategoryAxis]
      : categoryAxis;

    // Swap axes for horizontal bar
    const xAxis = isHorizontalBar ? valueAxis : categoryAxisOption;
    const yAxis = isHorizontalBar ? categoryAxisOption : valueAxis;

    const tooltipFormatter = buildExplorerChartTooltipFormatter({
      resolvedGranularity,
      compositeCategoryAxisTooltip: sparseFlatCompareBars,
      firstDimensionIsDate,
      comparisonPeriodLabels,
      showLineAreaCompareTooltipDates,
      alignedComparisonOverlay,
      sortedXValues,
      seriesConfigsLength: seriesConfigs.length,
      formatNumber,
    });

    return {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        padding: [10, 14],
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        axisPointer: {
          type: [
            "bar",
            "stackedBar",
            "stackedHorizontalBar",
            "horizontalBar",
          ].includes(chartType)
            ? "shadow"
            : "cross",
        },
        formatter: tooltipFormatter,
      },
      // Link the overlaid category axes so the axis tooltip gathers both the
      // current and previous series (otherwise it only collects one axis).
      ...(needsDualCompareAxis
        ? { axisPointer: { link: [{ [compareCategoryAxisKey]: "all" }] } }
        : {}),
      legend: {
        show: legendShow,
        type: "plain",
        left: "center",
        top: 8,
        width: "88%",
        padding: [8, 0, 20, 0],
        textStyle: { color: textColor },
        // Show "(current)" / "(prior)" in the legend instead of the full date
        // ranges (which are long and wrap). Series names keep the date ranges so
        // the tooltip can still show the exact periods on hover.
        ...(comparisonPeriodLabels
          ? {
              formatter: (name: string) => {
                const { baseName, period } = parseComparisonTooltipSeriesName(
                  name,
                  comparisonPeriodLabels,
                );
                if (period === "current") {
                  return baseName ? `${baseName} (current)` : "current";
                }
                if (period === "previous") {
                  return baseName ? `${baseName} (prior)` : "prior";
                }
                return name;
              },
            }
          : {}),
      },
      xAxis,
      yAxis,
      series: seriesConfigs,
    };
  }, [
    exploration?.result?.rows,
    comparisonExploration?.result?.rows,
    compareEnabled,
    submittedExploreState,
    submittedPreviousTimeFrame,
    renderOpts,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    animate,
    valueAxisName,
    chartBoxSize,
  ]);

  const hasEmptyData = useMemo(() => {
    if (!exploration?.result?.rows?.length) return true;
    return exploration.result.rows.every((r) => r.values.length === 0);
  }, [exploration?.result?.rows]);

  if (
    !shouldChartSectionShow({
      loading,
      error,
      submittedExploreState,
    })
  )
    return null;

  return (
    <Flex
      direction="column"
      position="relative"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        flex: 1,
        minHeight: 0,
      }}
    >
      {error ? (
        <Box p="4">
          {isManagedWarehousePendingQueryError(error) ? (
            <ManagedWarehouseNoEventsCallout />
          ) : (
            <Callout status="error">{error}</Callout>
          )}
        </Box>
      ) : !exploration ? (
        <Flex
          p="4"
          style={{ textAlign: "center", flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            No data available. Select a metric to see results.
          </Text>
        </Flex>
      ) : hasEmptyData ? (
        <Flex
          p="4"
          style={{ textAlign: "center", flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            The query ran successfully, but no data was returned.
          </Text>
        </Flex>
      ) : bigNumberCards && bigNumberCards.length > 0 ? (
        <Flex
          direction="column"
          p="4"
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <Box
            style={{
              display: "grid",
              flex: 1,
              minHeight: 0,
              width: "100%",
              height: "100%",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, max(11rem, calc((100% - 3rem) / 4))), 1fr))",
              gridAutoRows: "minmax(0, 1fr)",
              gap: "var(--space-4)",
              alignItems: "stretch",
            }}
          >
            {bigNumberCards.map((card, metricIndex) => {
              const trend = bigNumberComparisonTrends?.[metricIndex];
              return (
                <Box
                  key={`${card.label}-${metricIndex}`}
                  style={{
                    minWidth: 0,
                    minHeight: 0,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#ffffff",
                    borderRadius: "var(--radius-4)",
                    boxShadow:
                      theme === "dark"
                        ? "0 1px 3px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)"
                        : "var(--shadow-3)",
                    padding: "var(--space-4)",
                  }}
                >
                  <BigValueChart
                    value={card.value}
                    formatter={formatNumber}
                    label={card.label}
                    compact
                    compareSlot={
                      trend ? (
                        <ComparisonTrendLabel
                          trend={trend}
                          priorValueScale={0.5}
                        />
                      ) : undefined
                    }
                  />
                </Box>
              );
            })}
          </Box>
        </Flex>
      ) : chartConfig ? (
        <Box
          ref={attachChartWrapper}
          style={{ flex: 1, minHeight: 0, position: "relative" }}
        >
          <EChartsReact
            key={`${submittedExploreState.chartType}:${JSON.stringify(chartConfig)}`}
            notMerge
            option={{
              ...chartConfig,
              ...(animate ? {} : { animation: false }),
              padding: [0, 0, 0, 0],
              grid: {
                left:
                  submittedExploreState?.chartType === "horizontalBar" ||
                  submittedExploreState?.chartType === "stackedHorizontalBar"
                    ? "10%"
                    : "8%",
                right: "5%",
                top: chartConfig.legend?.show ? 58 : "8%",
                bottom: "10%",
              },
            }}
            style={{ width: "100%", height: "100%" }}
            onChartReady={(chart) => {
              chartInstanceRef.current = chart ?? null;
              if (chartsContext && chart) {
                chartsContext.registerChart(CHART_ID, chart);
              }
            }}
          />
        </Box>
      ) : (
        <Box p="4" style={{ textAlign: "center" }}>
          <HelperText status="error">Unknown chart type</HelperText>
        </Box>
      )}
    </Flex>
  );
}
